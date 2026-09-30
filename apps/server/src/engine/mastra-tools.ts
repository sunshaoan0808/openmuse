import { createTool } from "@mastra/core/tools";
import { instrument, type NeutralTool } from "./tool-kit.ts";

/**
 * 把中性工具转成 Mastra 工具。
 *
 * 放在单独文件里，是为了让 Mastra 的依赖只在 `AGENT_ENGINE=mastra` 时被引入
 * （`tool-kit.ts` 本身不导入 Mastra）。
 *
 * Mastra 的 `execute(inputData, context)` 第二个参数是执行上下文（含 requestContext），
 * 中性工具不需要它，直接忽略——工具自身的闭包里已经带了 owner/thread/signal。
 */
export function forMastra(tools: readonly NeutralTool[]) {
  return Object.fromEntries(
    tools.map(instrument).map((tool) => [
      tool.name,
      createTool({
        id: tool.name,
        description: tool.description,
        // 仓库用 zod v4，Mastra 1.x 的 peer 范围是 ^3.25 || ^4，运行期一致；
        // 类型层面 Mastra 按 v3 形状声明，这里按值传递、由 Mastra 自己做校验。
        inputSchema: tool.parameters as never,
        execute: async (inputData: unknown) => tool.execute(inputData as never),
      }),
    ]),
  );
}
