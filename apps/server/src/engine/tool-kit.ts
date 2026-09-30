import { defineTool } from "@copilotkit/runtime/v2";
import type { z } from "zod";

/**
 * 中性工具描述符：与具体 agent 框架无关。
 *
 * 背景：仓库里同一批工具要喂给两个引擎——自带的 AG-UI/tanstack 引擎（用 `defineTool`）
 * 与 Mastra 引擎（用 `createTool`）。此前工具直接用 `defineTool` 写死，Mastra 那边就拿不到。
 * 现在统一成这个形状：定义一次，两边各套一层外壳。
 *
 * 注意：本文件**不导入 Mastra**，避免自带引擎路径被拖上 Mastra 依赖图。
 */
export interface NeutralTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: S;
  execute: (args: z.output<S>) => Promise<unknown>;
}

/** 套回自带引擎的 `defineTool`（AG-UI / tanstack agent 用）。 */
export function forAgUi(tools: readonly NeutralTool[]) {
  return tools.map(instrument).map((tool) =>
    defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: (args) => tool.execute(args as never),
    }),
  );
}

/** 参数摘要：只看键与截断值，够复盘"模型到底发了什么查询"，也不把大段内容灌进日志。 */
function summarize(args: unknown) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .slice(0, 6)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
      return `${key}=${(text ?? "").replace(/\s+/g, " ").slice(0, 200)}`;
    })
    .join(" ");
}

/** 结果摘要：键名 + 字节规模 + 结果条数/后端/错误，足以判断"工具给了什么"。 */
function describeResult(result: unknown) {
  if (!result || typeof result !== "object") return String(result).slice(0, 120);
  const record = result as Record<string, unknown>;
  const hints: string[] = [];
  if (typeof record.error === "string")
    hints.push(`error=${record.error.replace(/\s+/g, " ").slice(0, 150)}`);
  if (typeof record.backend === "string") hints.push(`backend=${record.backend}`);
  if (Array.isArray(record.results)) hints.push(`results=${record.results.length}`);
  if (Array.isArray(record.elements)) hints.push(`elements=${record.elements.length}`);
  if (Array.isArray(record.pages)) hints.push(`pages=${record.pages.length}`);
  if (typeof record.answer === "string")
    hints.push(`answer=${record.answer.replace(/\s+/g, " ").slice(0, 120)}`);
  let size = 0;
  try {
    size = JSON.stringify(result).length;
  } catch {
    size = 0;
  }
  return `${Object.keys(record).slice(0, 7).join(",")} ${size}B ${hints.join(" ")}`.trim();
}

/**
 * 工具调用留痕：线上出现"答非所问"时，后台必须能复盘到**模型实际传的参数**与结果规模——
 * 否则只能靠猜（曾经真的猜不出来：会话不落库、日志也不记工具调用）。
 * 只打印参数摘要与规模，不回显完整内容。
 */
export function instrument<S extends z.ZodType>(tool: NeutralTool<S>): NeutralTool<S> {
  return {
    ...tool,
    execute: async (args) => {
      const started = Date.now();
      const summary = summarize(args);
      try {
        const result = await tool.execute(args);
        console.log(
          `[tool] ${tool.name} ${summary} → ${describeResult(result)} (${Date.now() - started}ms)`,
        );
        return result;
      } catch (error) {
        console.log(
          `[tool] ${tool.name} ${summary} → 抛错 ${error instanceof Error ? error.message.slice(0, 200) : String(error)} (${Date.now() - started}ms)`,
        );
        throw error;
      }
    },
  };
}
