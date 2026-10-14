import "./config.ts";
import { HttpAgent } from "@ag-ui/client";
import type { AgentRunner } from "@copilotkit/runtime/v2";
import {
  type AgentsFactory,
  type CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import { ConversationAgent } from "./engine/conversation.ts";
import { createMastraChatAgent } from "./engine/mastra-engine.ts";
import { loadAssistantContext } from "./engine/assistant-context.ts";
import type { AgentService } from "./engine/service.ts";
import { createJevAdapter, type JevAdapter } from "./jev/adapter.ts";

export function agentConfigured(config: Config) {
  return (
    config.agentBackend === "sample" ||
    (config.agentBackend === "agui"
      ? Boolean(config.agentUrl)
      : Boolean(
          config.model &&
            (process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              process.env.GOOGLE_API_KEY),
        ))
  );
}
/** 从请求头解析 owner（与 identifyUser 同源），供引擎工厂使用。 */

/**
 * 不让入站的 `Authorization` 转发给 agent。
 *
 * 为什么必须显式关掉：CopilotKit 的运行时**按设计**会把入站请求的
 * `authorization` 与自定义 `x-*` 头转发到 agent 上（那是给"远程 agent 拿服务令牌"用的场景，
 * 见其 `forwardHeaders` 文档与 DEFAULT_DENY_HEADER_NAMES —— 默认黑名单只挡
 * `x-forwarded-*`/`x-real-ip` 之类代理头，**不挡 authorization**）。
 *
 * 而 `@ag-ui/mastra` 会把 agent 身上的 headers 塞进模型调用的
 * `modelSettings.headers`，于是 app 的会话令牌（`Bearer <43 字>`）**覆盖掉 provider 的 apiKey**，
 * 被当成模型 API key 发给网关 —— 实测网关回 401 Invalid API key，且现象极具迷惑性：
 * 同样的 key 用 curl 或直接调 agent 都是 200，只有走 HTTP 聊天这条路才 401。
 *
 * 我们的 agent 是**进程内**的，不需要任何入站头，所以这里直接拒绝转发 authorization。
 */
const FORWARD_HEADERS: { deny: string[] } = { deny: ["authorization"] };

export function makeRuntime(
  config: Config,
  service: AgentService,
  auth: Auth,
  intelligence: CopilotKitIntelligence | undefined,
  runner?: AgentRunner,
) {
  // Built on first use, then shared so live mode reuses one TypeSafe client across requests.
  let jevAdapter: JevAdapter | undefined;
  const sharedJevAdapter = () => (jevAdapter ??= createJevAdapter(config));
  const agents: AgentsFactory = async ({ request }) => {
    const owner = await auth.owner(request.headers.get("authorization") ?? undefined);
    // 角色 + 长期记忆（两个引擎共用同一段；读不到则返回空片段，行为与接入前一致）。
    const contextBlock = (await loadAssistantContext(service, owner)).block;
    return {
      default:
        config.agentEngine === "mastra"
          ? (() => {
              const mastra = createMastraChatAgent(
                config,
                {
                  service,
                  owner: owner,
                },
                contextBlock,
              );
              if (!mastra)
                throw new Error(
                  "AGENT_ENGINE=mastra 需要 MODEL（如 openai/vendor/model）与 OPENAI_BASE_URL",
                );
              return mastra;
            })()
          : config.agentBackend === "sample"
            ? new ConversationAgent(config, service, owner, sharedJevAdapter())
            : config.agentBackend === "agui"
              ? new HttpAgent({
                  url: config.agentUrl ?? "http://127.0.0.1:1/unconfigured",
                  headers: config.agentToken
                    ? { Authorization: `Bearer ${config.agentToken}` }
                    : {},
                })
              : new ConversationAgent(config, service, owner, sharedJevAdapter()),
    };
  };
  // 两条分支对应官方两种运行时模式：
  //  - 有 Intelligence → CopilotIntelligenceRuntimeOptions（云或自家垫片，持久线程 + 实时通道）
  //  - 无 Intelligence → CopilotSseRuntimeOptions（标准 AG-UI/SSE + 本地线程端点）
  const runtime = intelligence
    ? new CopilotRuntime({
        agents,
        intelligence,
        forwardHeaders: FORWARD_HEADERS,
        identifyUser: async (request: Request) => ({
          id: await auth.owner(request.headers.get("authorization") ?? undefined),
          name: "OpenMuse user",
        }),
        generateThreadNames: false,
      })
    : new CopilotRuntime({
        agents,
        ...(runner ? { runner } : {}),
        forwardHeaders: FORWARD_HEADERS,
        identifyUser: async (request: Request) => ({
          id: await auth.owner(request.headers.get("authorization") ?? undefined),
          name: "OpenMuse user",
        }),
      });
  return createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });
}
