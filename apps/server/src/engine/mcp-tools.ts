import { z } from "zod";
import type { NeutralTool } from "./tool-kit.ts";

/**
 * MCP（Model Context Protocol）接入。
 *
 * 背景：官方 Muse（com.facebook.aura）内嵌了完整的 MCP SDK（registry / session / 2025-06-18 规范），
 * 能挂接任意 MCP 服务器；OpenMuse 这边原本一个工具都是硬编码的。这里补上客户端侧：
 * 把配置里声明的 MCP 服务器上的工具，转换成中性的 `NeutralTool`，于是**两个引擎都能用**
 * （自带引擎经 `forAgUi`，Mastra 经 `forMastra`）。
 *
 * 配置（环境变量 MCP_SERVERS，JSON 数组）：
 *   [{"name":"fs","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp/sandbox"]}]
 *   [{"name":"remote","transport":"http","url":"https://example.com/mcp"}]
 *
 * 设计取舍：
 * - **同步取用、异步刷新**：工具数组是在同步上下文里拼的（run 方法内），所以对外只暴露缓存；
 *   连接与 listTools 由 `refreshMcpTools()` 在启动时与定期执行。坏掉的服务器不会拖住对话。
 * - 工具名统一加前缀 `mcp__<server>__<tool>`，避免与内置工具撞名。
 * - MCP 的入参是 JSON Schema，这里转成 zod（够用的子集：object/array/string/number/boolean/enum/anyOf-null）。
 */

interface McpServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** 已连接的工具缓存（同步读取用）。 */
let cache: NeutralTool[] = [];
let lastRefresh: { at: number; summary: string; tools: number } = { at: 0, summary: "未刷新", tools: 0 };
const clients = new Map<string, unknown>();

export function mcpToolCount(): number {
  return cache.length;
}

export function mcpStatus(): { at: number; summary: string; tools: number } {
  return { at: lastRefresh.at, summary: lastRefresh.summary, tools: cache.length };
}

/** 同步读取缓存（对话构建工具时调用）。 */
export function mcpTools(): NeutralTool[] {
  return cache;
}

function parseServers(): McpServerConfig[] {
  const raw = process.env.MCP_SERVERS?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("MCP_SERVERS 必须是 JSON 数组");
    return parsed.filter((s) => s && typeof s.name === "string" && (s.transport === "stdio" || s.transport === "http"));
  } catch (error) {
    console.warn("[mcp] MCP_SERVERS 解析失败，已忽略：", error instanceof Error ? error.message : error);
    return [];
  }
}

/** 工具名清洗：MCP 工具名可能带点号/斜杠，统一成 Telegram/模型都安全的形式。 */
function toolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
}

/** JSON Schema（MCP 入参）→ zod 的最小可用子集转换。 */
function jsonSchemaToZod(schema: unknown): z.ZodType {
  if (!schema || typeof schema !== "object") return z.any();
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf)) {
    const parts = s.anyOf.map(jsonSchemaToZod);
    return parts.length === 1 ? parts[0] : z.union(parts as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  if (Array.isArray(s.enum)) return z.enum(s.enum.map(String) as [string, ...string[]]);
  switch (s.type) {
    case "object": {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const shape: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries(props)) {
        const inner = jsonSchemaToZod(value);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      return z.object(shape).passthrough();
    }
    case "array":
      return z.array(jsonSchemaToZod(s.items));
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    default:
      return z.any();
  }
}

/** 把 MCP 工具结果压成一段文本（内容可能是 text / image / resource）。 */
function renderResult(result: unknown): unknown {
  const r = result as { content?: unknown; isError?: boolean; structuredContent?: unknown };
  if (r?.structuredContent && !r.content) return r.structuredContent;
  if (!Array.isArray(r?.content)) return r ?? null;
  const parts = (r.content as { type?: string; text?: string; uri?: string; mimeType?: string }[]).map((part) => {
    if (part?.type === "text") return part.text ?? "";
    if (part?.type === "image") return `[image ${part.mimeType ?? ""}]`;
    if (part?.type === "resource") return `[resource ${part.uri ?? ""}]`;
    return `[${part?.type ?? "unknown"}]`;
  });
  return { isError: r.isError === true, content: parts.join("\n") };
}

/** 建立连接并拉取工具列表；失败的服务器只记日志、不影响其它服务器与对话。 */
export async function refreshMcpTools(): Promise<{ at: number; summary: string; tools: number }> {
  const servers = parseServers();
  if (!servers.length) {
    cache = [];
    lastRefresh = { at: Date.now(), summary: "未配置 MCP 服务器（MCP_SERVERS 为空）", tools: 0 };
    return mcpStatus();
  }

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const collected: NeutralTool[] = [];
  const notes: string[] = [];

  for (const server of servers) {
    try {
      let transport: unknown;
      if (server.transport === "stdio") {
        if (!server.command) throw new Error("stdio 传输缺少 command");
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        transport = new StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          env: { ...(process.env as Record<string, string>), ...(server.env ?? {}) },
          stderr: "ignore",
        });
      } else {
        if (!server.url) throw new Error("http 传输缺少 url");
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        transport = new StreamableHTTPClientTransport(new URL(server.url));
      }

      // 旧连接先关掉，避免刷新时泄漏子进程
      const previous = clients.get(server.name) as { close?: () => Promise<void> } | undefined;
      if (previous?.close) await previous.close().catch(() => {});

      const client = new Client({ name: "openmuse", version: "1.0.0" });
      await client.connect(transport as never);
      clients.set(server.name, client);

      const listed = await client.listTools();
      const tools = listed?.tools ?? [];
      for (const tool of tools) {
        const name = toolName(server.name, tool.name);
        collected.push({
          name,
          description: `[MCP:${server.name}] ${tool.description ?? tool.name}`,
          parameters: jsonSchemaToZod(tool.inputSchema) as z.ZodType,
          execute: async (args: unknown) => {
            try {
              const result = await client.callTool(
                { name: tool.name, arguments: (args ?? {}) as Record<string, unknown> },
                undefined,
                { timeout: 120_000 },
              );
              return renderResult(result);
            } catch (error) {
              return { error: `MCP 调用失败（${server.name}/${tool.name}）：${error instanceof Error ? error.message : String(error)}` };
            }
          },
        });
      }
      notes.push(`${server.name}: ${tools.length} 个工具`);
      console.log(`[mcp] ${server.name} 已连接，暴露 ${tools.length} 个工具`);
    } catch (error) {
      notes.push(`${server.name}: 连接失败`);
      console.warn(`[mcp] ${server.name} 连接失败：`, error instanceof Error ? error.message : error);
    }
  }

  cache = collected;
  lastRefresh = { at: Date.now(), summary: notes.join("；") || "无服务器", tools: collected.length };
  return mcpStatus();
}

/** 启动时调用一次：失败不抛出，避免影响服务启动。 */
export async function startMcp(): Promise<void> {
  try {
    const status = await refreshMcpTools();
    console.log(`[mcp] 初始化完成：${status.summary}（共 ${status.tools} 个工具）`);
  } catch (error) {
    console.warn("[mcp] 初始化异常（已忽略）：", error instanceof Error ? error.message : error);
  }
}
