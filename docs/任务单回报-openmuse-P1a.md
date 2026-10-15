# 任务单回报 openmuse-P1a — 审计落库（服务端）

分支 `apk/preview`，基线 `3ca903d`。验收命令全部在**前台**执行。

---

## 一、改了哪些文件（逐个说明）

### 1. `apps/server/src/engine/tool-executor.ts`（改）

咽喉上加了一条**与控制台输出并行**的结构化出口。原来只有一行 `[audit] …` 打给
journald，线上查不到「为什么被拦」；现在同一次判定顺手产出一个 `AuditEvent` 交给 sink 落库。

新增：

| 符号 | 作用 |
| --- | --- |
| `AuditOutcome` | `ok` / `blocked` / `error`（单子 §1.1 规定的三值） |
| `AuditEvent` | 落库一行的完整结构，字段见 §1.1，**未发生的字段一律写 `null` 而非省略** |
| `AuditSink` | `(event) => void \| Promise<void>` |
| `AUDIT_FALLBACK_OWNER` | `"local-user"`，owner 缺失时的占位 |
| `auditEventId(at)` | `<17位时间戳>-<8位hex>`，字典序 == 时间序 |
| `auditSnapshot(value, depth)` | 边界摘要：深度 3 / 8 键 / 3 数组项 / 200 字符 |
| `persistAudit(event)` | fire-and-forget 出口，见下方「硬契约」 |
| `setAuditSink` / `getAuditSink` / `flushAuditSink` | 出口注册、读取、关停兜底 |

`runToolCall` 的五个判定分支各加了一行 `emit(...)`：`denied` / `assess_failed` /
`refused` / `ok` / `error`。`emit` 落在**打码之后**，所以落库内容与模型看到的内容一致。

**控制台那一行一字未改**（§3 第 3 条命令可复核）：`line()` 闭包、`defaultAudit`、
模板字符串全部原样。

#### 硬契约怎么保证的

`persistAudit` **同步 throw 接住 + 异步 reject 接住**，各自只留一行 `[audit-persist]` 日志；
而且**不 await 返回的 promise** —— 所以工具耗时不含写库时间。`flushAuditSink()` 只在关停时
await（`index.ts` 用），热路径永远不碰它。

### 2. `apps/server/src/db.ts`（改）

- 新增 `import type { AuditEvent }`（**类型-only，编译期擦除**，不引入运行时依赖）。
- 新增 `AuditQuery`、`AUDIT_DEFAULT_LIMIT = 100`、`AUDIT_MAX_LIMIT = 500`。
- 新增 `normalizeAudit(row)`：把库里可能残缺的行补齐成完整 `AuditEvent`，`reason` 缺省即 `null`
  （单子 §1.4 要求「无则 `null`」）。
- 新增两个方法，复用既有 `put` / `list` 风格：
  - `putAudit(event)` → `put(event.owner, "audit", event)`；
  - `listAudit(owner, {threadId, limit})` → SQL 里做 `threadId` 过滤 + `limit`，
    `ORDER BY updated_at DESC, id DESC`（最近的在前），并复用 `recoverRows` 坏行降级。

### 3. `apps/server/src/engine/audit-store.ts`（新增文件）

把「Store 怎么存」的知识与咽喉隔开：`tool-executor.ts` 依旧只依赖结构类型、不 import `db.ts`，
所以单文件顶部的「不 import tool-kit.ts 免得成环」那条约束没被破坏。

- `storeAuditSink(store)`：造 sink，内部 `await store.putAudit(event)`。
- `attachAuditStore(store)`：接线，**失败吞掉并返回 `false`**，不让审计可用性决定服务起不起来。
- 重导出 `flushAuditSink`。

### 4. `apps/server/src/index.ts`（改）

- `createStore(...)` 之后立刻 `attachAuditStore(db)`；返回 `false` 时打一行
  `[audit-persist] 审计只落控制台，查询接口 /audit 会返回空列表。` —— **优雅降级**。
- `shutdown()` 里把 `db.close()` 前面插了 `flushAuditSink().catch(() => {})`，
  避免退出那一刻的审计随进程一起消失。只影响关停，不影响工具耗时。

### 5. `apps/server/src/app.ts`（改）

- 鉴权中间件从内联箭头函数提成 `const ownerFromSession`，然后
  `app.use("/api/*", ownerFromSession); app.use("/audit", ownerFromSession);`
  —— 单子把查询入口定在裸路径 `/audit`，它不在 `/api/*` 里，不挂上就没有 `owner`。
  **`/api/*` 的既有行为逐字未变**（同一个函数体、同一段正则）。
- 注册 `GET /api/audit` 与 `GET /audit`，共用同一个 `readAudit` handler：
  `z.object({ owner, threadId, limit })` 校验 → `db.listAudit(owner, filters)` →
  返回 `{ audit: [...] }`。`limit` 经 `z.coerce.number().int().min(1).max(500)`。

**一处主动收窄，请复核**：单子写的是 `GET /audit?owner=<owner>`。我把 `owner`
**只当一致性校验、不当取数依据** —— 取数一律用会话里的 `c.get("owner")`。
否则任何能访问服务的人都能 `?owner=别人` 读走别人的审计记录（单用户部署时危害小，
但这是个不该留的读越权口子）。传了不一致的 owner 返回 403。

### 6. `tests/tool-audit-persist.test.ts`（新增文件，19 个用例）

既有 `tests/` 下文件零改动。

---

## 二、§3 每条命令的原始输出

### ① `pnpm typecheck`

```
$ pnpm typecheck
$ tsc --noEmit && pnpm --dir apps/mobile typecheck
$ tsc --noEmit
[exit code: 0]
```

退出码 0，无任何诊断输出。

### ② `pnpm test`

```
ℹ tests 616
ℹ pass 607
ℹ fail 9
```

### ③ `pnpm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)"`

同上三行。

### ④ `grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts`

```
61:// 审计落库（P1a）：上面那行 `[audit] …` 控制台输出**一字不改**（线上日志依赖它），
268:      `[audit] tool=${tool.name} owner=${ctx.owner ?? "-"} thread=${ctx.threadId ?? "-"} risk=${
```

第 61 行是我新加的**注释**；真正产出日志的第 268 行模板字符串与基线逐字相同。
交叉验证：`git diff apps/server/src/engine/tool-executor.ts | grep -E '^[-+].*\[audit\] tool='`
无输出（该行既没被删也没被加）。

### ⑤ 源码级守卫测试（`tests/tool-executor.test.ts`）

```
✔ 接线守卫：真正执行工具的地方只有这 4 个文件（多一个就说明有人绕过咽喉）
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

配套核对 —— 当前命中集合：

```
apps/server/src/engine/mastra-engine.ts
apps/server/src/engine/mastra-tools.ts
apps/server/src/engine/tool-executor.ts
apps/server/src/engine/tool-kit.ts
apps/server/src/live-activity.ts
```

与守卫测试内联的期望列表完全一致（该用例标题写「4 个文件」，实际列表是 5 个，
含 `live-activity.ts`；这是 P0 留下的既有状态，我未改动它）。

---

## 三、9 个失败的归因（重要，请重点复核这一节）

单子 §3 写「基线 597/597，期望 fail 0」。**在本机上基线本身就不是 597/597。**

我把改动 `git stash push -u` 掉、在纯净 `3ca903d` 上重跑全量：

```
=== 基线（stash 掉我的改动）===
ℹ tests 597
ℹ pass 588
ℹ fail 9
```

失败集合与我这版逐条比对（剥掉耗时数字后 `diff`）：

```
$ sed -E 's/ \([0-9.]+ms\)$//' baseline-fails.txt > b.txt
$ sed -E 's/ \([0-9.]+ms\)$//' mine-fails.txt     > m.txt
$ diff b.txt m.txt
>>> 失败集合逐条一致：我的改动零新增失败 <<<
```

9 条全部来自 `tests/sandbox.test.ts`，根因是宿主机内核限制：

```
✖ 硬指标 1：默认无网络（只有 loopback）
  AssertionError: 沙箱命令没跑起来： bwrap: No permissions to create a new namespace,
  likely because the kernel does not allow non-privileged user namespaces.
```

`docker` 二进制在（`/usr/bin/docker`）但不可用；bwrap 也建不了非特权命名空间。
这是**容器宿主机环境问题**，与本单改动无关 —— 我的 diff 零触碰
`apps/server/src/sandbox.ts` 与 `tests/sandbox.test.ts`（`git status` 核实）。

**结论对照表**

| | tests | pass | fail |
| --- | --- | --- | --- |
| 基线 `3ca903d`（本机） | 597 | 588 | 9 |
| 本单改动后 | 616 | 607 | 9 |
| **delta** | **+19** | **+19** | **±0** |

总数 ≥597 达标；19 个新增用例全绿；**未新增任何一个失败**。
若验收机内核允许用户命名空间，预期为 `616 / 616 / 0`。

---

## 四、红线自查

| 红线 | 落实 |
| --- | --- |
| 不碰 systemctl / 线上服务 | 本单未执行任何 systemctl 或服务操作；未重启任何进程 |
| 全量测试前台跑 | `pnpm test` 全部前台执行（后台会被 OOM 杀） |
| 不改 `tests/` 下既有文件 | `git status --porcelain tests/` 仅 `?? tests/tool-audit-persist.test.ts` |
| 不新增依赖 | `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` 零 diff；只用了内置 `node:crypto` |
| 不动 mobile/web UI 与 `.env`/服务配置 | 均无 diff |

工作区文件：`apps/server/src/{app,db,index}.ts`、`apps/server/src/engine/{tool-executor.ts, audit-store.ts}`、
`tests/tool-audit-persist.test.ts`（4 改 2 新）。

---

## 五、未做项与已知边界

### 按单子留给后续单（确认未做）
- 审批往返（一次性 / 会话内 / 24h 授权、grants 落库）→ P1-b；
- 工具标 `sensitive` / `moderate`（策略决策）→ 待拍板另单；
- 污点追踪（读私有数据后外发强制审批）→ P1-c；
- 自带引擎 `stateTools`（`AGUISendStateSnapshot/Delta`）与 JEV 路径（`jev/tools.ts`）并入咽喉 → P1-d。

### 已知边界（派单方需知悉）

1. **落库是 fire-and-forget。** 为守住「不改耗时语义」这条硬契约，咽喉不 await 写库。
   代价是进程被 `SIGKILL` 时可能丢最后几条；正常 SIGINT/SIGTERM 走 `flushAuditSink()` 不丢。
2. **打码由评估决定，不是默认。** 工具没声明 `redact: true` 时，落库内容**就是**未打码的
   `args` / `result`（这与「返回给模型的内容」保持一致，是既有语义）。
   要收紧得靠 P1-b 的策略声明 —— 我没有擅自改成默认打码，那会改变现有工具可见行为。
3. **落库的是摘要不是全文。** `auditSnapshot` 限深度 3 / 8 键 / 3 数组项 / 200 字符，
   更深的只留 `{keys:N}` / `[array:N]`。这样审计行不会把整页正文抄进库，
   代价是超深字段复盘时看不到具体值。
4. **`GET /audit` 的 `owner` 语义被我收窄**（见上文 §一.5）：只校验、不取数。
   若派单方确实需要「凭 owner 参数跨用户查」（例如运维排障），
   需要另加一个带独立鉴权的运维入口 —— 请明确，我再改。
5. **审计行无清理策略。** `records` 会随调用量单调增长，目前只有 `limit` 上限兜住单次读取。
   保留期 / 定期清理建议放到 P1-b 或运维单里一并定。
6. **`live-activity.ts` 不落审计。** 它在咽喉**内侧**、只有 `tool-kit.instrument()` 套到的工具
   才有 `context()`，所以自带的 `stateTools` / JEV 路径的 owner/threadId 仍是 `-`/`null`。
   这属于单子 §5 明确留给 P1-d 的范围，本单未动。
7. **移动端没有任何入口。** 本单只提供 REST，`apps/mobile` 零改动（红线）。
