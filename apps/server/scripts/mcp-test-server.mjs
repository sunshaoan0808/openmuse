#!/usr/bin/env node
/**
 * 最小可用的 stdio MCP 测试服务器（用于验证 OpenMuse 的 MCP 接入）。
 *
 * 用法（在 .env 里配置）：
 *   MCP_SERVERS=[{"name":"test","transport":"stdio","command":"node","args":["apps/server/scripts/mcp-test-server.mjs"]}]
 *
 * 暴露两个工具：
 *   - add(a, b)：加法，用来验证「入参 JSON Schema → zod → 模型正确调用」
 *   - host_info()：返回主机名与时间，验证无参工具
 */
import os from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "openmuse-test-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "add",
      description: "把两个数字相加，返回整数结果。用于验证 MCP 工具调用链路。",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number", description: "第一个数" },
          b: { type: "number", description: "第二个数" },
        },
        required: ["a", "b"],
      },
    },
    {
      name: "host_info",
      description: "返回运行本 MCP 服务器的主机名与当前时间。",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name === "add") {
    const sum = Number(args.a) + Number(args.b);
    return { content: [{ type: "text", text: `MCP 加法结果：${sum}` }] };
  }
  if (name === "host_info") {
    return {
      content: [{ type: "text", text: `host=${os.hostname()} time=${new Date().toISOString()}` }],
    };
  }
  return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
});

await server.connect(new StdioServerTransport());
