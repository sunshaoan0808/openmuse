# 任务单 openmuse-P1b — 审批往返（服务端）

> 前置：P0 工具执行收口（`3ca903d`）、P1a 审计落库（`c74868f`）均已落地。
> 咽喉现在会「拒批」但**没有审批入口** —— 被拦的工具永远拦着。本单补上**服务端**审批往返：
> 用户批准一次 → 写入授权（grants）→ 后续匹配调用**直接放行**，全程留审计。
> **客户端 UI 不在本单范围**；验收由派单方执行，你的自述不作为验收依据。

## 0. 环境与红线

- 工作目录：本副本根目录。基线 `c74868f`，干净；`pnpm test` 基线 **616/616**。
- **禁止** `systemctl` / 任何服务操作（那是线上）；**禁止**修改 `tests/` 下既有文件；禁止新增依赖；
  禁止改 mobile/web UI 与 `.env`；禁止改动控制台 `[audit] …` 那一行的格式。
- 全量测试**必须前台跑**（后台会被 cgroup OOM 杀）。

## 1. 授权（grant）语义 —— 必须逐条实现

| scope | 含义 | 失效条件 |
| --- | --- | --- |
| `once` | 只放行**下一次**该工具（同 owner + 同 thread）调用 | 用掉即失效（消耗型） |
| `session` | 同一 **threadId** 内一直放行 | 线程结束，或**服务重启**（按进程实例界定） |
| `24h` | owner 内任意线程放行 | `expiresAt = 授权时刻 + 24h` |

- 落库：复用 Postgres `records`（`kind='grants'`），字段至少含
  `id/owner/tool/scope/threadId|null/createdAt/expiresAt|null/consumedAt|null`。
- `once` 的消耗必须**原子**（并发下不能放行两次）：用现有 `compareAndSwap` 或等价原语，不要 read-then-write。

## 2. 咽喉改造（`apps/server/src/engine/tool-executor.ts`）

判定顺序固定为：

1. **拒绝名单**（最高优先级，有名单就不放行，即使有 grant —— 明确写清这个优先级）；
2. **有效 grant 命中** → 放行，并在审计里记 `granted:<scope>`；`once` 同时被消费；
3. 静态 `risk` / 逐次 `assess`（保持 P0 语义不变）；
4. 需要审批但没有 grant → **登记一条待审批**（`kind='approvals'`，字段含
   `tool/owner/threadId/risk/reason/args 摘要/requestedAt/status='pending'`），
   抛出「等待审批」错误给模型：文案必须写明**别重试同一调用**、已通知用户、拿到授权后同一调用会成功。
5. 审计：审批登记写一行（`outcome=blocked`，`reason` 保留），用户批准/拒绝也各写一行审计。

**未声明 `risk`/`assess` 的工具行为必须与改造前逐字一致**（返回值同一对象、抛错同一 Error 实例）。

## 3. 审批 REST（沿用现有路由与鉴权风格）

- **取数一律用会话里的 owner**；URL 里若带 `owner` 只做一致性校验，不一致返回 403（沿用 P1a 的做法）。
- `GET /approvals?status=pending|all&limit=<n>` → 该 owner 的审批列表（最近的在前）。
- `POST /approvals/:id/approve`，body `{ "scope": "once" | "session" | "24h" }`
  → 写 grant + 审批置 `approved`；scope 非法 → 400；非本人的 id → 404/403。
- `POST /approvals/:id/deny`，body `{ "reason"?: string }` → 审批置 `denied`（**不产生任何放行**）。
- 同时挂 `/api/*` 与裸路径两种前缀（P1a 里 `/audit` 的处理方式照搬），并复用同一鉴权中间件。

## 4. 新增测试（新文件 `tests/tool-approval.test.ts`，不得改既有测试）

1. 无 grant 时：需审批的工具被拦，且**登记了一条 pending**（含 reason 与工具名）。
2. `once`：批准后**下一次成功**、**再下一次又被拦**（消耗语义；并发两次调用只能过一次）。
3. `session`：同 thread 内连续放行；换 thread 仍拦；服务实例重启后失效（用可注入的实例标识/时钟）。
4. `24h`：`expiresAt` 计算正确；过期后重新拦（时钟可注入，不要 sleep）。
5. 拒绝名单优先级高于 grant（同时命中 → 仍拦）。
6. 未声明 `risk`/`assess` 的工具：返回值同一对象、抛错同一 Error 实例（同一性断言）。
7. 审计：`granted:<scope>` 与审批登记都能在审计出口看到；落库失败不影响工具语义。
8. REST：approve/deny 的正常路径、非法 scope → 400、别人的审批 id → 403/404。

## 5. 机械验收（派单方执行）

```bash
pnpm test              # 期望 ≥616 全绿（基线 616/616），fail 0
pnpm typecheck         # 退出码 0
grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts   # 该行仍在且格式未变
```

守卫测试「真正执行工具的地方只有那 4 个文件」必须保持绿
（`mastra-engine.ts` / `mastra-tools.ts` / `tool-executor.ts` / `tool-kit.ts`）。

## 6. 回报

写 `docs/任务单回报-openmuse-P1b.md`：改了哪些文件、§5 每条命令的**原始输出**、未做项与已知边界。

## 7. 明确不做（留后续）

- 客户端审批 UI / 推送通知 / 跨设备转发；
- 污点追踪（读私有数据后外发强制审批）→ P1c；
- `stateTools` / JEV 路径并入咽喉 → P1d；
- 给具体工具标 `sensitive`/`moderate`（策略决策，等用户拍板）。
