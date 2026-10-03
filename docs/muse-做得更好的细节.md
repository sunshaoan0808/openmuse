# Muse「同一个功能上更讲究」的细节（对标分析）

> 这一单挖的是与 [`改造清单-对标Muse.md`](./改造清单-对标Muse.md) **互补**的另一类差距：
> 改造清单回答的是「Muse 有、我们没有」的功能有无问题；本清单回答的是**同一个功能上 Muse 更讲究的地方**——
> 手感、时机、状态机完备度、边界与限制、文案密度、动画节奏、容错与重试。
>
> 也就是说：下面每一条，我们**都已经有这个功能了**，只是做得比 Muse 糙。

## 证据来源与方法

- **Muse 侧**（真包 `com.facebook.aura` 9.0.0.23.178，`/home/ubuntu/muse-pkg/muse.apk`，**不重新反编译**，只检索已挖好的证据底座）：
  - `/tmp/muse-evidence/classes.txt`（27477 个 aura/hatch 类名）——用于类名/状态机/组件符号；
  - `/tmp/muse-evidence/strings.txt`（98370 条资源字符串，格式 `[A] locale⇥资源名⇥值`）——用于中文 UI 文案（键名多为 `(name removed)`，值可靠）；
  - `/tmp/muse-evidence/constants.txt`（dex 数值常量 + jadx 字面量行）——用于尺寸/阈值/时长；
  - `docs/muse-原版挖掘记录.md`（已有结论，直接引用）；
  - `/tmp/muse-jadx/sources`（jadx 产物，用于补 `类.java:行号`）。
- **我们这侧**：`apps/mobile/src/*` 与 `apps/mobile/App.tsx`，每条给出 `文件:行号`。
- **证据强度**：类名/字符串/常量是直接读到的（`observed`）；由类名推断出的界面行为标注「推断」。拿不到证据的标「待证」。
- 排序口径：**体感影响 ÷ 改造成本**（大=3/中=2/小=1 作为量级，同比值时影响大者在前）。
- 本文件**只做分析**，不含任何代码改动建议之外的实现，也不涉及顶栏实现（另一任务）。

---

## 1. 子任务行：跟着心跳走的「用时」，而不是一个静态数字 ★推荐

- **Muse 的做法**：并行子代理那一行会把**实时累计秒数**直接写在文案里。`strings.txt`：
  `[A] zh-rCN (name removed) %1$d个子智能体%2$s工作中 · %3$d秒`，另有单档 `[A] zh-rCN (name removed) %1$s秒`；
  活动模型见 `docs/muse-原版挖掘记录.md` §2（`activeSubAgents`/`SubAgentRow`、`agentActivityExpiryJob`）。即「N 个子智能体在跑 · 已 X 秒」是一个**每秒刷新**的活数字，用户能凭它判断「是真在动还是卡住了」。
- **我们的实况**：聊天里的并行任务栏只报数量与状态，没有任何时间维度的心跳。`apps/mobile/src/running-tasks.tsx:54`
  （`{summary.running > 0 ? \`${summary.running} 个任务在跑\` : ...}`）；任务流卡片 `apps/mobile/src/activity-card.tsx:55` 的
  `用时 ${duration}` **只在跑完（`running=false`）后才出现**，跑的时候看不到。
- **用户体感影响**：中 —— 长任务里「有没有在动」是第一焦虑源。
- **改造成本**：小 —— 已有 `startedAt`/`endedAt`（`activity-card.tsx:32-35`）与秒级 tick 只需一个 `useEffect` 定时器；文案对齐 `已 X 秒`。

## 2. 代码块：带「复制代码」按钮，而不是只能手选 ★推荐

- **Muse 的做法**：代码块是可一键复制的组件。`strings.txt`：`[A] zh-rCN (name removed) 复制代码`；组件符号
  `conversation/view/richcontent/HatchCodeBlockKt`（见 `docs/muse-原版挖掘记录.md` §10）。
- **我们的实况**：`apps/mobile/src/assistant-response.tsx:77-128` 的 `CodeBlock` 有语言标签、四色高亮、横向滚动，
  但**没有复制按钮**——只有 `Text selectable`（`assistant-response.tsx:108`），长代码手选极难。
- **用户体感影响**：中 —— 拿到代码的第一动作就是复制。
- **改造成本**：小 —— 复用 `Clipboard.setStringAsync`，且复制时已有「去零宽字符」的既有做法可照抄
  （`apps/mobile/src/chat.tsx:1186`）。

## 3. 发送态：发送按钮会变成「上传中」转圈，每条消息有「发送中/已发送」 ★推荐

- **Muse 的做法**：主行动按钮有第三个态。`constants.txt` 的
  `composer/view/HatchComposerKt$ComposerPrimaryActionSlot$1$1.java:82` 命中
  `AuraSpinnerKt.m1925AuraSpinnerFNF3uiM(..., "hatch-send-button-uploading")`——发送键在上传附件时换成 spinner；
  `$1$2.java:52` 则是 `hatch_stop_square`（回复中变停止键）。消息级文案：`strings.txt` 有 `正在发送…`、`已发送`、`正在发送消息`（推断为出站队列/气泡上的发送状态）。
- **我们的实况**：发送键只在「发送 / 停止」两态间切（`apps/mobile/src/chat.tsx:1988-1996`，依据 `replying` 与 `draft`），
  **不反映附件上传**；`imageBusy` 只挂在「+ / 图片」两个入口上（`chat.tsx:1895`）。排队中的消息只显示
  `接下来 / 消息已暂缓`（`chat.tsx:1690`），没有逐条的「发送中/已发送」。
- **用户体感影响**：中 —— 上传大附件时「点了发送却像没反应」。
- **改造成本**：小 —— `imageBusy` 状态已在（`chat.tsx:633` 附近），把它的「忙」接到发送键样式/图标即可；出站队列的消息状态由 `conversation-queue.ts` 提供。

## 4. 上传前先做体积预检，超限给具体 MB ★推荐

- **Muse 的做法**：附件大小有**显式的、可被远端配置的上限**，且超限是**带类型的异常**而不是泛化报错。
  `composer.upload.AttachmentTooLargeException`（`classes.txt`）；
  `HatchConversationViewModel.java:219` `DEFAULT_MAX_UPLOAD_SIZE_MB = 25` 与 `:6270` `getEffectiveMaxUploadSizeLimitMb()`；
  文案 `strings.txt`：`文件过大。上限是%1$s MB`、`文件过大，上限为%1$dMB。`。
- **我们的实况**：客户端选完文件直接上传，**没有任何体积校验**（`apps/mobile/src/image-attachment.ts:53-83` `uploadImage`、
  `:103-135` `uploadDocument`）；服务端只有一条 12MB 的整体 body 限制，报的还是通用于 PDF 的话术
  `请求过大；PDF 需在 10 MB 以内`（`apps/server/src/app.ts:115-118`）。选一个 40MB 视频 → 传完才失败，且文案答非所问。
- **用户体感影响**：中 —— 失败来得晚且说不清原因。
- **改造成本**：小 —— `DocumentPicker` 的 asset 已带 `size`，在 `pickDocument`（`chat.tsx:1019`）里先判即可；文案对齐「上限 X MB」。

## 5. 语音输入：音频焦点、失败自愈、取消阈值、实时波形

- **Muse 的做法**：语音是一整套状态机，不是「开/关」。
  `composer/view/dictation/` 下：`ComposerDictationController`（含 `start$fireAutoSubmit`）、`DictationMode`/`DictationOutcome`/`DictationGating`、
  `HatchDictationMicRecorder`（内含 `AudioFocusState`、`CaptureStats`、`scheduleStartRetry`、`onAudioFocusChange`——
  **处理音频焦点被别的应用抢走**、失败会自己重试）、`HatchAndroidDictationService`（`downloadModelThenStart`、`modelDownloadTimeout`——
  含**端上模型下载**）、`HatchShortwaveDictationClient`（流式 PCM）。
  取消距离有明确阈值：`constants.txt` 的 `composer/view/HatchComposerKt.java:133` `DICTATION_CANCEL_THRESHOLD = 60.0f`（60dp）；
  波形：`HoldDictationComposerKt.java:126` `DictationWaveform3IgeMak(waveformBuffer, ...)`；文案 `按住即可语音输入`。
- **我们的实况**：`apps/mobile/src/speech.native.ts:81-114` 只有 `toggle()` 开/停，`continuous:false`；
  **没有音频焦点处理、没有失败自动重试、没有按住取消阈值、没有实时波形**；界面上只有一圈 `MicPulse` 扩散光
  （`apps/mobile/src/chat.tsx:133-148`）。识别中被电话/其他录音应用抢麦没有任何兜底。
- **用户体感影响**：大 —— 语音是移动端最高频的输入方式之一，静默失败最伤人。
- **改造成本**：中 —— 音频焦点/重试可在 `speech.native.ts` 内加；波形需要拿到分贝采样；无需动原生工程（`expo-speech-recognition` 已接）。

## 6. 附件上传：本端暂存 + 逐张进度 + 失败轻触重试 + 预览

- **Muse 的做法**：附件有**本地暂存与待发模型**，不是选完即丢。
  `composer.upload.HatchAttachmentStaging`（`stage` / `stageBytes`）、`HatchPendingAttachment`、`HatchAttachmentUploader`；
  `composer.view.HatchAttachmentsMenuKt` + `AttachmentMenuId` + `AttachmentCategory`（分类型）。
  文案 `strings.txt`：`%1$s正在上传…`、`上传失败。轻触即可重试`、`无法上传附件，请重试。`、`附件预览`、`移除附件`；
  预览组件 `agentpermission/AgentPermissionRequestPreviewAttachmentsKt`（含 `PreviewAttachmentMedia`、`openViewerModifier`）。
- **我们的实况**：上传全程只用一个 `imageBusy` 字符串 + 一行全局错误（`apps/mobile/src/chat.tsx:996-1017` `attachImage`、
  `:1018-1044` `pickDocument`）；附件在上传成功后才以 chip 出现（`chat.tsx:1826-1858`），
  **没有逐张进度、没有失败重试入口、没有点击预览**（失败只是把服务端错误塞进 `attachError`）。
- **用户体感影响**：中 —— 附件是任务质量的直接来源。
- **改造成本**：中 —— 需要把「上传中/失败」的临时条目纳入 composer 的附件列表状态（当前是 `attachments: string[]`，`chat.tsx:625`）。

## 7. 暂停/继续：有确认、有覆盖层、有生物识别

- **Muse 的做法**：暂停是**一整屏的交互**，不是静默切换。
  `pause/HatchPauseBottomSheetComponentKt`（内含 `biometricPrompt`、`topCenterPositionProvider`）、
  `pause/HatchPausedOverlayKt`（暂停时的覆盖层）、`pause/HatchPauseBottomSheetContentKt$PauseHatchConfirmDialog`、
  `pause/HatchUnpauseBottomSheetContentKt`；文案：`暂停`、`取消暂停`、`使用生物特征数据取消暂停？`、`%1$s已暂停`。
- **我们的实况**：`stop()` 只做 `queue.pause()` + `copilotkit.stopAgent`（`apps/mobile/src/chat.tsx:967-975`），
  暂停的表现仅是一条小字 `消息已暂缓 · 发送前请保持应用在前台`（`chat.tsx:1690`）加一个「发送排队中的消息」按钮
  （`chat.tsx:1713-1724`）——**没有二次确认、没有全局「已暂停」态**，用户很容易以为已经停了实际仍在排队。
- **用户体感影响**：中 —— 停止/暂停是「安全感」功能。
- **改造成本**：中 —— 复用既有 `Sheet`（`ui.tsx:400`）做确认面板 + 一条顶部/覆盖提示；生物识别可选。

## 8. 链接预览：正文与输入区都能把 URL 变成预览卡

- **Muse 的做法**：消息正文与输入区都会识别可预览的链接并渲染成卡片。
  `conversation/view/HatchMessageLinkPreviewKt`、`utils/HatchLinkPreviewKt$findPreviewableUrlRanges`、
  `composer/view/ComposerLinkPreviewState`、`composer/view/ComposerLinkPreviewsKt`
  （`constants.txt` 的 `HatchComposerKt$TextInputComposer$mainRow$1.java:269` 出现 `composerLinkPreviewState` 入参）。
- **我们的实况**：正文里的链接只是普通下划线文本（`apps/mobile/src/assistant-response.tsx:44` `link: { color, textDecorationLine: "underline" }`），
  没有标题/摘要/缩略图卡；输入框粘贴 URL 时也没有任何预览（`chat.tsx:1900-1948` 的 `TextInput` 无链接识别）。
- **用户体感影响**：中 —— 「它到底读的是哪个链接」一回可见。
- **改造成本**：中 —— 服务端已有网页抓取能力（`read_pages`/`search.ts`），可复用来生成预览元数据。

## 9. 复制的可见反馈（toast）

- **Muse 的做法**：复制一律有回执。`strings.txt`：`已复制到剪贴板`（出现 3 次）、`已复制`、`链接已复制`、`复制密钥`。
- **我们的实况**：复制消息文本是**静默**的（`apps/mobile/src/chat.tsx:1184-1187` `copyMessageText`）。
  但仓库里**已经有现成的 toast 通道**（`apps/mobile/App.tsx:238-257` 的 `toast` 状态 + `workspace.tsx:36` 的 `notify`），
  只是消息复制没用它（对比：`thread-artifacts.tsx:130` `notify("公开链接已复制")`、`details.tsx:1019-1020` 链接复制有「已复制」态）。
- **用户体感影响**：小 —— 但「不知道复没复上」是高频微挫败。
- **改造成本**：小 —— 一行 `notify("已复制到剪贴板")`。

## 10. 撤回时如实提示「可能仍在智能体记忆里」

- **Muse 的做法**：撤回不是简单删掉就完，会给出边界说明。`strings.txt`：
  `你可以删除已发送的消息。你删除的消息会从对话中移除，但可能仍留在智能体的记忆中。`
- **我们的实况**：撤回菜单项只写「撤回」（`apps/mobile/src/chat.tsx:488`），
  `unsendMessage`（`chat.tsx:1165-1183`）直接本端移除 + 写服务端墓碑，**没有任何关于「记忆里还在」的提示**。
- **用户体感影响**：小 —— 但涉及隐私预期，说清楚比不说好。
- **改造成本**：小 —— 菜单/确认文案一处。

## 11. 输入框字数上限与实时计数

- **Muse 的做法**：输入有软上限并实时告知。`strings.txt`：
  `已输入%1$d个字符，最多不能超过%2$d个字符`、`已达到%1$d个字符的上限`。
- **我们的实况**：聊天输入框**没有 `maxLength`、没有计数**（`apps/mobile/src/chat.tsx:1900-1948` 的 `TextInput` 无该属性）。
  仓库里别处其实用得上（`details.tsx:1037/1044` 邮件主题 120、正文 300；`computer-workspace.tsx:193` 16000），
  唯独对话输入框是裸的。
- **用户体感影响**：小 —— 长文用户会撞上。
- **改造成本**：小 —— `TextInput` 补 `maxLength` + 在临界时显示计数。

## 12. 附件数量上限的友好提示

- **Muse 的做法**：附件有数量上限，超了说人话。`strings.txt`：`你最多可附加%1$d项内容`；
  分类模型 `composer.upload.AttachmentCategory`。
- **我们的实况**：附件是无限追加的（`apps/mobile/src/chat.tsx:1740-1743` 的 `attachments` 累加无上限），
  超量只会让 composer 越挤越多（`chat.tsx:1826-1858`）。
- **用户体感影响**：小 —— 上限本身低敏，但无上限会造成版面失控。
- **改造成本**：小。

## 13. 相机：应用内取景与拍摄确认，而不是直接甩给系统相机

- **Muse 的做法**：相机是应用内的组件（推断）：`composer/camera/HatchCameraScreenKt`
  （含 `HatchCameraConfirmation`）、`HatchCameraPreviewKt`、`HatchCameraDialogKt`、`HatchCameraCaptureState`
  （`launch` / `takeResult` 状态机）、`HatchCameraLauncherKt`（`permission` / `onFailure` 分支）。
- **我们的实况**：`apps/mobile/src/image-attachment.ts:32-37` 直接 `ImagePicker.launchCameraAsync` 调系统相机，
  **没有应用内取景、没有拍后确认/重拍**；权限失败是靠 catch 后拼一句中文（`:26-31`）。
- **用户体感影响**：中（对拍照高频的用户）。
- **改造成本**：大 —— 需要引入相机预览能力（expo-camera）并自建取景/确认界面；故排在末位。

---

## 建议先做的 5 条（体感影响 ÷ 成本 最高）

| # | 条目 | 体感 | 成本 | 为什么先做 |
|---|---|---|---|---|
| 1 | **子任务行实时秒数**（§1） | 中 | 小 | 直接回答「它到底在动没有」，纯前端、有 `startedAt` 现成 |
| 2 | **代码块「复制代码」按钮**（§2） | 中 | 小 | 一行交互，复制既有去零宽字符逻辑可抄 |
| 3 | **发送中/已发送 + 发送键上传态**（§3） | 中 | 小 | 复用已存在的 `imageBusy`/出站队列状态，消除「点了没反应」 |
| 4 | **上传前体积预检 + 具体 MB 上限**（§4） | 中 | 小 | 把「传完才失败且答非所问」提前成「选完即知」 |
| 5 | **语音输入健壮性**（§5） | 大 | 中 | 音频焦点/自动重试是静默失败的最大来源，收益最大 |

> 前 4 条都是小成本、可单点验证；第 5 条成本略高但收益面最广，作为本组收尾。

## 排序总表（体感÷成本）

| 序 | 条目 | 体感 | 成本 | 比值 |
|---|---|---|---|---|
| 1 | 子任务行实时秒数 | 中 | 小 | 2.0 |
| 2 | 代码块复制按钮 | 中 | 小 | 2.0 |
| 3 | 发送中/已发送 + 发送键上传态 | 中 | 小 | 2.0 |
| 4 | 上传前体积预检 + 具体 MB | 中 | 小 | 2.0 |
| 5 | 语音输入健壮性（焦点/重试/波形/取消阈值） | 大 | 中 | 1.5 |
| 6 | 附件上传态/失败重试/预览 | 中 | 中 | 1.0 |
| 7 | 暂停/继续的确认与覆盖层 | 中 | 中 | 1.0 |
| 8 | 正文与输入区链接预览 | 中 | 中 | 1.0 |
| 9 | 复制反馈 toast | 小 | 小 | 1.0 |
| 10 | 撤回「仍在记忆中」提示 | 小 | 小 | 1.0 |
| 11 | 输入框字数上限与计数 | 小 | 小 | 1.0 |
| 12 | 附件数量上限提示 | 小 | 小 | 1.0 |
| 13 | 相机应用内取景与确认 | 中 | 大 | 0.67 |

## 待证 / 未纳入

- 「正在发送…/已发送」具体挂在气泡还是出站队列上——`strings.txt` 有值但键名已被抹，**未定位到确切宿主组件**，标**待证**（不影响 §3 结论方向）。
- `components/reactions/AuraCelebrationBlastKt` / `AuraCrownDropKt` / `AuraFireSmokeBurstKt` 等一批粒子特效类，疑似「完成/庆祝」的一次性特效库，但与改造清单 P2-6（头像状态动画/里程碑）重叠，**本单不重复立项**。
