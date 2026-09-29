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
  return tools.map((tool) =>
    defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: (args) => tool.execute(args as never),
    }),
  );
}
