# OpenMuse 对标 Muse 改造清单（2026-10-03 全量盘点）

> 参照：[`muse-原版挖掘记录.md`](./muse-原版挖掘记录.md)（Muse 侧机制与符号证据）、
> [`任务流差距分析.md`](./任务流差距分析.md)、[`muse-对齐计划.md`](./muse-对齐计划.md)。
> 本轮**只做分析**，清单按 P0/P1/P2 分组，每条四要素：**差距 → 目标形态 → 涉及文件/模块 → 验收方式**。
> 维度标记：①交互手感与手势 ②对话页与任务流 ③文件/产物预览与处理 ④发布与分享 ⑤多端与远程 ⑥视觉细节与性能。

---

## 0. 现状校准（先读：既有文档与代码不一致的地方）

本轮逐文件核对后发现，`muse-对齐计划.md` 里部分条目**已落地但文档没更新**，也有**文档写着已做、代码里其实没有**的：

| 对齐计划的说法 | 代码实况（2026-10-03） |
|---|---|
| P1「文件交付：导出 PDF / HTML」待做 | **已做**：`details.tsx:922-936` 导出按钮；服务端 `/api/files/:id/export`（`app.ts:452`）+ worker 打印（`browser.ts:96`）+ 发布链接（`publish.ts`）全套在 |
| P1「对话里的文件 chip」待做 | **没做**：`save_document` 在 `chat.tsx` 的 14 个渲染器里**没有注册**，智能体写完文件聊天里什么都不出现 |
| 灵感对齐 #8「建议条 ✅ 已实现（Web 验过）」 | **没有**：`chat.tsx:877` 只有一行注释占位，无任何实现 |
| 灵感对齐 #7「聊天内出卡 ✅ 已实现」 | **没有**：`IdeaChatCard` /「来自灵感」在 src 里搜不到（灵感只有独立页） |
| P0「状态词表 agentPhase + emoji」待做 | **没做**：`labels.ts` 无 `agentPhase()` / `actionEmoji()` |
| P2「审批三段式」待做 | **没做**：`actions.ts` 的 proposal 只有 title/kind/data，无 headline/narrative/question |

> 结论：本轮清单以**代码实况**为准。既有文档里标「已做」的不再重复列；标「待做」但实际已做的不进清单。

**本轮盘点确认已有的底子**（不重复立项，改造时直接复用）：
任务流 activity 折叠（`packages/domain/src/activity.ts` 两态+虚线+用时，App/服务端共用）；顶栏滚动位移映射与磨砂（`header-collapse.ts`/`header-scrim.ts`）；水豚卡片保留 + 玻璃层（`App.tsx:345-599`）；滚动锚定与「最新消息」按钮（`chat.tsx:918-957`）；文件 40+ 扩展名识别与预览全家桶（`files.ts`、`details.tsx:820-1090`）；发布 /p/:token 真撤销（`publish.ts`）；任务级短时凭据 mint/revoke（`credentials.ts`）+ git 句柄代理（`git-proxy.ts`）；断线 outbox+游标+断流自愈（`conversation-*.ts`、`chat.tsx:747-785`）。

---

## P0 —— 立刻做：一眼可见的差距 + 性能地基

### P0-1 对话内文件 chip（含补齐工具渲染器）③②

- **差距**：智能体调 `save_document` 写完文件后，聊天流里**什么都不出现**（该工具没注册渲染器）；用户只能靠一句"文件在 Files 里"的话去找。同类问题：`workspace_*`、`git_commit/push`、`computer_*`、`ask_user` 等 8 个工具也都没注册渲染器，跑完即隐身。
- **目标形态**：`save_document` 返回 `{id,name,mimeType,size}` → 助手消息流里渲染一张**文件卡**（文件名 + 类型图标 + 大小），点开用既有 hero 过渡进文件详情（`FileThreadCard` 已有现成卡片，接到工具渲染器即可）。其余工具统一套 `ToolDetailRow` 一行降级（"任务 · 动作"+ 点开细节），跑完有痕迹。
- **涉及文件**：`apps/mobile/src/chat.tsx`（`WorkspaceTools` 注册表）、`apps/mobile/src/thread-artifacts.tsx`（复用 `FileThreadCard`）、`apps/mobile/src/tool-detail.tsx`、服务端无需改（结果字段已够）。
- **验收方式**：真机要一份"XX.md"→ 聊天里出现文件卡 → 点开进 markdown 预览 → 刷新 App 后卡片仍在（走 `TaskThreadCard` 的按 id 回放路径）；`apps/mobile/test` 增加渲染器注册完整性单测（枚举服务端工具名 × 客户端注册表）。

### P0-2 助手正文行内图片 ②③

- **差距**：markdown 里的图片被渲染成 `[Image]` **文字占位**（`assistant-response.tsx:72-76`）。Muse 有 `HatchInlineImageKt`，正文贴图是基本盘；用户问"给我看看图"时我们只能显示占位符。
- **目标形态**：markdown image 节点 → 真图。图片 URL 分两类：`/api/files/...` 用带 Authorization 头的 `Image`（`details.tsx:1076-1081` 已有同款写法可抄）；外链图先只放行 https 并给加载失败占位。尺寸约束：maxWidth 100% + 按 aspectRatio 占位防跳动。
- **涉及文件**：`apps/mobile/src/assistant-response.tsx`（`rules.image`）、`apps/mobile/src/assistant-markdown.ts`（URL 安全判定扩展）。
- **验收方式**：单测扩展 `apps/mobile/test/assistant-markdown.test.ts`（files 链接识别/外链 http 拒绝）；真机让智能体描述一张已上传图片并在回复里引用 → 正文显示真图、点击可放大（可先用现有文件详情承接）。

### P0-3 状态词表 agentPhase + 动作 emoji ①②

- **差距**：Muse 13 态把「模型在想（THINKING）」「正在出字（TYPING）」「正在用工具（USING_TOOL）」分开；我们只有工具级状态 —— **思考那 5～60 秒顶栏和工作气泡完全沉默**，这是"它看起来死了"的最大来源。也没有每动作一个 emoji（`HatchStatusPillUiState.activityEmoji`）。
- **目标形态**：`labels.ts` 增纯函数 `agentPhase()`：在飞工具 → `USING_TOOL`；已开始出字 → `TYPING`；有 run 在跑 → `THINKING`；有待审批 → `NEEDS_APPROVAL`；有后台任务 → `WAITING_FOR_SUBAGENTS`；否则 `IDLE`。加 `actionEmoji()`（工具→emoji）。顶栏状态行（`App.tsx:396-407`）、聊天工作气泡（`chat.tsx:1170-1197`）、头像面板（`avatar-panel.tsx:34-43`）三处共用。
- **涉及文件**：`apps/mobile/src/labels.ts`、`App.tsx`、`chat.tsx`、`avatar-panel.tsx`、`agent-ui.tsx`（`AgentStatus`）。
- **验收方式**：`apps/mobile/test/agent-phase.test.ts`（各分支+优先级，纯函数）；真机：发一条要跑十几秒的消息 → 顶栏依次出现「思考中…」→「正在搜索网页 · …」→「正在回复」，思考期不再空白。

### P0-4 代码块高亮与滚动 ②

- **差距**：代码块只是灰底 `Text`（`assistant-response.tsx:54-58`），无高亮、长行会撑破或被零宽空格污染；Muse 有 `HatchCodeBlockKt`（带语言标签与高亮）。
- **目标形态**：fence 渲染升级：语言标签行（取 fence info string）+ 轻量 tokenizer 高亮（自写关键字/字符串/注释三色即可，不引大库）+ **横向 ScrollView**（代码不折行、容器不撑破）。保持 `selectable`。
- **涉及文件**：`apps/mobile/src/assistant-response.tsx`（`renderCodeBlock`）、可新建 `apps/mobile/src/code-highlight.ts`（纯函数 → token 数组，便于单测）。
- **验收方式**：`apps/mobile/test/code-highlight.test.ts`（ts/py/json 三样例切 token）；真机贴一段含长行的代码回复：有语言标签、着色、横向可滚、复制无零宽字符。

### P0-5 消息列表虚拟化 ⑥

- **差距**：聊天列表是 `ScrollView` + `visible.map()`（`chat.tsx:900-1011`），几百条消息全部常驻渲染 —— 长会话首帧慢、滚动掉帧、内存高。Muse（Compose LazyColumn）天然虚拟化。
- **目标形态**：迁移到 `FlatList`（inverted 布局 + `windowSize`/`maxToRenderPerBatch` 调优）。**注意**：滚动锚定（`followLatest`/`awayFromLatest`/`onContentSizeChange` 钉回原位）、顶栏位移映射、`RiseIn` 仅新消息播动画这三套逻辑要一一适配；inverted 后锚定语义反转（栈底=列表头）。不改任何消息渲染子组件的对外 props。
- **涉及文件**：`apps/mobile/src/chat.tsx`（列表主体、滚动事件）、必要时 `conversation-merge.ts`（保证消息 id 稳定作 key）。
- **验收方式**：造 500 条消息的会话（可用 `tests/fixtures` 思路写个种子脚本）：首帧 < 1s、滚动无明显掉帧、读历史时新回复到达不拽人回底（现有行为回归）、顶栏收起/磨砂行为不变；`apps/mobile/test` 现有 chat-clean / conversation-merge 测试全绿。

### P0-6 附件入口放开全类型 ③

- **差距**：输入区"+"选附件只能从**已有工作区文件**里挑（`chat.tsx:1300-1333`），拍照/相册只走图片（`attachImage`）；`FilesScreen.upload` 的 DocumentPicker 又只放行 PDF/Office 四类（`screens.tsx:945-950`）。而服务端 `files.ts` 早已支持 40+ 文本/媒体类型 —— **上传口比存储口窄**，用户没法把手机里的 md/csv/音频交给智能体。
- **目标形态**：两处放宽：① 输入区"+"菜单加「文件…」走 DocumentPicker 全类型（`type: "*/*"`，服务端校验兜底）；② `FilesScreen.upload` 放开类型过滤（提示支持清单文案用 `files.ts` 的 `SUPPORTED` 同款）。
- **涉及文件**：`apps/mobile/src/screens.tsx`（`FilesScreen.upload`）、`apps/mobile/src/chat.tsx`（"+"菜单）、`apps/mobile/src/image-attachment.ts`（抽一个通用 `uploadFile`）。
- **验收方式**：真机从手机选一个 .md 与一个 .mp3 → 都进文件页并可预览（文本/markdown 渲染、媒体走 MediaPlayer）→ 在对话里 @ 到；Web 端同样路径走 FormData 复测。

### P0-7 聊天建议条（补齐对齐计划声称已做的那条）②①

- **差距**：`chat.tsx:877` 只有一行「照 Muse 的 HatchSuggestionBar」注释，无实现。Muse 在输入框上方给可直接点的短建议（文案按动作类型取资源）。
- **目标形态**：空闲且主会话时，从 `/api/agent` 的 ideas 取前 2 条（已有数据源，服务端 `buildSummary` 已下发），输入框上方渲染两条可点 pill，点按即 `enqueue()` 派活；跑动中隐藏。
- **涉及文件**：`apps/mobile/src/chat.tsx`（composer 上方）、`apps/mobile/src/agent-workspace.tsx`（ideas 已随轮询返回）。
- **验收方式**：真机空闲时见两条建议 pill，点按即发送对应消息并开始跑动；跑动中与侧边会话不出现；`apps/mobile/test` 加一条过滤逻辑单测（有 ideas/无 ideas/跑动中）。

---

## P1 —— 功能补齐：中等成本，按序推进

### P1-1 消息长按菜单：复制 / 重发 / 撤回 + 消息反应 ②

- **差距**：消息无任何操作菜单（正文仅 `selectable`）。Muse 有 `HatchReactionUsageStore`（表情反应，按使用频率排序）与 `HatchUnsendNuxStore`（撤回，带首次提示）。
- **目标形态**：长按用户消息 → 菜单（复制 / 再次发送 / 撤回）；长按助手消息 → 菜单（复制 / 分享为文本）。撤回 = 服务端 tombstone（按消息 id 写删除标记，游标增量拉取时**不复活**）+ 本端立即移除。反应可后置到同一条目二期（表情面板按使用频率排序）。
- **涉及文件**：`apps/server/src/chat-turns.ts` + `app.ts`（新路由 `DELETE /api/conversation/:messageId`）、`apps/mobile/src/conversation-merge.ts`（增量合入时吃 tombstone）、`apps/mobile/src/chat.tsx`（长按菜单组件）、`apps/mobile/src/conversation-store.ts`。
- **验收方式**：服务端单测（撤回 tombstone + since= 游标拉取不复活 + 幂等）；真机：长按出菜单、撤回后另一端刷新也不复活、复制不带零宽字符。

### P1-2 未读会话 + 会话内搜索 ②

- **差距**：会话表（`ThreadsSheet`）无未读点、无搜索。Muse 有 `HatchUnreadThreadsRepository` 与 `ConversationSearchScreen`。
- **目标形态**：会话存储加 `lastReadAt` 游标（客户端记 + 服务端 `/api/threads` 透传）；后台任务完成/其他端新消息 → 列表行出现未读点。搜索：服务端按消息文本过滤（`/api/threads?q=` 返回命中会话与片段），客户端列表顶部加搜索框。
- **涉及文件**：`apps/server/src/threads.ts`、`apps/mobile/src/saved-threads.ts`、`apps/mobile/src/threads.tsx`、`apps/mobile/src/conversation-store.ts`（游标已有，加 per-thread lastReadAt）。
- **验收方式**：服务端单测（未读计数、搜索命中、归档会话不计未读）；真机：B 会话有新回复 → 列表出现未读点 → 打开后消失；搜关键词能定位会话。

### P1-3 胶囊 ↔ 头像面板共享元素变形 ①

- **差距**：点头像是"弹一个 Sheet"（`App.tsx:545` → `avatar-panel.tsx` 的 `Sheet` 无 hero）；Muse 是 `StatusPillAvatarPanel` + `AvatarViewportShape` 的共享元素变形，头像是同一元素在两个形态间连续变化。
- **目标形态**：复用既有 hero 机制（`MeasureCard`/`HeroRect`/`Sheet hero`，`motion.ts:136-155` + `ui.tsx`）：把顶栏水豚卡片当源卡片量矩形，`AvatarPanel` 以同 hero 打开，配 `useSheetEntrance` 缓动；关闭时飞回。
- **涉及文件**：`apps/mobile/App.tsx`（顶栏卡片量矩形）、`apps/mobile/src/avatar-panel.tsx`（接 hero）、`apps/mobile/src/ui.tsx`（Sheet 已支持 hero，确认头像场景遮罩淡入）。
- **验收方式**：真机：点头像卡片 → 面板从卡片位置展开（视觉连续、无跳变），返回还原；低真机不要求 60fps，但不得出现闪烁/错位；不引入 reanimated/gesture-handler。

### P1-4 按住说话 + 输入区打磨 ①

- **差距**：语音是"点一下开、再点一下关"（`speech.native.ts:81-114`）；Muse 有 `liftedBeforeThreshold` 按住说话阈值手势 + `HoldDictationComposerKt`，且输入区有自己的 scrim 与 hint 交叉淡入（`composerHintCrossfade`/`composerInputModeTransition`）。我们 hint 固定、输入区无磨砂。
- **目标形态**：麦克风按钮支持两种模式并存：点按=切换（现状保留，避免误触成本）、**按住 ≥500ms=松手即发**（识别文本直接进发送，中途中止上滑取消）；placeholder 与语音状态做交叉淡入；输入区底加一层与顶栏同族的浅磨砂（Web 降级半透明）。
- **涉及文件**：`apps/mobile/src/speech.native.ts`、`apps/mobile/src/chat.tsx`（composer 按钮、placeholder）、`apps/mobile/src/motion.ts`（crossfade 原语）。
- **验收方式**：真机：按住说话松手即发出、上滑取消不发送、快速点按仍是开关模式；`apps/mobile/test` 对阈值判定做纯函数单测（按下时长 × 位移 → 状态机）。

### P1-5 审批三段式 + 请求带预览链接 ②

- **差距**：`ActionProposal` 只有 `title/kind/data/account`（`actions.ts:67-91`）；Muse 的审批是 Headline（做什么）/ Narrative（为什么）/ Question（要你答什么）三段，且请求里可带预览链接（`AgentPermissionRequestPreviewLinksKt`）。
- **目标形态**：proposal 增可选 `narrative`（智能体附一句理由）与 `previewLinks`（如邮件草稿的可读预览地址）；`ApprovalCard` 与复核详情（`details.tsx` review 分支）分别渲染三段；缺省字段优雅降级为现样式。
- **涉及文件**：`packages/domain/src/index.ts`（schema）、`apps/server/src/actions.ts`、`apps/server/src/engine/chat-tools.ts`（prepare_email 等工具补字段）、`apps/mobile/src/chat.tsx`（`ApprovalCard`）、`apps/mobile/src/details.tsx`（review 详情）。
- **验收方式**：服务端单测（三段可缺省/必填约束、旧数据兼容）；真机：审批卡显示"要做什么 + 为什么"，点复核能看到内容预览。

### P1-6 常驻授权页（对应 `ActivePermissionsScreen`）②⑤

- **差距**：只有一次性审批，批准过的能力没有"在生效的授权"列表，不可查看/撤销（Muse 有整页 + 显式 `RevokeActivePermissionRequestJson`）。
- **目标形态**：服务端新集合 `permissions`（owner、能力/工具名、范围、createdAt、lastUsedAt）；审批通过时写入，工具执行前先查——命中则免审批，**撤销即再生效**；`GET /api/permissions`、`POST /api/permissions/:id/revoke`；App 在「应用与设置」加列表 + 撤销 + 空态说明。
- **涉及文件**：`apps/server/src/actions.ts`（approve 路径写入）、`apps/server/src/app.ts`（路由）、新建 `apps/server/src/permissions.ts`、`apps/mobile/src/screens.tsx`（AppsScreen 入口）。
- **验收方式**：服务端 `tests/permissions.test.ts`（写入/列表/撤销后需再审批）；真机：批准一次 → 列表出现 → 撤销后同类操作重新弹审批。

### P1-7 数学公式（KaTeX）②

- **差距**：无公式渲染。Muse 用 `HatchKatexRenderer`/`HatchInlineMathKt`。
- **目标形态**：先做**纯 JS 渲染**（KaTeX 输出 MathML/HTML + 样式表）进 WebView 或轻量自渲染；支持行内 `$…$` 与块级 `$$…$$`，渲染失败回退原文。worker 侧已有无头浏览器，备选方案是服务端预渲染成 SVG 回图（与 P2-2 Mermaid 同一条管线）。
- **涉及文件**：`apps/mobile/src/assistant-markdown.ts`（$ 定界规则）、`assistant-response.tsx`（新增 math 规则）、可选 `apps/server/src/markdown-html.ts`（预渲染分支）。
- **验收方式**：单测（行内/块级/未闭合定界回退）；真机贴一段含公式的回复可读、不撑破版面。

### P1-8 灵感卡回流聊天流（`Origin.CHAT`）②

- **差距**：灵感只在独立页；Muse 的卡片会直接出现在聊天里（`HatchIdeaCardRow`），可"就做这个/看看/不用了"。
- **目标形态**：空闲时服务端把 1 条新灵感随 `/api/agent` 下发 → 聊天尾部（消息流之后）渲染灵感卡（标题+贴合理由+三个动作）；「就做这个」= `enqueue` 其 prompt 并把该条标记 builtAt；「不用了」= 点踩降权（`rateIdea` 已有）。
- **涉及文件**：`apps/mobile/src/chat.tsx`（消息流尾部）、`apps/mobile/src/agent-workspace.tsx`、服务端 `ideas` 相关（对齐计划 §灵感 已有 API 基础）。
- **验收方式**：真机：主会话出现灵感卡，三按钮行为正确，接受后卡片收束为一行回执；`refreshIdeas` 后点踩过的不再出现。

### P1-9 发布/分享动作进对话 ④

- **差距**：发布/导出/复制链接都收在**文件详情**里；Muse 的文档 chip 菜单直接带 分享/发布（`ArtifactShareOption = SHARE|PUBLISH|PUBLISH_TO_SHARE`）。P0-1 落地后，chip 上应有快捷动作。
- **目标形态**：P0-1 的文件卡长按/角标菜单：分享（系统面板，扩展名跟随，`details.tsx:871-921` 逻辑复用）、复制公开链接（未发布则先 publish）、导出 PDF/HTML 快捷项。
- **涉及文件**：`apps/mobile/src/chat.tsx`（chip 菜单）、`apps/mobile/src/thread-artifacts.tsx`、复用 `details.tsx` 的 share/export 函数（抽成 `apps/mobile/src/file-actions.ts` 纯逻辑便于两处共用与单测）。
- **验收方式**：真机：不进详情页即可从聊天里完成 分享/复制链接/导出 PDF 三件事；`apps/mobile/test/file-actions.test.ts` 覆盖扩展名与 MIME 映射。

### P1-10 会话事件推送：SSE 替代状态轮询 ⑤⑥

- **差距**：实时状态靠 `/api/agent` 轮询（3s/12s，`poll-cadence.ts`）：状态变化最多滞后 3 秒、跨境空转流量大。Muse 有 `chatEventSeq/chatEventCursorSeq` 事件订阅模型。
- **目标形态**：服务端开 `GET /api/events?since=` SSE（复用 `/api/copilotkit/*` 已有的 SSE 基建，`app.ts:644` 附近）：事件 = live 活动变化、任务状态变化、通知新增；客户端 `agent-workspace.tsx` 订阅 SSE，断线用 `since` 游标补拉一次再续订；轮询保留为 SSE 不可用时的降级。
- **涉及文件**：`apps/server/src/app.ts`（SSE 路由）、`apps/server/src/live-activity.ts`（变化时发事件）、`apps/mobile/src/agent-workspace.tsx`、`apps/mobile/src/poll-cadence.ts`（降级路径）。
- **验收方式**：服务端单测（事件序号单调、断线 since 补拉不丢）；真机：工具切换时顶栏状态 **秒级**更新；飞行模式 10 秒恢复后状态自动补齐；不新增失控连接（同会话单连接）。

### P1-11 浏览器控制租约 + 应用内接管 ⑤

- **差距**：浏览器"接管"是一个服务端渲染的网页控制台（`browser-console.ts`：600ms JPEG + 点选输入），App 内没有接管界面；且**没有"谁在控制"的显式状态**（Muse：`BrowserControlLease` + `AgentBrowserTakeoverControls`，agent 动作前校验租约）。电脑沙箱已有 Lease（`computer.ts:184,308`），浏览器侧没有。
- **目标形态**：浏览器会话加 `controlOwner: agent|user` + 租约到期时间（沿用 computer.ts 的 Lease 形状）：用户从 App 点「接管」→ 租约归人（agent 的 `page_act/browse_web` 被拒并提示"用户正在操作"）、归还或 3 分钟无操作自动回到 agent；App 内用 WebView 打开既有控制台页（`BrowserConsole.native.tsx` 已有壳）。
- **涉及文件**：`apps/server/src/browser.ts`（租约校验）、`apps/server/src/engine/chat-tools.ts`（page_act 前校验）、`apps/mobile/src/computer.tsx`（`ComputerEntry`/`BrowserThreadCard` 接管入口）、`apps/mobile/src/BrowserConsole.native.tsx`。
- **验收方式**：服务端单测（接管期间 agent 动作 409、租约过期自动释放、归还后恢复）；真机：接管时聊天里出现"你正在控制浏览器"横幅，agent 动作排队；归还后继续。

### P1-12 文档生成：docx / xlsx ③

- **差距**：Office 只能**读**（mammoth/xlsx，`OfficeReader.*`）；Muse 能自拼 docx（`file/docx/DocElement$Para|Table|Image`）。用户要"一份 Word"时我们给不了。
- **目标形态**：`save_document` 加 `format` 参数（`md|txt|docx|xlsx`）：docx 用最小 OOXML 写入器（段落/标题/表格，工作量可控）或服务端引 docx 库；xlsx 沿用已有 xlsx 包反向写。产出仍是 Files 里的文件 → 自动吃到 P0-1 的 chip 与既有预览。
- **涉及文件**：`apps/server/src/engine/chat-tools.ts`（save_document 扩参）、新建 `apps/server/src/office-write.ts`、`apps/server/src/files.ts`（importBinary 放行 docx/xlsx MIME）。
- **验收方式**：服务端单测（生成的 docx/xlsx 能被现有 OfficeReader 解析回读出标题与表格）；真机：要一份 Word 报告 → 文件 chip → OfficeReader 打开正常。

---

## P2 —— 锦上添花 / 高成本低频，记录在案

### P2-1 深色模式 ⑥
- **差距**：`colors` 固定浅色（`ui.tsx:28-41`），`app.json userInterfaceStyle: "light"`；Muse 有 `chatThemes` 明暗两套。
- **目标形态**：`colors` 改为 `useColorScheme()` 驱动的双 token 表（先只覆盖 canvas/card/text/muted/line 五个主色），顶栏玻璃 tint 与磨砂遮罩联动；不追求全量控色。
- **涉及文件**：`apps/mobile/src/ui.tsx`、`App.tsx`、`app.json`；渐次替换各文件硬编码色（`#F0F1F2`/`#F5F6F7` 等）。
- **验收方式**：真机切系统深色：聊天/动态/文件三页可读、无白块残留；浅色零回归（截图对照）。

### P2-2 Mermaid 流程图 ②③
- **差距**：无流程图渲染（Muse `HatchMermaidContentKt`）。
- **目标形态**：```mermaid 代码块 → 交给 worker 无头浏览器渲染成 SVG/PNG 回填（服务端已有 `/api/files/:id/export` 同一条 worker 打印管线可复用）；失败回退为代码块。
- **涉及文件**：`apps/server/src/browser.ts`（renderDiagram）、`apps/server/src/markdown-html.ts`、`apps/mobile/src/assistant-response.tsx`（fence 特判）。
- **验收方式**：单测（代码块识别与回退）；真机：含 mermaid 的回复显示成图。

### P2-3 目标分类与拖拽 ②
- **差距**：目标列表无分类、无排序（Muse `GoalCategory` + `GoalDragResolver/Source/Target`）。
- **目标形态**：先做分类字段（创建时选 + 列表按类分区，`GoalCreationBottomSheetKt` 同构）；拖拽排序依赖手势系统，等 P0-5 稳定后再评估是否引 gesture-handler。
- **涉及文件**：服务端 goals 存储、`apps/mobile/src/screens.tsx`（GoalsScreen）、`agent-ui.tsx`。
- **验收方式**：服务端单测 + 真机分区呈现。

### P2-4 导入记忆 ②
- **差距**：记忆只能逐条攒（Muse 有 `settings/importmemory` 整体导入）。
- **目标形态**：设置里加「导入记忆」：粘贴文本 → 按行/空行拆条 → 去重后写入 memories；JSON 数组格式也接受。
- **涉及文件**：`apps/server/src/engine/chat-tools.ts`（remember_fact 旁加导入函数）、`apps/mobile/src/screens.tsx`。
- **验收方式**：服务端单测（拆条/去重）；真机粘贴 10 行 → 生成 ≤10 条且重复的被合并。

### P2-5 应用锁 + 离线加密会话库 ⑤
- **差距**：无应用锁；会话明文缓存本机（Muse `HatchOfflineConversationCipher` 设备端加密、`AppLockOverlayScreenKey`）。
- **目标形态**：应用锁先做（启动时系统生物识别/密码，expo-local-authentication，失败进锁定屏）；会话库加密后置（涉及 outbox/游标/历史缓存三处存储迁移，单独排期）。
- **涉及文件**：`App.tsx`（启动闸）、`apps/mobile/src/conversation-store.ts`。
- **验收方式**：真机：开锁后冷启动要求认证；后台回前台超时再锁。

### P2-6 头像状态动画 / 里程碑庆祝 ⑥①
- **差距**：水豚是静态图（`Mascot`）；Muse 每状态一段头像动画 + 完成时里程碑视频。
- **目标形态**：不搬资产：给 3 个关键相位做自有动画——THINKING（轻微呼吸）、USING_TOOL（小幅摆动）、COMPLETED（一次性庆祝，如星星散点），用现有 `usePulse`/序列帧即可；素材用自有水豚的 2-3 帧变体。
- **涉及文件**：`apps/mobile/src/ui.tsx`（`Mascot`）、`App.tsx`。
- **验收方式**：真机三相位可见不同动画；完成时播一次不循环。

### P2-7 底部导航随滚动收起 ①⑥
- **差距**：底栏固定；Muse 的 `AuraNavBarViewModel.collapse()` 在内容下滚时收底栏（注意挖掘记录 §顶栏机制里的辨析：收的是底栏不是顶栏）。
- **目标形态**：复用 `headerCollapse` 进度（或反向），底栏 translateY 隐藏；聊天页只在上滑时收。
- **涉及文件**：`App.tsx`（底栏容器 675-717）、`header-scrim.ts`。
- **验收方式**：真机上滑底栏收、下滑即回；与键盘弹起不冲突。

### P2-8 每连接器权限分组页 ⑤
- **差距**：集成只有总开关；Muse `HatchConnectorPermissionsListScreen` 按连接器列能力+开关。
- **目标形态**：AppsScreen 的连接区按连接器（Google/Browser/OpenBot，`workspace.ts:298-317` 已分组）各自展开能力清单与允许/禁用开关，服务端存 allow/deny 并在工具注册时过滤。
- **涉及文件**：`apps/mobile/src/screens.tsx`（ConnectionsScreen）、服务端工具装配处（`engine/chat-tools.ts`）。
- **验收方式**：关掉某能力后该工具从本轮工具表消失（服务端单测）+ 真机复核。

### P2-9 保存到 Google Drive ④
- **差距/状态**：Muse 文档菜单有 `saveToGoogleDrive`；**用户已明确「暂时不做，先记为待办」**（对齐计划 §文件交付）。
- **目标形态**（待点名后再动工）：Google OAuth 已在仓库（`google-auth.ts`），加一个 export 目标动作；动工前先确认线上凭据是 live 而非 sample。
- **验收方式**：真机导出一份 md 到 Drive 并打开成功。

### P2-10 邀请胶囊 / 多用户 ④⑤
- **差距**：Muse 右上有「邀请」胶囊；我们是单用户模型（`auth.ts` 恒 `local-user`），自托管场景拉新无意义。
- **目标形态**：**暂缓**。若未来做多用户：sessions 已按 token 隔离，需引入 owner 注册/邀请码机制——成本高、与自托管定位冲突，记录不做的原因即可。
- **验收方式**：不适用。

---

## 明确不做（沿用既定边界）

| 不做 | 原因 |
|---|---|
| 手机即节点（闹钟/健康/定位/通讯录，Muse `commands`+`nodes`） | 需系统级权限与设备端节点架构；OpenMuse 定位是自托管 agent + 沙箱执行面 |
| 订阅/额度（`OUT_OF_CREDITS`、subscription 548 类） | 自托管无额度概念；模型网关报错已有中文提示 |
| 搬运 Muse 专有资产（statusVideos、字体、色板、代码） | 版权与项目既定约定；水豚为自有原画 |
| 机密 VM 形态（Noise 信道/attestation/CCV） | 已有等价物：Docker 沙箱 + 任务级短时凭据（`credentials.ts`）+ git 句柄代理（`git-proxy.ts`）；凭据"mint→用→revoke"模型已对齐 |
| resources.arsc 精确色值/圆角/动效曲线 | 加固读不到，动态测量成本高；视觉对齐以截图近似值为准 |

---

## 验收总则（每条完成的定义）

1. `pnpm typecheck`、`pnpm test`（含 `apps/mobile/test`）、`pnpm lint` 全绿；
2. 有纯逻辑单测的必须补单测（labels/activity/file-actions/phase 等都是纯函数，刻意可测）；
3. 有真机可见现象（截图或现象描述；Web 验收环境只对逻辑层有效，顶栏/键盘/磨砂类必须真机）;
4. 既有路径不回归：会话改名/归档、断线补拉、任务暂停/取消、审批、导出/发布复测通过；
5. 有限制就明写（如低端机掉帧），不静默降级。

## 建议推进顺序（依赖关系）

```
P0-1 文件chip ──→ P1-9 chip菜单(发布/分享) ──→ (P2-9 Drive)
P0-5 列表虚拟化 ──→ P2-3 拖拽 / P2-7 底栏收起（动布局的都等它）
P0-3 状态词表 ──→ P1-10 SSE推送（状态源先统一，再做推送）
P1-5 审批三段式 ──→ P1-6 常驻授权（同一服务端域）
P0-2 行内图 / P0-4 高亮 / P1-7 公式 / P2-2 Mermaid：同一条渲染管线，逐个叠加
```
