# 续单 openmuse-P1c（第 2 轮）—— 上轮零产出，本轮按"先落盘、后回报"推进

## 上轮发生了什么（判定依据，非你的自述）

- 运行 7200s 被上限掐断，**exit=124，四件交付物一件都没落盘**（工作树只有单子与 patch 文件）。
- 会话日志：**40 步 / 39 次工具调用全是探索**（`bash` 26、`grep` 7、`read` 5），
  **42 次 `pi-ai stream idle timeout after 300000ms`**（去重约 21 次真实卡死 ≈ 1.75 小时纯等待）+ 6 次 TRANSPORT 错。
- 结论：不是你没干活，是**上游路由静默黑洞**把时间吃光了。本轮 patch 已把空闲阈值压到 **60s**（上游健康时首字节 1.6-20s），
  撞一次只损失 1 分钟，重试能抢到活路由。

## 本轮的硬要求

1. **把探索预算压到最小**：集成点已经替你找好了，直接读这几处就够，不要全仓 grep：
   - API 请求助手：`apps/mobile/src/api.ts`（`request`/`withRetry` 附近，约 120-200 行）——照它的写法加方法即可；
   - Activity 面：`apps/mobile/src/screens.tsx` 的 `ActivityScreen()`（约 1132 行起），"你的操作"那段用
     `Card` + `SectionHeading` + `MeasureCard`；`pending` 计数在那里算（`w.actions.filter(...)`）；
   - 卡片形制参考：`apps/mobile/src/activity-card.tsx` 的 `TaskRow`（图标框 + 标题 + 副行 + 右侧小按钮）；
   - 纯逻辑测试风格参考：`apps/mobile/test/*.test.ts`（`node:test` + `assert/strict`，只测纯函数）。
2. **顺序（被再掐一次也要保住可验收的部分）**：
   ① 先写 `apps/mobile/src/approvals.ts`（纯逻辑）→ ② 立刻写 `apps/mobile/test/approvals.test.ts` 并跑一次单文件
   （`npx tsx --test apps/mobile/test/approvals.test.ts`）→ ③ 写 `apps/mobile/src/approval-card.tsx` →
   ④ 改 `apps/mobile/src/api.ts` 加三个代表方法 → ⑤ 并入 `ActivityScreen` → ⑥ 前台跑全量 `pnpm test` +
   `pnpm typecheck` → ⑦ **最后**才写 `docs/任务单回报-openmuse-P1c.md`。
3. **每写完一个文件就落盘**，不要攒到最后一起写。
4. 交付物与禁止事项同原单（`docs/任务单-openmuse-P1c.md`）：禁止改 `chat.tsx`、禁止新增页面/导航、禁止改既有测试文件、
   禁止新增依赖、禁止改服务端、禁止自创视觉与配色、禁止 `systemctl`。

## 验收（派单方执行）

```bash
pnpm test        # ≥636 且 fail 0
pnpm typecheck   # 根 + apps/mobile 退出码 0
git status --porcelain tests/ apps/mobile/test/    # 既有测试文件不得出现
ls apps/mobile/src/approvals.ts apps/mobile/src/approval-card.tsx apps/mobile/test/approvals.test.ts
```
