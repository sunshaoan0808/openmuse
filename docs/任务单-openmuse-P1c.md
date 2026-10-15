# 任务单 openmuse-P1c — App 侧审批入口（复用 Activity 面）

> 前置：服务端审批往返已完成（`a967277`）——`GET /approvals`、`POST /approvals/:id/approve {scope}`、
> `POST /approvals/:id/deny` 都可用；审批记录落在 `records(kind='approvals')`，授权落 `kind='grants'`。
> **现在 App 里没有任何入口**：模型会说"请在应用里确认"，而用户点不到。本单补这个入口。
> 验收由派单方执行，你的自述不作为验收依据。

## 0. 环境与红线

- 工作目录：本副本根目录。基线 `a967277`，干净；`pnpm test` 基线 **636/636**。
- **禁止**改 `chat.tsx`（审批不进聊天页，功能各归其位）；**禁止**新增页面/导航项；**禁止**改 `tests/` 与
  `apps/mobile/test/` 下**既有**文件（只允许新增测试文件）；禁止新增依赖；禁止改服务端代码；禁止 `systemctl`/服务操作。
- **禁止自创视觉**：只用仓库既有组件与配色（`Card` / `SectionHeading` / `Button` / `Chip` / `MeasureCard` / `s.*` 样式、
  `colors.*`），风格对齐 `apps/mobile/src/activity-card.tsx` 与 `ActivityScreen` 里"你的操作"那一段。
- 全量测试**必须前台跑**。

## 1. 交付物

1. **API 客户端**（`apps/mobile/src/api.ts`）：按既有请求助手的写法新增三个方法
   `listApprovals()`、`approveApproval(id, scope)`、`denyApproval(id, reason?)`；
   approve/deny 是 POST，**带幂等键**（助手已有 `idempotencyKey` 能力，服务端按键去重），
   令牌过期走既有的 401 续期重试路径，不另写一套。
2. **纯逻辑模块**（新文件 `apps/mobile/src/approvals.ts`）：把可测的东西抽出来，不要塞进组件：
   - `pendingApprovals(rows)`：只留 `status === "pending"`，按 `requestedAt` 倒序；
   - `approvalSummary(row)`：一行可读摘要（工具名 + 人话理由），字段缺失时给安全兜底（不抛错、不显示 `undefined`）；
   - `approvalScopes` / `scopeLabel(scope)`：`once`=只允许这一次、`session`=本会话内、`24h`=24 小时内；
   - 请求体构造（`approveBody(scope)` / `denyBody(reason?)`）与**非法 scope 的本地拦截**（只认三档）。
3. **审批卡片**（新文件 `apps/mobile/src/approval-card.tsx`）：形制对齐 `activity-card.tsx` 的 `TaskRow`
   —— 左侧图标框（用既有图标与 `colors.lavender`）、标题=`工具名`、副行=`approvalSummary` 的理由、
   右侧三个允许按钮（一次 / 本会话 / 24 小时）+ 一个拒绝按钮；按钮用既有 `Button`（`small`），
   进行中要禁用并显示进行态，成功后该行**立即从列表消失**（本地移除，不等下次轮询）。
4. **并入 Activity 面**（`apps/mobile/src/screens.tsx` 的 `ActivityScreen`）：
   - "等你复核 · N" 的计数里**并入待审批条数**（与 `awaiting_review` 的 actions 相加）；
   - 列表里在"你的操作"区域之上或之内列出待审批（用第 3 步的卡片），复用既有 `Card` + `SectionHeading` 版式；
   - 刷新沿用既有轮询节奏（`poll-cadence.ts` / 工作区刷新），**不要**新增全局定时器；
   - `/approvals` 不可用（503/网络失败）时**安静降级**：不显示该区块、不报错弹窗。
5. **测试**（新文件 `apps/mobile/test/approvals.test.ts`，纯逻辑用例）：
   过滤与倒序、摘要兜底（缺字段不崩）、三档标签、非法 scope 被本地拦下、请求体形状正确、
   失败（503/网络错）时降级为空列表且不抛错。

## 2. 机械验收（派单方执行）

```bash
pnpm test                 # 期望 ≥636 且 fail 0（基线 636/636）
pnpm typecheck            # 根 + apps/mobile 都要退出码 0
git status --porcelain tests/ apps/mobile/test/     # 既有测试文件不得出现在改动里
grep -rn "chat.tsx" apps/mobile/src/approvals.ts apps/mobile/src/approval-card.tsx   # 不应有
```

UI 观感由用户真机（重建 APK）确认 —— 你只需保证：只用既有组件、无新配色、无新导航项。

## 3. 回报

写 `docs/任务单回报-openmuse-P1c.md`：改了哪些文件、§2 每条命令的**原始输出**、未做项（例如真机观感待用户确认）。

## 4. 明确不做

- 聊天页内联审批、通知推送、跨设备转发；
- 给具体工具标 `sensitive`/`moderate`（策略项，等用户拍板）；
- 审批历史/统计页；批量审批。
