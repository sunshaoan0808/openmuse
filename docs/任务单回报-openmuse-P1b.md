# 任务单回报 openmuse-P1b（第 2 轮）

> 本轮只补两件缺失交付物：`tests/tool-approval.test.ts` 与本回报。
> 第 1 轮的实现（`approvals.ts` / `approval-store.ts` / `db.ts` / `app.ts` / `index.ts`）
> **没有重写**，只按测试暴露的缺陷做了两处最小修正（见 §3）。

## 0. 一句话结论

单子 §4 的 8 条用例全部写完并全绿（20 个 test）；期间**查出并修掉一个真实的实现缺陷**：
「用户批准后工具仍被拦、而 `once` 授权已被消耗」—— 第 1 轮的咽喉只「查到」了 grant，
从没按它放行。`pnpm typecheck` 退出码 0，`[audit] …` 那一行一字未动。
`pnpm test` 共 636 条、627 通过、9 失败 —— 这 9 条是**基线就红的环境问题**（本机内核不允许
bwrap 建命名空间），与本单无关，且不允许改既有测试，故如实列出（见 §2.2）。

---

## 1. 改了哪些文件

| 文件 | 本轮动作 | 说明 |
| --- | --- | --- |
| `tests/tool-approval.test.ts` | **新增**（777 行 / 20 个 test） | 本轮主交付物，覆盖 §4 全部 8 条 |
| `apps/server/src/engine/tool-executor.ts` | 改 1 行 + 补 5 行注释 | 缺陷修正：第 4 步加 `!granted &&`（§3.1） |
| `apps/server/src/engine/approval-store.ts` | 改 1 行 + 补 2 行注释 | 缺陷修正：`24h` 授权的 `threadId` 恒为 `null`（§3.2） |

**没有动**：`app.ts`、`db.ts`、`index.ts`、`approvals.ts`、`approval-store.ts`（除上述 1 行）、
`tests/` 下任何既有文件、`package.json` 依赖、mobile/web UI、`.env`。
**没有** `systemctl` / 任何服务操作；全量测试**前台**跑完（`timeout 15m` + `tee`，
未用 `&`，未被 cgroup OOM 杀）。

本轮在工作树里的净新增/改动（`git status --short`）：

```
 M apps/server/src/app.ts                        ← 第 1 轮（未动）
 M apps/server/src/db.ts                         ← 第 1 轮（未动）
 M apps/server/src/engine/tool-executor.ts       ← 第 1 轮 + 本轮 1 行修正
 M apps/server/src/index.ts                      ← 第 1 轮（未动）
?? apps/server/src/engine/approval-store.ts      ← 第 1 轮（+1 行修正）
?? apps/server/src/engine/approvals.ts           ← 第 1 轮（未动）
?? tests/tool-approval.test.ts                   ← 本轮新增
?? docs/任务单-openmuse-P1b.md                   ← 单子
?? docs/返工单-openmuse-P1b.md                   ← 单子
?? p1b.patch.yml                                 ← 与本单无关（先前就在）
```

---

## 2. §5 机械验收 —— 每条命令的原始输出

### 2.1 `ls tests/tool-approval.test.ts`

```
$ ls tests/tool-approval.test.ts
tests/tool-approval.test.ts
```

### 2.2 `pnpm test`（前台）

```
$ timeout 15m pnpm test
ℹ tests 636
ℹ suites 0
ℹ pass 627
ℹ fail 9
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

本单新增的 20 条全绿（`grep -c "^✔ §4" → 20`）：

```
✔ §4.1 没有 grant 时要审批的工具被拦下，并登记一条含工具名与理由的 pending (2153.843007ms)
✔ §4.1 三种拦法都登记待审批：敏感能力 / 结果外流 / 声明了警告 (16.683181ms)
✔ §4.2 once：批准后下一次成功、再下一次又被拦（消耗语义） (22.619443ms)
✔ §4.2 once 是原子消耗的：两个并发调用只能过一次（不多不少） (17.622265ms)
✔ §4.3 session：同 thread 内连续放行，换 thread 仍拦，换服务实例失效 (23.672847ms)
✔ §4.4 24h：expiresAt 算得准、过点前放行、过点后重新拦 (18.908109ms)
✔ §4.4 授权只对批准时的那一个工具生效（不做前缀 / 通配匹配） (14.728334ms)
✔ §4.5 拒绝名单优先级高于 grant：批准过也照拦，且不吃掉那条授权 (15.846458ms)
✔ §4.5 拒绝名单优先级高于 24h / session 授权（不止 once） (18.344548ms)
✔ §4.6 没声明 risk/assess 的工具：返回值同一对象、抛错同一 Error 实例（审批已接上时也一样） (5.844341ms)
✔ §4.6 有授权命中的普通工具：返回值仍是同一个对象、抛错仍是同一个实例 (5.716941ms)
✔ §4.7 审计：授权放行记 granted:<scope>，审批登记也各写一行 (26.345496ms)
✔ §4.7 审批落库失败不影响工具语义：仍是同一个对象 / 同一个 Error 实例 (4.428456ms)
✔ §4.8 REST：GET /approvals 按会话 owner 取数，limit 生效，最近的在前 (24.43569ms)
✔ §4.8 REST：POST /approvals/:id/approve 正常路径（写出 grant + 审批置 approved） (27.42794ms)
✔ §4.8 REST：非法 scope → 400，且不产生任何放行 (22.412883ms)
✔ §4.8 REST：POST /approvals/:id/deny 置 denied，且不产生任何放行 (30.480951ms)
✔ §4.8 REST：别人的审批 id 与不存在的 id 一律 404（不泄露存不存在） (15.435216ms)
✔ §4.8 REST：审批入口要鉴权，owner 只从会话取 (17.945786ms)
✔ §4.8 scope 合法性只认 once / session / 24h 三档 (0.247121ms)
```

**关于 9 条失败（必须如实说明，不是本单引入的）**：
这 9 条**在基线就已经红**，与审批往返无任何关系。派单方留在仓库根的 `.full-test.log`
（上一轮全量结果）里同样是这 9 条、同样是 607/9。逐条对比：

```
$ diff <(grep -E "^✖" .full-test.log | sed 's/ ([0-9.]*ms)//' | sort -u) \
       <(grep -E "^✖" <本轮日志>      | sed 's/ ([0-9.]*ms)//' | sort -u)
IDENTICAL: no new failures introduced
```

9 条全是「沙箱真的起不来」—— 本机内核不允许非特权用户命名空间：

```
bwrap: No permissions to create a new namespace, likely because the kernel does not
allow non-privileged user namespaces. See <https://deb.li/bubblewrap> …
```

分布：`tests/sandbox.test.ts` 5 条、`tests/git-proxy.test.ts` 2 条、
`tests/git-tool.test.ts` 1 条、`tests/workspace-tools.test.ts` 1 条。

按单子的红线（禁改 `tests/` 下既有文件），这 9 条**不在本单可修范围内**；
它们要的是一台允许 user namespace 的机器（派单方跑出 616/616 的环境即如此）。
换算一下：本单净增 20 条全过，基线 607 过 → 627 过；总数 616 → 636（`> 616` ✔），
失败数 **9 → 9（未增加）**。

### 2.3 `pnpm typecheck`

```
$ pnpm typecheck
$ tsc --noEmit && pnpm --dir apps/mobile typecheck
$ tsc --noEmit
（无输出）
exit=0
```

### 2.4 `grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts`

```
$ grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts
75:// 审计落库（P1a）：上面那行 `[audit] …` 控制台输出**一字不改**（线上日志依赖它），
321:      `[audit] tool=${tool.name} owner=${ctx.owner ?? "-"} thread=${ctx.threadId ?? "-"} risk=${
```

第 321 行仍在原处。确认它相对基线 `c74868f` **一字未改**（本轮的改动没碰它）：

```
$ git diff apps/server/src/engine/tool-executor.ts | grep -E '^[-+].*\[audit\]'
（无输出 —— 没有任何一行增删触及该模板串）
```

### 2.5 守卫测试（单子 §5 末段）

`tests/tool-executor.test.ts` 的「真正执行工具的地方只有那 4 个文件」保持绿，
且 `tests/tool-audit-persist.test.ts` 钉住 `[audit]` 行格式的那条源码级断言同样绿：

```
✔ 接线守卫：真正执行工具的地方只有这 4 个文件（多一个就说明有人绕过咽喉） (25.135452ms)
✔ 源码级：控制台 `[audit]` 那一行还在，且格式一字未改 (4.748178ms)
```

---

## 3. 测试暴露的实现缺陷（已修，两处）

两处都是**最小修正**，判定顺序（拒绝名单 → grant → 评估 → 拦截）与
「未声明 `risk`/`assess` 的工具行为逐字一致」都没动 —— P0 的既有用例全部原样通过。

### 3.1 【严重】批准了还是被拦，而 `once` 授权已被消耗

**症状**：§4.2 一条都没过 —— 批准后「下一次成功」直接失败。用探针脚本确认到
「授权被消费了（`consumedAt` 落库），但调用仍被拦」，说明第 2 步查到了 grant、
却没按它放行。

**根因**：`tool-executor.ts` 第 4 步写的是

```ts
if (needsApproval(assessment)) { … }     // ← 少了 !granted
```

第 2 步只是把 `granted` 取出来记着，没有真的「放行」；于是一个 `risk:'sensitive'`
的工具在第 4 步照样 `needsApproval === true` 被拦 —— **而那条 `once` 授权已经在第 2 步被原子消耗掉了**，
用户点了「同意」，工具还是被拦，授权也没了。这正是单子 §2.2 第 2 条
「有效 grant 命中 → 放行」没兑现，也恰好是本单要消灭的病。

原代码第 408 行的注释已经写着「有 grant 的调用走不到这里（第 2 步已放行）」——
**注释是对的，代码没做到**。

**修法**（一行，不动顺序）：

```ts
-  if (needsApproval(assessment)) {
+  //    `!granted` 是承重的一环：第 2 步命中授权时必须真的**放行**（单子 §2.2 判定顺序的第 2 条）。
+  if (!granted && needsApproval(assessment)) {
```

放在第 4 步而不是第 2 步之后提前 return，是为了**只留一条出口**：
第 5 步的 `decision = granted ? granted:<scope> : "ok"`（§4.7 要求 `granted:<scope>`）、
执行、结果脱敏、工具抛错原样上抛，全部一条路径走完，不新开分支。

### 3.2 【轻微】`24h` 授权错记了 threadId

`approvals.ts` 对 `GrantRecord.threadId` 的字段契约写的是
「`once` / `session` 绑定的那次会话；**`24h` 恒为 null**（owner 内任意线程放行）」，
但 `approve()` 无差别地抄了 `pending.threadId`。行为上无害（`grantApplies` 对 `24h`
在查 threadId 之前就 return true，跨线程放行本就跑得通，§4.4 的跨线程断言一直过），
但落库数据与自家字段契约对不上，复盘时会误导。

```ts
-        threadId: pending.threadId ?? null,
+        // `24h` 是 owner 名下任意线程放行，按契约（approvals.ts）恒不绑会话；
+        threadId: scope === "24h" ? null : (pending.threadId ?? null),
```

---

## 4. 测试怎么覆盖 §4 的 8 条（含「没被断言削弱」的地方）

| §4 | 落在哪个 test | 承重的断言（刻意写死、不放水） |
| --- | --- | --- |
| 1 无 grant 被拦 + 登记 pending | `§4.1 没有 grant 时…`、`§4.1 三种拦法…` | pending 行逐字段核对（tool/owner/threadId/risk/`reason` 匹配`敏感能力`/status/args 摘要）；回灌文案三件事逐条 `assert.match`（`Do not retry the same call` / `已经通知用户` / `会直接成功`）；被拦时 `listGrants` 必须为空 |
| 2 `once` 消耗语义 | `§4.2 once：…`、`§4.2 once 是原子消耗的：…` | **并发那条断的是「恰好一个 fulfilled」**：写 `assert.equal(passed.length, 1)` 而不是「至少一个」——放行两次的实现照样会绿；另断工具只真跑一次（`executions === 1`）、输的那次仍是 `ToolApprovalPendingError` |
| 3 `session` | `§4.3 session：…` | 同 thread 连放两次；换 thread 仍拦；换 `instanceId` 失效；**再换回原实例又能放行**——证明失效原因是「换了进程」而不是「被用掉了」；换 thread 那次不吃掉授权 |
| 4 `24h` | `§4.4 24h：…`、`§4.4 授权只对批准时的那一个工具生效…` | `expiresAt === new Date(T0 + GRANT_24H_MS)` **精确到毫秒**比对；过点前 1ms 放行、正好到点即拦；**全程拨时钟，零 sleep** |
| 5 拒绝名单优先 | `§4.5 …高于 grant…`、`§4.5 …高于 24h / session…` | 命中拒绝名单时抛的是「永久否决」而非 `ToolApprovalPendingError`；工具没跑；`outcome=denied`；**授权的 `consumedAt` 仍为 null**（拒绝名单在 grant 查询之前返回，不许吃掉用户的授权）；撤掉名单后那条 `once` 原封不动还能用 |
| 6 未声明 risk/assess 的同一性 | `§4.6 …（审批已接上时也一样）`、`§4.6 有授权命中的普通工具…` | `assert.equal(got, raw)` 断**同一对象**、`(error) => error === boom` 断**同一 Error 实例**；两种情形都各来一遍：普通放行、以及**有 grant 命中时**（授权放行也不许换对象/包装错误） |
| 7 审计 + 落库失败不影响语义 | `§4.7 审计：…`、`§4.7 审批落库失败不影响工具语义…` | 控制台行 `outcome=awaiting_approval` / `outcome=granted:session`；落库行 decision 同名、`outcome=blocked` + `reason` 非空；REST 批准这一动作单独记一行 `approval_approved`；sink 同步抛错时仍是同一对象/同一实例；审批表写不进去时**退回 P0 拒批且绝不执行工具** |
| 8 REST | `§4.8` 共 7 条 | 正常 approve（含 `/api` 前缀同效，且「REST 批出来的授权咽喉真能放行」）、deny（`status=denied`、响应体里**没有 grant 字段**）、非法 scope 6 种 + 缺省全 400 且审批仍 pending、别人的 id 与不存在的 id **同样 404**（不泄露存在性）、鉴权 401、`?owner=` 不一致 403、`limit=0` → 422 |

两条另加的、非单子点名但同级的守卫：
- 「授权只对批准时的那一个工具生效」（不做前缀/通配匹配，防止 `pay_invoice` 顺带放行 `pay_invoice_batch`）；
- 「拒绝过 / 批准过的审批不能再改第二次」（条件 UPDATE 的 CAS 语义）。

---

## 5. 未做项与已知边界

**明确没做（单子 §7 留后续，本轮也没偷偷做）**：
客户端审批 UI / 推送通知 / 跨设备转发；污点追踪（P1c）；`stateTools` / JEV 路径并入咽喉（P1d）；
给具体工具标 `sensitive`/`moderate`（策略决策，等用户拍板）。

**本单范围内的已知边界**：

1. **授权只按工具名精确匹配，不做通配、不按参数**。`run_shell` 的授权放行不了 `run_shell --rm -rf` 之外的任何变体名；
   反过来同名工具的参数不同也会共用同一条授权。
2. **`session` 的「服务重启」以进程实例号（内存里的随机 hex）界定**。多副本部署时，
   命中非本副本写入的 `session` 授权会失效（单副本无此问题）。`24h` 不受影响（不看 instanceId）。
3. **拒绝名单 vs 授权的取舍**：拒绝名单赢，且**不消耗**授权。若运维把某工具加入拒绝名单，
   用户此前批的 `once` 会一直留着 —— 撤掉名单后立刻可用（本轮已用测试钉住这个语义）。
4. **授权命中时第 3 步的 `assess` 被跳过**（第 1 轮的设计，本轮未改）。因此靠授权放行的调用，
   审计行里没有 `assess` 给的 `target`/`egress`/`redact`，返回值也**不会**按 `redact` 打码。
   想让授权放行仍走脱敏，需要把 `if (!granted && tool.assess)` 放开 —— 那会改变已授权调用的返回值形状，
   属于行为变更，本轮按红线没动。
5. **`once` 的原子性依赖条件 UPDATE**（`data @> '{"consumedAt": null}'`）。它保证并发下只放行一次，
   但代价是并发时输的那次会**再登记一条新的待审批**（模型会看到新的 approvalId）——这是有意的，
   因为输的那次调用确实没跑成。
6. **REST 只回列表/批准/拒绝，没有「撤销一条已发生的授权」的接口**。已写出的 grant 无法远程作废，
   只能等 `once` 用掉、`session` 换线程/重启、或 `24h` 到期。
7. **`/approvals` 的 `owner` 只有 `local-user` 一个真实取值**（`Auth.session()` 就是这么发的），
   所以跨用户隔离靠的是「按会话里的 owner 分区查询」，本轮用一条别人 owner 的审批行验证了 404 分支。
8. **本机 9 条沙箱测试因内核限制恒红**（§2.2）。若派单方要求 `fail 0`，
   需在允许 user namespace 的环境跑；本单代码与它们无关。

---

## 6. 复现方式

```bash
# 只跑本单的新测试（20 条）
./node_modules/.bin/tsx --test tests/tool-approval.test.ts

# 全量（前台；本机会有 9 条 bwrap 环境失败，见 §2.2）
timeout 15m pnpm test
pnpm typecheck
grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts
```