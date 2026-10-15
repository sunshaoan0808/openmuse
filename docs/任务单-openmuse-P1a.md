# 任务单 openmuse-P1a — 审计落库（服务端）

> 前置：P0 已由派单方落地并推送（`3ca903d`），工具执行已收口成单一咽喉
> （`apps/server/src/engine/tool-executor.ts`，经 `instrument()` 覆盖两个引擎）。
> 本单在咽喉之上补齐**审计落库**，使「这条工具调用为什么被拦」可查。
> **验收由派单方执行，你的自述不作为验收依据。**

## 0. 环境与红线

- 工作目录：本副本根目录（`/home/ubuntu/openmuse-dsh`）。分支状态：`3ca903d`，干净。
- **禁止** `systemctl restart openmuse.service` 或任何服务操作 —— 那是在跑的线上服务（上一轮有人这么干，服务崩了 15 次）。
- 禁止修改 `tests/` 下**既有**文件；禁止新增依赖；禁止动 mobile/web UI 与 `.env`/服务配置。
- 全量测试**必须前台跑**（后台会被 cgroup OOM 杀掉）：`pnpm test`。

## 1. 交付物

1. **持久化审计 sink**：把咽喉产出的每条审计事件写成 Postgres `records` 一行。
   - `owner`：调用上下文里的 owner；缺失时用 `"local-user"`。
   - `kind`：`"audit"`。
   - `id`：时间有序、可读（例如 `时间戳-随机短串`）。
   - `data`（JSON）：`tool`、`owner`、`threadId`、`risk`、`outcome`（`ok`/`blocked`/`error`）、`target`、`egress`、`durationMs`，以及**被拦时的 `reason`**。
   - 复用现有 `Store`（`apps/server/src/db.ts`）的方法风格：`put(owner, kind, value)` / `list(owner, kind)`。
2. **接线**：在服务启动处（`apps/server/src/index.ts`）用现有 `createStore(...)` 造 Store 并把 sink 注入咽喉；**Store 不可用/未配置时必须优雅降级**（不得让服务起不来）。
3. **保留观测行**：`apps/server/src/engine/tool-executor.ts` 里现有的 `console.log("[audit] ...")` 那一行**一字不改**（线上日志依赖它）。
4. **查询入口（只读）**：Store 上加按 thread 过滤/限量的读取方法，并挂一个 REST（沿用现有路由风格）：
   `GET /audit?owner=<owner>&threadId=<id>&limit=<n>` → 返回该 owner 的审计行（含 `reason`，无则 `null`）。
5. **失败隔离（硬契约）**：审计写入失败**不得**改变工具返回值、抛错实例、错误形状或耗时语义；失败只允许记一行日志。
   这条与 P0 的行为契约同级：未声明 `risk`/`assess` 的工具，返回值与抛错必须与改造前**逐字一致**（同一对象 / 同一 `Error` 实例）。

## 2. 新增测试（新文件 `tests/tool-audit-persist.test.ts`，不得改既有测试）

1. 每次工具调用产出一条审计事件，字段齐全；放行/拒批/抛错三条路都落库。
2. 被拦（例如 `risk: "sensitive"` 且无审批入口）时 `outcome=blocked` 且 `reason` 非空。
3. **sink 抛错**时：工具返回值是**同一个对象**，抛错是**同一个 `Error` 实例**（用同一性断言，不是等值）。
4. 查询方法：`threadId` 过滤与 `limit` 生效；不同 thread 互不串。
5. 脱敏：评估要求 `redact` 时，**落库内容**是脱敏后的（凭据字段被抹掉）。
6. 保留 `[audit]` 控制台行的源码级断言仍在（不要为了加落库而改掉那行）。

## 3. 机械验收（派单方执行）

```bash
cd /home/ubuntu/openmuse-dsh
pnpm test            # 期望 ≥597 全绿（基线 597/597），fail 0
pnpm typecheck       # 退出码 0
pnpm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)"
grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts   # 该行仍在且格式未变
```

源码级守卫测试「真正执行工具的地方只有那 4 个文件」必须保持绿：
`mastra-engine.ts` / `mastra-tools.ts` / `tool-executor.ts` / `tool-kit.ts`。

## 4. 回报

写 `docs/任务单回报-openmuse-P1a.md`，包含：
- 改了哪些文件（逐个说明）；
- §3 每条命令的**原始输出**（不要只写「通过」）；
- 未做项与已知边界。

## 5. 明确不做（留给后续单）

- 审批往返（一次性/会话内/24h 授权、grants 落库）→ P1-b；
- 工具标 `sensitive`/`moderate`（策略决策）→ 用户拍板后另单；
- 污点追踪（读私有数据后外发强制审批）→ P1-c；
- 自带引擎 `stateTools`（`AGUISendStateSnapshot/Delta`）与 JEV 路径（`jev/tools.ts`）并入咽喉 → P1-d。
