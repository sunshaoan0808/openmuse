# Muse「同一个功能上更讲究」的细节 · 第二批（动效文案 + 服务端）

> 与 [`muse-做得更好的细节.md`](./muse-做得更好的细节.md)（第一批 13 条，已全部落地）互补。
> 本批 18 条：A 动效/文案/触觉/手势 11 条 + B 服务端/数据层 7 条。
> 证据底座：`/tmp/muse-evidence/`（classes 27477 / strings 98370 / constants 2336+757）。
> 每条格式：Muse 证据 → 我们现状（`文件:行号`）→ 体感 → 成本。
> 排序口径与第一批一致：**体感影响 ÷ 改造成本**。

---

## A. 动效 / 文案 / 触觉 / 深色 / 手势 / 通知（11 条）

### A1. 消息进场动画：按类型分三种，而不是一种淡入 ★推荐

- **Muse 证据（observed，`classes.txt`）**：`conversation.view.HatchMessageEntryAnimationsKt`
  下四个独立进场函数：`messageEntryAnimation`（普通消息）、`presentationEntryAnimation`
  （富呈现）、`streamingCursorEntryAnimation`（流式光标）、`approvalRowTransition`（审批行转场）；
  另有 `common.ui.StaggeredEntranceKt`（列表错峰进场，推断）。
- **我们现状**：`apps/mobile/src/motion.ts:42-74` 只有一个通用 `useRiseIn`
  （淡入 + 上浮 8dp + 缩放 0.98→1，`duration = motion.normal = 220`），所有消息/卡片/状态行共用；
  无类型区分、无错峰（历史消息靠 `enabled=false` 直接关动画）。
- **体感影响**：中 —— 流式回复时光标是视觉焦点，Muse 给它单独动画；我们全用一种淡入，
  流式更新时容易显得「闪一下」而不是「长出来」。
- **改造成本**：小 —— `useRiseIn` 旁加两个变体（`useStreamingIn` 更小位移+更短时长、
  列表侧 `delay = index * 30` 错峰），不动原生。

### A2. 滚动边缘淡隐：长列表顶部/底部有 fade，而不是硬切

- **Muse 证据（observed，`classes.txt`）**：三处独立滚动淡隐
  `activation.view.AuraDisclosureScreenKt$DisclosureScrollFade`、
  `conversation.search.ConversationSearchScreenKt$SearchScrollFades`（含 `showTopFade`/`showBottomFade`）、
  `conversation.view.HatchConversationHistorySidePanelKt$ConversationHistoryScrollFades`；
  另有 `VoiceTranscriptReveal`（语音转写揭示动画）。
- **我们现状**：`apps/mobile/src/chat.tsx:722` 起的滚动只管「是否贴底/自动跟随」，
  无任何边缘 fade；历史面板/搜索结果直接硬切出可滚动区。
- **体感影响**：小～中 —— fade 是「这里还能滚」的无声提示；没有它要靠试探才知道底下有内容。
- **改造成本**：小 —— 顶/底各一条绝对定位渐变带，透明度跟 `scrollY`/是否到边走
  （参考 `ui.tsx:515` 的 scrim）。

### A3. 状态药丸动画有时长表：220 / 350 / 1000ms，而不是一个 magic number

- **Muse 证据（observed，`constants.txt`）**：
  `status/view/HatchStatusPillAvatarAnimationKt$StatusPillAvatarAnimation$1$1.java:240` `1000`、
  `:255` `220`、`:258` `350` —— 同一个状态药丸里至少三个档位
  （推断：220 进场、350 形态切换、1000 呼吸/等待循环）。
- **我们现状**：`apps/mobile/src/motion.ts:12-19` 三档 `quick:130 / normal:220 / slow:320`，
  且 `skeleton.tsx:31` 扫光 `1250`、`ui.tsx:443-479` scrim/morph `220/340/300` 各写各的，
  无「等待态 ≥1000ms 慢循环」约定。
- **体感影响**：小 —— 转场快慢不一，用户说不清但觉得糙。
- **改造成本**：小 —— `motion` 表补 `idle: 1000` 档，散落时长收敛过去。

### A4. 加载文案按资源细分，而不是一句正在加载 ★推荐

- **Muse 证据（observed，`strings.txt` zh-rCN）**：`正在加载` 近 20 个细分变体：
  `正在加载 PDF`、`正在加载声音…`、`正在加载影音文件…`、`正在加载导航卡`、
  `正在加载支付方式`、`正在加载近期文件…` 等；上传/下载同理
  （`%1$s正在上传…`、`正在下载"%1$s"…`）。
- **我们现状**：`chat.tsx:2206` `正在加载会话…`、`agent-ui.tsx:532` 等有几句具体的，
  但大量中间态是裸 `ActivityIndicator`
  （`computer-workspace.tsx:141,453`、`search-tool-card.tsx:66,113`、`agent-ui.tsx:144,538`），
  转半天不知道在等什么。
- **体感影响**：中 —— 「在等什么」是等待焦虑主因；细分文案等于免费进度条。
- **改造成本**：小 —— 给裸 `ActivityIndicator` 逐个配一句文案，不动逻辑。

### A5. 错误文案带动作：「轻触刷新即可重试」，而不是只说失败

- **Muse 证据（observed，`strings.txt` zh-rCN）**：错误必带下一步：
  `出错了，轻触刷新即可重试。`、`我们无法连接。请检查网络连接并重试。`、
  `尚未检测到连接。请在 Messenger 发条消息，然后重试。`（连修都教了）；
  上传失败分轻/重两档：`上传失败。轻触即可重试`（原地）vs `上传失败，请重试。`。
- **我们现状**：主链路已对齐（`chat.tsx:1702-1703`）；但
  `browser-tool-card.tsx:92` `浏览器没有返回页面，请重试。`、
  `agent-ui.tsx:492,504` 只有「重试」没有「为什么」，
  且「原地、不丢上下文」的承诺只在附件上传处有。
- **体感影响**：中 —— 「知道为什么 + 点一下就地解决」vs「只知道失败了」，差一次工单/一次弃用。
- **改造成本**：小 —— 文案级；按「失败原因 + 是否保留上下文 + 点哪里重试」三件套补齐。

### A6. 空态文案分「系统空」和「你还没建」

- **Muse 证据（observed，`strings.txt` zh-rCN）**：两套措辞并存——
  系统视角：`暂无安排`、`暂无文件`、`暂无活动`、`尚未追踪任何内容`；
  用户视角：`还没有创建任何内容`、`还没有影音内容`（推断：后者带 CTA）。
- **我们现状**：`screens.tsx` 的 `Empty` 组件覆盖不错
  （`:248` `一点喘息空间 / 今天没有安排。`、`:322` `收件箱很安静`），
  但措辞混用「没有…」一式（`:578`、`:1026`），无「暂无（系统）/还没有（你）」区分，
  且部分空态无下一步（`:1388` `没有匹配的连接器。`就没了）。
- **体感影响**：小 —— 「还没有」暗含「你可以去建」，比「没有」多半步引导。
- **改造成本**：小 —— 文案级；给无 CTA 的空态补下一步入口。

### A7. 触觉是按场景作曲的，而不是四种单震 ★推荐

- **Muse 证据（observed，`classes.txt`）**：
  `components.reactions.AuraReactionHapticsKt`（`buildComposition` —— 震动编成**序列**再放）
  + `HapticBeat` + `HapticPulse` 两个原语；落点在 reaction 场景。
- **我们现状**：`apps/mobile/src/haptics.native.ts:34-45` 只有
  `hapticTap`（Light）、`hapticPress`（Medium）、`hapticSuccess`、`hapticWarn` 四种单发；
  但**长按消息**（`chat.tsx:1428,1447`）、**长按构件**（`thread-artifacts.tsx:68`）、
  **面板拖拽回弹**（`ui.tsx:487-508` `springBack`）三处手势关键点**零触觉**。
- **体感影响**：中 —— 长按无震动 = 不确定「按够久了没」；回弹无震动 = 「关没关上」靠眼睛确认。
  本批体感/成本比最高的一条。
- **改造成本**：小 —— `expo-haptics` 已在；三处各加一行
  （长按 Medium、回弹落位 Light、reaction 成功 Success），
  外加 `hapticPattern` 用 `setTimeout` 序列实现 Beat/Pulse。

### A8. 深色模式：Muse 有一整套外观设置，我们是写死亮色

- **Muse 证据（observed，`classes.txt` + `strings.txt`）**：`appappearance/` 包 53 个类：
  `AppAppearanceOption`、`HatchAppAppearanceManager`、
  `HatchAppAppearanceSettingsScreenKt`（`AppAppearanceModeSection`、`AvatarSizeSection`、
  `ChatThemePicker`）；文案 `外观`、`浅色`、`深色`、`聊天主题`。
  即：模式（浅/深/跟随系统）+ 聊天主题 + 头像尺寸，三级可调。
- **我们现状**：`apps/mobile/src/ui.tsx:35` 起 `colors` 全写死亮色
  （`card: #FFFFFF`、`text: #11191C`…），全仓无 `useColorScheme`/`Appearance`（grep 零命中）；
  无外观设置页，无聊天主题。
- **体感影响**：大（夜间用户）—— 晚上开亮色聊天气泡等于开远光灯；应用商店评论区高频扣分项。
- **改造成本**：中 —— `colors` 已收敛在 `ui.tsx` 一处（好消息），但全仓内联样式多，
  深色要逐屏过一遍；建议先「跟随系统 + 一套深色色板」，主题/头像尺寸后置。

### A9. 滑动回复：Muse 气泡能右滑直接回复，我们只能长按 ★推荐

- **Muse 证据（observed，`classes.txt` + `constants.txt`）**：
  `conversation.view.HatchSwipeToReplyKt` 全套：`HatchReplySwipeContainer` +
  `HatchReplyAffordance`（滑动中露出的回复图标）+ `launchSettleBack`（松手回弹）+
  `LocalConversationListScrolling`/`LocalBubbleTextSelectionActive`（与滚动、文本选择的互斥）；
  `conversation/view/ReplySwipeMetrics.java:47` `(f - f2) * 0.35f + f2`（0.35 阻尼）；
  手册文案 `左滑取消`（zh-rCN）。
- **我们现状**：`chat.tsx:1428,1447` 只有 `onLongPress → setActionsFor`；
  `ui.tsx:484-508` 的 `PanResponder` 只服务底部面板下拉关闭；无 swipe-to-reply、无行级滑动操作。
  另：`HatchMessageLongPressMenuHostKt` 带 `HatchInlineReactionBar`（一步到位），
  我们的长按是「反应面板 + 菜单」分两步（`chat.tsx:466`），少了 inline。
- **体感影响**：大（高频用户）—— 回复是最高频手势之一；长按两步 vs 右滑一步，用一天就拉开差距。
- **改造成本**：中 —— `PanResponder` 已会用（`ui.tsx:496`），给用户气泡包横向 swipe 容器
  （阈值 + 0.35 阻尼 + 松手回弹可照抄），难点是与纵向滚动/文本选择的互斥
  （Muse 为此单列两个 Local 状态，说明踩过坑）。

### A10. 应用内通知栏：Muse 有 InAppNotificationHost，我们只有系统通知

- **Muse 证据（observed，`classes.txt` + `strings.txt`）**：`inappnotification/` 包 21 个类：
  `HatchInAppNotificationHostKt`（Host + Bar + Icon）+ `api.InAppNotification$Duration`；
  文案：`在你的智能体回复或完成任务时接收通知。`、`设置完成后，我会在此处通知你。`、
  `草稿通知已发布。轻触通知即可打开预填草稿的消息，然后按下"发送"。`；
  权限索取有专用 CTA。
- **我们现状**：`local-notifications.native.ts`（183 行）+ `background-updates.tsx:9`
  即只有**系统级**本地通知；应用**内**无通知栏（切后台再回来，错过的完成态无处看）；
  无 opt-in 引导，无「草稿已备好，点我发送」类通知。
- **体感影响**：中 —— 后台跑完任务回来没有一条应用内横幅，等于白跑。
- **改造成本**：中 —— 系统通知已通，加一个应用内横幅 host
 （Duration 自动消失 + 点击跳转对应会话/草稿），数据源接现有后台任务状态。

### A11. 提醒是一等命令，而不是只有日历展示

- **Muse 证据（observed，`classes.txt` + `strings.txt`）**：`commands/alarm/` 整包：
  `AlarmCommandSpecs`、`AlarmDismissHandler`/`AlarmDismissAllHandler`（+ Target）、
  `ReminderDismissHandler`/`ReminderDismissAllHandler` —— 「解散单个/全部」是命令级语义；
  文案：`设置提醒`、`把提醒添加到你的日历。`、`每天%1$s`/`每周`。
- **我们现状**：`screens.tsx:248,800` 日历展示 + 空态齐备，`DateFields.*`/`date-time.ts` 做时间解析；
  但无「设提醒/闹钟」命令语义，无 dismiss/dismiss-all，无系统日历写入入口。
- **体感影响**：中 —— 「帮我明天早上提醒我」是语音助手最高频请求之一；能展示不能设，临门一脚让出去了。
- **改造成本**：中～大 —— 展示层已齐，缺调度（`local-notifications` 可复用）+ 自然语言时间落命令 +
  dismiss 语义；建议先「文本命令设提醒 + 单条解散」，日历写入后置。

---

## B. 服务端 / 数据层（7 条）

### B1. 统一重试与退避封装（不要只靠 SDK 自带）

- **Muse 证据**：`network.fresco.ThumbnailRetryScheduler`/`scheduleRetry$job`；
  `HatchVoiceVideoConfigStore$RetryConfigKey/RetryState`；
  `AuraSessionManager$AbraTokenRefreshResult$Retry`；文案「出错了，点击即可重试。」
- **我们现状**：`apps/server/src/config.ts:100-107` 仅注释说明 Provider SDK 自带重试
  （`MODEL_MAX_RETRIES=2`）；`jev/adapter.ts:80-89` 有 `retryable()`（4xx 仅 408/429）；
  其余只是文案级 "retry" 提示，无统一指数退避/抖动/Retry-After 封装。
- **体感影响**：中 —— 瞬时抖动（网关 502/503、缩略图、流式中断）直接甩给用户「请重试」，多点一次；
  Token 刷新失败无 Retry/Failed/SessionChanged 分级。
- **改造成本**：中 —— 抽 `withRetry({retries, baseMs, jitter, retryable, honorRetryAfter})`
  包住 fetch/网关调用；约 0.5–1 天。

### B2. 离线 outbox：先存本地、恢复后自动同步（不要断网即丢）★推荐

- **Muse 证据**：`conversation.offline.HatchOfflineConversationRepository` /
  `HatchOfflineConversationDao(_Impl)` / `HatchOfflineConversationDatabase(_Impl)` /
  `HatchOfflineConversationCipher` / `HatchOfflineMessageEntity` / `HatchOfflineThreadEntity` /
  `HatchOfflineKeyEntity` / `PurgeOversizedMessagesCallback` /
  `HatchConversationViewModel$seedFromOfflineCache$1`；文案 `No connection`/`Offline`/
  `Reconnecting (%1$d)…`/`没有网络连接`。
- **我们现状**：`apps/server/src/app.ts:258` 仅一句注释 + 状态改写；
  `google-auth.ts:136` 的 `access_type:"offline"` 是 OAuth 语义，与断网续传无关；
  无 outbox/本地持久化/重连同步队列。
- **体感影响**：大 —— 断网时发送/操作直接失败丢失；弱网用户体感就是「东西没了」。
- **改造成本**：高 —— 需 outbox 表 + 断网检测 + 重连 flush + 冲突处理；
  移动端为主，server 侧约 2–3 天联调。

### B3. 缓存：头像/文件元信息加 TTL，不要每次回源

- **Muse 证据**：`network.transport.cache.BoundedInMemoryHatchHttpCacheStore`；
  `audio.HatchAudioCache$getOrDownload/evictIfNeeded`；
  `composer.util.FileThumbnailCache$getOrLoad`；
  `conversation.repo.HatchConversationRepository$seedReplayCursorFromCache`。
- **我们现状**：`apps/server/src/app.ts:106` 全局 `Cache-Control: no-store`；
  `publish.ts:41` 同样 `no-store`；无内存/TTL/LRU、ETag、SWR；
  `search.ts` 的 key 轮询是可用性策略非缓存。
- **体感影响**：中 —— 头像/文件预览每次回源；列表/详情无 seed-from-cache，首屏必等网络。
- **改造成本**：中 —— Store/服务层加带 TTL 的 LRU（头像/文件元信息 5–15min）；约 1 天。
  注意隐私：no-store 的发布链接不要缓存 body。

### B4. 错误码：给 AppError 加业务码，不要只有 HTTP 状态 ★推荐

- **Muse 证据**：`network.hatchauth.HatchAuthError$RateLimited`；
  `$$inlined$executeStefiRequest…$HatchHttpApi$WhenMappings`（统一请求执行器 + 结果映射）；
  `bugreport.AuraBugReportCollector$ReplaceResult$TooLarge/Failed`。
- **我们现状**：`apps/server/src/errors.ts:1-9`
  `AppError(message, status)` 只有 HTTP 状态、无业务码；
  `log.ts:17-29` 只记 status+requestId；
  `jev/adapter.ts:158-162` 把错误二分为 "Please retry / Do not retry" 文案。
- **体感影响**：中 —— 前端只能按 HTTP 状态猜原因；
  排查时缺业务码 + cause 链，只能翻日志猜。
- **改造成本**：小 —— 加 `code` 字段
  （如 `QUOTA_EXHAUSTED`/`UPSTREAM_5xx`/`AUTH_EXPIRED`），响应统一
  `{error:{code,message,retryable,retryAfter}}`；约 0.5 天。

### B5. 限流提示：429 带 Retry-After + 剩余额度，不要只说稍后再试 ★推荐

- **Muse 证据**：文案「你已用完当前周期的所有%1$s词元。请升级方案或等待词元重置。」/
  「出错次数过多，请稍后重试。」；类 `subscription.repo.CreditQuotaType`；
  `login.nativeflow.HatchCaaRateLimit`。
- **我们现状**：`apps/server/src/app.ts:181` 登录限流 429 无 Retry-After 头；
  `search.ts:546-549` 配额类失败把 key 关小黑屋（服务端自保），但不向客户端透出配额/重置时间。
- **体感影响**：中 —— 用户被限流只看到「稍后再试」，不知道等多久、是哪个配额，会反复撞墙。
- **改造成本**：小 —— 429 统一加 `Retry-After` + `X-RateLimit-Remaining/Reset`，
  配额耗尽返回升级/等待双选项文案；约 0.5 天。

### B6. 数据迁移：建版本表 + 启动顺序执行，不要裸改表

- **Muse 证据**：`conversation.offline.HatchOfflineConversationDatabase(_Impl)`
  （Room 式版本化 DB）、`startup.AuraStartupOrchestrator$upgradeToFullScope`；
  `PurgeOversizedMessagesCallback`（超大消息清理）。
- **我们现状**：`apps/server/src/db.ts:14-51` 只有 `isCorruptRow/recoverRows`
  （TOAST 坏块逐行跳过 + 记日志），无 `schemaVersion`/`user_version`、无 migration 脚本、无升级路径。
- **体感影响**：中（长期）—— 现在单表结构还能撑；一旦改字段/加表，老库用户升级即 500，
  且无 purge 策略，坏数据越积越多。
- **改造成本**：中 —— 建 `schema_migrations` 版本表 + 启动顺序执行 `ALTER TABLE…`；
  附带 oversized 行 purge；约 1 天。

### B7. 日志与诊断：一键收集（脱敏）+ request-id 贯穿，不要只靠贴控制台

- **Muse 证据**：`bugreport.AuraBugReportCollector/collect/cleanupAsync`、
  `bugreport.AuraBugReportSender$uploadStefiAttachment`、
  `analytics.AuraLogger/AuraAnalytics/HatchAppEventLogger`、crashreporting（22 类）、tracer（2 类）；
  文案 `Collecting diagnostics…`/`Include logs and diagnostics`/`正在收集诊断信息…`/`代理日志`。
- **我们现状**：`apps/server/src/log.ts:1-29` 只有 `backgroundFailure`/`providerFailure` 打 console
  （刻意不记 payload/credential URL）；无 request-id 贯穿、无一键「收集诊断/上报 bug」、
  无脱敏附件上传。
- **体感影响**：中 —— 线上出问题只能让用户「贴控制台日志」，复现率低；
  跨 provider/网关/DB 的一次请求串不起来，定位靠猜。
- **改造成本**：中 —— `x-request-id` 贯穿 + 结构化 JSON 日志 +
  `/api/diagnostics` 一键打包（脱敏）+ 可选 Sentry；约 1–2 天。

---

## 建议先做的 5 条（体感 ÷ 成本）

| # | 条目 | 体感 | 成本 | 为什么先做 |
|---|---|---|---|---|
| A7 | **触觉作曲**（长按/回弹/成功） | 中 | 小 | 本批比值最高；`expo-haptics` 已在，三处各加一行 |
| A4 | **加载文案细分** | 中 | 小 | 纯文案；「在等什么」是等待焦虑主因 |
| A5 | **错误文案三件套** | 中 | 小 | 纯文案；差一次工单/一次弃用 |
| B4 | **错误码** | 中 | 小 | 0.5 天；前端/排查双受益 |
| B5 | **限流提示** | 中 | 小 | 0.5 天；消灭「反复撞墙」 |

> A1（进场动画变体）+ A2（滚动 fade）+ A3（时长表）+ A6（空态措辞）同为小成本，
> 可与上面 5 条拼成一批「纯前端 polish 周」；A9（滑动回复）体感大但成本中，单独成项；
> A8（深色）/A10（应用内通知）/A11（提醒命令）/B1（重试封装）/B3（缓存）/B6（迁移）/B7（诊断）
> 成本中以上，按需排期；B2（离线 outbox）成本最高，单独立项。

## 待证 / 未纳入

- `AuraCelebrationBlastKt` 等粒子特效（第一批已注明与 P2-6 重叠，本批仍不立项）。
- `HatchDictationMicRecorder` 的 `CaptureStats` 细节（第一批 §5 已覆盖状态机，本批不重复）。
