import { createHash, randomUUID } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { MastraAgent } from "@ag-ui/mastra";
import { computerTools } from "../computer-tools.ts";
import { MODEL_MAX_RETRIES } from "../config.ts";
import type { Config } from "../config.ts";
import { chatInstructions } from "./chat-prompt.ts";
import { reportStepLimit, splitTextAtToolCalls, stateTools } from "./tanstack-agent.ts";
import { chatTools } from "./chat-tools.ts";
import { forMastra } from "./mastra-tools.ts";
import type { AgentService } from "./service.ts";
import type { NeutralTool } from "./tool-kit.ts";

/**
 * C 路线的第二引擎：Mastra（与 OpenMuse 自带引擎并存、实战对比）。
 *
 * 与自带引擎的差异：
 * - 模型走 AI SDK 的 `chat()`（明确 /chat/completions，网关兼容性最好）；自带引擎走 `@tanstack/ai`
 *   的 OpenAI 适配器（该适配器 chat/completions 与 responses 两种端点都支持）；
 * - 工具集与自带引擎**同源**（`computerTools` + `chatTools` 经 `forMastra` 套壳），
 *   所以 Mastra 现在也能干活，不再是"只会聊天"；
 * - 审批链（AG-UI 的 TOOL_CALL_* 事件流）仍是自带引擎独有：Mastra 侧的工具直接执行；
 * - 系统提示词与自带引擎**共用一份**（`chat-prompt.ts`），从此不会两边漂移。
 */

/** 每请求构造一个 AG-UI 兼容的 Mastra agent；缺配置返回 undefined。 */
export function createMastraChatAgent(
  config: Config,
  ctx: { service: AgentService; owner: string },
): MastraAgent | undefined {
  // 每请求一个 requestKey：与自带引擎一致——同一请求内重试不会重复建任务/目标，跨请求则会新建。
  const requestKey = randomUUID();
  const key = (name: string, value: unknown) =>
    `${requestKey}:${name}:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  const signal = new AbortController().signal;
  const baseURL = process.env.OPENAI_BASE_URL;
  const modelId = (config.model ?? "").replace(/^openai\//, "");
  if (!baseURL || !modelId) return undefined;
  const gateway = createOpenAI({
    baseURL,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "gateway",
  });
  // 与自带引擎同源的同一批工具，只换外壳（forMastra）。
  // threadId 用稳定的 owner 级键：Mastra 侧不做按线程的浏览器隔离，复用同一会话还能绕开
  // worker 的 maxSessions 上限（自带引擎的历史遗留问题，见 docs/自建后端可行性评估.md §9）。
  const tools = forMastra([
    ...computerTools(
      ctx.service.computer,
      ctx.service.files,
      ctx.owner,
      `mastra:${requestKey}`,
      { signal },
    ),
    ...chatTools({
      service: ctx.service,
      owner: ctx.owner,
      threadId: `mastra:${ctx.owner}`,
      requestKey,
      key,
      signal,
    }),
    // App 状态工具：与自带引擎同名同义（自带引擎在 tanstackAgent 内部自动挂这两个）。
    // 客户端按工具名把结果转成 STATE_SNAPSHOT / STATE_DELTA，所以工具在、名字对，状态功能即对等。
    ...stateTools.map(
      (tool) =>
        ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: (args: unknown) => (tool.execute as (a: unknown) => Promise<unknown>)(args),
        }) as NeutralTool,
    ),
  ]);
  const agent = new Agent({
    id: "openmuse-mastra",
    name: "openmuse-mastra",
    instructions: chatInstructions(),
    // 用 chat() 明确走 /chat/completions：网关是 OpenAI 兼容端点，不保证实现 /responses。
    model: gateway.chat(modelId),
    tools,
  });
  // 与自带引擎的 maxSteps: 10 对齐。
  // MastraAgent 桥在内部调 agent.stream() 时**不转发** maxSteps（AgentConfig 里也没有这个字段），
  // 而 Mastra 默认步数较小，多步工具任务会提前停。这里在实例上包一层 stream 注入该选项，
  // 不改 node_modules、不动桥的私有实现。
  const stream = agent.stream.bind(agent);
  agent.stream = ((messages: never, options?: never) =>
    stream(messages, {
      ...((options ?? {}) as object),
      maxSteps: 10,
      // 与自带引擎的 MODEL_MAX_RETRIES 对齐（AI SDK 侧的重试次数）
      maxRetries: MODEL_MAX_RETRIES,
    } as never)) as typeof agent.stream;
  const mastraAgent = new MastraAgent({ agent, resourceId: ctx.owner });
  // 复用自带引擎的两层事件后处理，补齐 Mastra 桥不做的事：
  //  - splitTextAtToolCalls：工具调用前后的文本各起一条消息（否则整轮共用一个 messageId）
  //  - reportStepLimit：步数用尽而非模型收尾时补一句说明，避免"静默结束"
  const baseRun = mastraAgent.run.bind(mastraAgent);
  mastraAgent.run = ((input: Parameters<typeof baseRun>[0]) =>
    reportStepLimit(
      splitTextAtToolCalls(baseRun(input)),
      10,
      "我达到了本轮步数上限还没收尾。回复“继续”，我接着做。",
    )) as typeof mastraAgent.run;
  return mastraAgent;
}
