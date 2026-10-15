# 任务单回报：P0 工具执行收口（nanoMuse 机制落地）

**执行者：Hermes（我接手实现并自验）**。
dsh 两轮不合格：第 1 轮在共享的线上树里留了 `model.ts` 语法错（服务崩 15 次，见 TODO）；
第 2 轮交付把工具抛错吞成 `{error}`，打挂 `tests/site-accounts.test.ts`（582→581），
另有 3 处 stub + 1 个自造字段 + 缺回报 + 留 `.bak`。
第 3 轮作业已存档（`~/backups/dsh-p0-round3-20261015T001339/work.patch`），本单由我按单子规格实现。

## 做到了什么

1. **新增单一执行咽喉** `apps/server/src/engine/tool-executor.ts`
   —— 入口 `runToolCall(tool, args, ctx, deps)`，固定顺序：
   **拒绝名单 → 评估（静态 `risk` + 逐次 `assess` 合并）→ 判定要拦就拦 → 放行 → 真正执行 → 结果脱敏 → 审计**。
   评估器自己抛错时 **fail closed**（拦住并记审计），不赌。
2. **工具自己声明危险性**（关键设计，未省）：
   - 静态档位 `risk: "safe" | "moderate" | "sensitive"`（`moderate` 放行但必进审计；`sensitive` 默认拦）
   - 逐次覆写 `assess(args) → { risk?, target?, egress?, egressTarget?, summary?, warnings?, redact? }`
   - 结果脱敏：**只在 `redact: true` 时动手**（默认一字不改 → 兼容），键名像凭据或值像凭据的替换成 `[REDACTED]`
3. **两个引擎只能经这个入口** —— 接线点**只有一处**：`tool-kit.ts` 的 `instrument()`
   （自带引擎 `forAgUi`、Mastra `forMastra` 都先 map 它；`mcpTools`/`stateTools` 走同一批外壳）。
   上一轮改的是 5 个调用点，这一轮是 3 个文件 +55/−2 行。
4. **审批钩子留空实现**（本次不做 UI 往返）：需要批时**抛错拒绝**，理由回灌模型且**明确要求不要重试**
   （`Sentinel 拦下了「x」：…。Do not retry the same call——…`）。命中即拦的三类：
   静态 `sensitive`、`egress: "review"`、**声明了 `warnings`**（照单子 §2 测试清单第 3 条：warnings 也要拦）。
5. **行为兼容（最重要的验收点）**：没声明 `risk`/`assess` 的工具，执行路径等价于直接 `tool.execute(args)` ——
   返回值是**同一个对象**（`assert.equal` 同一性），抛错是**同一个 Error 实例**（不包装、不替换；工具自己的错误
   本模块一律 rethrow）。审计行是新增的可观测输出，不改返回值与错误。

### 测试（新增 15 条：`tests/tool-executor.test.ts`）

| 用例 | 钉住的事 |
|---|---|
| 返回值原样 / 抛错原样 | 同一对象、同一 Error 实例（兼容性） |
| 拒绝名单命中 | 连执行都不执行 + 文案含 `Do not retry` |
| 静态 `sensitive` | 默认拦 + 文案含「敏感能力」 |
| `egress: "review"` | 同样拦 |
| 评估器抛错 | fail closed + 审计记 `outcome=assess_failed` |
| `warnings` 非空 | **必须拦**（不是装饰结果），理由带出警告原文 |
| `moderate` | 放行 + 进审计（`summary=` 落审计） |
| 打码 | `redact: true` 才动；`apiKey`/`cookie`/`Bearer …` 抹掉，普通字段原样 |
| 审计 | 放行/拒批/抛错三条路各一行，含 owner/thread/risk/耗时 |
| 接线守卫 ×2 | ① 经 `instrument()` 的工具必过咽喉（拒绝名单能拦住合成工具）② 两引擎外壳源码级断言 `.map(instrument)` |
| 执行点守卫 | `apps/server/src` 里「真正执行工具」的位置只剩 5 个文件（见 grep），多一个就红 |
| 配置解析 | `TOOL_DENY_LIST` 逗号/空格/空项解析 |

## 证据

```
pnpm test        → 597/597 全绿（基线 582 + 新增 15），退出码 0，连续两次
pnpm typecheck   → 干净，退出码 0（根 tsc + apps/mobile tsc 都过），连续两次
```

`grep -rn "\.execute(" apps/server/src`（单子指定命令）的输出 —— 其中**真正执行工具**的只有 5 处：

```
--- 属于「执行工具」的（收紧后的形状） ---
engine/tool-executor.ts:189:  const raw = await tool.execute(args as never);   ← ★ 咽喉本体
engine/tool-kit.ts:46:       execute: (args) => tool.execute(args as never),  ← forAgUi 接线（对象已过咽喉）
engine/mastra-tools.ts:23:   execute: async (inputData) => tool.execute(...),  ← Mastra 接线（同上）
engine/mastra-engine.ts:142: ).execute(args as never),                          ← 工具定义内部委托（外壳仍是 instrument）
live-activity.ts:159:        return tool.execute(args);                          ← 动作上报包装层（在咽喉内侧）
--- 其余命中都不是工具，是别的服务的同名方法 ---
engine/service.ts:67 / engine/worker.ts:197  this.execute(...)     ← TaskWorker 的任务执行
app.ts:86         workspace.execute(...)                          ← workspace 服务
computer-routes.ts:18 / computer-tools.ts:63  computer.execute(...) ← computer 服务
actions.ts:165    this.options.execute(...)                       ← action 分发
```

```
git status --short
 M apps/server/src/config.ts
 M apps/server/src/engine/tool-kit.ts
 M apps/server/src/live-activity.ts
?? apps/server/src/engine/tool-executor.ts
?? tests/tool-executor.test.ts

git diff --stat → 3 files changed, 55 insertions(+), 2 deletions(-)
```

## 没做到 / 存疑

1. **审批的真正往返没有做**（单子明确留给 P1）：目前命中即拒批，没有「等用户点一下再放行」的路径，
   也没有 grants 持久化（一次性 / 会话内 / 24h / 常驻）。
2. **两条工具路径不在咽喉内**（本次范围外，需 P1 收）：
   - 自带引擎的 `stateTools`（`AGUISendStateSnapshot` / `AGUISendStateDelta`，在 `tanstack-agent.ts` 里用
     `defineTool` 直接给 Agent）—— 它们是纯客户端状态搬运，不碰外部世界，但严格说没经过咽喉。
   - JEV 路径（`jev/tools.ts`，`JEV_MODE=off` 时不可用）。
3. **没有把任何现有工具标成 `sensitive` / `moderate`**：本次只铺机制，标记现有工具会立刻改变线上行为
   （被拒批），那属于策略决策，应由后续单子按工具逐个评估后再标。所以现状 = 行为零变化。
4. **拒绝名单默认空**（`TOOL_DENY_LIST` 未设时不拦任何工具）：为保住「行为逐字一致」这条验收点，
   默认必须是空；真要拦谁，由部署方在 env 里点名。
5. 审计目前走 `console.log`（与 `tool-kit.ts` 既有的 `[tool] …` 留痕同一通道）。
   仓库另有 `taskSecrets.redact()` 用于「含明文凭据的日志行」，但审计行不含参数/结果正文，暂无需要。
   若要落库审计（可查询、可回溯），是 P1 的事。

## 建议的下一单（P1 顺序）

1. **审批往返**：咽喉的「拒批」改成「挂起 + 发审批请求（App 内）→ 用户决定 → 恢复该次调用」；
   先做一次性授权，再做会话内/24h（grants 落库 + owner 绑定）。
2. **把 `toolkit` 的 `assess` 用起来**：先标 3-5 个真需要策略的工具（`site_account` 这类会改账户状态的、
   `send_mail` 这类会外发的），用真实策略跑一周，观察误拦率，再决定默认档位。
3. **污点追踪**（nanoMuse 的另一半机制）：读过私有数据后，向非白名单的外发要强制审批；挂在同一个咽喉里。
4. **审计落库**：`[audit]` 行进数据库（按 owner/会话可查），App 的 Activity 能看到「这次为什么被拦」。
