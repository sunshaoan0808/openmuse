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

## 10. 文档与文件交付（`library` 941 类 + `file` 888 类）★

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

## 9. 使用边界

- 本记录**只用于理解机制**，不搬运原版的图片/字体/颜色令牌/代码（沿用项目既定约定：不照抄 Muse 专有资产）。
- 尺寸/配色中，只有"截图逐像素量出来的"那一节是近似值；符号与字段名是直接读到的。
- 资源常量（精确色值、圆角、动效曲线）**没有**取到：`resources.arsc` 被加固，要拿就只能上真机做动态测量。
