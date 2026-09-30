# OpenMuse 对齐 Muse 的实施计划

> 参照：[`muse-原版挖掘记录.md`](./muse-原版挖掘记录.md)（证据与符号名都在那边）。
> 原则：**机制对齐，资产不搬**；每项都要能验证（单测 + 真机现象），一次只推进一小批。

## 0. 原则与节奏

1. **机制对齐，不搬资产**：不复制原版的图片、字体、颜色令牌、代码；只学行为与结构。
2. **一项一验证**：每项都有①纯逻辑单测 ②真机可见现象 ③不破坏既有测试（`pnpm test` / 移动端 `test/*.test.ts` / `typecheck` 全绿）。
3. **小批交付**：一次打包拿一个可测增量，避免"改一堆再验证"。
4. **诚实边界**：做不到的（手机系统能力、订阅额度）明确写进"不做"，不假装有。

## 1. 已完成（含验证方式）

| 项 | 说明 | 验证 |
|---|---|---|
| 会话持久化（自有实现） | `threads.ts` + `/api/threads`（列表/改名/归档/恢复/删除）+ 每会话历史 | `tests/threads.test.ts` 6 条 |
| 对话 at-least-once | 消息 `seq` 游标、按 id 幂等追加、SSE `tee` 后台落库、turn 记录 | `tests/chat-turns.test.ts` 7 条；真机：12 秒处杀客户端 → 重开拿到完整回复 |
| 轮次并发护栏 | 同一轮重复投递忽略；同会话第二轮排队；兜底重试 | `tests/durable-runner.test.ts` 3 条 |
| 实时状态（按会话隔离） | 工具调用 → 中文动作 + 参数；90 秒窗口；`/api/agent` 的 `live` 数组 | `tests/live-activity.test.ts` 3 条；实测 live 随工具变化 |
| 磨砂顶栏（滚动联动） | `expo-blur` + 画布色遮罩 opacity 0→0.92（照 `ScrimScrollConnection`） | 真机：滚动时顶栏变实 |
| 助手正文纯文本排版 | 不再套灰气泡（原版如此） | 真机观感 |
| 应用图标 | 自有水豚生成 icon/adaptive/splash/favicon | 包内校验 + 视觉自检 |
| 聊天内并行任务栏 | 对应 `SubAgentRow`；行=标题+状态+进度+脉冲点 | `apps/mobile/test/thread-tasks.test.ts` 2 条 |
| 头像面板 | 对应 `HatchExpandedAvatarPanel`：大头像+状态+计数+任务行+快捷入口 | 真机 |

## 2. 计划

### P0 · 状态词表补齐 + 动作 emoji（App 侧，无服务端依赖）

**动机**：原版有 13 态，把"模型在想"（`THINKING`）与"出字"（`TYPING`）分开；我们只有工具级状态，**思考那 5～60 秒顶栏没话说**——这是"它看起来一直活着"的最大来源。

**做法**
- `apps/mobile/src/labels.ts` 增：`agentPhase()`（纯函数）+ `actionEmoji()`（工具→emoji）。
- 推导规则（App 侧即可，不需服务端）：
  - 有在飞工具调用 → `USING_TOOL`（沿用"正在搜索网页 · 关键词"）
  - 无在飞工具、但已开始出字 → `TYPING`
  - 有 run 在跑、以上都没有 → `THINKING`
  - 无 run、有在跑的后台任务 → `WAITING_FOR_SUBAGENTS`（沿用"N 个任务在跑"）
  - 有待审批 → `NEEDS_APPROVAL`
  - 其他 → `IDLE`
- 顶栏状态行、聊天工作气泡、头像面板三处共用同一份推导。

**验证**：`apps/mobile/test/agent-phase.test.ts`（各分支 + 优先级）；真机看思考期是否显示"思考中…"。

**风险/成本**：低（纯 App 侧，不碰服务端与协议）。

### P1 · 文件交付做到 Muse 那样（用户已明确要过）

**动机**：用户要"一份 MD 文件"时，Muse 的做法是——智能体产出带类型的文档 → 对话里出现**文档 chip**
→ chip 菜单里可**下载 / 下载为 HTML / 下载为 PDF / 存 Google Drive / 分享（含发布链接）**。
我们现在只能"写进文件页 + 一句话告诉他在哪"。

**已做**（见挖掘记录 §10 对照表）：`save_document` 工具、工作区文件落盘、App 内 markdown 预览、分享扩展名跟随类型。

**待做**
1. **对话里的文件 chip**：智能体调用 `save_document` 后，助手消息里渲染一张文件卡（文件名 + 类型 + 大小），点开就是文件详情。这是"她到底给没给我文件"最直接的答案。
2. **导出为 PDF / HTML**：我们已经有浏览器 worker（patchright + Xvfb），markdown → HTML → **打印成 PDF** 完全可行；HTML 导出就是同一份 HTML。
3. **保存到 Google Drive**：Google 集成已经在仓库里（OAuth + connectors），加一个动作即可。
4. **扩展名放宽**：照 Muse 的清单补齐文档/源码/媒体类型（至少 md/txt/csv/json/yaml/html + 常见源码），文件详情给文本预览。
5. （可选）**发布链接**：Muse 有 `PUBLISH` / `PUBLISH_TO_SHARE`；我们的签名 URL 机制天然支持，做成"生成只读分享链接"。
### P1 · 常驻授权页（对应 `ActivePermissionsScreen`）

**动机**：我们现在只有一次性审批；原版有"在生效的授权"列表（可查看、可撤销）。

**做法**
- 服务端：新集合 `permissions`（owner、能力/工具名、范围、创建时间、最后使用时间）+ `GET /api/permissions`、`POST /api/permissions/:id/revoke`。
- 授权来源：审批通过时（`actions` 的 approving 路径）写入一条常驻记录；任务/工具执行前按它判断是否需要再次审批。
- App：动态页/设置里加入口，列表 + 撤销；空态文案说明"批准过什么会出现在这里"。

**验证**：服务端 `tests/permissions.test.ts`（写入/列表/撤销/执行前判定）；真机：批准一次 → 出现在列表 → 撤销后再次要求审批。

**风险/成本**：中（触碰审批判定路径，必须保证"撤销即生效"）。

### P1 · 胶囊 ↔ 头像面板的共享元素变形

**动机**：原版是 `StatusPillAvatarPanel` + `AvatarViewportShape` 的共享元素变形，我们现在是"点开弹面板"。

**做法**：复用仓库既有的 hero 机制（`MeasureCard` → `Sheet` 的 `hero: HeroRect`）：把顶栏头像当源卡片，面板用同一 hero，配 `RiseIn`/`motion.ts` 的缓动。

**验证**：真机看变形是否跟手、返回是否还原；不引入 reanimated/gesture-handler。

**风险/成本**：中（纯 UI，但真机手感只能靠你验）。

### P1 · 对话富内容补齐（差距"一眼可见"）

**动机**：Muse 的助手消息能渲染代码块（高亮）、数学公式（KaTeX）、流程图（Mermaid）、
表格卡片、行内文件 chip、内嵌 HTML/交互控件；我们的 `assistant-markdown.ts` 只是基础 markdown-it
（无数学、无流程图、无代码高亮、无文件 chip）。

**做法（按性价比排序）**
1. **代码高亮**：markdown-it 加高亮插件（或自建轻量 tokenizer），只影响渲染层。
2. **数学公式**：接 KaTeX 渲染（WebView 或纯 JS 渲染 MathML）；先支持行内 `$…$` 与块级 `$$…$$`。
3. **文件 chip**：智能体调用 `save_document` 后，助手消息里渲染文件卡（与 §文件交付 的 chip 同一条）。
4. **Mermaid**：可用现成浏览器 worker 渲染成图片回填（我们本来就有无头浏览器）。

**验证**：把同一段含公式/代码/表格的回复在改动前后各渲染一次，比对（截图由你在真机确认）。

### P1 · 未读会话 + 会话内搜索（对照 `HatchUnreadThreadsRepository` / `ConversationSearchScreen`）

**做法**：未读用已有会话存储加 `lastReadAt` 游标即可；搜索在服务端按消息文本过滤（会话列表已有数据）。
**验证**：服务端单测（未读计数/搜索命中）+ 真机：列表出现未读点、搜索能定位到会话。

### P2 · 浏览器"租约 + 接管"状态（对照 `BrowserControlLease` / `AgentBrowserTakeoverControls`）

**动机**：Muse 把"谁在控制浏览器"做成显式状态（租约 + 接管），我们只有一句"可接管"入口。
**做法**：服务端为浏览器会话增加 `controlOwner: agent | user` 与租约到期时间；agent 动作前校验租约；
App 顶部显示当前控制方并可一键接管/归还。
**验证**：服务端单测（租约过期/接管后 agent 动作被拒）+ 真机现象。

### P2 · 消息反应与撤回（对照 `HatchReactionUsageStore` / `HatchUnsendNuxStore`）

**做法**：消息加 `reactions` 字段（按使用频率排序的表情面板）；撤回 = 本端与服务端同时移除该条
（服务端已有按消息 id 幂等的存储，撤回要写一条 tombstone，避免增量拉取时复活）。
**验证**：服务端单测（反应/撤回 + 游标不复活）+ 真机。

### P2 · 目标分类与拖拽（对照 `GoalCategory` / `GoalDragResolver`）

**做法**：目标加分类字段（先做分类，拖拽排序放到之后）。
**验证**：服务端单测 + 真机。

### P2 · 导入记忆（对照 `settings/importmemory`）

**做法**：给"记忆"加一个导入入口，接受文本/JSON（先做粘贴文本 → 拆条 → 存入 memories）。
**验证**：服务端单测（拆条/去重）+ 真机。

### P3 · 离线加密会话库 / 应用锁

Muse 有 `HatchOfflineConversationCipher`（设备端加密的离线会话库）与 `AppLockOverlayScreenKey`（应用锁）。
我们已有 outbox + 游标（防杀进程），但**没有**设备端加密库与应用锁——这两项成本高、优先级低，先记录。

### P2 · 每连接器的权限页（对应 `HatchConnectorPermissionsListScreen`）

**做法**：把 integrations/MCP 工具按连接器分组，逐连接器列出可用能力 + 开关（服务端存 allow/deny）；未连接时显示连接入口。

**验证**：服务端单测（分组/开关持久化）+ 真机。

### P2 · 审批请求三段式 + 历史详情（对应 `Headline/Narrative/Question`）

**做法**：`proposal` 携带 `headline`（要做什么）/`narrative`（为什么）/`question`（需要你回答什么）三段；审批卡与详情页分别渲染；历史列表可回看结果。

**验证**：服务端单测（三段必填/缺省）+ 真机。

### P2 · 会话开场头（对应 `showThreadIntroHeader`）

**做法**：新会话顶部一行说明"这段对话用于…"（由首条用户消息或手动归类生成），滚动后收起（与磨砂联动）。

## 3. 明确不做（并说明为什么）

| 不做 | 原因 |
|---|---|
| 手机系统能力（闹钟/健康/定位/通讯录，原版 `commands` 模块） | 需要系统级权限与设备端节点架构；OpenMuse 的形态是自托管个人 agent + 可接管浏览器/Docker 沙箱，不做系统级侵入 |
| 订阅/额度状态（`OUT_OF_CREDITS`、`subscription` 548 类） | 自托管部署没有额度概念；我们的"用不了"就是模型网关报错，已有中文提示 |
| 搬运原版资产（头像动画 `statusVideos`、里程碑视频、字体、色板、代码） | 版权与既定约定（不照抄 Muse 专有资产）；我们的水豚是自己生成的原画 |
| 机密 VM（`confidentialvm`/`ccv`） | 已有等价物（Docker 沙箱 computer），不追形态 |
| 动态测量真实色值/圆角/曲线 | `resources.arsc` 加固，静态读不到；只上真机做动态测量才可能，优先级低 |

## 4. 验收标准（"做完"的定义）

一项算完成，必须同时满足：

1. 代码合入且 `pnpm typecheck`、`pnpm test`、移动端 `test/*.test.ts` 全绿；
2. 有对应的**纯逻辑单测**（能测的部分）；
3. 有**真机可见现象**（截图或现象描述来自你这边，我无法自测真机渲染）；
4. **不破坏既有功能**：会话改名/归档、断线补拉、任务暂停/取消、审批这些既有路径复测通过；
5. 若某条限制仍然存在（例如变形动画在低端机上掉帧），**明确写出来**，不算完成。
