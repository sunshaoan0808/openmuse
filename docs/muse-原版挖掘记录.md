# Muse 原版挖掘记录

> 目标：把 Meta Muse（原版 App）的**产品结构与机制**挖清楚，作为 OpenMuse 对齐的参照。
> 本文件只记录**观察到的证据**与**推断**，不搬运任何原版资产或代码。

## 0. 样本与方法（可复现）

| 项 | 值 |
|---|---|
| 包名 | `com.facebook.aura` |
| 版本 | `9.0.0.23.178`（versionCode `1061401224`） |
| 样本 | APKPure 官方镜像的 base APK（40 MB，arm64 主 dex 4 个） |
| SHA-256（前 32 位） | `8423c0c35cef538fe274a969c573ad59` |
| 类总数 | 48,514 |
| 实现层 | 原生 Android + Jetpack Compose（`vds` 是其设计系统，代号 Aura），**不是 RN/Flutter** |

复现命令（工具链见 `apk-reverse` skill，已装 `jadx`/`droidasc`/`apktool`/smali jar）：

```bash
# 类清单（48k 行）
droidasc listclass muse.apk > /tmp/muse-classes.txt
# 按模块统计
grep '^Lcom/facebook/aura/' /tmp/muse-classes.txt | sed 's|^Lcom/facebook/aura/||' | awk -F/ 'NF>1{print $1}' | sort | uniq -c | sort -rn
# 单个类反编译
droidasc getclass muse.apk com.facebook.aura.status.viewmodel.HatchPillState
# 清单
droidasc getmanifest muse.apk
```

**证据强度标记**（沿用 apk-reverse skill 的约定）：
`observed` = 直接读到符号/字段；`inferred` = 由符号合理推断；`unverified` = 没验证。

**未能覆盖的**：资源表（`resources.arsc`）被加固，`apktool` 解不开，所以**没有**取到颜色/尺寸等资源常量（顶栏尺寸是靠官方截图逐像素量的，见 §3.5）；无真机（`adb`/frida-server 未接），动态行为未验证。

## 1. 产品模块地图（`observed`）

`com/facebook/aura/` 下一级模块与类数：

| 模块 | 类数 | 含义（推断） |
|---|---|---|
| `conversation` | 2382 | 会话主体（线程、消息、装饰） |
| `partners` | 1852 | 第三方合作集成 |
| `settings` | 1747 | 设置 |
| `navigation` | 1668 | 导航（tabs/spaces/overlay） |
| `gateway` | 1367 | 模型/agent 网关层 |
| `skills` | 1003 | **连接器 + 授权**（见 §5） |
| `vds` | 945 | 视觉设计系统（Aura VDS） |
| `library` | 941 | 产出物库（≈ 我们的 artifacts） |
| `file` | 888 | 文件 |
| `network` | 845 | 网络 |
| `login` | 701 | 登录 |
| `agentpermission` | 684 | **审批/授权**（见 §4） |
| `commands` | 620 | **手机侧能力面**（见 §6） |
| `devices` | 609 | 设备（node） |
| `status` | 604 | **状态胶囊 + 头像面板**（见 §3） |
| `subscription` | 548 | 订阅/付费墙 |
| `nodes` | 479 | 节点（手机/设备抽象） |
| `feed` | 426 | 动态流（≈ 我们的"动态"） |
| `composer` | 401 | 输入区 |
| `spaces` | 398 | 空间（会话分组？） |
| `confidentialvm` + `ccv` | 349 + 287 | 跑代码的机密 VM（≈ 我们的 computer） |
| `assist` | 274 | 语音助手 |
| `bloks` | 284 | Meta Bloks UI |

## 2. 会话与并发模型（`observed`）

标识符（字段名即语义）：

```
messageQueueDeduping       消息队列 + 去重
messageSeq                 每条消息有序号
messageRetryThreshold      重发阈值
chatEventSeq / chatEventCursorSeq / chatEvents / chatSubscribeParams
                           事件序号 + 游标 + 订阅（断线可增量补）
agentActivity / agentActivityStatus / agentActivityRevision / agentActivityExpiryJob
                           每个活动带状态、版本、过期任务（自动清理）
```

结论（`inferred`）：
1. **一条会话同时只跑一轮**：运行中再发消息进队列并去重，不会起第二条并行回复。
2. **客户端用游标补拉**：`chatEventCursorSeq` 说明断线重连是"按序号补"，不是"重放全部"。
3. **活动会过期**：`agentActivityExpiryJob` 说明"正在…"到点自动消失，不会永久挂着。

## 3. 状态系统（`status`，604 类）

### 3.1 状态词表（`observed`，`HatchPillState` 全部取值）

```
DISCONNECTED · CONNECTING · CONNECTION_ERROR   连接层
WAKING_UP        唤醒中
IDLE             空闲
THINKING         模型在想（未出字、未调工具）
TYPING           正在流式出字
USING_TOOL       正在用工具
MAKING_SOMETHING 正在产出（文件/图片/代码）
WAITING_FOR_SUBAGENTS  等并行子代理
NEEDS_APPROVAL   等你审批
PAUSED / RESETTING / OUT_OF_CREDITS
```

> 关键差距：我们只有"工具级"状态（正在搜索网页…）。**模型思考的那 5～60 秒我们无话可说**，原版把它拆成 THINKING/TYPING/USING_TOOL。

### 3.2 胶囊显示字段（`observed`，`HatchStatusPillUiState`）

```
pillState: HatchPillState      状态枚举
activityEmoji: String          每个动作一个 emoji
subtitleRes / subtitleText     副标题
botName: String                助手名
statusVideos: AvatarStatusVideos   每个状态一段头像动画
milestoneVideoUrl: String      里程碑视频（完成时播）
```

### 3.3 胶囊与头像面板是同一套（`observed`）

```
status/view/StatusPillAvatarPanel · HatchStatusPillAvatarPanelKt
status/view/StatusPillChromeMotion · HatchStatusPillAvatarAnimation
status/view/AvatarViewportShape · HatchAvatarPanelViewport
status/view/HatchAvatarEditMenuButtonKt（头像上的编辑菜单）
```
即：胶囊 ↔ 头像面板是**带视口形状的共享元素变形**，不是"点开弹一个面板"。

### 3.4 顶栏几何协调层（`observed`，`HatchStatusPillMetrics`）

```
avatarBoundsInWindow / pillBoundsInWindow / headerRowBottom / renderedPillBottom
contentTopReservation            在内容里预留顶栏占位
leadingChromeCenterY / trailingChromeCenterY / trailingChromeWidth / trailingChromeOwner
headerButtonEntrance             左右按钮的入场动画
avatarExpanded / avatarPanelProgress / avatarPanelBottomPx
```

### 3.5 磨砂是滚动联动的（`observed`）

```
header/view/ScrimConfig · ScrimConfig$Heavy · ScrimScrollConnection
```
→ 磨砂**不是固定值**，强度跟着滚动变化（停在顶部几乎透明，一滚就厚起来）。

### 3.6 顶栏的尺寸（截图逐像素测量，573px 宽 → 393pt 设备；`observed but approximate`）

| 元素 | 实测 |
|---|---|
| 页面底色 | `#FCFCFC` |
| 左上圆钮 | 白色正圆，≈30pt，两条横线菜单，带柔和阴影 |
| 正中 | **白色圆角卡片**（≈132pt 宽），头像叠在卡片上沿，卡内第一行名字（粗体 ~16pt）、第二行可变（空闲=功能入口，干活=当前动作） |
| 右上 | 白色胶囊（≈45×24pt，文字"邀请"） |
| 顶栏整体 | 没有底边线/整条阴影；玻璃强模糊；控件各自带阴影 |

## 4. 审批与授权（`agentpermission`，684 类）

```
AgentPermissionBannerKt / AgentPermissionBannerUiState      聊天内横幅
AgentPermissionApprovalsScreenKt                            审批页
pastapprovals/ActivePermissionsScreenKt                     ★ 在生效的常驻授权
AgentPermissionHistoryDetailsSheetKt                        历史详情
AgentPermissionTaskDetailsSheetKt                           任务详情
AgentPermissionRequestPreviewLinksKt                        ★ 请求里带预览链接
AgentPermissionIconsKt / AgentPermissionOpenBrowserLinkKt
CheckoutSheet / CheckoutPayWithLinkSheet / ShopifyCheckoutCartSheet / CheckoutTermsDisclosure
                                                            ★ 内置支付流程
```

我们缺的两块：**常驻授权列表**、**请求里的预览链接**。

## 5. 连接器即"skills"（`skills`，1003 类）

```
skills/connect/ApiAuthBottomSheetKt · PasswordAuthBottomSheetKt · CustomConnectorAuthScreenKt
skills/connect/ConnectorAccountLinkRequesterKt
skills/model/SkillKt · repo/HatchSkillsRepository$SkillsData
skills/view/HatchConnectorPermissionsListScreenKt · HatchTaskPermissionsScreenKt
skills/view/HatchConnectedAppsSettingsScreenKt
skills/viewmodel/RecipientPermissionsAvailabilityViewModel · view/RecipientPermissionsEntryKt
```
即：**每个连接器各自走 API-key/密码认证，各自有权限列表，还能按"接收者"配权限**。

## 6. 手机即节点：`commands` + `nodes`（`observed`）

```
commands/alarm/HatchAlarmRinger                      闹钟
commands/health/HealthDataSource + HealthSyncStartupJob   健康数据
commands/location/HatchLocationProvider              定位
commands/contactlookup/ContactNameLookup             通讯录
commands/notifications/*                             通知
commands/core/NodePermissionActivity + HatchPermissionResolver   按节点的权限
```
手机被抽象成 **node**，agent 可以直接操作它（`nodes` 479 类、`devices` 609 类）。这是它"Personal AI agent"的底牌，我们的 computer 是 Docker 沙箱，没有手机侧能力。

## 7. 其他值得记的（`observed`）

- `composer`：`HatchComposerKt` / `TextInputComposer` / `ComposerMicButton`（含 `liftedBeforeThreshold`，说明按住说话的**阈值手势**）/ `HoldDictationComposerKt` / `ComposerDictationController` / `HatchAttachmentUploader` / `composerHintCrossfade` / `composerInputModeTransition`。
- 主题：`agentBubbleColorLight/Dark`、`agentTextColorLight/Dark`、`chatBackgroundLight/Dark`、`chatThemes`（有明暗主题）。
- `conversation`：`HatchConversationScreenKt$ConversationScreenDecoration$showThreadIntroHeader`（线程开头的介绍头）。
- `feed`（426 类）≈ 我们的"动态"；`library`（941）≈ artifacts；`confidentialvm`+`ccv` ≈ computer。

## 8. 与原版的对照（我们已对上的部分）

| 维度 | 原版机制 | 我们的实现 |
|---|---|---|
| 一条会话一轮 | `messageQueueDeduping` + 队列 | ✅ App 发送队列 + 服务端轮次去重/排队 |
| 断线补拉 | `chatEventCursorSeq` | ✅ `/api/conversation?since=` 游标增量 |
| 活动会自动过期 | `agentActivityExpiryJob` | ✅ 活动 90 秒窗口 |
| 活动按会话隔离 | `agentActivityRevision`（每活动独立） | ✅ 按 threadId 存储与匹配 |
| 并行子代理 | `activeSubAgents` / `SubAgentRow` | ✅ 派活任务（durable）+ 聊天内任务栏 |
| 停止/取消 | `StopButton` / `agentActivityCancelToken` | ✅ 任务 pause/cancel、聊天停止 |
| 磨砂顶栏 | 原生 `RenderEffect` + `ScrimConfig` | ✅ expo-blur + 滚动联动遮罩 |
| 助手消息排版 | 纯文本铺在底色上 | ✅ 纯文本（不再套灰卡） |
| 状态词表 | 13 态（THINKING/TYPING/…） | ⚠️ 只有工具级，缺 THINKING/TYPING |
| 常驻授权 | `ActivePermissionsScreen` | ❌ 没有 |
| 胶囊↔面板变形 | 共享元素视口变形 | ⚠️ 现在是弹面板 |
| 每连接器权限 | `HatchConnectorPermissionsListScreen` | ❌ 只有总开关 |
| 手机节点能力 | `commands`（闹钟/健康/定位/通讯录） | ❌ 不做（见计划 §4） |

## 9. 信息架构：导航键注册表（`navigation/key`，544 类）★

Muse 把每个目的地注册成一个 Key，名字直接暴露了它的产品表面（摘录）：

```
AcSkillConsentSheetKey · ApiKeyAuthSheetKey            连接器授权
ActivationScreenKey · ActivationSettingsScreenKey       入门/激活
ActivationLegalSafetySettingsScreenKey · …DataPrivacy… · …HelpSupport…   法律/隐私/帮助
ActivePermissionsScreenKey                              ★ 常驻授权（我们缺）
AgentComputerScreenKey · AgentComputerTakeOverScreenKey ★ 智能体电脑 + 接管
AgentPermissionDecisionSheetKey · …HistoryDetailsSheetKey · …TaskDetailsSheetKey  审批三段
ArchivedSideChatsScreenKey                              ★ 归档的侧边会话（= 我们的会话+归档）
ArtifactsDetailScreenKey                                ★ 产物详情（= 我们的文件详情）
AppLockOverlayScreenKey                                 ★ 应用锁
AuraBugReportScreenKey · AuraBugReportDiagnosticLogsScreenKey  ★ 自带报错 + 诊断日志
AgenticDebugScreenKey · AuraInternalSettingsScreenKey   内部调试
```

## 10. 对话里的富内容（`conversation/view/richcontent`）★

Muse 的助手消息能渲染的不止 markdown：

```
HatchCodeBlockKt                 代码块
HatchKatexRenderer · HatchInlineMathKt · HatchMathContentKt   数学公式（KaTeX）
HatchMermaidContentKt            流程图（Mermaid）
HatchMarkdownTableCardKt         表格（卡片样式）
HatchInlineFileChipKt            行内文件 chip
HatchInlineImageKt / HatchInlineImageData   行内图片
HatchEmbeddedHtmlKt · HatchWidgetWebViewKt  嵌入 HTML / 交互控件（WebView 承载）
BlockQuoteDecoration             引用块
HatchMentionedData               提及数据/产物（@ 引用）
HatchPromptPreviewText           提示词预览
```

对照我们：`assistant-markdown.ts` 用的是**基础 markdown-it**（html:false，无数学/无流程图/无代码高亮），
有 markdown 表格但**没有** KaTeX、Mermaid、代码高亮、行内文件 chip —— 这是"一眼能看出来的差距"。

## 11. 浏览器与电脑控制：租约 + 接管（`gateway/agentbrowser`，128 类）★

```
BrowserControlLease · BrowserControlLeaseJson · BrowserLeaseRequestJson   ★ 控制权租约
AgentBrowserTakeoverControls                        ★ 人来接管的操作
BrowserSessionController · BrowserTaskRepository · BrowserTaskStateKt      会话与任务
BrowserTaskSnapshotJson · AgentBrowserSurface · AgentBrowserRemoteKey      快照与界面
HatchComputerContext · HatchComputerRepository · ComputerContextJson · ComputerEventJson
DesktopImageJson                                    桌面画面
```
即：**"谁在控制浏览器"是一个显式状态**（租约 + 接管），人和 agent 轮流持有；我们只有一句"可接管"的入口，
没有租约/接管状态机。

## 12. 对话级功能与离线（`conversation/{reactions,unsend,unread,offline,search}`）

```
reactions/HatchReactionUsageStore · HatchReactionOrderingKt   消息反应（按使用频率排序）
unsend/HatchUnsendNuxStore                                    撤回消息（带首次提示）
unread/HatchUnreadThreadsRepository · HasUnreadThreadsPayloadJson   未读会话
offline/HatchOfflineConversationCipher · …Dao · …Database     ★ 设备端加密的离线会话库
search/ConversationSearchScreenKt · HatchSearchHit · HatchSearchResult   会话内搜索
```
另：`conversation/view` 里还有 `HatchChatPromptPillKt`（提示词药丸）、`HatchCompactAudioPlayerKt`（音频播放）、
`HatchBrowserTaskCardKt`（浏览器任务卡）、`HatchConnectorAddAccountCardKt`（连接器卡片）、
`ConversationAnchorTracker`/`ConversationTailState`（滚动锚定）、`EmojiCategory`/`EmojiGridItem`（表情选择）、
`FlightOfferBookingRequest`/`FlightOfferDetailHolder`（机票预订流程，`partners` 模块的落地）。

## 13. 目标与产物库的 UI 能力（`library/view`，507 类）

```
ArtifactsDetailScreenKt · ArtifactsSectionKt           产物详情/分区
GoalCreationBottomSheetKt · GoalDetailScreenKt         目标创建（底部面板）/详情
GoalDragResolver · GoalDragSource · GoalDragTarget · GoalDropOutcome   ★ 目标拖拽
GoalCategory · GoalCreationCategory                    目标分类
GoalContextMenuKt · GoalRenameDialogKt · GoalDeleteConfirmationDialogKt  右键菜单/重命名/删除确认
```

## 14. 其他值得记的

- `settings/importmemory`（42 类）——**从别处导入记忆**（把已有助手的记忆迁进来）
- `AppLockOverlayScreenKey` —— 应用锁；`AuraBugReportDiagnosticLogsScreenKey` —— 自带诊断日志（与我们做的崩溃红条同一思路）
- `CredentialCaptureUrlOutcome` —— 登录凭据采集的出口（连接器登录用）
- `HatchComposerScrimKt` —— 输入区也有 scrim（与顶栏同一套磨砂思路）

## 15. 文档与文件交付（`library` 941 类 + `file` 888 类）★

用户要"一份 MD 文件"时，Muse 的完整机制（符号均为直接读到）：

**① 文档是带类型的产物**
```
conversation/viewmodel/HatchDocumentType
  ├─ $Markdown     ← 显式区分 Markdown
  ├─ $Html
  └─ $Generic
```
**② 对话里以"文档 chip"呈现，并带菜单**
```
conversation/view/richcontent/HatchDocumentChipMenuActions
  getOnDownload()            下载
  getOnDownloadAsHtml()      下载为 HTML
  getOnDownloadAsPdf()       下载为 PDF
  getOnSaveToGoogleDrive()   保存到 Google Drive
  getOnShare()               分享
  getArtifactShareOption()   分享范围枚举
utils/ArtifactShareOption = SHARE | PUBLISH | PUBLISH_TO_SHARE   ← 可把产物发布成链接
conversation/viewmodel/HatchConversationViewModel$downloadDocumentAsPdf / $saveDocumentToGoogleDrive
conversation/view/HatchConversationScreenKt$buildDocumentMenuActions$1..6
conversation/view/richcontent/HatchDocumentChipMenuActionsKt$LocalHatchDocumentChipMenuActionsBuilder
```
**③ 文件存放与引用**
```
file/actions/HatchFileActions · HatchShare · HatchShareKt
file/actions/HatchFileRef$Local | $Workspace     ← 文件引用分"本地"与"工作区"
file/core/HatchLocalFileStore · AtomicFileWriter ← 落盘（原子写）
file/core/HatchMimeResolver + $Extensions        ← 扩展名 → MIME
```
**④ 它认得的扩展名（`HatchMimeResolver$Extensions` 全部常量）**
```
文档：md mdown txt csv pdf docx pptx xlsx html htm
代码：py ts jsx kt java go cpp hpp sql yaml toml json plist scss zsh
媒体：mp3 m4a wav ogg mp4 mov mkv avi aac
```
即：**文档、源码、媒体都是"一等文件"**——源码文件也被当成可交付/可预览的产物。

**⑤ 生成 Word/Office 的能力**
```
file/docx/DocElement$Para | $Table | $Image | $Drawing    ← 自己拼 docx 结构
```

### 对照我们（本次已经做完的 + 仍缺的）

| 维度 | Muse | 我们 |
|---|---|---|
| 智能体写出文件 | 文档产物（Markdown/Html/Generic） | ✅ `save_document` 工具（本次加）→ 工作区 files |
| 文件存放 | LocalFileStore + Local/Workspace 引用 | ✅ `dataDir/files`（0600）+ `/api/files/:id/content` |
| 类型识别 | MimeResolver 认 30+ 扩展名（含源码） | ⚠️ 只认 pdf/png/jpg/webp/gif + 文本（md/txt） |
| 对话内呈现 | **文档 chip** + 菜单 | ❌ 只有一句"文件在 Files 里" |
| 导出 | 下载 / HTML / **PDF** / 存 Google Drive / 分享 | ⚠️ 分享（扩展名已修），**无导出 PDF/HTML** |
| 发布链接 | `PUBLISH` / `PUBLISH_TO_SHARE` | ❌ 无 |
| 生成 Office | docx 结构自拼 | ❌ 无（只做 PDF 表单填写） |

## 16. 使用边界

- 本记录**只用于理解机制**，不搬运原版的图片/字体/颜色令牌/代码（沿用项目既定约定：不照抄 Muse 专有资产）。
- 尺寸/配色中，只有"截图逐像素量出来的"那一节是近似值；符号与字段名是直接读到的。
- 资源常量（精确色值、圆角、动效曲线）**没有**取到：`resources.arsc` 被加固，要拿就只能上真机做动态测量。

---

## 11. 灵感（explore / IdeaCard）—— 比我们原来的理解大得多

上一版我以为"灵感"就是一条建议 + 接受/忽略。挖完 `com.facebook.aura.explore`（**44 个类**）
+ 会话侧的 `HatchIdea*` 之后，它其实是一整套**内容 feed + 可执行卡片**系统。

样本：`/home/ubuntu/muse-pkg/muse.apk`（com.facebook.aura 9.0.0.23.178，48514 类）。
复现：`grep "aura/explore/" /tmp/muse-classes.txt`；`droidasc getclass <apk> <FQCN>`。

### 11.1 数据模型（字段名即证据，均 observed）

`explore/repo/IdeaCard`（一张卡片 / 一条灵感）：
```
ideaCardId, title, summary, detailDescription,
fitReason,          ← "为什么贴合你"（我们的 reason 只到这个的一半）
buildSummary, buildStatus,   ← 这张卡是要**造东西**的（有构建状态与摘要）
previewImageUrl, iconUrl, iconMimeType,
primaryLabel, secondaryLabel, actionLabel, displayBadgeText, badges,
sharing: IdeaSharing        ← 可分享
```
`explore/repo/IdeaCardItem`（卡片**内部**的可选项，一张卡有多个 item）：
```
itemId, kind, title, summary, detailDescription, buildSummary,
previewImageUrl, selectable, isSelected   ← 可勾选，勾选后一起执行
```
`explore/repo/IdeaCardSection` / `IdeaSectionJson`：`sectionId, title, subtitle, layout, cards[]`
→ feed 是**分区的**，不是一维列表。
`IdeaCardLayout`（枚举）：**`IDEAS`** 与 **`COMMUNITY_ROWS`** → 至少两种版式（灵感流 / 社区流）。
`IdeaCardDetailOrigin`（枚举）：**`CHAT`** 与 **`FEED`** → 同一张卡既能在**聊天里**出现，
也能在 feed 里出现（来源可区分）。
`IdeaCardsViewerStateJson.hasBuiltIdea` → 存在"我已经造过一张"的用户状态。
`IdeaBadgeJson/DisplayBadgeJson.text`、`IdeaLabelJson` → 卡片上的角标/标签是数据驱动的；
`IdeaCardPresentationJson.badgeTexts()` 是从 badges 派生出来的展示方法（角标文案在客户端算）。

### 11.2 交互闭环（类名即证据）

| 能力 | 类 | 说明 |
|---|---|---|
| 执行 | `IdeaCardExecuteRequestJson{itemIds, mode}` → `IdeaCardExecuteResult{executionId, ideaCardId, status}` | **按 itemIds 执行**（不是整卡一把梭），`mode` 可切换方式 |
| 执行状态 | `IdeaCardExecuteStatus{ACCEPTED, QUEUED, UNKNOWN}`、`IdeaCardExecutionState` | 接受后进入**排队**，与我们"接受→建任务"同构但更细 |
| 反馈 | `IdeaFeedback{UP, DOWN}`（带 `wireValue`）、`IdeaEngagementRequestJson` | 点赞/点踩回路，喂给推荐 |
| 分享 | `IdeaCardShareAttempt/Response/Result` | 单卡可分享 |
| 分页 | `IdeaCardsFeedResponse`、`IdeaCardsPaginationJson` | feed 是**分页**的 |
| 详情合并 | `IdeaCardDetailMergeKt`、`IdeaCardDetailViewModel` | 详情与聊天流合并展示 |

### 11.3 会话侧（`conversation/view/`）

- `HatchIdeaCardRow` / `HatchIdeaRowCardKt` / `HatchIdeaWidgetCardKt` → 灵感**以卡片形式出现在聊天里**
- `HatchSuggestionBarKt` + `HatchSuggestionLabels.resources(UiAction): LabelResources`
  → 输入框上方的**建议条**；建议的文案是**按动作类型**取资源，不是写死的字符串
- `SeededIdeaDetail{detail, isExecutable}` + `IdeaWidgetSeedKt` → **预置/种子灵感**，且标注"是否可执行"
- `HatchSpaceProposalCardKt` → 还有一类"空间提案"卡（与灵感并列的主动提议）

### 11.4 与我们的差距（现状 → Muse）

| 维度 | 我们 | Muse |
|---|---|---|
| 来源 | 只在「灵感」页 | **聊天里也会出卡**（`Origin.CHAT`）+ 建议条 |
| 结构 | 一维列表 | **分区 + 分页**（`Section`/`Layout`） |
| 卡片信息 | title/reason/evidence/prompt | 再加 **fitReason / 预览图 / 图标 / badges / primary·secondary·action** |
| 粒度 | 整条接受或忽略 | 卡片内**多个可勾选 item**，按 itemIds 执行 |
| 反馈 | 无 | **UP/DOWN** 回流 |
| 分享 | 无 | 单卡分享 |
| 预置 | 无 | **种子灵感**（seeded，标注可执行性） |

### 11.5 建议的落地顺序（便宜且立刻能感知的在前）

1. **P0 反馈（UP/DOWN）**：数据结构加 `feedback`，服务端记分并在 `refreshIdeas` 排序时降权点踩过的类型
2. **P0 分区**：`/api/agent` 的 ideas 按 `kind` 分组返回（邮件文档 / 日程对接 / 目标计划），App 按区分组渲染
3. **P0 文案对齐 fitReason**：把 `reason` 的展示改成"为什么贴合你"的措辞
4. **P1 聊天内出卡**：把新灵感以卡片形式插到聊天流（等价 `Origin.CHAT`），可执行/忽略
5. **P1 建议条**：输入框上方给 2–3 条短建议（`SuggestionBar`）
6. **P1 预置种子灵感**：无来源时给出可执行的种子卡（而不是空状态）
7. **P2 多 item + 勾选执行**、**P2 分享**、**P2 分页**

---

## 12. 编程任务 / 提交仓库 / 一次性密钥 —— Muse 的 Confidential VM 体系

问题：用户在 Muse 里跑编程任务能提交仓库，而且"密钥用完就销毁"。挖 `com.facebook.aura`
的 `confidentialvm`（386 类）、`ccv`（287 类）、`gateway`（1367 类）、`devices/token` 之后，
它不是"给 Agent 一个 Git token"，而是**每个用户一台受证明保护的 VM + 网关代理 + 可吊销凭据**。

### 12.1 执行面（VM）

| 类 | 含义（observed） |
|---|---|
| `confidentialvm/HatchVmPeerType` | 枚举 **`CONFIDENTIAL` / `STANDARD`** —— 两种 VM 并存 |
| `confidentialvm/ConfidentialVmProvisioningReset` | `reset(userSession)` / `resetForVmSwitch(...)` —— VM 可**重置/切换**（销毁语义） |
| `confidentialvm/ConfidentialVmSetupGate` | 开通闸门（先满足条件才给 VM） |
| `confidentialvm/HatchVmAccessController` | 访问控制核心：持 `gateway: HatchGatewayConnection`、`repository: ConfidentialVmRepository`、`userSession`、`attemptedAutomaticCredentialVmIds`、`credentialReconnectInFlight`、`localConnectionFailure` |
| `confidentialvm/HatchVmAccessInputs` | 放行判定的输入：`connectionFailed`、`credentialReconnectInFlight`、`gatewayState: HatchGatewayStateSnapshot`、`userData` |
| `HatchVmAccessState$SecurityFailure / $RetriableFailure / $Resuming` | 访问状态机（安全失败 / 可重试失败 / 恢复中） |

### 12.2 通道（Noise + 硬件证明）

| 类 | 含义 |
|---|---|
| `gateway/noise/carrier/NoiseGatewayCarrier` | 网关的 **Noise 协议**信道（端到端加密握手） |
| `gateway/noise/carrier/NoiseGatewayCarrierSoLoader` | 原生 **.so** 实现（握手在 native 层） |
| `gateway/noise/carrier/AttestationVerifierHolder` | **校验对端证明（attestation）** —— 这是"敢把代码和凭据交给那台 VM"的前提 |
| `gateway/noise/carrier/Stream0Listener` | Noise 的第 0 号流（握手/控制流） |
| `gateway/connection/*`（127 类） | 完整连接状态机：`ConnectionEngine/Reducer/Phase/LifecycleSnapshot/DemandOutcome/ConnectAttemptCancellation` |

### 12.3 凭据：怎么做"用完就销毁"（这是用户最关心的一条）

| 类 | 含义 |
|---|---|
| `devices/token/LinkDeviceTokenMinter` | **`mintDeviceTokens(...)` + `revokeDeviceTokens(...)`** —— 令牌可铸造、**可吊销** |
| `devices/token/DeviceTokenRevokeRequestJson/ResponseJson` | 吊销是**一条显式请求**，不是靠过期 |
| `confidentialvm/StoredCredentialContinuation` | 枚举 **`SHOW_PROMPT` / `RETRY` / `SECURITY_FAILURE` / `RETRIABLE_FAILURE`** —— 存下来的凭据失效时的续接策略（先静默重试，安全失败才找人） |
| `confidentialvm/model/ConfidentialVmTemporaryAccessViewModel` | **临时访问**（时间受限） |
| `confidentialvm/repository/ConfidentialVmEscrowResult` | **托管（escrow）** |
| `confidentialvm/model/ConfidentialVmPin*`（register/reminder/state） | 用 **PIN** 保护这台 VM 的访问 |
| `confidentialvm/ConfidentialVmOperatorSshJsonKt` | 给"操作者"的 **SSH** 端点（Agent/运维进去干活的口子） |
| `common/prefs/AuraVMPrefStore` + `AuraPrefsSignOutCleanupHandler` | 按 VM 存偏好；**登出时清理** |
| `agentpermission/pastapprovals/RevokeActivePermissionRequestJson` | 授权也可显式**撤销** |

### 12.4 编程任务的界面侧

- `agentcomputer/view/AgentComputerScreenKt`（Agent 的"电脑"全屏）
- `agentcomputer/view/AgentComputerTerminalStateKt`（**终端状态** —— 任务在 VM 里跑命令）
- `agentcomputer/view/AgentComputerTakeOverScreenKt` + `BrowserTakeoverBottomBarKt`（**接管**）
- `common/prefs/HatchDeveloperMode` / `HatchDeveloperPrefs`（开发者模式）
- App 的 DEX 里**搜不到任何 git/PR/repo 痕迹**（`strings | grep -i "git clone|pull request|diff --git"` 只命中外链文档）
  → **代码与提交动作全部发生在 VM 内部**，App 只负责显示终端与控制权

### 12.5 一句话总结这套设计

```
App ──Noise 加密信道（native .so）+ 对端 attestation 校验── gateway
      └─ HatchVmAccessController 按 gateway 状态 + 用户数据放行
         · 凭据：mint / revoke（显式吊销）+ TemporaryAccess（临时）+ PIN + Escrow
         · VM：CONFIDENTIAL | STANDARD，可 reset / switch（销毁与切换）
         · 任务：在 VM 内跑终端/浏览器/仓库操作，App 显示"电脑屏幕 + 终端状态 + 接管"
```
要点：**凭据是"可吊销 + 临时"**，不是"长期 token 放在配置里"；**执行面是一台可重置的独立 VM**，
App 只是窗口；**信任靠 attestation**，不是靠网络位置。

### 12.6 我们的差距与可落地的部分

| 维度 | 我们现状 | 可落地 |
|---|---|---|
| 执行面 | 本机 + Docker"电脑"沙箱（复用同一台机器） | 已有 sandbox；缺"每任务可重置" |
| 凭据 | `.env` 里的长期 key（Tavily/网关…） | **可做**：任务级短时凭据，mint→用→**任务结束即 revoke** |
| 传输 | HTTPS + token；mesh 内是 WireGuard | 够用；Noise+attestation 属 M 系 VM 专有 |
| 界面 | 有 computer 面板 + 浏览器接管 | 已有雏形 |
