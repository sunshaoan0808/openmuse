# 任务单：nanoMuse 机制落地 P2b —— 授权升级成"限定能力"（服务端）

> 派单时间：2026-10-15 · 受派：dsh（DeepSeek Harness，本机 3080）
> 来源：`docs/nanoMuse-调研.md` §4.2（授权是"限定能力"而非布尔）+ §4.4（审批超时=拒绝）+ §7 第 2 条
> 工程仓库：**副本** `/home/ubuntu/openmuse-dsh2`（分支 `apk/preview`，基线 `3a100b2`）
> 派单前基线（派单方已测）：`pnpm test` **661/661**、`pnpm typecheck` 干净

## 0. 一句话

P1b 已把审批往返做成"**按工具**授权"。nanoMuse 的授权是"**限定能力**"：授权键带**目标**
（`web_fetch:example.com` / `send_email:a@x` / `shell:git`）、**多目标调用每个目标都要被覆盖**、
带 warning 的调用**只给 once**、待审批**超时即拒绝**、用户能**列出并撤销**已授的权限。
本次只做服务端这四条。**只借机制，不搬代码**（GPL 红线）。

## 1. 硬约束（违反任一条即不合格）

1. **许可红线**：nanoMuse 全仓 GPL-3.0-or-later，**禁止复制其任何源码/文件/提示词文本**；照设计自己实现。
2. 不读、不写、不打印任何凭据文件（`.env` / `/etc/dsh-web.env` / key）。
3. **不 commit、不 push**：改完留在工作区等人工 review。
4. **不装新依赖**。
5. **回归必须绿**：`pnpm test` 全绿（基线 **661/661**）、`pnpm typecheck` 干净。
   **不许改既有测试文件**（`tests/tool-approval.test.ts`、`tests/tool-executor.test.ts`、`tests/tool-taint.test.ts`
   一字不动）—— 新用例一律放新文件。
6. **范围**：只改 `apps/server/src/**` + 新增 `tests/**`；`apps/mobile/` 本次**不动**（客户端那半是下一单）。
7. **绝不碰线上**：在副本 `/home/ubuntu/openmuse-dsh2` 里做；**不要**碰 `/home/ubuntu/openmuse`
   （线上服务 tsx 直跑源码）。不要 `systemctl` 重启任何服务。
8. **每改完一个文件立刻** `pnpm exec tsc -p tsconfig.json --noEmit`；报错当场修。
9. 不许留 `*.bak`、临时脚本、数据目录、调试 `console.log`。

## 2. 交付内容

### 2.1 授权键带目标（**行为兼容是硬要求**）

- `apps/server/src/engine/approvals.ts`（今 `:29` 的 `GRANT_SCOPES`、`:126` 的 `grantExpiresAt`、
  `:146-149` 的 `grantApplies`、`:197` 的 `acquireGrant` 查询键、`:219` 的 `approve`）：
  `GrantRecord` 与查询键**新增** `target?: string | null`。
  **规则（写死）**：
  - 有 `target` 的授权**只覆盖同 target 的调用**；
  - `target` 为 `null/undefined` 的授权**退化为按 tool 匹配** = 今天的行为，**逐字不变**。
- `apps/server/src/engine/tool-executor.ts` 的 `acquireGrant({ owner, tool, threadId })` 调用点
  （约 `:381`，在咽喉里）带上本次调用的 target —— 来源是工具声明 / `assess()` 返回的 `target`；没有就传 `null`。
- **多目标**：`ToolAssessment` 新增可选 `targets?: string[]`（与既有 `target` 并存，判定时取并集）。
  **多目标调用要求每个目标都有覆盖的授权**才算命中；缺任何一个 → 待审批，且审批理由里**点名缺哪个目标**。
  单个 target / 无 target 的调用行为与今天一致。

### 2.2 带 warning 的调用只给 once（服务端强制，不信客户端）

- `approve(owner, id, scope)` 里：若该审批对应的 assessment 带 `warnings`（P0 已有字段），
  **强制把 scope 降为 `"once"`**，并把**实际生效**的 scope 写回审批记录与返回值；
  客户端传 `session`/`24h` 也**不许**放宽。返回值新增字段 `downgraded: true`（既有字段一字不改）。
- 无 warnings 的调用**不许**被过度收紧：申请 24h 仍是 24h。

### 2.3 待审批超时即拒绝

- 审批记录新增 `expiresAt`（默认 `3600s`；常量导出，测试可注入）。
- 纯函数 `isApprovalExpired(record, now)`。
- `approve()` 对**已过期**记录**不得**放行：返回专门结果（`expired`）而不是普通 null，
  回报里说明你选了哪种形状与理由。
- 新增 `expireStaleApprovals(store, owner, now)`：把过期 pending 批量置为 `expired`（供日后巡检调用）。
- **红线**：超时/过期的 pending **绝不能**被当作 allow —— 过期后调用方仍是被拦状态。

### 2.4 可撤销的授权列表（服务端 API）

- `GET  /api/grants` → 当前 owner 的授权列表（`id / tool / target / scope / createdAt / expiresAt / 来源审批 id`）。
- `DELETE /api/grants/:id` → 撤销一条（**幂等**：删两次都返回成功语义）。
- 越权保护：只允许操作**本 owner** 的记录，别人的 id → **403**（沿用 P1a/P1c 既有做法）。
- 挂进 P1b 已有的 approvals 路由块（**不要新建路由文件**）。

### 2.5 测试（新文件；≥20 例）

- `tests/grant-target.test.ts`：有 target 的授权不覆盖别的 target；无 target 的授权行为与今天**逐字一致**；
  多目标缺一个 → 待审批且理由点名缺哪个；大小写/规范化（若你做了规范化，写进回报）。
- `tests/approval-expiry.test.ts`：边界（正好到点、差 1ms 未到）；过期后 approve 被拒且状态**不是** allowed；
  批量过期只动过期项；落库字段完整。
- `tests/approval-downgrade.test.ts`：带 warnings 申请 24h → 实际 once + `downgraded:true`；
  无 warnings 申请 24h → 仍 24h。
- `tests/grant-revoke.test.ts`：撤销后授权不再命中；撤销幂等；越权 id 403。

### 2.6 回报格式

写到 `docs/任务单回报-openmuse-P2b.md`（同时 stdout 打一份）：

```
## 做到了什么（逐条对应 2.1-2.4）
## 证据
- pnpm test：<通过数>/<总数>（基线 661）；连续两次
- pnpm typecheck 输出
- grep -n "grantApplies\|acquireGrant" apps/server/src/engine/*.ts 的输出（贴行号锚点）
- git status --short 文件清单
## 没做到 / 存疑
## 建议的下一单（≤5 行；客户端那半与"常驻/会话内 scope"是否值得做，给你的判断）
```

## 3. 参考

- `docs/nanoMuse-调研.md` §4.2 / §4.4 —— 只作设计对照；与代码不符以代码为准并在回报里指出。
- 既有实现：`apps/server/src/engine/{approvals,approval-store,tool-executor}.ts`；
  测试风格：`tests/tool-approval.test.ts`（内存 store 假实现）。
