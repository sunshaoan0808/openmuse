# 返工单 openmuse-P1b（第 2 轮）

## 现状（第 1 轮留下的，**别丢、别重写**）

工作树里已有未提交的实现：`apps/server/src/engine/approvals.ts`（260 行）、`approval-store.ts`（251 行），
以及 `db.ts` / `app.ts` / `tool-executor.ts` / `index.ts` 的改动（+320/−14）。
派单方已复核：`pnpm typecheck` 退出码 0；既有 `pnpm test` 616/616 全绿；`[audit] …` 行未被改动；
执行点仍只有那 4 个文件；REST 六个路由（`/api/approvals`、`/approvals`、`/api/approvals/:id/approve|deny`）已挂上。

## 不合格项（第 1 轮就是在这里停下的）

1. **`tests/tool-approval.test.ts` 不存在** —— 单子 §4 的 8 条用例**一条都没写**（`pnpm test` 仍是 616，等于新增实现零覆盖）。
2. **`docs/任务单回报-openmuse-P1b.md` 不存在** —— 单子 §6 的回报没写。

第 1 轮日志最后一行是 "Writing now."（正要写测试文件时结束）。**所以本轮按下面的顺序做，别再先写别的。**

## 本轮要做的（顺序固定）

1. **先写 `tests/tool-approval.test.ts`**，覆盖单子 §4 全部 8 条：
   无 grant 被拦且登记 pending（含 reason/工具名）／`once` 消耗语义（**真并发两次调用只能过一次**）／
   `session` 同 thread 放行、换 thread 仍拦、换服务实例失效／`24h` 过期（**注入时钟，不要 sleep**）／
   拒绝名单优先级高于 grant／未声明 `risk`/`assess` 的工具行为逐字一致（同一性断言）／
   审计能看到 `granted:<scope>` 与审批登记且落库失败不影响工具语义／REST 正常路径 + 非法 scope→400 + 别人的审批 id→403/404。
2. 跑 `pnpm test`（**前台**，见红线）。若用例暴露实现缺陷 → 修实现，但**§2 的判定顺序与行为同一性不得改动**。
3. 再写 `docs/任务单回报-openmuse-P1b.md`：改了哪些文件、§5 每条命令的**原始输出**、未做项与已知边界。

## 红线（与首轮一致）

- **禁止** `systemctl` / 任何服务操作；**禁止**改 `tests/` 下既有文件；禁止新增依赖；禁止碰 mobile/web UI 与 `.env`。
- 全量测试**必须前台跑**（后台会被 cgroup OOM 杀）。
- 不要为了过测试而弱化断言（尤其那两条同一性断言与并发断言）。

## 机械验收（派单方执行，你的自述不作数）

```bash
ls tests/tool-approval.test.ts          # 必须存在
pnpm test                               # 必须 > 616 且 fail 0
pnpm typecheck                          # 退出码 0
grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts   # 行仍在且格式未变
ls docs/任务单回报-openmuse-P1b.md       # 必须存在
```
