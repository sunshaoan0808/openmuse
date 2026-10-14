# nanoMuse 调研（对标 OpenMuse）

> 调研时间：2026-10-14 · 对象版本 **v1.0.5「Lookout」**（2026-10-13 发布，首版 2026-09-25）
> 仓库：<https://github.com/nano-muse/nanoMuse>（163MB）· 论文：arXiv **2610.08699**（浙江大学，2026-10-06）
> 许可：**GPL-3.0-or-later**（含 `android/` 子树）—— ⚠️ **只可借鉴机制与设计，禁止复制代码**（会污染 OpenMuse 的 MIT）

## 0. 一句话

nanoMuse 是「**把整个 agent 放进你自己的设备**」的实现：手机 app 里跑一个完整 agent（PRoot Alpine 沙箱 + shell + 浏览器 + MCP + 技能 + 定时任务），桌面端是 Electron 壳里的 DeepSeek Harness 插件，多台设备通过一个**可选、可自建**的 relay 会合。它的论文里专门有一句**:「Against CopilotKit's OpenMuse, open but built as a server with windows onto it, nanoMuse puts the agent on the device」** —— 它把 OpenMuse 当参照物，卖点正是「agent 在设备上」。

它的价值不在「多端中继」（对单账号的 OpenMuse 是过度设计），而在**安全闸门的设计**、**记忆整理规则**、**离线优先同步**这三块 —— 都是服务端形态能立刻照做的。

## 1. 事实清单（可核对）

| 项目 | 数字 |
| --- | --- |
| 仓库 | 163MB；Kotlin 845 文件 / Swift 537 / Python 308 / TS 132 |
| Android APK | 37MB 下载（arm64，v1.0.5，解包 93MB / 607 文件） |
| 桌面端 | 256MB(Linux)–498MB(macOS) 下载，Linux 安装后 928MB，空闲内存约 0.5GB |
| relay | **一个 Python 进程 + 一个 SQLite 文件**，空闲约 85MB，**1 vCPU / 1GB 够** |
| 自建成本 | 大陆 ¥30–60/月，海外 US$4–6/月 + 模型用量 |
| 端 | Android、iOS(TestFlight)、桌面(mac/Win/Linux)、Web、relay + 控制台、Docker 自建 |

**Android APK 里装了什么**（实测解包）：`alpine-minirootfs.tar` 8.08MB（基础 Alpine，521 条目，**不含 Python**）、`proot-aarch64` + `libproot*.so`、`default_mount/`（profile 脚本 + URL 拦截 wrapper + 打包的 Python MCP 客户端）、bash→ash 翻译规则 13KB、jieba 分词 5.59MB、模型目录 5.23MB、**`libgojni.so` 28.9MB（rclone-mobile，云备份用，不是 agent）**、onnxruntime + VAD（端侧语音活动检测）。**没有 Python runtime** —— Android 的 agent loop 是 Kotlin 写的。

## 2. 架构：五端各是什么

```
Android app ─┐
iOS app ─────┤ 每台设备 = 一个完整 agent（自己的 loop + 自己的 Sentinel + 自己的 hands）
桌面 app ────┤
Web app ─────┘        │
                      │  可选：relay（nanoMuse Cloud）只做「会合点」
                      └── 账号/签发 key / hub 帧路由 / 会话文本同步 / 自己的 key 直连 provider
```

- **Android**：OpenMinis 1.13 上游子树（GPL）+ `io.github.nanomuse.*`。agent loop 在 `ChatViewModel.kt`（`MAX_AGENT_TURNS = 200`），设备能力经 **native_offload** 暴露成 shell 里的 CLI。
- **桌面**：`harness/desktop/`（Electron 壳，spawn dsh host）+ `harness/dsh-nanomuse/`（DeepSeek Harness 插件）+ PyInstaller 打包的 Python runtime 经 **stdio MCP** 供手。
- **relay**：FastAPI + SQLite；**从不自己执行任务**，也看不到审批内容。

### 2.1 最值得看的一处：native_offload

PRoot 在 `execve` 上拦截 `/usr/local/bin/<name>` 的桩程序，把 argv/env/cwd 经**抽象 unix socket**（`<applicationId>.native-offload`，`sandbox/OffloadSocketName.kt:17-22`）转给 Kotlin handler。于是 agent 在沙箱 shell 里敲的每条设备操作都是普通 CLI：`nanomuse-hands run --task …`、`android-a11y-cli`、`android-location`、`minis-scheduled`……

**★ 意义**：设备能力对 agent 零成本（不动 tool schema、不加描述 token），可增删可替换。这正是「服务端 agent + 手机客户端」最该抄的一条：客户端起一个 MCP server 暴露自身能力（loopback + 随机 token，工具按设备命名空间化 `device__clipboard_read`），服务器当普通 MCP 挂载。

## 3. 与 Meta Muse / OpenMuse 的正面对比

论文依据 Meta 三篇公开材料 + **一份 Muse 生产系统提示词副本**，逐句标注来源。

| | Meta Muse | OpenMuse（你） | nanoMuse |
| --- | --- | --- | --- |
| agent 跑在哪 | 每人一台云 VM | 你自己的服务器 | 设备本地（手机/电脑） |
| 手机屏幕 | ✘（手机只是数据源） | ✘ | ✔（无障碍手势） |
| 电脑屏幕 | ✔（macOS app 里的暗淡实时画面） | 列为未来工作 | ✔（nut.js / pyautogui / xdotool） |
| 开放程度 | 只有 gadget SDK(Apache) | MIT | GPL-3.0 |

**Muse 的十个设计决定**（它「赢在一个形状」，不在跑分）：一个有名字有脸的单一 agent / 一条长对话而非分会话 / 脸下面的状态行 / 每次工具调用一个 chip + 活动日志 / 词不够用时给卡片（限定范围的审批、模型看不见内容的安全表单、单次支付卡）/ **记忆是你能打开编辑的文件** / 主动发言门槛可调 / **五个房间：Chat · Feed · Ideas · Goals + Library** / 云端电脑是「带停止键的暗淡实时画面」/ 步骤默认可见。

**Muse 的安全核心（全部在 agent 够不到的地方）**：Sentinel 是「connector 动作与全部网络出网」的唯一授权方（*Muse proposes actions, but only Sentinel can grant permission*）；真实凭据在边界外，agent 只拿代理令牌；**内核级污点跟踪**（进程读到用户数据即标脏，只有落在极窄策略内的干净请求才免问）；审批**直发客户端**而不走对话；授权是限定能力（一次性/会话/任务/时限/常驻）；浏览器子 agent 只看无障碍树快照、填凭据时暂停、结账检测器强制按精确金额批一次。**Muse 的手机是数据源不是屏幕** —— 这不是疏忽，是 iOS/Android 的限制，也正是 nanoMuse 的切入点。

**Muse 的记忆**：两层 —— agent 维护的「它自己是谁 / 你是谁」文件 + 运行时带索引的记忆库 + 人物/群组关系图（一人一文件）；**被明确要求「先搜记忆，不要相信自己的印象」**，并可回答「这条记忆哪来的、被什么替换了」；对话之外的**后台任务**（agent 自己不能排）维护记忆、关系图、点子、目标、技能和 Feed。

## 4. 值得搬的机制（按价值排序，均已本地复核）

### 4.1 Sentinel：把「执行」收成唯一咽喉 ★★★★★

**「The agent never executes a tool.」** 已验证：`nanomuse/agent/core.py` 全文**零 `.execute(`**，循环里唯一执行路径是 `sentinel.guard(call, tool)`（`agent/core.py:511`）；真正执行只发生在 `sentinel/gate.py` 内。

闸门决策顺序（`sentinel/policy.py:77` 起，固定顺序）：
1. `deny_tools` → 拒
2. 用户规则（tool glob + 参数 glob，首条命中定行为）
3. `always_allow` / `always_ask` 列表
4. 风险三档（`safe/moderate/sensitive`）× 模式（`ask`/`strict`/`auto`）
5. **污点升级**：会话读过私有数据 + 有向非白名单主机的出网 → 强制 ASK（`auto` 也挡不住，且**不可逆**）
6. **warning 升级**：`rm -rf`、`curl | sh` 之类**任何模式都放不过**，只有显式 allow 规则可越

密钥也在闸门后注入：只有 `accepts_secrets=True` 的工具在批准后才把 `{{vault:NAME}}` 换成真值，输出再脱敏。

**→ 对 OpenMuse**：把工具执行收成一个 interceptor/中间件（审批、密钥注入、脱敏、审计、污点全在这一处），调用方永远拿不到裸 execute。**收益最大、落地最直接**（Node 里就是一层 tool executor 包装）。

### 4.2 授权是「限定能力」而非布尔 ★★★★★

授权键 = `tool:target`（`web_fetch:example.com`、`send_email:a@x`、`shell:git`），作用域 `once / conversation / session / 24h / always`，只有 24h/always 落盘；带 warning 的调用**只给 once**（支付与密码永不记住）；多目标调用（`git,head` 管道）**每个目标都要被覆盖**才算命中；全部列在 Permissions 页可撤销。

审批卡的**产品措辞**值得逐字学（`android/.../res/values/nm_strings.xml`）：三档问句（*Allow %1$s to pay on %2$s?* / *…to send to %2$s?* / *…to run this risky command?*），按钮 once / this chat / always for … / deny，队列徽标（*%1$s is waiting for your approval in another chat* + *%1$d more waiting*），预览块（Command / Page / **On the screen**），分类 chip（Delete/Send/Pay/Install），**付款要过设备屏幕锁**。

### 4.3 污点追踪防提示注入 ★★★★

会话级内存 set：读过私有数据的工具成功执行后标脏（`gate.py:371`），此后任何外发到非白名单主机的调用强制 ASK。不落盘、重启即清。**对「服务器上的 agent 会读网页」这件事，这是最实用的一道墙**。

### 4.4 审批的异步往返：服务端挂 Future + 事件推客户端 + POST 决策 + 超时=拒绝 ★★★★

`WebUI.ask_approval`（`server/webui.py:510`）先注册 `asyncio.Future` 再 emit `type:"approval"` 事件，`set_status("waiting")`，`await asyncio.wait_for(fut, timeout=approval_timeout)`（默认 3600s，**超时即拒绝**）；客户端 `POST /api/approvals/{id}` 回来 `fut.set_result`。跨设备时卡片经 hub 转发，**在「提问处」弹出**（目标设备抛 approval 事件 → 提问方弹自己惯用的卡 → 回 `approve`）。

### 4.5 记忆：模型提案 / 代码裁决 ★★★★

- 写入**不是每轮自动沉淀**，而是模型显式调 `remember` 工具；`remember` 先算相似度（0.8 阈值）命中就改写旧条，0.4–0.8 之间反问「要不要 replaces=<id>」；每轮**自动的是注入**。
- 整理（`memory/consolidate.py:278 tidy`）让模型提案、**代码裁决**：合并只能用**原句里出现过的词**（防凭空造词）、**永不删用户手写条目**、单次最多删 20% 且至少留 4 条、每次改动写 `memory_log` **可回滚**。
- 记忆文件：`SOUL.md`（它是谁）/ `USER.md`（你是谁）/ `GLOBAL.md`（跨会话）/ 日期日记 / `HEARTBEAT.md`（例行）。
- 检索：默认 IDF 关键词打分（中英混排用「字母词 + CJK 二元组」分词），可选向量召回用 **RRF 融合** + 相对阈值。

**→ 对 OpenMuse**：你已有的记忆沉淀做了一半（每轮提炼 + 确定性 id + 温度衰减），缺的正是「**合并不得造新词**」与「**永不删用户手写**」这两条硬校验，以及可回滚日志。

### 4.6 离线优先同步：单调 seq + 客户端 cursor ★★★★

- 每账号一个计数器，**每个被接受的变更取下一个 seq**；客户端存「已拉到的最大 cursor」，`since=<cursor>` 拿增量。
- 首拉用 `tail=300` 只取最新 300 条并回报 `skipped=N` —— 首屏秒开。
- **id 由写方生成**（`cid`/`mid` 是设备生成的 UUID），服务端幂等：已知 mid 跳过（除非是 tombstone）；主会话「先到者命名」，第二个 main 被拒并回报正确 id。
- 冲突**不搞向量时钟/CRDT**，三套朴素规则：主会话唯一、消息按 mid 幂等、会话 last-write-newer-wins。删除用 tombstone（立即删正文，墓碑留 30 天）。
- 分页**把消息所属的父行一起带上**，客户端「先父后子」应用，避免孤儿。

### 4.7 其余可搬的小而实用 ★★★

- **SKILL.md（agentskills.io 标准）**：索引进系统提示（名字+描述），正文**按需加载**；用户技能覆盖内置；`/name` 直接展开。两段式显著省 token。
- **阶梯（the ladder）**：能做一件事时取最低一档 —— 技能 → CLI/MCP → 带登录态抓页面 → 浏览器 → **屏幕是最后一档**，爬档要明说。
- **hands 的三条契约**（若要做屏幕操作）：只截图感知、**0–999 网格**坐标、**每个动作必须带一句人话 label**（Sentinel 按 label 判风险、审批卡按 label 措辞）。加：打转守卫（同动作+同屏指纹第 3 次提醒、第 6 次停）、历史**只留 1 张图**（省 token 的关键）、FLAG_SECURE 黑屏检测连续 3 次即交还用户、`MAX_RUN_MS=30min`。
- **配额先预留后结算**：调用前按典型用量预留 + 每账号并发上限（默认 4，每分钟 30 次），防多个并发请求各自通过检查后一起冲穿预算。**单账号也立刻有用**（尤其有定时任务时）。
- **日志规范**：hub 日志只打设备 id 前 12 字符、**不记设备名**（「设备名是人自己的话」）；账号只打 id 前 8 字符；请求响应带 `X-…-Request` 关联 id，让「报障 ↔ 台账行」能对上而不用记正文。
- **"app 关闭还在工作" = 服务端常驻 + 唤醒契约**：一个调度循环算出 `next_wake_at()` 下发给客户端，客户端到点唤醒服务端（手机用精确闹钟）；后台 run 与前台 run 走**同一条 send 通道**，只带 `source:"background"` 标签 —— 后台事件天然进同一 timeline。

## 5. 现在**不要**搬的（多用户/多设备才需要）

- **hub 中继与帧路由**（`cloud/nanomuse_cloud/hub.py` 全部）：device 注册/在线/broadcast/`forget`。而且它的**离线语义是「没有队列」**——发给离线设备立即失败（`device_offline`），只有多端同时在线才有意义。
- **跨设备审批转发与 remote_control 门禁**：这是「A 设备让 B 做事、由 B 的在场人批」的问题。
- **多用户账号体系**：短信验证码/邮箱码/scrypt 密码 + 锁定、邀请裂变与防刷（去 `+tag`、gmail 去点合并、一次性邮箱域名黑名单、**邀请加成延迟到新人首次消费才结算**）、终身 micro-yuan 额度池、admin console。你的单账号 + 自建网关让这些都不成立。
- **`proxy_fetch`**：文档里自己标注「Not built yet」的设计稿。

## 6. 它自己承认的短板 = 你的机会

论文《Limitations》一节写得很直白：

1. **策略边界不等于特权边界** —— 单设备上 Sentinel 与 agent 同一信任域，拿不到「agent 够不到的宿主」。**而你是服务端形态，天然可以把闸门放在 agent 进程之外**（甚至是另一个进程），这是 OpenMuse 相对它的结构性优势。
2. **手还没有成功率的数字** —— 「没有成功率和人工接管次数可报，我们宁可说有而不要估一个」。
3. **记忆还不知道每行是谁写的** —— 记忆的 provenance（哪一行是哪个模型哪天写的、有多确定）尚未落地。
4. 没有自己的模型、没有 per-person VM 的内核级污点、没有钱包与产物。

## 7. 建议的下一步（对 OpenMuse，按性价比）

1. **工具执行收口**：把两个引擎（自带 / Mastra）的工具调用统一进一个 executor 拦截层 —— 审批、密钥、脱敏、审计、污点都挂这里。这是后面所有安全动作的地基。
2. **审批升级成能力授权**：`tool:target` + `once/会话/24h/常驻` + 可撤销列表 + 带 warning 只给 once；顺手把审批卡文案按它那套「向人提问」的措辞重写。
3. **加会话级污点标记**：读过私有数据后，外发到非白名单域名一律要批。防网页注入最实用的一步，服务端实现极省事。
4. **记忆整理补两条硬校验**：合并只能用原句出现过的词 + 永不删用户手写条目 + 改动可回滚（你已有沉淀与去重，只差这层裁决）。
5. **客户端同步改 seq/cursor 增量**（若要多端）：`since` 增量 + `tail` 首拉 + 客户端生成 id 幂等 + tombstone。
6. **（若要做屏幕操作）先定契约再写代码**：只截图 / 0–999 网格 / 每步必须带人话 label / 打转守卫 / 历史只留 1 张图。

## 8. 许可红线（重要）

nanoMuse **全仓 GPL-3.0-or-later**（含 `android/` 子树，那是 OpenMinis 1.13 的 GPL 代码）。OpenMuse 是 MIT（CopilotKit）派生 + 自己的实现。**借鉴机制、思路、产品文案的写法都可以；复制任何源码文件都会让 OpenMuse 被 GPL 传染。** 需要什么功能就照它的设计自己写一遍 —— 这也正好符合「只移植机制不搬代码」的既定路线（柳如烟那次同一个原则）。

## 9. 本机留档

| 内容 | 路径 |
| --- | --- |
| 源码（v1.0.5 最新 main，163MB） | `/home/ubuntu/nanomuse` |
| 发布产物 APK（37MB，sha256 已与官方核对一致） | `/home/ubuntu/nanomuse-dist/nanoMuse-1.0.5-arm64.apk` |
| 桌面 harness 插件（2.4MB，含源码 map） | `/home/ubuntu/nanomuse-dist/dsh/` |
| 论文全文（已缓存，可 grep） | `~/.hermes/cache/web/arxiv.org-6321ef05e4.md` |
| 抽验脚本（32 项论断本地复核） | `/tmp/verify_nanomuse.py` |

**抽验结果**：32 项关键论断全部证实（28 项精确命中，4 项为复核脚本匹配过严，已按真实写法确认：`CALL_TTL_S = 15*60`、`_int("MAX_IN_FLIGHT", 4)`、`_int("PER_MINUTE_REQUESTS", 30)`、socket 名在 `sandbox/OffloadSocketName.kt`）。
