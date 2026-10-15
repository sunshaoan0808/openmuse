# 任务单回报：nanoMuse 机制落地 P2b —— 授权升级成"限定能力"（服务端）

> 回报时间：2026-10-15 · 执行方式：**派单方接手实现**（见下"派单账"）
> 单子：`docs/任务单-openmuse-P2b.md` · 来源：`docs/nanoMuse-调研.md` §4.2 / §4.4 / §7 第 2 条
> 基线：661/661（派单前实测）· 交付后：**702/702**

## 派单账（如实记录）

同一份单子派了三轮，**全部被上游吃掉**，零有效产出，因此由派单方接手：

| 轮次 | 结果 | 证据 |
|---|---|---|
| 1（550B，120s 看门狗） | exit=1 / 44s | `PI_AI_ERROR: Service temporarily overloaded`（刚读完文件） |
| 2（muse-spark-1.3） | exit=0 / 1873s，**无效交付** | 会话指标：28 步 / 34 调用 / **16 次 idle timeout + 8 空回复 + 8 重试**，单步最长 283s；最后只吐一句"正在补全…"、无工具调用 → `turn/end reason=completed`；落盘仅 `GrantRecord.target` 两行 + 一个违规 `.bak` |
| 3（550B，45s 看门狗） | exit=1 / 29s | 同样 `Service temporarily overloaded` |

接手顺序按纪律走：**纯逻辑与类型 → 测试跑绿 → 接线 → 全量门禁 → 最后回报**。
（第 2 轮留下的那 2 行 `target` 字段被保留并补全了注释。）

## 做到了什么（逐条对应单子 §2）

- **§2.1 授权键带目标**：`GrantRecord.target`（`null` = 不限定目标 = **改造前的行为，逐字不变**）。
  `grantApplies()` 增加目标匹配；`GrantQuery.target`；`normalizeGrant()` 对旧行（无 target）退化为 `null`。
  **多目标**：`ToolPolicy.targets(args)`（**同步纯函数**，因为它在授权判定第 2 步就要用，而 `assess()` 排第 3 步）、
  `ApprovalBackend.acquireGrant({ targets })`、`missingTargets()`（只读诊断，供审批理由点名）。
  多目标**每个都要被覆盖**才放行；**先整体核验再消耗**，缺一个时不白烧已覆盖的 `once`。
- **§2.2 带警告只给 once**：`downgradeScope(scope, warnings)` 纯函数；`approve`/`approveChecked` 里**服务端强制**降档，
  实际生效的 scope **写回审批记录**（`approval.scope`）并在响应里给 `downgraded`；无警告的调用**不许**被收紧。
  咽喉登记审批时把 `assessment.warnings` 一起落库（批准时才有据可依）。
- **§2.3 待审批超时即拒绝**：`APPROVAL_TTL_MS = 1h`、`approvalExpiresAt()`、`isApprovalExpired()`；
  `ApprovalRecord.expiresAt`；`approve` 对过期一律 **null（不放行）**；新增 `approveChecked()` 分出
  `missing / not_pending / expired`；REST 侧 **410 Gone**（超时作废）与 **404**（找不到/已处理）分开回。
  **过期绝不等于放行**：过期后状态仍是 `pending`、不写任何 grant（有专门用例钉住）。
- **§2.4 授权列表与撤销**：`GET /api/grants`（只列本 owner，带 `target/scope/expiresAt`；`?owner=` 别人的 → **403**）、
  `DELETE /api/grants/:id`（**幂等**：第二次 200 + `removed:false`；别人的 id 删不到且那条授权原样还在）、
  裸路径 `/grants` 与 `/api/grants` 行为一致、无令牌一律 401、撤销后**真的不再命中**。

## 证据

- `pnpm test`：**702/702**（661 基线 + 41 新例），`fail 0`。副本与主仓各跑一遍，数字一致。
- `pnpm typecheck`：两处均干净（无输出）。
- 新增测试文件（4 个，**全部新文件**）：`tests/grant-target.test.ts`(13)、`tests/approval-expiry.test.ts`(10)、
  `tests/approval-downgrade.test.ts`(7)、`tests/grant-revoke.test.ts`(11)。
- `git status --short`：改 5 个源文件 + 1 个既有测试文件；无 `*.bak` / 临时脚本 / 数据文件残留。
- **偏离（必须点名）**：`tests/tool-approval.test.ts` 加了 **4 行**（两处 fixture 补必填字段）：
  `+ target: null,` / `+ targets: [], + expiresAt: null, + warnings: [],`。
  **断言与用例一字未动**（`git diff tests/tool-approval.test.ts` 只有这 4 行）。原因是本仓约定"未发生的一律写 null 不省略"，
  新字段是必填；改成 optional 反而破坏该文件自己写明的约定。
- 另有 2 处必要的小改动：`errors.ts` 的 `AppError` 状态联合加了 `410`（其 code 归到 `NOT_FOUND`，status 才是客户端要区分的）。

## 线上真实验证（重启服务后，走真实 HTTP + 真实 Postgres）

| # | 场景 | 结果 |
|---|---|---|
| 1 | 种一条**已过期**的待审批 → `POST /api/approvals/:id/approve` | **HTTP 410** `这条待审批已经超时作废，请重新发起这次调用。` ✓ |
| 2 | 不存在的审批 → 同上 | **HTTP 404** ✓（既有语义没被抢走） |
| 3 | 带 `warnings` + `targets` 的待审批 → 申请 `24h` | **200** `downgraded=true`、`grant.scope=once`、`grant.target=example.com` ✓ |
| 4 | `GET /api/grants` | 200，本次那条在列表里（`site_account scope=once target=example.com`）✓ |
| 5 | `GET /api/grants?owner=<别人>` | **403**（ASCII 与 URL 编码中文都验过；未编码中文回 400 是我 curl 的编码问题，非服务端缺陷）✓ |
| 6 | `DELETE /api/grants/:id` → 再删一次 | 200 `removed=true` → 200 `removed=false`（幂等）；列表复查已消失 ✓ |

现场已清理（残留 0 行）。

## 没做到 / 存疑

- **客户端 Permissions 面**：单子明确"服务端这半"，App 侧（列出已授权、一键撤销、三档问句文案）**未做**，留给下一单。
- `POST /api/approvals/:id/approve` 的响应**新增**了 `downgraded` 字段（既有字段一字未改）；客户端不消费也兼容。
- 目标语义目前**只有 `targets()` 声明的工具**才生效；今天没有任何 chat-tool 声明它 → 线上行为与改造前完全一致（这是有意的兼容设计）。
  真正启用需要下一单给 `web_fetch` / `send_mail` 之类的工具补 `targets()` 声明。

## 建议的下一单

1. **客户端（App）**：在既有 Activity/Permissions 面里加"已授权限"列表 + 一键撤销（走本次的 `GET/DELETE /api/grants`），
   并把 `downgraded` 与三档问句文案（支付/发送/危险命令）如实显示。
2. **给工具补 `targets()`**：先 `web_fetch`（域名）与 `send_mail`（收件人），再考虑 `shell`（命令名）—— 从此"批一次只放行一个目标"。
3. `expireStaleApprovals()` 这类巡检本单**故意没接**（单子只要判定与批量过期的纯逻辑）；要做常驻巡检时再挂调度器。
