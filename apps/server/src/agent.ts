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
    return {
      default:
        config.agentEngine === "mastra"
          ? (() => {
              const mastra = createMastraChatAgent(config, {
                service,
                owner: owner,
              });
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
        identifyUser: async (request: Request) => ({
          id: await auth.owner(request.headers.get("authorization") ?? undefined),
          name: "OpenMuse user",
        }),
        generateThreadNames: false,
      })
    : new CopilotRuntime({
        agents,
        ...(runner ? { runner } : {}),
        identifyUser: async (request: Request) => ({
          id: await auth.owner(request.headers.get("authorization") ?? undefined),
          name: "OpenMuse user",
        }),
      });
  return createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });
}
