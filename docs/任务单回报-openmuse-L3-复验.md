# 任务单回报：openmuse-L3（复验单）—— 长命令不再被掐断

> 执行：长命令复验（本单零代码改动）
> 单子：`docs/任务单-openmuse-L3.md`
> 工作目录：`/root/work/openmuse-local`
> 脚本回显：`PWD=/root/work/openmuse-local  HEAD=e00c32b`

---

## 1. 三条命令的 rc 与耗时

| # | 命令 | rc | 耗时 |
|---|---|---|---|
| 1 | `pnpm typecheck` | **0** | **79s** |
| 2 | `pnpm test` | **0** | **1043s** |
| 3 | `git status --porcelain tests/` | 0 | 瞬时（无输出） |

三条命令均**前台**依次跑完并拿到 `rc` 后才继续，**没有出现** `BASH_TIMEOUT` / `timed out after …ms`；本轮给命令设的 `timeoutMs` 为 **1800000**（30 分钟），实际最长的 `pnpm test` 只用 1043s，远在预算内。单子给出的「全量测试实测约 937s」在本次复验为 1043s。

原始回显（脚本逐行）：

```
===== typecheck =====
typecheck rc=0 耗时=79s
===== test =====
...
test rc=0 耗时=1043s
===== tests/ porcelain =====
```

---

## 2. 全量测试 pass / fail 计数

`pnpm test` 末尾的 TAP 汇总（原样）：

```
1..751
# tests 751
# suites 0
# pass 751
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1037330.193469
```

- `ℹ pass 751`
- `ℹ fail 0`

（`duration_ms 1037330.193469` ≈ 1037s 的测试运行时间；脚本外层墙钟耗时记为 1043s，差额是启动 / 收尾开销。）

---

## 3. `git status --porcelain tests/` 的原始输出

```
```

（以上代码块内为**空**：命令 rc=0 且**没有任何输出行**。）

说明：`tests/tool-targets.test.ts` 已在 HEAD `e00c32b` 中提交，因此工作树对 `tests/` 处于干净状态，`--porcelain tests/` 没有未跟踪 / 已修改行。为佐证「`tests/` 只有新增文件」，另附只读 git 查询（不属单子三条命令，仅作证据）：

```
$ git diff --name-status HEAD^ HEAD -- tests/
A	tests/tool-targets.test.ts

$ git diff --name-status HEAD -- tests/      # 工作树 vs HEAD
(empty)

$ git ls-files --others --exclude-standard tests/
(empty)
```

即：相对上一提交，`tests/` 下**唯一**的变更是新增 `tests/tool-targets.test.ts`；工作树没有任何已跟踪测试被改动，也没有其它未跟踪测试文件。

---

## 4. 结论（一句话）

**门禁全绿（`pnpm typecheck` rc=0、`pnpm test` rc=0 / `pass 751` `fail 0`、`git status --porcelain tests/` rc=0 无输出），`tests/` 相对上一提交只有新增文件 `tests/tool-targets.test.ts`，长命令已可在前台跑完、未被掐断。**

---

## 5. 完整命令回显（原样落盘）

下面为本次复验脚本 stdout 的完整内容（含全量 TAP 输出），原样粘贴：

```
PWD=/root/work/openmuse-local  HEAD=e00c32b
===== typecheck =====
typecheck rc=0 耗时=79s
===== test =====
TAP version 13
# Subtest: 相位优先级：用工具 > 出字 > 思考 > 后台任务 > 等审批 > 空闲
ok 1 - 相位优先级：用工具 > 出字 > 思考 > 后台任务 > 等审批 > 空闲
  ---
  duration_ms: 1.418465
  type: 'test'
  ...
# Subtest: 出字优先于思考：还没调工具但已有正文时是 TYPING，不是 THINKING
ok 2 - 出字优先于思考：还没调工具但已有正文时是 TYPING，不是 THINKING
  ---
  duration_ms: 0.420733
  type: 'test'
  ...
# Subtest: 思考期的关键是「有话说」：runActive 但无工具无正文 = THINKING
ok 3 - 思考期的关键是「有话说」：runActive 但无工具无正文 = THINKING
  ---
  duration_ms: 0.213406
  type: 'test'
  ...
# Subtest: 相位文案：后台任务带数量，其余走固定词表
ok 4 - 相位文案：后台任务带数量，其余走固定词表
  ---
  duration_ms: 3.28501
  type: 'test'
  ...
# Subtest: 动作 emoji：认识的工具给对应表情，不认识的给兜底扳手
ok 5 - 动作 emoji：认识的工具给对应表情，不认识的给兜底扳手
  ---
  duration_ms: 0.320159
  type: 'test'
  ...
# Subtest: parseApprovals：只留 pending，别的状态一律不要
ok 6 - parseApprovals：只留 pending，别的状态一律不要
  ---
  duration_ms: 3.32099
  type: 'test'
  ...
# Subtest: parseApprovals：按请求时间倒序（最近的在前）
ok 7 - parseApprovals：按请求时间倒序（最近的在前）
  ---
  duration_ms: 15.627952
  type: 'test'
  ...
# Subtest: parseApprovals：坏行丢弃而不是让界面崩（缺 id / 缺 tool / 非对象）
ok 8 - parseApprovals：坏行丢弃而不是让界面崩（缺 id / 缺 tool / 非对象）
  ---
  duration_ms: 5.644336
  type: 'test'
  ...
# Subtest: parseApprovals：返回体不是 { approvals: [] } 时安静给空列表，不抛错
ok 9 - parseApprovals：返回体不是 { approvals: [] } 时安静给空列表，不抛错
  ---
  duration_ms: 1.905544
  type: 'test'
  ...
# Subtest: parseApprovals：字段缺失给兜底（reason/risk/threadId/requestedAt 可缺）
ok 10 - parseApprovals：字段缺失给兜底（reason/risk/threadId/requestedAt 可缺）
  ---
  duration_ms: 1.226571
  type: 'test'
  ...
# Subtest: approvalSummary：有理由用理由，没理由退回「<工具> 需要你确认」
ok 11 - approvalSummary：有理由用理由，没理由退回「<工具> 需要你确认」
  ---
  duration_ms: 0.374657
  type: 'test'
  ...
# Subtest: 档位：只认三档，标签固定，顺序固定
ok 12 - 档位：只认三档，标签固定，顺序固定
  ---
  duration_ms: 0.405902
  type: 'test'
  ...
# Subtest: approveBody：非法档位在本地就被拦下（返回 null，不发请求）
ok 13 - approveBody：非法档位在本地就被拦下（返回 null，不发请求）
  ---
  duration_ms: 0.498595
  type: 'test'
  ...
# Subtest: denyBody：理由空白就不带字段，非空白去掉首尾空格
ok 14 - denyBody：理由空白就不带字段，非空白去掉首尾空格
  ---
  duration_ms: 5.017729
  type: 'test'
  ...
# Subtest: 幂等键：同一条审批 + 同一档位稳定不变，不同档位互不相同
ok 15 - 幂等键：同一条审批 + 同一档位稳定不变，不同档位互不相同
  ---
  duration_ms: 40.638066
  type: 'test'
  ...
# Subtest: assistant Markdown structures the reported response
ok 16 - assistant Markdown structures the reported response
  ---
  duration_ms: 59.769192
  type: 'test'
  ...
# Subtest: incomplete Markdown and raw HTML stay harmless
ok 17 - incomplete Markdown and raw HTML stay harmless
  ---
  duration_ms: 25.584073
  type: 'test'
  ...
# Subtest: only absolute HTTP(S) links can open
ok 18 - only absolute HTTP(S) links can open
  ---
  duration_ms: 0.911088
  type: 'test'
  ...
# Subtest: 清洗抄写抖动：书名号内的杂符号、重复片名、只开不闭
ok 19 - 清洗抄写抖动：书名号内的杂符号、重复片名、只开不闭
  ---
  duration_ms: 1.212256
  type: 'test'
  ...
# Subtest: 清洗不碰片名里的正当字符（连字符、撇号、数字）
ok 20 - 清洗不碰片名里的正当字符（连字符、撇号、数字）
  ---
  duration_ms: 0.353499
  type: 'test'
  ...
# Subtest: 正文图片：本应用文件接口识别为 file 并抽出文件 id
ok 21 - 正文图片：本应用文件接口识别为 file 并抽出文件 id
  ---
  duration_ms: 12.605722
  type: 'test'
  ...
# Subtest: 正文图片：只有 https 外链直接显示，http/相对路径/伪协议保持占位
ok 22 - 正文图片：只有 https 外链直接显示，http/相对路径/伪协议保持占位
  ---
  duration_ms: 1.135662
  type: 'test'
  ...
# Subtest: the browser address bar accepts domains and keeps explicit web URLs
ok 23 - the browser address bar accepts domains and keeps explicit web URLs
  ---
  duration_ms: 2.015613
  type: 'test'
  ...
# Subtest: the address bar rejects unsupported schemes, credentials, and malformed inputs
ok 24 - the address bar rejects unsupported schemes, credentials, and malformed inputs
  ---
  duration_ms: 1.44273
  type: 'test'
  ...
# Subtest: 聊天页要干爽：灵感卡片与灵感建议 chip 都不许出现在聊天里
ok 25 - 聊天页要干爽：灵感卡片与灵感建议 chip 都不许出现在聊天里
  ---
  duration_ms: 2.532789
  type: 'test'
  ...
# Subtest: 灵感的家还在：IdeasScreen 保留，入口仍可跳转
ok 26 - 灵感的家还在：IdeasScreen 保留，入口仍可跳转
  ---
  duration_ms: 2.425827
  type: 'test'
  ...
# Subtest: 聊天页不再有「最近结果」这个看不懂的开关（产出在消息流里本来就有卡片）
ok 27 - 聊天页不再有「最近结果」这个看不懂的开关（产出在消息流里本来就有卡片）
  ---
  duration_ms: 27.617569
  type: 'test'
  ...
# Subtest: ts 代码切出关键字/字符串/注释
ok 28 - ts 代码切出关键字/字符串/注释
  ---
  duration_ms: 2.632757
  type: 'test'
  ...
# Subtest: round-trip：token 拼回原样恒等于输入（不上色也不能改坏代码）
ok 29 - round-trip：token 拼回原样恒等于输入（不上色也不能改坏代码）
  ---
  duration_ms: 1.845441
  type: 'test'
  ...
# Subtest: 按语言家族判注释：CSS 的 \#fff 不是注释，Python 的 \# 是
ok 30 - 按语言家族判注释：CSS 的 \#fff 不是注释，Python 的 \# 是
  ---
  duration_ms: 0.497565
  type: 'test'
  ...
# Subtest: SQL 的 -- 行注释与 JSON 无注释
ok 31 - SQL 的 -- 行注释与 JSON 无注释
  ---
  duration_ms: 0.333674
  type: 'test'
  ...
# Subtest: 跨行反引号模板串成段保留；未闭合行内引号到行尾为止
ok 32 - 跨行反引号模板串成段保留；未闭合行内引号到行尾为止
  ---
  duration_ms: 0.459999
  type: 'test'
  ...
# Subtest: 语言标签取 fence 信息串的第一个词并小写
ok 33 - 语言标签取 fence 信息串的第一个词并小写
  ---
  duration_ms: 0.312286
  type: 'test'
  ...
# Subtest: 合并：服务端顺序为准，本地多出来的接在后面，按 id 去重
ok 34 - 合并：服务端顺序为准，本地多出来的接在后面，按 id 去重
  ---
  duration_ms: 16.687462
  type: 'test'
  ...
# Subtest: 待发消息落盘：重启后队列里还在，服务端确认后才清账
ok 35 - 待发消息落盘：重启后队列里还在，服务端确认后才清账
  ---
  duration_ms: 19.369179
  type: 'test'
  ...
# Subtest: 恢复不会把队列里已有的消息复制一遍
ok 36 - 恢复不会把队列里已有的消息复制一遍
  ---
  duration_ms: 1.598842
  type: 'test'
  ...
# Subtest: 增量拉取时不能把新消息前置（真机：新回复被顶到最上面、被悬浮顶栏压住，看起来像丢了）
ok 37 - 增量拉取时不能把新消息前置（真机：新回复被顶到最上面、被悬浮顶栏压住，看起来像丢了）
  ---
  duration_ms: 3.280528
  type: 'test'
  ...
# Subtest: 服务端全量返回时按 seq 排序、本地未确认的接在最后
ok 38 - 服务端全量返回时按 seq 排序、本地未确认的接在最后
  ---
  duration_ms: 1.407743
  type: 'test'
  ...
# Subtest: 没有 seq 时保持原顺序（不瞎排）
ok 39 - 没有 seq 时保持原顺序（不瞎排）
  ---
  duration_ms: 0.285436
  type: 'test'
  ...
# Subtest: acknowledgedIds 只认服务端回来的 id
ok 40 - acknowledgedIds 只认服务端回来的 id
  ---
  duration_ms: 0.384879
  type: 'test'
  ...
# Subtest: 墓碑：本地副本被清掉，增量里也不会复活（另一端撤回后这台设备不再看到它）
ok 41 - 墓碑：本地副本被清掉，增量里也不会复活（另一端撤回后这台设备不再看到它）
  ---
  duration_ms: 0.579779
  type: 'test'
  ...
# Subtest: 墓碑之外还带 reactions 更新：同 id 以服务端版本为准（replace 不重复）
ok 42 - 墓碑之外还带 reactions 更新：同 id 以服务端版本为准（replace 不重复）
  ---
  duration_ms: 0.359304
  type: 'test'
  ...
# Subtest: follow-ups sent during a reply run once, in order; 泵忙时 flush 立即返回不叠加等待
ok 43 - follow-ups sent during a reply run once, in order; 泵忙时 flush 立即返回不叠加等待
  ---
  duration_ms: 4.535829
  type: 'test'
  ...
# Subtest: 失败不是终局：不暂停、不抛错、不弹终态，退避到点自动重试成功
ok 44 - 失败不是终局：不暂停、不抛错、不弹终态，退避到点自动重试成功
  ---
  duration_ms: 1.484428
  type: 'test'
  ...
# Subtest: 退避节奏就是 TG 那套：1s→2s→5s→15s→60s→5min，之后封顶 5min；达到阈值算「卡住」
ok 45 - 退避节奏就是 TG 那套：1s→2s→5s→15s→60s→5min，之后封顶 5min；达到阈值算「卡住」
  ---
  duration_ms: 2.175675
  type: 'test'
  ...
# Subtest: 点按重发：resendNow 清零失败计数、不等退避立刻再试
ok 46 - 点按重发：resendNow 清零失败计数、不等退避立刻再试
  ---
  duration_ms: 1.318306
  type: 'test'
  ...
# Subtest: 通道忙（QueueBusyError）不算失败：attempts 不增，只让位 1.5s 再试
ok 47 - 通道忙（QueueBusyError）不算失败：attempts 不增，只让位 1.5s 再试
  ---
  duration_ms: 1.106456
  type: 'test'
  ...
# Subtest: 冷启动恢复：杀进程后重开，outbox 里的未送达消息继续送（含失败计数），送达后落盘清空
ok 48 - 冷启动恢复：杀进程后重开，outbox 里的未送达消息继续送（含失败计数），送达后落盘清空
  ---
  duration_ms: 1.601958
  type: 'test'
  ...
# Subtest: restore 不重复恢复同一条（快照里已有的跳过）
ok 49 - restore 不重复恢复同一条（快照里已有的跳过）
  ---
  duration_ms: 0.395567
  type: 'test'
  ...
# Subtest: 暂停后泵不动；resume 继续投递（stop 语义保持）
ok 50 - 暂停后泵不动；resume 继续投递（stop 语义保持）
  ---
  duration_ms: 0.81882
  type: 'test'
  ...
# Subtest: calendar time is rendered and entered in the selected named zone
ok 51 - calendar time is rendered and entered in the selected named zone
  ---
  duration_ms: 89.4943
  type: 'test'
  ...
# Subtest: a zone crossing the UTC date boundary preserves the selected day
ok 52 - a zone crossing the UTC date boundary preserves the selected day
  ---
  duration_ms: 1.587725
  type: 'test'
  ...
# Subtest: invalid calendar dates and out-of-range times do not normalize silently
ok 53 - invalid calendar dates and out-of-range times do not normalize silently
  ---
  duration_ms: 0.530735
  type: 'test'
  ...
# Subtest: a daylight-saving gap cannot become a different appointment time
ok 54 - a daylight-saving gap cannot become a different appointment time
  ---
  duration_ms: 2.662588
  type: 'test'
  ...
# Subtest: partial native date edits never normalize from Date.parse
ok 55 - partial native date edits never normalize from Date.parse
  ---
  duration_ms: 0.554066
  type: 'test'
  ...
# Subtest: 秒数按整秒四舍五入，且不会出现负数
ok 56 - 秒数按整秒四舍五入，且不会出现负数
  ---
  duration_ms: 3.496243
  type: 'test'
  ...
# Subtest: 用时文案复用全仓统一的人话格式
ok 57 - 用时文案复用全仓统一的人话格式
  ---
  duration_ms: 19.618075
  type: 'test'
  ...
# Subtest: 计时器是 1 秒一跳（把它改成静态数字就失去了意义）
ok 58 - 计时器是 1 秒一跳（把它改成静态数字就失去了意义）
  ---
  duration_ms: 0.843369
  type: 'test'
  ...
# Subtest: 聊天里的子任务行与跑动卡片都接上了活数字
ok 59 - 聊天里的子任务行与跑动卡片都接上了活数字
  ---
  duration_ms: 0.540072
  type: 'test'
  ...
# Subtest: 代码块有「复制代码」，且复制前剥掉零宽字符
ok 60 - 代码块有「复制代码」，且复制前剥掉零宽字符
  ---
  duration_ms: 0.640821
  type: 'test'
  ...
# Subtest: 类型判定：markdown/html/源码/媒体/图片/PDF 各归各类
ok 61 - 类型判定：markdown/html/源码/媒体/图片/PDF 各归各类
  ---
  duration_ms: 2.036186
  type: 'test'
  ...
# Subtest: 分享扩展名跟随类型：html→html、txt→txt、md→md、图片/媒体按类型、其余→pdf
ok 62 - 分享扩展名跟随类型：html→html、txt→txt、md→md、图片/媒体按类型、其余→pdf
  ---
  duration_ms: 2.824996
  type: 'test'
  ...
# Subtest: 分享 MIME 与 UTI 跟随类型（与详情页原有映射一字不差）
ok 63 - 分享 MIME 与 UTI 跟随类型（与详情页原有映射一字不差）
  ---
  duration_ms: 0.669238
  type: 'test'
  ...
# Subtest: 动作可用性与详情页按钮条件一致：文本/网页可导出 PDF，仅文本可导出 HTML
ok 64 - 动作可用性与详情页按钮条件一致：文本/网页可导出 PDF，仅文本可导出 HTML
  ---
  duration_ms: 1.219918
  type: 'test'
  ...
# Subtest: 识别自家文件的链接：带签名/不带签名/绝对与相对都认，别的链接不认
ok 65 - 识别自家文件的链接：带签名/不带签名/绝对与相对都认，别的链接不认
  ---
  duration_ms: 12.027069
  type: 'test'
  ...
# Subtest: 聊天与文件面板都必须把文件链接交回应用内（否则又跳浏览器）
ok 66 - 聊天与文件面板都必须把文件链接交回应用内（否则又跳浏览器）
  ---
  duration_ms: 30.540662
  type: 'test'
  ...
# Subtest: 图片有独立的预览分支，且排在 Office 兜底之前
ok 67 - 图片有独立的预览分支，且排在 Office 兜底之前
  ---
  duration_ms: 2.832757
  type: 'test'
  ...
# Subtest: 图片用 Image + Authorization 头取图（与 PdfReader 同一套鉴权）
ok 68 - 图片用 Image + Authorization 头取图（与 PdfReader 同一套鉴权）
  ---
  duration_ms: 1.304334
  type: 'test'
  ...
# Subtest: 图片不会被当成 PDF/文本处理，也不会显示“N pages”
ok 69 - 图片不会被当成 PDF/文本处理，也不会显示“N pages”
  ---
  duration_ms: 1.086148
  type: 'test'
  ...
# Subtest: 文本型不再只有 md/txt：csv / json / 源码也进文本预览，且只有 markdown 走富文本
ok 70 - 文本型不再只有 md/txt：csv / json / 源码也进文本预览，且只有 markdown 走富文本
  ---
  duration_ms: 1.060092
  type: 'test'
  ...
# Subtest: 音视频有独立分支（排在 Office 之前），交给 MediaPlayer 播
ok 71 - 音视频有独立分支（排在 Office 之前），交给 MediaPlayer 播
  ---
  duration_ms: 9.965332
  type: 'test'
  ...
# Subtest: 文本/文档预览不再自建内层滚动盒（避免嵌套滚动导致滑不动）
ok 72 - 文本/文档预览不再自建内层滚动盒（避免嵌套滚动导致滑不动）
  ---
  duration_ms: 1.059267
  type: 'test'
  ...
# Subtest: 详情面板正文开启嵌套滚动，让自滚动子视图先吃手势
ok 73 - 详情面板正文开启嵌套滚动，让自滚动子视图先吃手势
  ---
  duration_ms: 1.508392
  type: 'test'
  ...
# Subtest: 文件页搜索：网格渲染过滤后的列表，且不会再冒出绕过搜索的列表
ok 74 - 文件页搜索：网格渲染过滤后的列表，且不会再冒出绕过搜索的列表
  ---
  duration_ms: 2.090505
  type: 'test'
  ...
# Subtest: 位移映射：滚多少移多少，按比例
ok 75 - 位移映射：滚多少移多少，按比例
  ---
  duration_ms: 4.457733
  type: 'test'
  ...
# Subtest: 同一位置永远同一进度（这就是'不闪'的结构性保证）
ok 76 - 同一位置永远同一进度（这就是'不闪'的结构性保证）
  ---
  duration_ms: 0.74963
  type: 'test'
  ...
# Subtest: 顶栏位移（像素）是 scroll offset 的纯函数：同一 y 永远同一位移、交错求值不串状态
ok 77 - 顶栏位移（像素）是 scroll offset 的纯函数：同一 y 永远同一位移、交错求值不串状态
  ---
  duration_ms: 1.781476
  type: 'test'
  ...
# Subtest: 手指微抖只产生微小位移，不会跳变（真机反馈的闪烁）
ok 78 - 手指微抖只产生微小位移，不会跳变（真机反馈的闪烁）
  ---
  duration_ms: 0.323503
  type: 'test'
  ...
# Subtest: 单调：滚得越远，顶栏移出得越多
ok 79 - 单调：滚得越远，顶栏移出得越多
  ---
  duration_ms: 0.366257
  type: 'test'
  ...
# Subtest: 触摸信号仍可用（聊天页据此判断要不要停止自动跟随）
ok 80 - 触摸信号仍可用（聊天页据此判断要不要停止自动跟随）
  ---
  duration_ms: 0.306117
  type: 'test'
  ...
# Subtest: reads a complete Jev result from JSON or an object and rejects malformed content
ok 81 - reads a complete Jev result from JSON or an object and rejects malformed content
  ---
  duration_ms: 8.549098
  type: 'test'
  ...
# Subtest: the latest complete panel only belongs to the active thread and current turn
ok 82 - the latest complete panel only belongs to the active thread and current turn
  ---
  duration_ms: 1.398929
  type: 'test'
  ...
# Subtest: finds AG-UI function tool calls as rendered by CopilotKit
ok 83 - finds AG-UI function tool calls as rendered by CopilotKit
  ---
  duration_ms: 3.031265
  type: 'test'
  ...
# Subtest: stale, wrong-thread, selected, busy and pending panels cannot submit
ok 84 - stale, wrong-thread, selected, busy and pending panels cannot submit
  ---
  duration_ms: 0.320047
  type: 'test'
  ...
# Subtest: a carried preference leaves a new refinement panel selectable
ok 85 - a carried preference leaves a new refinement panel selectable
  ---
  duration_ms: 0.299007
  type: 'test'
  ...
# Subtest: only the failed option can retry while its panel has not been replaced
ok 86 - only the failed option can retry while its panel has not been replaced
  ---
  duration_ms: 0.520798
  type: 'test'
  ...
# Subtest: selection uses the bounded server action format and rejects unknown options
ok 87 - selection uses the bounded server action format and rejects unknown options
  ---
  duration_ms: 0.964096
  type: 'test'
  ...
# Subtest: the transcript shows the trusted option label instead of the action payload
ok 88 - the transcript shows the trusted option label instead of the action payload
  ---
  duration_ms: 0.554899
  type: 'test'
  ...
# Subtest: a replayed choice is confirmed only after a server continuation
ok 89 - a replayed choice is confirmed only after a server continuation
  ---
  duration_ms: 1.017258
  type: 'test'
  ...
# Subtest: 根组件用键盘高度补底部内边距（覆盖根树里的输入框）
ok 90 - 根组件用键盘高度补底部内边距（覆盖根树里的输入框）
  ---
  duration_ms: 2.147111
  type: 'test'
  ...
# Subtest: Sheet 面板自己避让键盘（Modal 不在根树里，根组件那层够不到）
ok 91 - Sheet 面板自己避让键盘（Modal 不在根树里，根组件那层够不到）
  ---
  duration_ms: 1.91677
  type: 'test'
  ...
# Subtest: 键盘补偿不能重复叠加（根树与 Modal 互不影响，各加一次即可）
ok 92 - 键盘补偿不能重复叠加（根树与 Modal 互不影响，各加一次即可）
  ---
  duration_ms: 4.624675
  type: 'test'
  ...
# Subtest: 客户端上传上限与服务端 bodyLimit 是同一个数
ok 93 - 客户端上传上限与服务端 bodyLimit 是同一个数
  ---
  duration_ms: 5.966919
  type: 'test'
  ...
# Subtest: 超限先把话说清楚（带具体 MB），没超就放行
ok 94 - 超限先把话说清楚（带具体 MB），没超就放行
  ---
  duration_ms: 9.555028
  type: 'test'
  ...
# Subtest: 输入计数只在临界时出现（平时不打扰）
ok 95 - 输入计数只在临界时出现（平时不打扰）
  ---
  duration_ms: 32.323275
  type: 'test'
  ...
# Subtest: 常量都接上了：选完先判体积、输入框限长、附件有上限
ok 96 - 常量都接上了：选完先判体积、输入框限长、附件有上限
  ---
  duration_ms: 4.522981
  type: 'test'
  ...
# Subtest: 复制有回执、撤回如实提示边界、发送键有上传态（都是 Muse 的原话）
ok 97 - 复制有回执、撤回如实提示边界、发送键有上传态（都是 Muse 的原话）
  ---
  duration_ms: 1.723501
  type: 'test'
  ...
# Subtest: 工具名说成人话
ok 98 - 工具名说成人话
  ---
  duration_ms: 2.019452
  type: 'test'
  ...
# Subtest: 从参数里挑最有信息量的那个值
ok 99 - 从参数里挑最有信息量的那个值
  ---
  duration_ms: 1.009104
  type: 'test'
  ...
# Subtest: 相对时间有刚刚/秒/分钟/小时
ok 100 - 相对时间有刚刚/秒/分钟/小时
  ---
  duration_ms: 0.419454
  type: 'test'
  ...
# Subtest: 音量归一到 0..1（原生给的是 -2..10，<0 视为听不见）
ok 101 - 音量归一到 0..1（原生给的是 -2..10，<0 视为听不见）
  ---
  duration_ms: 7.017796
  type: 'test'
  ...
# Subtest: 上滑取消：滑够 60dp（Muse 的 DICTATION_CANCEL_THRESHOLD）才取消
ok 102 - 上滑取消：滑够 60dp（Muse 的 DICTATION_CANCEL_THRESHOLD）才取消
  ---
  duration_ms: 0.510168
  type: 'test'
  ...
# Subtest: 抢麦会自愈：native 实现要开音量、要有上限地重试、取消要用 abort
ok 103 - 抢麦会自愈：native 实现要开音量、要有上限地重试、取消要用 abort
  ---
  duration_ms: 8.756865
  type: 'test'
  ...
# Subtest: 网页版与原生的语音接口一致（少一个字段就是运行时坑）
ok 104 - 网页版与原生的语音接口一致（少一个字段就是运行时坑）
  ---
  duration_ms: 3.286951
  type: 'test'
  ...
# Subtest: 待发附件：上传中/失败都画出来，失败能原地重试（不用重新选文件）
ok 105 - 待发附件：上传中/失败都画出来，失败能原地重试（不用重新选文件）
  ---
  duration_ms: 5.89322
  type: 'test'
  ...
# Subtest: 暂停不是静默切换：有确认面板，也有全局的「已暂停」提示
ok 106 - 暂停不是静默切换：有确认面板，也有全局的「已暂停」提示
  ---
  duration_ms: 1.301576
  type: 'test'
  ...
# Subtest: 拍照先确认再上传（Muse 的 HatchCameraConfirmation）
ok 107 - 拍照先确认再上传（Muse 的 HatchCameraConfirmation）
  ---
  duration_ms: 3.681812
  type: 'test'
  ...
# Subtest: 输入区链接卡与服务端共用同一份 URL 判定
ok 108 - 输入区链接卡与服务端共用同一份 URL 判定
  ---
  duration_ms: 1.026327
  type: 'test'
  ...
# Subtest: 预览端点必须拦内网地址（它等于替用户去访问任意 URL）
ok 109 - 预览端点必须拦内网地址（它等于替用户去访问任意 URL）
  ---
  duration_ms: 3.720606
  type: 'test'
  ...
# Subtest: 正文里的链接也出卡，且与输入区共用同一个组件
ok 110 - 正文里的链接也出卡，且与输入区共用同一个组件
  ---
  duration_ms: 1.117587
  type: 'test'
  ...
# Subtest: 波形只保留最近 N 个采样，数值夹在 0..1
ok 111 - 波形只保留最近 N 个采样，数值夹在 0..1
  ---
  duration_ms: 4.57848
  type: 'test'
  ...
# Subtest: 波形接上了界面
ok 112 - 波形接上了界面
  ---
  duration_ms: 3.675495
  type: 'test'
  ...
# Subtest: 应用内取景：原生有、网页版没有（调用方据此回落系统相机）
ok 113 - 应用内取景：原生有、网页版没有（调用方据此回落系统相机）
  ---
  duration_ms: 1.051453
  type: 'test'
  ...
# Subtest: 装了 expo-camera，并且不为了拍照顺手要麦克风权限
ok 114 - 装了 expo-camera，并且不为了拍照顺手要麦克风权限
  ---
  duration_ms: 5.545022
  type: 'test'
  ...
# Subtest: A7 触觉：长按与回弹有专属序列（不是单发一次）
ok 115 - A7 触觉：长按与回弹有专属序列（不是单发一次）
  ---
  duration_ms: 67.813488
  type: 'test'
  ...
# Subtest: A4 加载：裸转圈都要配一句在等什么
ok 116 - A4 加载：裸转圈都要配一句在等什么
  ---
  duration_ms: 3.41187
  type: 'test'
  ...
# Subtest: A5 错误：失败要说为什么 + 下一步
ok 117 - A5 错误：失败要说为什么 + 下一步
  ---
  duration_ms: 1.070389
  type: 'test'
  ...
# Subtest: B4 错误码：服务端给 code，客户端透 code
ok 118 - B4 错误码：服务端给 code，客户端透 code
  ---
  duration_ms: 0.446028
  type: 'test'
  ...
# Subtest: B5 限流：429 带等多久，客户端说人话
ok 119 - B5 限流：429 带等多久，客户端说人话
  ---
  duration_ms: 3.714222
  type: 'test'
  ...
# Subtest: 有空转的任务时按忙时节奏
ok 120 - 有空转的任务时按忙时节奏
  ---
  duration_ms: 9.095053
  type: 'test'
  ...
# Subtest: 刚上报过实时活动时也算在动
ok 121 - 刚上报过实时活动时也算在动
  ---
  duration_ms: 40.823019
  type: 'test'
  ...
# Subtest: 等审批/等输入也算在动（用户随手一答就该立刻跟上）
ok 122 - 等审批/等输入也算在动（用户随手一答就该立刻跟上）
  ---
  duration_ms: 0.555005
  type: 'test'
  ...
# Subtest: 全静下来就放宽到闲时间隔
ok 123 - 全静下来就放宽到闲时间隔
  ---
  duration_ms: 0.471799
  type: 'test'
  ...
# Subtest: 还没拿到数据时按忙时（首屏要快）
ok 124 - 还没拿到数据时按忙时（首屏要快）
  ---
  duration_ms: 0.25884
  type: 'test'
  ...
# Subtest: 闲时间隔至少是忙时的 3 倍（这就是省下来的流量）
ok 125 - 闲时间隔至少是忙时的 3 倍（这就是省下来的流量）
  ---
  duration_ms: 0.311717
  type: 'test'
  ...
# Subtest: 只有终态才算终态 —— running 不算
ok 126 - 只有终态才算终态 —— running 不算
  ---
  duration_ms: 7.816217
  type: 'test'
  ...
# Subtest: 客户端说在跑 + 服务端已终态 → 收回运行态
ok 127 - 客户端说在跑 + 服务端已终态 → 收回运行态
  ---
  duration_ms: 0.488953
  type: 'test'
  ...
# Subtest: 不该误收的情况：客户端本来没在跑，或服务端还在跑
ok 128 - 不该误收的情况：客户端本来没在跑，或服务端还在跑
  ---
  duration_ms: 0.306969
  type: 'test'
  ...
# Subtest: 宽限期必须为正，否则会在正常收尾时误发停止请求
ok 129 - 宽限期必须为正，否则会在正常收尾时误发停止请求
  ---
  duration_ms: 0.38449
  type: 'test'
  ...
# Subtest: 滚动磨砂的处理器不能走原生驱动（普通 ScrollView 会把它当函数调用而崩）
ok 130 - 滚动磨砂的处理器不能走原生驱动（普通 ScrollView 会把它当函数调用而崩）
  ---
  duration_ms: 1.766403
  type: 'test'
  ...
# Subtest: 调用点用的是普通 ScrollView（这正是必须 JS 驱动的原因）
ok 131 - 调用点用的是普通 ScrollView（这正是必须 JS 驱动的原因）
  ---
  duration_ms: 1.498689
  type: 'test'
  ...
# Subtest: a search result payload becomes card-ready results and pages
ok 132 - a search result payload becomes card-ready results and pages
  ---
  duration_ms: 9.305177
  type: 'test'
  ...
# Subtest: read_pages arrays and wrapped payloads both parse
ok 133 - read_pages arrays and wrapped payloads both parse
  ---
  duration_ms: 2.392386
  type: 'test'
  ...
# Subtest: a failure payload keeps its message instead of inventing results
ok 134 - a failure payload keeps its message instead of inventing results
  ---
  duration_ms: 0.965196
  type: 'test'
  ...
# Subtest: garbage results never render as results
ok 135 - garbage results never render as results
  ---
  duration_ms: 1.876925
  type: 'test'
  ...
# Subtest: hosts are shown without the www prefix
ok 136 - hosts are shown without the www prefix
  ---
  duration_ms: 0.660056
  type: 'test'
  ...
# Subtest: 发送路径不得再看 agent.isRunning 决定发不发
ok 137 - 发送路径不得再看 agent.isRunning 决定发不发
  ---
  duration_ms: 2.623043
  type: 'test'
  ...
# Subtest: run() 里「忙」要走让位重试（QueueBusyError），不能当失败
ok 138 - run() 里「忙」要走让位重试（QueueBusyError），不能当失败
  ---
  duration_ms: 0.475854
  type: 'test'
  ...
# Subtest: 客户端说在跑时要问服务端，判据复用同一个纯函数
ok 139 - 客户端说在跑时要问服务端，判据复用同一个纯函数
  ---
  duration_ms: 0.684772
  type: 'test'
  ...
# Subtest: 只显示没结束的任务，且按会话归属过滤
ok 140 - 只显示没结束的任务，且按会话归属过滤
  ---
  duration_ms: 3.255802
  type: 'test'
  ...
# Subtest: 进度与汇总
ok 141 - 进度与汇总
  ---
  duration_ms: 1.962876
  type: 'test'
  ...
# Subtest: 续期钩子必须把新令牌写回 App 的 token state
ok 142 - 续期钩子必须把新令牌写回 App 的 token state
  ---
  duration_ms: 1.431064
  type: 'test'
  ...
# Subtest: CopilotKitProvider 的 headers 仍然取自 token state
ok 143 - CopilotKitProvider 的 headers 仍然取自 token state
  ---
  duration_ms: 0.808305
  type: 'test'
  ...
# Subtest: 注册表没有重复项，且每个条目都有名字与中文说明
ok 144 - 注册表没有重复项，且每个条目都有名字与中文说明
  ---
  duration_ms: 4.310624
  type: 'test'
  ...
# Subtest: 此前在聊天里隐身的 8 个工具必须登记在册（save_document 等）
ok 145 - 此前在聊天里隐身的 8 个工具必须登记在册（save_document 等）
  ---
  duration_ms: 0.294432
  type: 'test'
  ...
# Subtest: save_document 是卡片级渲染，其余工具默认收成一行细节
ok 146 - save_document 是卡片级渲染，其余工具默认收成一行细节
  ---
  duration_ms: 0.345739
  type: 'test'
  ...
# Subtest: 外壳不再给顶部留内边距：SafeAreaView 的 edges 里不能有 top
ok 147 - 外壳不再给顶部留内边距：SafeAreaView 的 edges 里不能有 top
  ---
  duration_ms: 2.181506
  type: 'test'
  ...
# Subtest: 顶栏是绝对定位覆盖层（Muse 模型，a7f77ec 定案）：位移只动 transform 不动布局
ok 148 - 顶栏是绝对定位覆盖层（Muse 模型，a7f77ec 定案）：位移只动 transform 不动布局
  ---
  duration_ms: 1.133075
  type: 'test'
  ...
# Subtest: 顶栏底色：半透明覆盖层底 + 整条不套玻璃（正文会从底下穿过，玻璃只给小控件）
ok 149 - 顶栏底色：半透明覆盖层底 + 整条不套玻璃（正文会从底下穿过，玻璃只给小控件）
  ---
  duration_ms: 0.919242
  type: 'test'
  ...
# Subtest: 对话页不再用 -insets.top 抵消（外壳不再留内边距，抵消反而会把内容推出屏幕）
ok 150 - 对话页不再用 -insets.top 抵消（外壳不再留内边距，抵消反而会把内容推出屏幕）
  ---
  duration_ms: 5.262395
  type: 'test'
  ...
# Subtest: denying a persisted proposal never calls its adapter
ok 151 - denying a persisted proposal never calls its adapter
  ---
  duration_ms: 9953.72927
  type: 'test'
  ...
# Subtest: concurrent approval consumes the proposal only once
ok 152 - concurrent approval consumes the proposal only once
  ---
  duration_ms: 81.149454
  type: 'test'
  ...
# Subtest: wrong owner and stale hash cannot approve
ok 153 - wrong owner and stale hash cannot approve
  ---
  duration_ms: 119.179417
  type: 'test'
  ...
# Subtest: expired and disconnected proposals never reach the provider
ok 154 - expired and disconnected proposals never reach the provider
  ---
  duration_ms: 114.524491
  type: 'test'
  ...
# Subtest: uncertain writes retain uncertainty and cannot be retried
ok 155 - uncertain writes retain uncertainty and cannot be retried
  ---
  duration_ms: 121.414868
  type: 'test'
  ...
# Subtest: another service instance sees persisted proposals
ok 156 - another service instance sees persisted proposals
  ---
  duration_ms: 95.987447
  type: 'test'
  ...
# Subtest: event validation preserves all-day semantics and rejects missing offsets
ok 157 - event validation preserves all-day semantics and rejects missing offsets
  ---
  duration_ms: 105.952486
  type: 'test'
  ...
# Subtest: account switching and reconnecting invalidate a prepared action
ok 158 - account switching and reconnecting invalidate a prepared action
  ---
  duration_ms: 34.478453
  type: 'test'
  ...
# Subtest: review stores authoritative calendar details and binds execution to their version
ok 159 - review stores authoritative calendar details and binds execution to their version
  ---
  duration_ms: 76.38602
  type: 'test'
  ...
# Subtest: idempotent proposal replay returns a completed action before another provider preparation
ok 160 - idempotent proposal replay returns a completed action before another provider preparation
  ---
  duration_ms: 90.294788
  type: 'test'
  ...
# Subtest: concurrent idempotent proposals retain a single persisted review and activity entry
ok 161 - concurrent idempotent proposals retain a single persisted review and activity entry
  ---
  duration_ms: 28.76642
  type: 'test'
  ...
# Subtest: an expired stale review cannot overwrite a concurrently executing action
ok 162 - an expired stale review cannot overwrite a concurrently executing action
  ---
  duration_ms: 93.528744
  type: 'test'
  ...
# Subtest: a proposal remembers the conversation that asked for it
ok 163 - a proposal remembers the conversation that asked for it
  ---
  duration_ms: 7.839786
  type: 'test'
  ...
# Subtest: 任务的运行事件折成任务流：连续的同类工具合成一个任务
ok 164 - 任务的运行事件折成任务流：连续的同类工具合成一个任务
  ---
  duration_ms: 16.263754
  type: 'test'
  ...
# Subtest: 还在跑的任务：最后一个任务未完成，且不给用时
ok 165 - 还在跑的任务：最后一个任务未完成，且不给用时
  ---
  duration_ms: 0.42236
  type: 'test'
  ...
# Subtest: 只看自己任务的事件，且按时间排序（事件在库里未必有序）
ok 166 - 只看自己任务的事件，且按时间排序（事件在库里未必有序）
  ---
  duration_ms: 0.511958
  type: 'test'
  ...
# Subtest: 连续的同类步骤合成一个任务（这是与 Muse 对齐的核心规则）
ok 167 - 连续的同类步骤合成一个任务（这是与 Muse 对齐的核心规则）
  ---
  duration_ms: 10.621451
  type: 'test'
  ...
# Subtest: 换类目才开新任务，且上一个任务自动收尾
ok 168 - 换类目才开新任务，且上一个任务自动收尾
  ---
  duration_ms: 1.560521
  type: 'test'
  ...
# Subtest: 还在跑时只有最后一个任务未完成（状态只有两态，不掺工具的 loading）
ok 169 - 还在跑时只有最后一个任务未完成（状态只有两态，不掺工具的 loading）
  ---
  duration_ms: 0.69221
  type: 'test'
  ...
# Subtest: 没登记过的工具各自成一类，不糊在一起
ok 170 - 没登记过的工具各自成一类，不糊在一起
  ---
  duration_ms: 0.336338
  type: 'test'
  ...
# Subtest: 一次跑动 = 最后一条用户消息之后的所有步骤
ok 171 - 一次跑动 = 最后一条用户消息之后的所有步骤
  ---
  duration_ms: 0.595029
  type: 'test'
  ...
# Subtest: 用时只在给了起止时间时才算
ok 172 - 用时只在给了起止时间时才算
  ---
  duration_ms: 0.416842
  type: 'test'
  ...
# Subtest: 空跑动是合法的：没有任务、状态仍然明确
ok 173 - 空跑动是合法的：没有任务、状态仍然明确
  ---
  duration_ms: 0.20155
  type: 'test'
  ...
# Subtest: 工具名的两种形状都要认（App 用的是 {function:{name}}，踩过一次真坑）
ok 174 - 工具名的两种形状都要认（App 用的是 {function:{name}}，踩过一次真坑）
  ---
  duration_ms: 0.243158
  type: 'test'
  ...
# Subtest: 服务端每个真实工具名都要落到中文类目上（不许把英文工具名直接摆到界面）
ok 175 - 服务端每个真实工具名都要落到中文类目上（不许把英文工具名直接摆到界面）
  ---
  duration_ms: 1.612746
  type: 'test'
  ...
# Subtest: 每个任务要记住自己下面按顺序发生的步骤（点开任务才能看它做了什么）
ok 176 - 每个任务要记住自己下面按顺序发生的步骤（点开任务才能看它做了什么）
  ---
  duration_ms: 0.71335
  type: 'test'
  ...
# Subtest: 每个真实工具名都要有中文动作短语（点开任务后逐条列的就是它）
ok 177 - 每个真实工具名都要有中文动作短语（点开任务后逐条列的就是它）
  ---
  duration_ms: 4.386643
  type: 'test'
  ...
# Subtest: 最后一条用户消息之后没步骤时，退回最近一次真有步骤的跑动（否则刷新后卡片会莫名消失）
ok 178 - 最后一条用户消息之后没步骤时，退回最近一次真有步骤的跑动（否则刷新后卡片会莫名消失）
  ---
  duration_ms: 0.559036
  type: 'test'
  ...
# Subtest: 任务行摘要：重复合成 ×N，末尾跟用时
ok 179 - 任务行摘要：重复合成 ×N，末尾跟用时
  ---
  duration_ms: 0.330352
  type: 'test'
  ...
# [http] POST /api/session → 200 1405ms
# [http] GET /api/agent → 401 2ms
# [http] POST /api/agent/tasks → 401 5ms
# [http] GET /api/agent → 200 80ms
# [http] GET /api/main-thread → 401 3ms
# [http] GET /api/main-thread → 200 150ms
# [http] GET /api/main-thread → 200 157ms
# [http] GET /api/main-thread → 200 176ms
# [http] GET /api/main-thread → 200 98ms
# [http] POST /api/agent/tasks → 201 54ms
# [http] GET /api/agent/tasks/e333109c-5b47-4201-af40-c3c315e1a60a → 404 13ms
# [http] POST /api/agent/tasks/e333109c-5b47-4201-af40-c3c315e1a60a/control → 404 10ms
# [http] POST /api/agent/tasks/e333109c-5b47-4201-af40-c3c315e1a60a/input → 404 41ms
# [http] GET /api/agent → 200 30ms
# [http] POST /api/agent/tasks/482bec6b-acb5-4efe-bf12-b56bba3c175b/control → 200 56ms
# [http] POST /api/agent/tasks/482bec6b-acb5-4efe-bf12-b56bba3c175b/control → 200 10ms
# [http] POST /api/agent/tasks/482bec6b-acb5-4efe-bf12-b56bba3c175b/control → 200 76ms
# [http] GET /api/agent/tasks/482bec6b-acb5-4efe-bf12-b56bba3c175b → 200 10ms
# [http] POST /api/agent/tasks → 422 8ms
# [http] POST /api/agent/tasks → 422 10ms
# [http] POST /api/agent/tasks/missing/control → 422 5ms
# [http] POST /api/agent/tasks/missing/input → 422 15ms
# [http] POST /api/agent/goals → 422 36ms
# [http] POST /api/agent/goals/missing → 422 4ms
# [http] POST /api/agent/goals/missing → 422 5ms
# [http] POST /api/agent/monitors → 422 6ms
# [http] POST /api/agent/monitors/missing/control → 422 4ms
# [http] POST /api/agent/ideas/missing → 422 6ms
# [http] POST /api/agent/memories → 422 7ms
# [http] POST /api/agent/identity → 422 9ms
# [http] POST /api/agent/sample-page → 422 86ms
# [http] POST /api/agent/tasks → 400 56ms
# [http] POST /api/agent/goals → 201 17ms
# [http] POST /api/agent/tasks → 201 125ms
# [http] POST /api/agent/goals/4a6af1ff-a739-4955-bd1d-22b505319ea2 → 200 72ms
# [http] GET /api/agent/tasks/528b0910-3c4f-4c75-bc76-b945b7f95f6a → 200 9ms
# [http] POST /api/agent/goals/d8acb93e-6ec0-4d60-ba39-104fff4acbca → 404 5ms
# [http] POST /api/agent/tasks → 404 18ms
# [http] POST /api/agent/memories → 201 18ms
# [http] POST /api/agent/memories/779c2178-3de0-40ca-a540-041e282401ce → 200 6ms
# [http] POST /api/agent/memories/private-memory → 404 4ms
# [http] POST /api/agent/memories/private-memory/forget → 404 3ms
# [http] POST /api/agent/identity → 200 10ms
# [http] GET /api/agent → 200 79ms
# [http] POST /api/agent/identity → 422 4ms
# [http] POST /api/agent/memories/779c2178-3de0-40ca-a540-041e282401ce/forget → 200 18ms
# [http] GET /api/agent → 200 166ms
# [http] POST /api/agent/ideas/refresh → 200 102ms
# [http] POST /api/agent/ideas/76e1a645389b9678da90c4e67229997b1492df77e771265325dbe9c84870c319 → 200 64ms
# [http] POST /api/agent/ideas/refresh → 200 223ms
# [http] GET /api/agent → 200 290ms
# [http] POST /api/agent/ideas/9257724ef98b2937a273e9b3d3d4c1bd40b1ca3e07be15b9f3ce1cc45898bf66 → 200 502ms
# [http] POST /api/agent/ideas/9257724ef98b2937a273e9b3d3d4c1bd40b1ca3e07be15b9f3ce1cc45898bf66 → 200 509ms
# [http] GET /api/agent → 200 155ms
# [http] POST /api/agent/tasks/be29f7b0b36ee45a2473a37aa8081df96156234d6be072ef7488b28ec36f8f83/control → 200 16ms
# [http] POST /api/agent/sample-page → 200 13ms
# [http] POST /api/agent/monitors → 201 88ms
# [http] GET /api/agent/tasks/aebe9f8dbf4b0f157fd868ee061c33ec073ae12d294105b7d68f70cc33a0d955 → 200 60ms
# [http] GET /api/agent/notifications → 200 84ms
# [http] POST /api/agent/sample-page → 200 4ms
# [http] POST /api/agent/monitors/1786daad-15e8-42e8-8075-d030b2a2b7dd/control → 200 17ms
# [http] POST /api/agent/sample-page → 200 11ms
# [http] POST /api/agent/monitors/1786daad-15e8-42e8-8075-d030b2a2b7dd/control → 200 19ms
# [http] POST /api/agent/sample-page → 200 46ms
# [http] POST /api/agent/monitors/1786daad-15e8-42e8-8075-d030b2a2b7dd/control → 200 11ms
# [http] POST /api/agent/sample-page → 200 11ms
# [http] POST /api/agent/monitors/1786daad-15e8-42e8-8075-d030b2a2b7dd/control → 200 28ms
# [http] GET /api/agent/notifications → 200 73ms
# [http] POST /api/agent/notifications/fbbe132de87e1b2c79dc6510a5747fb8d6f7da425d89f0fcec0d2a6b33e26717/read → 200 23ms
# [http] GET /api/agent/notifications → 200 288ms
# [http] GET /api/agent → 200 481ms
# [http] POST /api/agent/monitors/1786daad-15e8-42e8-8075-d030b2a2b7dd/control → 200 188ms
# [http] POST /api/agent/monitors/1786daad-15e8-42e8-8075-d030b2a2b7dd/control → 200 194ms
# [http] POST /api/agent/notifications/e60728ab31f44e69acd1e897f93376037ae540fc6b009cb09094d7a2feab411e/read → 404 9ms
# Subtest: agent API requires a session and reports the actual worker state
ok 180 - agent API requires a session and reports the actual worker state
  ---
  duration_ms: 25303.925208
  type: 'test'
  ...
# Subtest: the main Rich Thread survives reopening and concurrent initialization
ok 181 - the main Rich Thread survives reopening and concurrent initialization
  ---
  duration_ms: 334.272548
  type: 'test'
  ...
# Subtest: task detail and controls stay scoped to the authenticated owner
ok 182 - task detail and controls stay scoped to the authenticated owner
  ---
  duration_ms: 361.96109
  type: 'test'
  ...
# Subtest: agent request validation rejects malformed input with useful JSON errors
ok 183 - agent request validation rejects malformed input with useful JSON errors
  ---
  duration_ms: 291.394483
  type: 'test'
  ...
# Subtest: goal updates validate milestones and pausing a goal pauses its task
ok 184 - goal updates validate milestones and pausing a goal pauses its task
  ---
  duration_ms: 336.384219
  type: 'test'
  ...
# Subtest: memories can be edited and forgotten while identity changes persist
ok 185 - memories can be edited and forgotten while identity changes persist
  ---
  duration_ms: 390.055352
  type: 'test'
  ...
# Subtest: idea dismissal survives refresh and concurrent acceptance creates one goal and task
ok 186 - idea dismissal survives refresh and concurrent acceptance creates one goal and task
  ---
  duration_ms: 1402.567527
  type: 'test'
  ...
# Subtest: sample monitor saves its baseline and deduplicates notifications for repeated changes
ok 187 - sample monitor saves its baseline and deduplicates notifications for repeated changes
  ---
  duration_ms: 2710.859635
  type: 'test'
  ...
# [http] POST /api/agent/sample-page → 404 81ms
# [http] POST /api/agent/monitors → 422 65ms
# [http] POST /api/agent/tasks → 201 74ms
# [http] GET /api/agent/tasks/3f653ff6-133d-45ea-a12b-3ed263617ad0 → 200 42ms
# [http] GET /api/agent → 200 302ms
# Subtest: live mode rejects sample sources and hides the fixture mutation endpoint
ok 188 - live mode rejects sample sources and hides the fixture mutation endpoint
  ---
  duration_ms: 283.727254
  type: 'test'
  ...
# Subtest: a delegated task keeps the conversation that asked for it
ok 189 - a delegated task keeps the conversation that asked for it
  ---
  duration_ms: 469.635929
  type: 'test'
  ...
# [http] POST /api/session → 200 1677ms
# [http] POST /api/agent/tasks → 201 191ms
# [http] POST /api/agent/tasks → 201 5ms
# [http] POST /api/agent/tasks → 201 255ms
# [http] POST /api/agent/tasks → 201 22ms
# Subtest: 同一 Idempotency-Key 的派活只创建一个任务
ok 190 - 同一 Idempotency-Key 的派活只创建一个任务
  ---
  duration_ms: 22637.126459
  type: 'test'
  ...
# Subtest: 没有幂等键时每次都是新任务（默认行为不变）
ok 191 - 没有幂等键时每次都是新任务（默认行为不变）
  ---
  duration_ms: 292.456708
  type: 'test'
  ...
# [http] POST /api/session → 200 2625ms
# [http] GET /api/workspace → 401 4ms
# [http] GET /api/workspace → 200 14ms
# Subtest: API protects private data and rejects unrelated web origins
ok 192 - API protects private data and rejects unrelated web origins
  ---
  duration_ms: 15393.618755
  type: 'test'
  ...
# [http] GET /api/files/4136b7f6-18c2-4a76-bc1a-843ab85f4aeb/content → 200 116ms
# [http] POST /api/files/4136b7f6-18c2-4a76-bc1a-843ab85f4aeb/fill → 201 803ms
# [http] GET /api/files/4136b7f6-18c2-4a76-bc1a-843ab85f4aeb/content → 200 48ms
# [http] GET /api/files/4136b7f6-18c2-4a76-bc1a-843ab85f4aeb/content → 403 1ms
# [http] POST /api/actions → 201 118ms
# [http] POST /api/actions/d37339c1-07f6-4e6f-955b-824ef83afe26/decide → 200 158ms
# [http] POST /api/actions → 201 193ms
# [http] POST /api/actions/aeeb5ae7-b4ec-4467-97a7-e6f4d6c8e9b7/decide → 200 304ms
# [http] POST /api/actions → 201 159ms
# [http] POST /api/google/disconnect → 200 6ms
# [http] POST /api/actions/2d9f78e2-7102-439e-a2d7-bdc8073b3f95/decide → 409 7ms
# [http] POST /api/browsers → 503 36ms
# [http] POST /api/google/connect → 200 7ms
# [http] GET /api/calendars → 200 10ms
# [http] GET /api/calendar/events → 200 10ms
# [http] GET /api/mail/threads/trip-thread → 200 25ms
# [http] GET /api/calendar/events → 422 6ms
# Subtest: sample workspace serves a real PDF and filling creates a new version
ok 193 - sample workspace serves a real PDF and filling creates a new version
  ---
  duration_ms: 1234.258552
  type: 'test'
  ...
# Subtest: reviewed sample email persists a receipt, then revocation blocks another proposal
ok 194 - reviewed sample email persists a receipt, then revocation blocks another proposal
  ---
  duration_ms: 1060.875951
  type: 'test'
  ...
# Subtest: missing browser setup is explicit rather than a fictional browser session
ok 195 - missing browser setup is explicit rather than a fictional browser session
  ---
  duration_ms: 74.885062
  type: 'test'
  ...
# Subtest: calendar ranges and complete sample mail threads survive navigation
ok 196 - calendar ranges and complete sample mail threads survive navigation
  ---
  duration_ms: 113.982192
  type: 'test'
  ...
# { status: 401, path: '/api/entitlements/runtime' } Runtime entitlement request failed
# [http] GET /api/copilotkit/info → 200 1347ms
# Subtest: sample agent streams actual AG-UI events without a model key
ok 197 - sample agent streams actual AG-UI events without a model key
  ---
  duration_ms: 1496.828192
  type: 'test'
  ...
# Subtest: guided document delegation streams a rich tool result bound to its saved task
ok 198 - guided document delegation streams a rich tool result bound to its saved task
  ---
  duration_ms: 397.712783
  type: 'test'
  ...
# [audit-persist] 审计写入失败 id=20261016054955810-7c0cd620 tool=plain_sensitive：null function or function signature mismatch
# Subtest: §2.2 downgradeScope：带警告一律降成 once（请求什么档都降）
ok 199 - §2.2 downgradeScope：带警告一律降成 once（请求什么档都降）
  ---
  duration_ms: 9221.652997
  type: 'test'
  ...
# Subtest: §2.2 downgradeScope：没有警告就不动（只降不升，也不许莫名收紧）
ok 200 - §2.2 downgradeScope：没有警告就不动（只降不升，也不许莫名收紧）
  ---
  duration_ms: 8.616171
  type: 'test'
  ...
# Subtest: §2.2 带警告的调用申请 24h → 实际生效 once，且审批记录里写回的是 once
ok 201 - §2.2 带警告的调用申请 24h → 实际生效 once，且审批记录里写回的是 once
  ---
  duration_ms: 194.927386
  type: 'test'
  ...
# Subtest: §2.2 没带警告的调用申请 24h → 仍是 24h，且不许标记降档
ok 202 - §2.2 没带警告的调用申请 24h → 仍是 24h，且不许标记降档
  ---
  duration_ms: 256.252404
  type: 'test'
  ...
# Subtest: §2.2 降档后的授权是消耗型：只放行一次，第二次仍被拦
ok 203 - §2.2 降档后的授权是消耗型：只放行一次，第二次仍被拦
  ---
  duration_ms: 428.067858
  type: 'test'
  ...
# Subtest: §2.2 咽喉登记时把 assessment 的 warnings 带进审批记录（批准时才有据可依）
ok 204 - §2.2 咽喉登记时把 assessment 的 warnings 带进审批记录（批准时才有据可依）
  ---
  duration_ms: 212.828812
  type: 'test'
  ...
# Subtest: §2.2 没有 warnings 的工具：登记时带的是空数组（不是 undefined）
ok 205 - §2.2 没有 warnings 的工具：登记时带的是空数组（不是 undefined）
  ---
  duration_ms: 11.600099
  type: 'test'
  ...
# Subtest: §2.3 isApprovalExpired：没有 expiresAt 的旧记录一律不算过期（兼容）
ok 206 - §2.3 isApprovalExpired：没有 expiresAt 的旧记录一律不算过期（兼容）
  ---
  duration_ms: 13093.982045
  type: 'test'
  ...
# Subtest: §2.3 isApprovalExpired：差 1ms 未到点 → 还没过期
ok 207 - §2.3 isApprovalExpired：差 1ms 未到点 → 还没过期
  ---
  duration_ms: 16.652209
  type: 'test'
  ...
# Subtest: §2.3 isApprovalExpired：正好到点 → 已过期（边界含等号）
ok 208 - §2.3 isApprovalExpired：正好到点 → 已过期（边界含等号）
  ---
  duration_ms: 0.674953
  type: 'test'
  ...
# Subtest: §2.3 approvalExpiresAt：登记时刻 + 1 小时
ok 209 - §2.3 approvalExpiresAt：登记时刻 + 1 小时
  ---
  duration_ms: 0.843699
  type: 'test'
  ...
# Subtest: §2.3 登记待审批时落库的 expiresAt = 登记时刻 + 1h（时钟可注入，不真等）
ok 210 - §2.3 登记待审批时落库的 expiresAt = 登记时刻 + 1h（时钟可注入，不真等）
  ---
  duration_ms: 56.35902
  type: 'test'
  ...
# Subtest: §2.3 过期后 approve 被拒（null），**状态仍是 pending 且不产生任何 grant**
ok 211 - §2.3 过期后 approve 被拒（null），**状态仍是 pending 且不产生任何 grant**
  ---
  duration_ms: 186.01257
  type: 'test'
  ...
# Subtest: §2.3 approveChecked 把三种情况分开：missing / not_pending / expired
ok 212 - §2.3 approveChecked 把三种情况分开：missing / not_pending / expired
  ---
  duration_ms: 629.587111
  type: 'test'
  ...
# Subtest: §2.3 未过期时批准照常：到期时刻就是失效时刻
ok 213 - §2.3 未过期时批准照常：到期时刻就是失效时刻
  ---
  duration_ms: 125.585491
  type: 'test'
  ...
# Subtest: §2.3 过期判定用的是**审批自己的** expiresAt，与授权过期无关
ok 214 - §2.3 过期判定用的是**审批自己的** expiresAt，与授权过期无关
  ---
  duration_ms: 54.233438
  type: 'test'
  ...
# Subtest: §2.3 别人的审批依旧批不到（过期检查不许改变越权语义）
ok 215 - §2.3 别人的审批依旧批不到（过期检查不许改变越权语义）
  ---
  duration_ms: 42.086182
  type: 'test'
  ...
# Subtest: 控制台动作按类型分流：后退/前进/刷新/视口用 worker 的独立端点，点击仍走 input
ok 216 - 控制台动作按类型分流：后退/前进/刷新/视口用 worker 的独立端点，点击仍走 input
  ---
  duration_ms: 11830.853918
  type: 'test'
  ...
# Subtest: 控制台预览可以要 JPEG 低清帧（省字节），并带回当前页面信息
ok 217 - 控制台预览可以要 JPEG 低清帧（省字节），并带回当前页面信息
  ---
  duration_ms: 7458.827573
  type: 'test'
  ...
# Subtest: agent 的眼与手：元素列表按 ref 返回，动作带上 ref 执行，截图交视觉模型
ok 218 - agent 的眼与手：元素列表按 ref 返回，动作带上 ref 执行，截图交视觉模型
  ---
  duration_ms: 8436.403999
  type: 'test'
  ...
# Subtest: 眼与手是真正的工具，模型看得见
ok 219 - 眼与手是真正的工具，模型看得见
  ---
  duration_ms: 15.470299
  type: 'test'
  ...
# Subtest: read_image 仍然把图片理解的答案带回给模型（重构视觉调用时最容易丢的东西）
ok 220 - read_image 仍然把图片理解的答案带回给模型（重构视觉调用时最容易丢的东西）
  ---
  duration_ms: 12.514602
  type: 'test'
  ...
# Subtest: 工具参数宽容：模型把数字写成字符串或 null 时不应让整次调用失败
ok 221 - 工具参数宽容：模型把数字写成字符串或 null 时不应让整次调用失败
  ---
  duration_ms: 30.099414
  type: 'test'
  ...
# Subtest: 提示词要求处理歧义词：保留原词搜索并点名另一种解读
ok 222 - 提示词要求处理歧义词：保留原词搜索并点名另一种解读
  ---
  duration_ms: 1.486661
  type: 'test'
  ...
# Subtest: 跨语言兜底：中文提问 + 英文查询时，同一次调用会用用户原话再搜一遍并合并
ok 223 - 跨语言兜底：中文提问 + 英文查询时，同一次调用会用用户原话再搜一遍并合并
  ---
  duration_ms: 13.720796
  type: 'test'
  ...
# Subtest: 语言一致时不额外搜索（不白花钱也不拖慢）
ok 224 - 语言一致时不额外搜索（不白花钱也不拖慢）
  ---
  duration_ms: 25.553937
  type: 'test'
  ...
# Subtest: lastUserText 能读字符串与分段两种消息格式
ok 225 - lastUserText 能读字符串与分段两种消息格式
  ---
  duration_ms: 1.403627
  type: 'test'
  ...
# Subtest: hasCjk 与 mergeSearchResults 的基本性质
ok 226 - hasCjk 与 mergeSearchResults 的基本性质
  ---
  duration_ms: 0.767187
  type: 'test'
  ...
# [http] POST /api/browsers/00000000-0000-4000-8000-000000000001/reopen → 200 603ms
# [http] POST /api/browsers/00000000-0000-4000-8000-000000000001/reopen → 200 93ms
# [http] GET /api/browsers/00000000-0000-4000-8000-000000000001 → 200 0ms
# [http] GET /api/browsers/00000000-0000-4000-8000-000000000001/console → 401 0ms
# [http] GET /api/browsers/00000000-0000-4000-8000-000000000001 → 200 0ms
# [http] GET /api/browsers/00000000-0000-4000-8000-000000000001/console → 200 0ms
# [http] GET /api/browsers/00000000-0000-4000-8000-000000000001 → 401 0ms
# [http] GET /api/browsers/00000000-0000-4000-8000-000000000099 → 404 0ms
# [http] POST /api/browsers/00000000-0000-4000-8000-000000000099/reopen → 404 0ms
# Subtest: browser API reopens an owned profile at the edited address and renews console access
ok 227 - browser API reopens an owned profile at the edited address and renews console access
  ---
  duration_ms: 13903.864352
  type: 'test'
  ...
# Subtest: server reopens the same worker UUID regardless of stale local session status
ok 228 - server reopens the same worker UUID regardless of stale local session status
  ---
  duration_ms: 7571.327683
  type: 'test'
  ...
# Subtest: console input persists the worker's current page title and URL
ok 229 - console input persists the worker's current page title and URL
  ---
  duration_ms: 8093.407312
  type: 'test'
  ...
# Subtest: failed creation remains app-visible and can be retried with its original UUID
ok 230 - failed creation remains app-visible and can be retried with its original UUID
  ---
  duration_ms: 23015.17898
  type: 'test'
  ...
# Subtest: browser observations reuse an owned profile and reject unowned reads
ok 231 - browser observations reuse an owned profile and reject unowned reads
  ---
  duration_ms: 9605.039212
  type: 'test'
  ...
# Subtest: chat browser reads reuse a persisted owned profile across turns and service restarts
ok 232 - chat browser reads reuse a persisted owned profile across turns and service restarts
  ---
  duration_ms: 6407.197018
  type: 'test'
  ...
# Subtest: chat browser retries failed navigation using the reserved profile
ok 233 - chat browser retries failed navigation using the reserved profile
  ---
  duration_ms: 5174.739687
  type: 'test'
  ...
# Subtest: concurrent chat reads keep each navigation paired with its page read
ok 234 - concurrent chat reads keep each navigation paired with its page read
  ---
  duration_ms: 6219.176741
  type: 'test'
  ...
# Subtest: cancelled chat browser requests do not start navigation or a follow-up read
ok 235 - cancelled chat browser requests do not start navigation or a follow-up read
  ---
  duration_ms: 11370.777238
  type: 'test'
  ...
# Subtest: browser read fails on missing page text instead of inventing observation content
ok 236 - browser read fails on missing page text instead of inventing observation content
  ---
  duration_ms: 16014.866414
  type: 'test'
  ...
# Subtest: browser imports return rejected downloads even when no PDF was accepted
ok 237 - browser imports return rejected downloads even when no PDF was accepted
  ---
  duration_ms: 11506.949084
  type: 'test'
  ...
# Subtest: worker persists unsupported, oversized and interrupted download outcomes
ok 238 - worker persists unsupported, oversized and interrupted download outcomes
  ---
  duration_ms: 765.445059
  type: 'test'
  ...
# Subtest: browser rejects private, special-use and encoded IP addresses
ok 239 - browser rejects private, special-use and encoded IP addresses
  ---
  duration_ms: 15.728512
  type: 'test'
  ...
# Subtest: browser rejects DNS answers containing any private address and pins public resolution
ok 240 - browser rejects DNS answers containing any private address and pins public resolution
  ---
  duration_ms: 3.088938
  type: 'test'
  ...
# Subtest: worker protects all controls, validates before launch, and health reveals no sessions
ok 241 - worker protects all controls, validates before launch, and health reveals no sessions
  ---
  duration_ms: 872.541566
  type: 'test'
  ...
# Subtest: egress proxy blocks HTTP and CONNECT traffic to local network destinations
ok 242 - egress proxy blocks HTTP and CONNECT traffic to local network destinations
  ---
  duration_ms: 39.32496
  type: 'test'
  ...
# Subtest: the browser counts as connected only while its worker answers
ok 243 - the browser counts as connected only while its worker answers
  ---
  duration_ms: 12272.874963
  type: 'test'
  ...
# [http] GET /api/workspace → 200 292ms
# [http] GET /api/workspace → 200 83ms
# Subtest: the workspace reports the browser offline while its worker's health check fails
ok 244 - the workspace reports the browser offline while its worker's health check fails
  ---
  duration_ms: 28407.407546
  type: 'test'
  ...
# Subtest: about:blank 放行（导出 PDF 用），其它非公网目标照旧拒绝
ok 245 - about:blank 放行（导出 PDF 用），其它非公网目标照旧拒绝
  ---
  duration_ms: 1.314034
  type: 'test'
  ...
# [http] POST /api/session → 200 2115ms
# [http] POST /api/conversation → 200 28ms
# [http] PUT /api/conversation → 200 60ms
# [http] POST /api/conversation → 200 40ms
# [http] GET /api/conversation → 200 59ms
# [http] GET /api/conversation → 200 30ms
# [http] GET /api/conversation → 200 46ms
# [http] GET /api/conversation → 200 125ms
# Subtest: 追加消息：发游标、按 id 幂等、重发不回退
ok 246 - 追加消息：发游标、按 id 幂等、重发不回退
  ---
  duration_ms: 18346.51438
  type: 'test'
  ...
# Subtest: 游标拉取：since 之后的消息才下发
ok 247 - 游标拉取：since 之后的消息才下发
  ---
  duration_ms: 3.250246
  type: 'test'
  ...
# Subtest: SSE 解析与消息拼装：正文 + 工具调用 + 工具结果
ok 248 - SSE 解析与消息拼装：正文 + 工具调用 + 工具结果
  ---
  duration_ms: 5.901733
  type: 'test'
  ...
# Subtest: 没有正文也没有工具调用的空消息不落库
ok 249 - 没有正文也没有工具调用的空消息不落库
  ---
  duration_ms: 2.256492
  type: 'test'
  ...
# Subtest: 空回合判定：只有开始/结束事件、没有正文与工具调用 ⇒ failed
ok 250 - 空回合判定：只有开始/结束事件、没有正文与工具调用 ⇒ failed
  ---
  duration_ms: 0.841605
  type: 'test'
  ...
# Subtest: 空回合判定：只吐空白正文字符也算空 ⇒ failed
ok 251 - 空回合判定：只吐空白正文字符也算空 ⇒ failed
  ---
  duration_ms: 0.305437
  type: 'test'
  ...
# Subtest: 空回合判定：有正文 ⇒ succeeded
ok 252 - 空回合判定：有正文 ⇒ succeeded
  ---
  duration_ms: 0.459498
  type: 'test'
  ...
# Subtest: 空回合判定：只发起工具调用（没有正文）仍是成功的中间轮次
ok 253 - 空回合判定：只发起工具调用（没有正文）仍是成功的中间轮次
  ---
  duration_ms: 0.625297
  type: 'test'
  ...
# Subtest: 空回合判定：RUN_ERROR 优先于正文（哪怕已经吐了一半）
ok 254 - 空回合判定：RUN_ERROR 优先于正文（哪怕已经吐了一半）
  ---
  duration_ms: 0.779917
  type: 'test'
  ...
# Subtest: 服务端接口：追加是幂等的，且能按游标只取增量
ok 255 - 服务端接口：追加是幂等的，且能按游标只取增量
  ---
  duration_ms: 242.252753
  type: 'test'
  ...
# Subtest: 重开 App 后能从游标处拿到断线期间的回复与轮次状态
ok 256 - 重开 App 后能从游标处拿到断线期间的回复与轮次状态
  ---
  duration_ms: 53.06081
  type: 'test'
  ...
# Subtest: 卡住的一轮会被看门狗判为中断，不会让 App 一直等
ok 257 - 卡住的一轮会被看门狗判为中断，不会让 App 一直等
  ---
  duration_ms: 142.073355
  type: 'test'
  ...
# [http] GET /api/computer → 401 141ms
# [http] POST /api/computer/commands → 401 82ms
# [http] GET /api/computer → 200 376ms
# [http] POST /api/computer/files/read → 422 328ms
# [http] POST /api/computer/files/import → 404 132ms
# [http] POST /api/computer/commands → 409 797ms
# [http] POST /api/computer/commands → 200 276ms
# Subtest: computer REST endpoints require session ownership and return persisted receipts
ok 258 - computer REST endpoints require session ownership and return persisted receipts
  ---
  duration_ms: 24105.989873
  type: 'test'
  ...
# Subtest: Docker subprocess uses literal argv, strips provider credentials, caps output and bounds hangs
ok 259 - Docker subprocess uses literal argv, strips provider credentials, caps output and bounds hangs
  ---
  duration_ms: 1111.736846
  type: 'test'
  ...
# Subtest: disabled computer reports setup without invoking Docker
ok 260 - disabled computer reports setup without invoking Docker
  ---
  duration_ms: 19406.048914
  type: 'test'
  ...
# Subtest: commands execute solely as Docker argv and persist failed exit/output receipts
ok 261 - commands execute solely as Docker argv and persist failed exit/output receipts
  ---
  duration_ms: 749.956062
  type: 'test'
  ...
# Subtest: a running command holds an atomic lease across service instances
ok 262 - a running command holds an atomic lease across service instances
  ---
  duration_ms: 378.228999
  type: 'test'
  ...
# Subtest: timeouts and interruptions remain durable and idempotent commands never replay
ok 263 - timeouts and interruptions remain durable and idempotent commands never replay
  ---
  duration_ms: 1665.492264
  type: 'test'
  ...
# Subtest: attaching an existing container fails closed on unsafe isolation or owner labels
ok 264 - attaching an existing container fails closed on unsafe isolation or owner labels
  ---
  duration_ms: 1613.049405
  type: 'test'
  ...
# Subtest: paths cannot escape the workspace and file contents travel on stdin
ok 265 - paths cannot escape the workspace and file contents travel on stdin
  ---
  duration_ms: 192.45875
  type: 'test'
  ...
# Subtest: Stop interrupts an active command and its final output cannot overwrite the interrupted receipt
ok 266 - Stop interrupts an active command and its final output cannot overwrite the interrupted receipt
  ---
  duration_ms: 218.912063
  type: 'test'
  ...
# Subtest: exit 137 without a recorded stop remains a failed command
ok 267 - exit 137 without a recorded stop remains a failed command
  ---
  duration_ms: 93.001506
  type: 'test'
  ...
# Subtest: restart waits until a delayed pre-stop Docker execution acknowledges completion
ok 268 - restart waits until a delayed pre-stop Docker execution acknowledges completion
  ---
  duration_ms: 730.312163
  type: 'test'
  ...
# Subtest: failed Stop keeps commands quarantined and can be retried before the lease expires
ok 269 - failed Stop keeps commands quarantined and can be retried before the lease expires
  ---
  duration_ms: 988.392739
  type: 'test'
  ...
# Subtest: a timeout with unconfirmed Docker cleanup stays quarantined until Stop succeeds
ok 270 - a timeout with unconfirmed Docker cleanup stays quarantined until Stop succeeds
  ---
  duration_ms: 467.628855
  type: 'test'
  ...
# Subtest: an expired lease from a dead executor recovers as interrupted without replay
ok 271 - an expired lease from a dead executor recovers as interrupted without replay
  ---
  duration_ms: 195.238575
  type: 'test'
  ...
# Subtest: every API mode runs without an Intelligence key (local SSE mode)
ok 272 - every API mode runs without an Intelligence key (local SSE mode)
  ---
  duration_ms: 1.842265
  type: 'test'
  ...
# Subtest: a self-hosted Intelligence endpoint must set apiUrl and wsUrl together
ok 273 - a self-hosted Intelligence endpoint must set apiUrl and wsUrl together
  ---
  duration_ms: 1.572666
  type: 'test'
  ...
# Subtest: every API mode accepts a non-empty Intelligence key
ok 274 - every API mode accepts a non-empty Intelligence key
  ---
  duration_ms: 0.238507
  type: 'test'
  ...
# Subtest: Jev mode is off by default and validates explicit modes
ok 275 - Jev mode is off by default and validates explicit modes
  ---
  duration_ms: 2.03868
  type: 'test'
  ...
# Subtest: browser worker URL keeps an existing scheme and adds http to host:port
ok 276 - browser worker URL keeps an existing scheme and adds http to host:port
  ---
  duration_ms: 0.624463
  type: 'test'
  ...
# Subtest: environment variables that override a different .env value are reported by name
ok 277 - environment variables that override a different .env value are reported by name
  ---
  duration_ms: 0.824921
  type: 'test'
  ...
# [http] POST /api/session → 200 3345ms（慢）
# [http] POST /api/conversation → 200 63ms
# [http] DELETE /api/conversation → 422 7ms
# [http] DELETE /api/conversation → 200 6ms
# [http] GET /api/conversation → 200 20ms
# [http] GET /api/conversation → 200 56ms
# [http] DELETE /api/conversation → 404 6ms
# [http] POST /api/conversation → 200 70ms
# [http] GET /api/conversation → 200 58ms
# [http] POST /api/conversation/reactions → 200 265ms
# [http] GET /api/conversation → 200 25ms
# [http] POST /api/conversation/reactions → 422 4ms
# [http] POST /api/conversation/reactions → 404 4ms
# [http] GET /api/conversation/reactions → 200 4ms
# Subtest: 撤回纯函数：移除消息、写墓碑、幂等、重试补发不复活
ok 278 - 撤回纯函数：移除消息、写墓碑、幂等、重试补发不复活
  ---
  duration_ms: 20388.437266
  type: 'test'
  ...
# Subtest: 反应纯函数：切换、seq 顶到最新、已撤回消息不可反应
ok 279 - 反应纯函数：切换、seq 顶到最新、已撤回消息不可反应
  ---
  duration_ms: 1.103171
  type: 'test'
  ...
# Subtest: 反应面板顺序：用得多的在前，没用过的保持默认顺序
ok 280 - 反应面板顺序：用得多的在前，没用过的保持默认顺序
  ---
  duration_ms: 1.421068
  type: 'test'
  ...
# Subtest: 使用频率计数：只增不减（历史用法决定面板排序）
ok 281 - 使用频率计数：只增不减（历史用法决定面板排序）
  ---
  duration_ms: 10.264528
  type: 'test'
  ...
# Subtest: 服务端接口：撤回→拉取带墓碑→其它端能清掉本地副本；只能撤回自己的消息
ok 282 - 服务端接口：撤回→拉取带墓碑→其它端能清掉本地副本；只能撤回自己的消息
  ---
  duration_ms: 185.190168
  type: 'test'
  ...
# Subtest: 服务端接口：反应切换会随游标增量重投递，不支持的表情被拒
ok 283 - 服务端接口：反应切换会随游标增量重投递，不支持的表情被拒
  ---
  duration_ms: 481.826537
  type: 'test'
  ...
# Subtest: 空会话的墓碑字段是空数组而不是缺省
ok 284 - 空会话的墓碑字段是空数组而不是缺省
  ---
  duration_ms: 0.412558
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=browser-chat risk=safe outcome=ok target=- egress=none egress_target=- summary=- (313ms)
# [tool] browse_web url=https://example.org/article → sessionId,url,title,text,truncated 193B (321ms)
# [http] GET /api/browsers/cbe1888c-8bc4-4cda-a291-71ff2d7dddaf → 200 9ms
# [audit] tool=browse_web owner=local-user thread=browser-chat risk=safe outcome=ok target=- egress=none egress_target=- summary=- (129ms)
# [tool] browse_web url=https://example.org/article → sessionId,url,title,text,truncated 193B (130ms)
# Subtest: chat browse_web emits real SDK tool events and returns observed source content immediately
ok 285 - chat browse_web emits real SDK tool events and returns observed source content immediately
  ---
  duration_ms: 21517.376976
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=browser-chat risk=safe outcome=ok target=- egress=none egress_target=- summary=- (529ms)
# [tool] browse_web url=https://example.org/article → error 43B error=Public page could not be opened (531ms)
# Subtest: chat browse_web emits an honest completed error result when navigation fails
ok 286 - chat browse_web emits an honest completed error result when navigation fails
  ---
  duration_ms: 9612.972382
  type: 'test'
  ...
# Subtest: unsubscribing from chat stops queued browser navigation and further model steps
ok 287 - unsubscribing from chat stops queued browser navigation and further model steps
  ---
  duration_ms: 11274.670644
  type: 'test'
  ...
# [audit] tool=search_mail owner=local-user thread=browser-chat risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (16ms)
# [tool] search_mail query=aquarium → matches,truncated 501B (17ms)
# [audit] tool=read_mail_thread owner=local-user thread=browser-chat risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (9ms)
# [tool] read_mail_thread threadId=trip-thread → messages,truncated 687B (10ms)
# Subtest: chat searches and reads actual owner mail without creating a task or sending
ok 288 - chat searches and reads actual owner mail without creating a task or sending
  ---
  duration_ms: 16812.711
  type: 'test'
  ...
# [audit] tool=search_mail owner=local-user thread=browser-chat risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (6ms)
# [tool] search_mail query=aquarium → error 22B error=Google 未连接 (7ms)
# [audit] tool=read_mail_thread owner=local-user thread=browser-chat risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (25ms)
# [tool] read_mail_thread threadId=trip-thread → error 21B error=找不到这个邮件会话 (25ms)
# Subtest: chat mail tools report disconnected mail and refuse another owner's thread
ok 289 - chat mail tools report disconnected mail and refuse another owner's thread
  ---
  duration_ms: 17003.907408
  type: 'test'
  ...
# Subtest: refinement may omit options but new panels still need candidates
ok 290 - refinement may omit options but new panels still need candidates
  ---
  duration_ms: 65.954116
  type: 'test'
  ...
# Subtest: mail-grounded choices name a thread, while generic clarification needs no mail reference
ok 291 - mail-grounded choices name a thread, while generic clarification needs no mail reference
  ---
  duration_ms: 2.289963
  type: 'test'
  ...
# [audit] tool=search_mail owner=local-user thread=jev-thread risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (103ms)
# [tool] search_mail query=aquarium → matches,truncated 501B (120ms)
# [audit] tool=read_mail_thread owner=local-user thread=jev-thread risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (24ms)
# [tool] read_mail_thread threadId=trip-thread → messages,truncated 687B (25ms)
# Subtest: present_choices emits a complete panel and selection uses trusted stored label
ok 292 - present_choices emits a complete panel and selection uses trusted stored label
  ---
  duration_ms: 26526.929549
  type: 'test'
  ...
# Subtest: invalid and cross-thread actions return a run error without model execution
ok 293 - invalid and cross-thread actions return a run error without model execution
  ---
  duration_ms: 9252.408407
  type: 'test'
  ...
# Subtest: live choices reject unobserved source pages without creating a panel
ok 294 - live choices reject unobserved source pages without creating a panel
  ---
  duration_ms: 9622.943685
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=jev-thread risk=safe outcome=ok target=- egress=none egress_target=- summary=- (120ms)
# [tool] browse_web url=https://example.org/original → sessionId,url,title,text,truncated 150B (122ms)
# Subtest: a redirected browse does not prove the requested source URL
ok 295 - a redirected browse does not prove the requested source URL
  ---
  duration_ms: 9082.497661
  type: 'test'
  ...
# [audit] tool=read_mail_thread owner=local-user thread=jev-thread risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (84ms)
# [tool] read_mail_thread threadId=trip-thread → messages,truncated 687B (85ms)
# Subtest: mail read in an earlier run does not authorize a new live clarification
ok 296 - mail read in an earlier run does not authorize a new live clarification
  ---
  duration_ms: 9945.363742
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=jev-thread risk=safe outcome=ok target=- egress=none egress_target=- summary=- (120ms)
# [tool] browse_web url=https://example.org/exhibit → sessionId,url,title,text,truncated 156B (120ms)
# Subtest: live refinement reuses the verified stored sources with no new browse or options
ok 297 - live refinement reuses the verified stored sources with no new browse or options
  ---
  duration_ms: 9202.480723
  type: 'test'
  ...
# Subtest: generic live clarification succeeds without mail, but an unobserved mail thread does not
ok 298 - generic live clarification succeeds without mail, but an unobserved mail thread does not
  ---
  duration_ms: 10846.913671
  type: 'test'
  ...
# Subtest: Jev judges the person's own message, not the agent's summary of it
ok 299 - Jev judges the person's own message, not the agent's summary of it
  ---
  duration_ms: 8572.029061
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=jev-thread risk=safe outcome=ok target=- egress=none egress_target=- summary=- (31ms)
# [tool] browse_web url=https://example.org/exhibit → sessionId,url,title,text,truncated 162B (53ms)
# Subtest: live comparison rejects a factual detail absent from the read page
ok 300 - live comparison rejects a factual detail absent from the read page
  ---
  duration_ms: 13224.88555
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=jev-thread risk=safe outcome=ok target=- egress=none egress_target=- summary=- (141ms)
# [tool] browse_web url=https://example.org/empty → sessionId,url,title,text,truncated 132B (143ms)
# Subtest: an empty browser read does not authorize a live comparison
ok 301 - an empty browser read does not authorize a live comparison
  ---
  duration_ms: 5649.07907
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=jev-thread risk=safe outcome=ok target=- egress=none egress_target=- summary=- (274ms)
# [tool] browse_web url=https://example.org/rocky-shore → sessionId,url,title,text,truncated 184B (280ms)
# Subtest: live comparison rejects invented option label
ok 302 - live comparison rejects invented option label
  ---
  duration_ms: 5797.370069
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=jev-thread risk=safe outcome=ok target=- egress=none egress_target=- summary=- (42ms)
# [tool] browse_web url=https://example.org/rocky-shore → sessionId,url,title,text,truncated 184B (43ms)
# Subtest: live comparison rejects invented source title
ok 303 - live comparison rejects invented source title
  ---
  duration_ms: 7760.857858
  type: 'test'
  ...
# [audit] tool=browse_web owner=local-user thread=jev-thread risk=safe outcome=ok target=- egress=none egress_target=- summary=- (101ms)
# [tool] browse_web url=https://example.org/rocky-shore → sessionId,url,title,text,truncated 184B (106ms)
# Subtest: live comparison rejects no supporting details
ok 304 - live comparison rejects no supporting details
  ---
  duration_ms: 6055.525529
  type: 'test'
  ...
# Subtest: a later ordinary completed turn invalidates a prior choice panel
ok 305 - a later ordinary completed turn invalidates a prior choice panel
  ---
  duration_ms: 10126.765492
  type: 'test'
  ...
# Subtest: an ordinary turn that fails still retires the earlier choice, as the transcript does
ok 306 - an ordinary turn that fails still retires the earlier choice, as the transcript does
  ---
  duration_ms: 20095.216258
  type: 'test'
  ...
# Subtest: cancelling an ordinary turn still retires the earlier choice
ok 307 - cancelling an ordinary turn still retires the earlier choice
  ---
  duration_ms: 14205.956555
  type: 'test'
  ...
# Subtest: a run resuming after a tool result is not a new turn and keeps the choice
ok 308 - a run resuming after a tool result is not a new turn and keeps the choice
  ---
  duration_ms: 16989.53018
  type: 'test'
  ...
# Subtest: only the turn that retired a panel may refine it
ok 309 - only the turn that retired a panel may refine it
  ---
  duration_ms: 21664.68125
  type: 'test'
  ...
# Agent execution failed: Error: Connection interrupted
#     at <anonymous> (/root/work/openmuse-local/tests/conversation-sdk.test.ts:58:31)
#     at Observable.init (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/observable/throwError.ts:123:68)
#     at Observable.Observable._trySubscribe (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:244:19)
#     at <anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:234:18)
#     at Object.errorContext (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/util/errorContext.ts:29:5)
#     at Observable.Observable.subscribe (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:220:5)
#     at Object.mergeInternals (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/operators/mergeInternals.ts:136:10)
#     at <anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/operators/mergeMap.ts:95:42)
#     at OperatorSubscriber.<anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/util/lift.ts:24:18)
#     at <anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:226:22)
# Agent execution failed: Error: Connection interrupted
#     at <anonymous> (/root/work/openmuse-local/tests/conversation-sdk.test.ts:58:31)
#     at Observable.init (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/observable/throwError.ts:123:68)
#     at Observable.Observable._trySubscribe (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:244:19)
#     at <anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:234:18)
#     at Object.errorContext (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/util/errorContext.ts:29:5)
#     at Observable.Observable.subscribe (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:220:5)
#     at Object.mergeInternals (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/operators/mergeInternals.ts:136:10)
#     at <anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/operators/mergeMap.ts:95:42)
#     at OperatorSubscriber.<anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/util/lift.ts:24:18)
#     at <anonymous> (/root/work/openmuse-local/node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/src/internal/Observable.ts:226:22)
# Subtest: an emitted CopilotKit run error folds into backoff retries and never pauses the queue
ok 310 - an emitted CopilotKit run error folds into backoff retries and never pauses the queue
  ---
  duration_ms: 40.858767
  type: 'test'
  ...
# Subtest: CopilotRuntime 必须拒绝转发入站 authorization
ok 311 - CopilotRuntime 必须拒绝转发入站 authorization
  ---
  duration_ms: 4.535901
  type: 'test'
  ...
# Subtest: pnpm 补丁文件存在，且把安全网挪到了组装响应之后
ok 312 - pnpm 补丁文件存在，且把安全网挪到了组装响应之后
  ---
  duration_ms: 1.992104
  type: 'test'
  ...
# Subtest: 补丁仍登记在 pnpm-workspace.yaml（否则 CI 安装时不会应用）
ok 313 - 补丁仍登记在 pnpm-workspace.yaml（否则 CI 安装时不会应用）
  ---
  duration_ms: 0.942237
  type: 'test'
  ...
# Subtest: 铸一把就能用，明文返回一次；列表里只回后 6 位
ok 314 - 铸一把就能用，明文返回一次；列表里只回后 6 位
  ---
  duration_ms: 24693.158634
  type: 'test'
  ...
# Subtest: 任务结束 → 绑在它名下的凭据被显式吊销（'用完就销毁'）
ok 315 - 任务结束 → 绑在它名下的凭据被显式吊销（'用完就销毁'）
  ---
  duration_ms: 134.177699
  type: 'test'
  ...
# Subtest: 手动吊销 / 到期失效 / 过期扫描
ok 316 - 手动吊销 / 到期失效 / 过期扫描
  ---
  duration_ms: 161.165981
  type: 'test'
  ...
# [db] list 命中损坏行，改为逐行读取：missing chunk number 0 for toast value 16631 in pg_toast_16384
# [db] 跳过损坏行 list ctid=(0,2)：missing chunk number 0 for toast value 16631 in pg_toast_16384
# [db] list 共跳过 1 行损坏数据（其余 2 行正常返回）
# [db] list 命中损坏行，改为逐行读取：missing chunk number 0 for toast value 16631 in pg_toast_16384
# Subtest: isCorruptRow 认得出真实的损坏消息，普通错误照旧抛
ok 317 - isCorruptRow 认得出真实的损坏消息，普通错误照旧抛
  ---
  duration_ms: 5.105267
  type: 'test'
  ...
# Subtest: 一行 TOAST 坏了 → 逐行读，坏的跳过，其余照常返回（不再整个 502）
ok 318 - 一行 TOAST 坏了 → 逐行读，坏的跳过，其余照常返回（不再整个 502）
  ---
  duration_ms: 4.673804
  type: 'test'
  ...
# Subtest: 降级路径里遇到损坏以外的错误仍然抛（不能把真问题当数据损坏吞掉）
ok 319 - 降级路径里遇到损坏以外的错误仍然抛（不能把真问题当数据损坏吞掉）
  ---
  duration_ms: 1.795392
  type: 'test'
  ...
# Subtest: 日志脱敏：令牌形状不会原样进 journald
ok 320 - 日志脱敏：令牌形状不会原样进 journald
  ---
  duration_ms: 2.311536
  type: 'test'
  ...
# Subtest: school-trip demo reads mail before presenting clarification choices
ok 321 - school-trip demo reads mail before presenting clarification choices
  ---
  duration_ms: 11.78948
  type: 'test'
  ...
# Subtest: school-trip search ignores newer unrelated aquarium mail and rejects wrong read
ok 322 - school-trip search ignores newer unrelated aquarium mail and rejects wrong read
  ---
  duration_ms: 2.756378
  type: 'test'
  ...
# Subtest: both non-exhibit clarification choices continue from trusted school mail
ok 323 - both non-exhibit clarification choices continue from trusted school mail
  ---
  duration_ms: 2.311667
  type: 'test'
  ...
# Subtest: school-trip demo stops after failed mail or choice result
ok 324 - school-trip demo stops after failed mail or choice result
  ---
  duration_ms: 3.166148
  type: 'test'
  ...
# Subtest: Explore exhibits browses every cited aquarium page before showing comparison
ok 325 - Explore exhibits browses every cited aquarium page before showing comparison
  ---
  duration_ms: 4.12242
  type: 'test'
  ...
# Subtest: live Jev demo candidates quote each page instead of reusing sample copy
ok 326 - live Jev demo candidates quote each page instead of reusing sample copy
  ---
  duration_ms: 1.913731
  type: 'test'
  ...
# Subtest: Explore exhibits does not make a card when a browser read fails
ok 327 - Explore exhibits does not make a card when a browser read fails
  ---
  duration_ms: 3.358414
  type: 'test'
  ...
# Subtest: Explore exhibits rejects a successful page whose text does not support its fixture claim
ok 328 - Explore exhibits rejects a successful page whose text does not support its fixture claim
  ---
  duration_ms: 1.401134
  type: 'test'
  ...
# Subtest: hands-on preference refines the same candidate set and selection is acknowledged
ok 329 - hands-on preference refines the same candidate set and selection is acknowledged
  ---
  duration_ms: 5.294632
  type: 'test'
  ...
# Subtest: aquarium research distinguishes exhibit entries from navigation and only quotes observed descriptions
ok 330 - aquarium research distinguishes exhibit entries from navigation and only quotes observed descriptions
  ---
  duration_ms: 1.610733
  type: 'test'
  ...
# Subtest: the email demo reads the thread returned by search and quotes its actual details
ok 331 - the email demo reads the thread returned by search and quotes its actual details
  ---
  duration_ms: 7.537551
  type: 'test'
  ...
# Subtest: the email demo handles no matches and disconnected mail without inventing details
ok 332 - the email demo handles no matches and disconnected mail without inventing details
  ---
  duration_ms: 1.161546
  type: 'test'
  ...
# Subtest: demo only summarizes browser evidence belonging to the current user turn
ok 333 - demo only summarizes browser evidence belonging to the current user turn
  ---
  duration_ms: 2.897713
  type: 'test'
  ...
# Subtest: demo reports missing or failed browser evidence without inventing a summary
ok 334 - demo reports missing or failed browser evidence without inventing a summary
  ---
  duration_ms: 0.607224
  type: 'test'
  ...
# Subtest: AI Mock drives the real TanStack BuiltInAgent through two browser tool rounds
ok 335 - AI Mock drives the real TanStack BuiltInAgent through two browser tool rounds
  ---
  duration_ms: 2654.737584
  type: 'test'
  ...
# Subtest: email drafts default cc, bcc, and attachmentIds to empty arrays
ok 336 - email drafts default cc, bcc, and attachmentIds to empty arrays
  ---
  duration_ms: 22.382814
  type: 'test'
  ...
# Subtest: email drafts reject a subject containing a line break
ok 337 - email drafts reject a subject containing a line break
  ---
  duration_ms: 31.143477
  type: 'test'
  ...
# Subtest: email drafts enforce recipient, cc/bcc, and attachment limits
ok 338 - email drafts enforce recipient, cc/bcc, and attachment limits
  ---
  duration_ms: 1.193169
  type: 'test'
  ...
# Subtest: email drafts reject malformed addresses
ok 339 - email drafts reject malformed addresses
  ---
  duration_ms: 10.584105
  type: 'test'
  ...
# Subtest: timed events require an explicit UTC offset
ok 340 - timed events require an explicit UTC offset
  ---
  duration_ms: 40.855402
  type: 'test'
  ...
# Subtest: all-day events reject a full timestamp in place of a date
ok 341 - all-day events reject a full timestamp in place of a date
  ---
  duration_ms: 0.982706
  type: 'test'
  ...
# Subtest: events reject an end at or before the start
ok 342 - events reject an end at or before the start
  ---
  duration_ms: 1.143536
  type: 'test'
  ...
# Subtest: events default calendarId, location, and description
ok 343 - events default calendarId, location, and description
  ---
  duration_ms: 0.473499
  type: 'test'
  ...
# Subtest: proposal schema discriminates on kind and validates nested data
ok 344 - proposal schema discriminates on kind and validates nested data
  ---
  duration_ms: 3.131643
  type: 'test'
  ...
# [runner] 忽略重复的一轮 thread=t1 message=m1（回复由游标补拉送达）
# Subtest: 同一轮被重复投递时只跑一次（客户端超时重发不该白跑第二遍）
ok 345 - 同一轮被重复投递时只跑一次（客户端超时重发不该白跑第二遍）
  ---
  duration_ms: 16746.848734
  type: 'test'
  ...
# Subtest: 同一会话的另一轮会排队等前面跑完，而不是报 Thread already running
ok 346 - 同一会话的另一轮会排队等前面跑完，而不是报 Thread already running
  ---
  duration_ms: 165.925935
  type: 'test'
  ...
# {
#   timestamp: '2026-10-16T05:55:01.388Z',
#   context: { phase: 'durable-runner-persist' },
#   error: 'Error'
# }
# Subtest: 内存 runner 报 already running 时会自动重试，不把这一轮丢掉
ok 347 - 内存 runner 报 already running 时会自动重试，不把这一轮丢掉
  ---
  duration_ms: 1509.235832
  type: 'test'
  ...
# Subtest: detectNegation 只认关键词之前的否定词（不再自我抵消）
ok 348 - detectNegation 只认关键词之前的否定词（不再自我抵消）
  ---
  duration_ms: 31.398831
  type: 'test'
  ...
# Subtest: 否定生效：『我不喜欢这个』不该被记成开心
ok 349 - 否定生效：『我不喜欢这个』不该被记成开心
  ---
  duration_ms: 1.238505
  type: 'test'
  ...
# Subtest: 『不要脸』这类关键词不会被自身包含的否定词抵消
ok 350 - 『不要脸』这类关键词不会被自身包含的否定词抵消
  ---
  duration_ms: 1.163916
  type: 'test'
  ...
# Subtest: 无角色光谱时退化为纯关键词（contextLevel=1）
ok 351 - 无角色光谱时退化为纯关键词（contextLevel=1）
  ---
  duration_ms: 0.418714
  type: 'test'
  ...
# Subtest: 角色光谱真的参与加权：忠诚高的角色，感动被放大、傲娇被压制
ok 352 - 角色光谱真的参与加权：忠诚高的角色，感动被放大、傲娇被压制
  ---
  duration_ms: 0.415458
  type: 'test'
  ...
# Subtest: 表达力是全局缩放：expressiveness=1 → 所有情感 ×1.2
ok 353 - 表达力是全局缩放：expressiveness=1 → 所有情感 ×1.2
  ---
  duration_ms: 0.247725
  type: 'test'
  ...
# Subtest: 同一句话会因为角色光谱不同而落到不同情感 —— 这才是光谱的意义
ok 354 - 同一句话会因为角色光谱不同而落到不同情感 —— 这才是光谱的意义
  ---
  duration_ms: 0.417796
  type: 'test'
  ...
# Subtest: 情感方向看的是用户在说自己还是在说助手
ok 355 - 情感方向看的是用户在说自己还是在说助手
  ---
  duration_ms: 0.33031
  type: 'test'
  ...
# Subtest: 弧线：从平静切过去算切换，之后同情感连续触发才升温，第 3 次转 rising
ok 356 - 弧线：从平静切过去算切换，之后同情感连续触发才升温，第 3 次转 rising
  ---
  duration_ms: 2.176082
  type: 'test'
  ...
# Subtest: 弧线与历史都只保留最近 N 条，不会无限增长
ok 357 - 弧线与历史都只保留最近 N 条，不会无限增长
  ---
  duration_ms: 1.479206
  type: 'test'
  ...
# Subtest: findPeakEmotion 取累计强度最高的那种情感
ok 358 - findPeakEmotion 取累计强度最高的那种情感
  ---
  duration_ms: 0.339323
  type: 'test'
  ...
# Subtest: 提示词注入：平静且低强度不注入（省 token）
ok 359 - 提示词注入：平静且低强度不注入（省 token）
  ---
  duration_ms: 0.347704
  type: 'test'
  ...
# Subtest: two workers claim one task only once
ok 360 - two workers claim one task only once
  ---
  duration_ms: 12038.829638
  type: 'test'
  ...
# Subtest: cancellation invalidates a stale worker before its next effect
ok 361 - cancellation invalidates a stale worker before its next effect
  ---
  duration_ms: 11665.915913
  type: 'test'
  ...
# Subtest: expired leases recover saved checkpoints after the database restarts
ok 362 - expired leases recover saved checkpoints after the database restarts
  ---
  duration_ms: 12721.562291
  type: 'test'
  ...
# Subtest: scheduled tasks wait for due time and approvals wait for a recorded outcome
ok 363 - scheduled tasks wait for due time and approvals wait for a recorded outcome
  ---
  duration_ms: 12111.632426
  type: 'test'
  ...
# Subtest: finance artifacts compute cents exactly and reject ambiguous CSV
ok 364 - finance artifacts compute cents exactly and reject ambiguous CSV
  ---
  duration_ms: 61.291414
  type: 'test'
  ...
# Subtest: pending reviews do not starve queued work
ok 365 - pending reviews do not starve queued work
  ---
  duration_ms: 4070.633899
  type: 'test'
  ...
# Subtest: run history keeps the time the run started
ok 366 - run history keeps the time the run started
  ---
  duration_ms: 3620.787445
  type: 'test'
  ...
# Subtest: a failed run record does not leave the task stuck in the worker
ok 367 - a failed run record does not leave the task stuck in the worker
  ---
  duration_ms: 9430.55255
  type: 'test'
  ...
# [http] POST /api/session → 200 2591ms
# [http] POST /api/files → 201 75ms
# [http] POST /api/files → 201 11ms
# [http] POST /api/files → 201 54ms
# [http] POST /api/files → 201 10ms
# [http] POST /api/files → 201 12ms
# Subtest: 音视频按魔数认类型：wav（真文件）、mp3（ID3）、mp4（ftyp）、webm（EBML）
ok 368 - 音视频按魔数认类型：wav（真文件）、mp3（ID3）、mp4（ftyp）、webm（EBML）
  ---
  duration_ms: 29828.70937
  type: 'test'
  ...
# [http] POST /api/files → 201 91ms
# [http] GET /api/files/92eee313-68fb-42d4-825e-4ce2adaf9a8d/content → 200 13ms
# Subtest: 音频分享/取回时扩展名跟着类型走（不是一律 .pdf）
ok 369 - 音频分享/取回时扩展名跟着类型走（不是一律 .pdf）
  ---
  duration_ms: 118.632633
  type: 'test'
  ...
# [http] POST /api/session → 200 3533ms（慢）
# [http] POST /api/files → 201 164ms
# [http] GET /api/files/a23e5218-fcd0-4aa7-ae83-ed7f0edf898e/content → 200 55ms
# [http] POST /api/files → 201 11ms
# [http] GET /api/files/04b32cc4-3e0e-48cc-9d6e-ea9e2990923c/content → 200 11ms
# [http] POST /api/files → 201 9ms
# [http] GET /api/files/32346596-7006-43d3-bb41-7cae3d9a5194/content → 200 494ms
# [http] POST /api/files → 201 70ms
# [http] GET /api/files/a3ef29ba-ccbc-443e-8d81-7cc8b6cba1d8/content → 200 95ms
# [http] POST /api/files → 422 66ms
# [http] POST /api/files → 422 13ms
# Subtest: 上传 csv / json / py：按扩展名认成对应类型，能存也能取回
ok 370 - 上传 csv / json / py：按扩展名认成对应类型，能存也能取回
  ---
  duration_ms: 22530.722476
  type: 'test'
  ...
# [http] POST /api/files → 201 89ms
# Subtest: 扩展名不符或内容可疑的一律拒绝（防伪装成 .py 的二进制）
ok 371 - 扩展名不符或内容可疑的一律拒绝（防伪装成 .py 的二进制）
  ---
  duration_ms: 188.397055
  type: 'test'
  ...
# Subtest: 智能体写文件时尊重扩展名（save_document 交 .csv 就存成 text/csv）
ok 372 - 智能体写文件时尊重扩展名（save_document 交 .csv 就存成 text/csv）
  ---
  duration_ms: 314.684583
  type: 'test'
  ...
# Subtest: 密钥不进沙箱：沙箱只拿句柄、凭据由服务端代发；吊销后句柄立刻失效
ok 373 - 密钥不进沙箱：沙箱只拿句柄、凭据由服务端代发；吊销后句柄立刻失效
  ---
  duration_ms: 22074.931195
  type: 'test'
  ...
# Subtest: 工具层：git_push 自动改用代发句柄，沙箱命令行与回包里都没有令牌
ok 374 - 工具层：git_push 自动改用代发句柄，沙箱命令行与回包里都没有令牌
  ---
  duration_ms: 3519.360977
  type: 'test'
  ...
# Subtest: 沙箱里：从只读挂载克隆源仓库 → 提交 → 推回本地裸仓库（全程无网）
ok 375 - 沙箱里：从只读挂载克隆源仓库 → 提交 → 推回本地裸仓库（全程无网）
  ---
  duration_ms: 1634.597026
  type: 'test'
  ...
#    沙箱里看到的状态: fatal: Authentication failed for 'http://127.0.0.1:8585/repo.git/'
#    服务端收到的 Authorization 次数: 2
# Subtest: 凭据走 GIT_ASKPASS：远端只认凭据，且凭据不出现在命令行/配置里
ok 376 - 凭据走 GIT_ASKPASS：远端只认凭据，且凭据不出现在命令行/配置里
  ---
  duration_ms: 604.016527
  type: 'test'
  ...
# Subtest: 聊天里调用 git 工具 → 明确拒绝，且不碰沙箱
ok 377 - 聊天里调用 git 工具 → 明确拒绝，且不碰沙箱
  ---
  duration_ms: 764.000013
  type: 'test'
  ...
# Subtest: mail reads nested plain text and attachment references over authenticated Gmail paths
ok 378 - mail reads nested plain text and attachment references over authenticated Gmail paths
  ---
  duration_ms: 100.823906
  type: 'test'
  ...
# Subtest: HTML-only messages expose complete plain text while removing active and non-content elements
ok 379 - HTML-only messages expose complete plain text while removing active and non-content elements
  ---
  duration_ms: 181.636312
  type: 'test'
  ...
# Subtest: Gmail attachments decode actual bytes and enforce declared and actual size limits
ok 380 - Gmail attachments decode actual bytes and enforce declared and actual size limits
  ---
  duration_ms: 27.629766
  type: 'test'
  ...
# Subtest: mail sends correctly encoded CRLF MIME and the exact attachment bytes
ok 381 - mail sends correctly encoded CRLF MIME and the exact attachment bytes
  ---
  duration_ms: 23.403984
  type: 'test'
  ...
# Subtest: header injection and oversized outgoing attachments fail before credential access
ok 382 - header injection and oversized outgoing attachments fail before credential access
  ---
  duration_ms: 5.231679
  type: 'test'
  ...
# Subtest: replies resolve source metadata and preserve thread and message references
ok 383 - replies resolve source metadata and preserve thread and message references
  ---
  duration_ms: 53.091733
  type: 'test'
  ...
# Subtest: reply metadata cannot inject headers
ok 384 - reply metadata cannot inject headers
  ---
  duration_ms: 2.385454
  type: 'test'
  ...
# Subtest: calendar reads expanded primary events and maps all-day boundaries
ok 385 - calendar reads expanded primary events and maps all-day boundaries
  ---
  duration_ms: 23.050866
  type: 'test'
  ...
# Subtest: calendar writes use calendar IDs, preserve unrelated fields via PATCH, and notify guests
ok 386 - calendar writes use calendar IDs, preserve unrelated fields via PATCH, and notify guests
  ---
  duration_ms: 160.29546
  type: 'test'
  ...
# Subtest: calendar review captures authoritative details and requires a usable version
ok 387 - calendar review captures authoritative details and requires a usable version
  ---
  duration_ms: 6.14499
  type: 'test'
  ...
# Subtest: calendar writes refuse targets changed since review before dispatch
ok 388 - calendar writes refuse targets changed since review before dispatch
  ---
  duration_ms: 6.004566
  type: 'test'
  ...
# Subtest: calendar review resolves the selected calendar zone when Google omits an event zone
ok 389 - calendar review resolves the selected calendar zone when Google omits an event zone
  ---
  duration_ms: 4.049226
  type: 'test'
  ...
# Subtest: calendar writes pass the reviewed version to Google's final conditional write
ok 390 - calendar writes pass the reviewed version to Google's final conditional write
  ---
  duration_ms: 7.22951
  type: 'test'
  ...
# Subtest: all-day writes use exclusive date-only end and invalid dates never call Google
ok 391 - all-day writes use exclusive date-only end and invalid dates never call Google
  ---
  duration_ms: 5.549464
  type: 'test'
  ...
# Subtest: event updates explicitly clear the opposite time representation when switching all-day mode
ok 392 - event updates explicitly clear the opposite time representation when switching all-day mode
  ---
  duration_ms: 5.772671
  type: 'test'
  ...
# Subtest: scope errors remain visible and do not look like empty inboxes
ok 393 - scope errors remain visible and do not look like empty inboxes
  ---
  duration_ms: 7.459365
  type: 'test'
  ...
# Subtest: network failures and 5xx write responses produce outcome_unknown without retrying
ok 394 - network failures and 5xx write responses produce outcome_unknown without retrying
  ---
  duration_ms: 94.007433
  type: 'test'
  ...
# Subtest: credential failures before dispatch and explicit 4xx writes remain definite failures
ok 395 - credential failures before dispatch and explicit 4xx writes remain definite failures
  ---
  duration_ms: 4.790896
  type: 'test'
  ...
# Subtest: an interrupted error response body cannot erase uncertainty about a write
ok 396 - an interrupted error response body cannot erase uncertainty about a write
  ---
  duration_ms: 3.414636
  type: 'test'
  ...
# Subtest: thread detail reads sent and archived messages outside the inbox list
ok 397 - thread detail reads sent and archived messages outside the inbox list
  ---
  duration_ms: 12.131881
  type: 'test'
  ...
# Subtest: thread detail retrieves complete text bodies stored behind Gmail attachment IDs
ok 398 - thread detail retrieves complete text bodies stored behind Gmail attachment IDs
  ---
  duration_ms: 54.067106
  type: 'test'
  ...
# Subtest: event reads include earlier today and support selected calendars and bounded ranges
ok 399 - event reads include earlier today and support selected calendars and bounded ranges
  ---
  duration_ms: 4.937528
  type: 'test'
  ...
# Subtest: calendar discovery follows pagination and retains names, zones, and access roles
ok 400 - calendar discovery follows pagination and retains names, zones, and access roles
  ---
  duration_ms: 6.195927
  type: 'test'
  ...
# Subtest: recurring masters and occurrences are rejected from fresh Google data before updates or deletes
ok 401 - recurring masters and occurrences are rejected from fresh Google data before updates or deletes
  ---
  duration_ms: 11.08681
  type: 'test'
  ...
# Subtest: single-event validation is repeated at execution and read failures never dispatch writes
ok 402 - single-event validation is repeated at execution and read failures never dispatch writes
  ---
  duration_ms: 72.763094
  type: 'test'
  ...
# [http] POST /api/session → 200 2893ms
# [http] GET /api/grants → 200 146ms
# [http] GET /api/grants → 403 5ms
# [http] GET /api/grants → 200 9ms
# [http] GET /api/grants → 200 78ms
# [http] GET /grants → 200 39ms
# [http] DELETE /api/grants/20260301080000000-f1390cea → 200 15ms
# [http] DELETE /api/grants/20260301080000000-b06d3916 → 200 19ms
# [http] DELETE /api/grants/20260301080000000-b06d3916 → 200 20ms
# [http] DELETE /api/grants/20260301080000000-fa4525a9 → 200 4ms
# [http] DELETE /api/grants/根本不存在的-id → 200 17ms
# [http] GET /grants → 401 1ms
# [http] GET /api/grants → 401 0ms
# [http] DELETE /grants/x → 401 1ms
# [http] DELETE /api/grants/x → 401 1ms
# [http] POST /api/approvals/20260301080000000-d76d364e/approve → 410 147ms
# [http] POST /api/approvals/根本没有这条/approve → 404 37ms
# [audit] tool=send_payment owner=local-user thread=t-rest risk=sensitive outcome=ok decision=approval_approved approval=20260301080000000-4b6fdffb
# [http] POST /api/approvals/20260301080000000-4b6fdffb/approve → 200 28ms
# [http] GET /api/grants → 200 12ms
# Subtest: §2.4 GET /api/grants：只列本 owner 的授权，且带 target / scope / expiresAt
ok 403 - §2.4 GET /api/grants：只列本 owner 的授权，且带 target / scope / expiresAt
  ---
  duration_ms: 24879.122426
  type: 'test'
  ...
# Subtest: §2.4 GET /api/grants?owner=别人 → 403；写自己 → 200（同一套取数口径）
ok 404 - §2.4 GET /api/grants?owner=别人 → 403；写自己 → 200（同一套取数口径）
  ---
  duration_ms: 18.390855
  type: 'test'
  ...
# Subtest: §2.4 裸路径 /grants 与 /api/grants 行为一致
ok 405 - §2.4 裸路径 /grants 与 /api/grants 行为一致
  ---
  duration_ms: 128.569507
  type: 'test'
  ...
# Subtest: §2.4 DELETE /api/grants/:id：撤销后这条授权**真的不再命中**
ok 406 - §2.4 DELETE /api/grants/:id：撤销后这条授权**真的不再命中**
  ---
  duration_ms: 176.720245
  type: 'test'
  ...
# Subtest: §2.4 撤销是幂等的：删第二次仍 200，但 removed=false
ok 407 - §2.4 撤销是幂等的：删第二次仍 200，但 removed=false
  ---
  duration_ms: 279.870558
  type: 'test'
  ...
# Subtest: §2.4 别人的授权删不掉，而且那条授权**还在**（撤销不许变成越权后门）
ok 408 - §2.4 别人的授权删不掉，而且那条授权**还在**（撤销不许变成越权后门）
  ---
  duration_ms: 188.315639
  type: 'test'
  ...
# Subtest: §2.4 不存在的 id：200 + removed=false（幂等，不报错）
ok 409 - §2.4 不存在的 id：200 + removed=false（幂等，不报错）
  ---
  duration_ms: 23.426957
  type: 'test'
  ...
# Subtest: §2.4 没令牌一律 401（列表与撤销都要鉴权，裸路径也不例外）
ok 410 - §2.4 没令牌一律 401（列表与撤销都要鉴权，裸路径也不例外）
  ---
  duration_ms: 20.141904
  type: 'test'
  ...
# Subtest: §2.3 过期的待审批 → 410 Gone（与「找不到」的 404 分开）
ok 411 - §2.3 过期的待审批 → 410 Gone（与「找不到」的 404 分开）
  ---
  duration_ms: 164.050029
  type: 'test'
  ...
# Subtest: §2.3 不存在的审批仍然 404（既有语义不许被 410 抢走）
ok 412 - §2.3 不存在的审批仍然 404（既有语义不许被 410 抢走）
  ---
  duration_ms: 48.85875
  type: 'test'
  ...
# Subtest: §2.4 批准响应里带 downgraded，且授权真的落在库里（可被列表看到）
ok 413 - §2.4 批准响应里带 downgraded，且授权真的落在库里（可被列表看到）
  ---
  duration_ms: 90.590023
  type: 'test'
  ...
# Subtest: §2.1 不限定目标的授权：放行任意目标，也放行「没有目标」的调用（与改造前逐字一致）
ok 414 - §2.1 不限定目标的授权：放行任意目标，也放行「没有目标」的调用（与改造前逐字一致）
  ---
  duration_ms: 17257.346829
  type: 'test'
  ...
# Subtest: §2.1 脏行归一化：缺 target 字段的旧记录退化成「不限定目标」
ok 415 - §2.1 脏行归一化：缺 target 字段的旧记录退化成「不限定目标」
  ---
  duration_ms: 1.718675
  type: 'test'
  ...
# Subtest: §2.1 限定目标的授权：放行同目标
ok 416 - §2.1 限定目标的授权：放行同目标
  ---
  duration_ms: 1.301211
  type: 'test'
  ...
# Subtest: §2.1 限定目标的授权：不放行别的目标
ok 417 - §2.1 限定目标的授权：不放行别的目标
  ---
  duration_ms: 0.801955
  type: 'test'
  ...
# Subtest: §2.1 限定目标的授权：不放行「没有目标」的调用（那是另一种调用形状）
ok 418 - §2.1 限定目标的授权：不放行「没有目标」的调用（那是另一种调用形状）
  ---
  duration_ms: 0.492154
  type: 'test'
  ...
# Subtest: §2.1 多目标全被覆盖 → 放行；两条 once 都被消耗
ok 419 - §2.1 多目标全被覆盖 → 放行；两条 once 都被消耗
  ---
  duration_ms: 104.713268
  type: 'test'
  ...
# Subtest: §2.1 多目标缺一个 → 整体不放行，且**已覆盖的那些不被消耗**（不白烧用户的点头）
ok 420 - §2.1 多目标缺一个 → 整体不放行，且**已覆盖的那些不被消耗**（不白烧用户的点头）
  ---
  duration_ms: 43.573195
  type: 'test'
  ...
# Subtest: §2.1 不传 targets（老调用形状）→ 与改造前一致：单目标路径逐个候选试
ok 421 - §2.1 不传 targets（老调用形状）→ 与改造前一致：单目标路径逐个候选试
  ---
  duration_ms: 12.528171
  type: 'test'
  ...
# Subtest: §2.1 missingTargets：只报没被覆盖的，且**不消耗**任何授权
ok 422 - §2.1 missingTargets：只报没被覆盖的，且**不消耗**任何授权
  ---
  duration_ms: 76.306469
  type: 'test'
  ...
# Subtest: §2.1 normalizeTargets：认字符串 / 数组，丢非字符串与空白，去重且保序
ok 423 - §2.1 normalizeTargets：认字符串 / 数组，丢非字符串与空白，去重且保序
  ---
  duration_ms: 13.756924
  type: 'test'
  ...
# Subtest: §2.1 咽喉把工具声明的目标传给授权查询（假后端观察 query）
ok 424 - §2.1 咽喉把工具声明的目标传给授权查询（假后端观察 query）
  ---
  duration_ms: 44.334003
  type: 'test'
  ...
# Subtest: §2.1 没声明 targets 的工具：查询里不带 targets（= 改造前的形状）
ok 425 - §2.1 没声明 targets 的工具：查询里不带 targets（= 改造前的形状）
  ---
  duration_ms: 11.234332
  type: 'test'
  ...
# Subtest: §2.1 多目标缺授权时，登记的那条审批理由里点名缺的目标
ok 426 - §2.1 多目标缺授权时，登记的那条审批理由里点名缺的目标
  ---
  duration_ms: 15.668244
  type: 'test'
  ...
# Subtest: panels survive restart and reject owner, thread, option, version and replay conflicts
ok 427 - panels survive restart and reject owner, thread, option, version and replay conflicts
  ---
  duration_ms: 28531.615813
  type: 'test'
  ...
# Subtest: new generation supersedes an old panel and prevents late inference publication
ok 428 - new generation supersedes an old panel and prevents late inference publication
  ---
  duration_ms: 19561.826746
  type: 'test'
  ...
# Subtest: refinement reuses all candidates and permits a new selection
ok 429 - refinement reuses all candidates and permits a new selection
  ---
  duration_ms: 10847.78524
  type: 'test'
  ...
# Subtest: aborted decision never publishes a panel
ok 430 - aborted decision never publishes a panel
  ---
  duration_ms: 8984.528712
  type: 'test'
  ...
# Subtest: failed and aborted decisions keep the prior panel, while an agent decision clears it
ok 431 - failed and aborted decisions keep the prior panel, while an agent decision clears it
  ---
  duration_ms: 12049.226458
  type: 'test'
  ...
# Subtest: stale refinement cannot reserve over a newer published panel
ok 432 - stale refinement cannot reserve over a newer published panel
  ---
  duration_ms: 8944.107959
  type: 'test'
  ...
# Subtest: refinement after a selection remains selectable as a new panel
ok 433 - refinement after a selection remains selectable as a new panel
  ---
  duration_ms: 8579.961656
  type: 'test'
  ...
# Subtest: candidate source lookup uses the full current set and rejects sample proof in live mode
ok 434 - candidate source lookup uses the full current set and rejects sample proof in live mode
  ---
  duration_ms: 22091.993778
  type: 'test'
  ...
# Subtest: evidence records are scoped to owner, thread, and run
ok 435 - evidence records are scoped to owner, thread, and run
  ---
  duration_ms: 28513.178624
  type: 'test'
  ...
# Subtest: a selection made during inference prevents the new panel from replacing it
ok 436 - a selection made during inference prevents the new panel from replacing it
  ---
  duration_ms: 22602.124901
  type: 'test'
  ...
# Subtest: refinement uses a selection that races before generation reservation
ok 437 - refinement uses a selection that races before generation reservation
  ---
  duration_ms: 14310.033801
  type: 'test'
  ...
# Subtest: mail evidence lookup uses direct run marker and web evidence stores bounded text
ok 438 - mail evidence lookup uses direct run marker and web evidence stores bounded text
  ---
  duration_ms: 9600.98808
  type: 'test'
  ...
# Subtest: an agent decision invalidates the older panel but a failed decision preserves it
ok 439 - an agent decision invalidates the older panel but a failed decision preserves it
  ---
  duration_ms: 14659.604263
  type: 'test'
  ...
# Subtest: ordinary-turn expiry rejects stale actions while preserving a concurrent selection
ok 440 - ordinary-turn expiry rejects stale actions while preserving a concurrent selection
  ---
  duration_ms: 19206.192003
  type: 'test'
  ...
# Subtest: panel validation rejects empty, duplicate and unsourced comparison options
ok 441 - panel validation rejects empty, duplicate and unsourced comparison options
  ---
  duration_ms: 63.422124
  type: 'test'
  ...
# Subtest: actions round trip and malformed prefixed actions reject
ok 442 - actions round trip and malformed prefixed actions reject
  ---
  duration_ms: 2.854322
  type: 'test'
  ...
# Subtest: ranking uses stable ties and rejects missing, unknown or nonfinite scores
ok 443 - ranking uses stable ties and rejects missing, unknown or nonfinite scores
  ---
  duration_ms: 0.827292
  type: 'test'
  ...
# Subtest: ranking compares rubric levels, not fractions between them
ok 444 - ranking compares rubric levels, not fractions between them
  ---
  duration_ms: 0.422797
  type: 'test'
  ...
# Subtest: live adapter sends the user's own message and references options by position
ok 445 - live adapter sends the user's own message and references options by position
  ---
  duration_ms: 53.175578
  type: 'test'
  ...
# Subtest: live adapter keeps the agent's control unless Jev is confident
ok 446 - live adapter keeps the agent's control unless Jev is confident
  ---
  duration_ms: 0.796105
  type: 'test'
  ...
# Subtest: live adapter rejects invalid controls and missing confidence
ok 447 - live adapter rejects invalid controls and missing confidence
  ---
  duration_ms: 93.430567
  type: 'test'
  ...
# Subtest: live adapter accepts continuous scores within its four-step rubric
ok 448 - live adapter accepts continuous scores within its four-step rubric
  ---
  duration_ms: 0.528239
  type: 'test'
  ...
# Subtest: live adapter rejects scores outside its four-step rubric
ok 449 - live adapter rejects scores outside its four-step rubric
  ---
  duration_ms: 4.761814
  type: 'test'
  ...
# Subtest: live adapter logs failures and only asks for a retry when one can help
ok 450 - live adapter logs failures and only asks for a retry when one can help
  ---
  duration_ms: 733.92266
  type: 'test'
  ...
# Subtest: preferred refinement option must be visible in the panel
ok 451 - preferred refinement option must be visible in the panel
  ---
  duration_ms: 29.901569
  type: 'test'
  ...
# Subtest: live adapter returns controlled error for malformed answers
ok 452 - live adapter returns controlled error for malformed answers
  ---
  duration_ms: 6.017875
  type: 'test'
  ...
# Subtest: real client sends the pinned model and key to the System One endpoint
ok 453 - real client sends the pinned model and key to the System One endpoint
  ---
  duration_ms: 207.377217
  type: 'test'
  ...
# Subtest: real client retries a server error once, then reports a retryable failure
ok 454 - real client retries a server error once, then reports a retryable failure
  ---
  duration_ms: 702.707592
  type: 'test'
  ...
# Subtest: real client does not retry an authentication failure
ok 455 - real client does not retry an authentication failure
  ---
  duration_ms: 13.59146
  type: 'test'
  ...
# Subtest: real client cancellation surfaces as the caller's abort
ok 456 - real client cancellation surfaces as the caller's abort
  ---
  duration_ms: 45.940271
  type: 'test'
  ...
# Subtest: 从正文里认出第一条链接，并剥掉尾部标点
ok 457 - 从正文里认出第一条链接，并剥掉尾部标点
  ---
  duration_ms: 1.932118
  type: 'test'
  ...
# Subtest: 主机名去掉 www.
ok 458 - 主机名去掉 www.
  ---
  duration_ms: 1.439736
  type: 'test'
  ...
# Subtest: 内网 / 本机地址一律拒绝（这个端点等于 SSRF 跳板）
ok 459 - 内网 / 本机地址一律拒绝（这个端点等于 SSRF 跳板）
  ---
  duration_ms: 2.93224
  type: 'test'
  ...
# Subtest: 从 HTML 抽标题与描述：og 优先，实体要还原，永不执行脚本
ok 460 - 从 HTML 抽标题与描述：og 优先，实体要还原，永不执行脚本
  ---
  duration_ms: 1.398229
  type: 'test'
  ...
# Subtest: 缺少 og 标签时退回 <title>，啥都没有就返回空
ok 461 - 缺少 og 标签时退回 <title>，啥都没有就返回空
  ---
  duration_ms: 2.117912
  type: 'test'
  ...
# Subtest: 工具调用翻译成人话，并带上最有信息量的参数
ok 462 - 工具调用翻译成人话，并带上最有信息量的参数
  ---
  duration_ms: 24528.251895
  type: 'test'
  ...
# Subtest: 活动按会话分开存，超时后不再显示（不会串到别的会话）
ok 463 - 活动按会话分开存，超时后不再显示（不会串到别的会话）
  ---
  duration_ms: 106.931858
  type: 'test'
  ...
# Subtest: withActivity 包住的工具照常执行，同时上报当前动作
ok 464 - withActivity 包住的工具照常执行，同时上报当前动作
  ---
  duration_ms: 7.838644
  type: 'test'
  ...
# Subtest: background failures retain safe error codes without logging messages
ok 465 - background failures retain safe error codes without logging messages
  ---
  duration_ms: 13.4989
  type: 'test'
  ...
# Subtest: background failures omit unsafe code strings
ok 466 - background failures omit unsafe code strings
  ---
  duration_ms: 0.838933
  type: 'test'
  ...
# Subtest: 常见 Markdown 语法都能转成 HTML
ok 467 - 常见 Markdown 语法都能转成 HTML
  ---
  duration_ms: 4.117403
  type: 'test'
  ...
# Subtest: 内容里的 HTML 必须是纯文本（导出前不让它变成可执行结构）
ok 468 - 内容里的 HTML 必须是纯文本（导出前不让它变成可执行结构）
  ---
  duration_ms: 0.525352
  type: 'test'
  ...
# Subtest: 行内代码里的星号不会被当成强调符号
ok 469 - 行内代码里的星号不会被当成强调符号
  ---
  duration_ms: 0.343749
  type: 'test'
  ...
# Subtest: 包出来的文档带标题与字符集（中文不乱码）
ok 470 - 包出来的文档带标题与字符集（中文不乱码）
  ---
  duration_ms: 0.354884
  type: 'test'
  ...
# Subtest: 文档带分享元数据，且元数据里同样转义（双引号不能逃出属性）
ok 471 - 文档带分享元数据，且元数据里同样转义（双引号不能逃出属性）
  ---
  duration_ms: 0.768374
  type: 'test'
  ...
# Subtest: tokenizeForCompare：英文词小写
ok 472 - tokenizeForCompare：英文词小写
  ---
  duration_ms: 6.058115
  type: 'test'
  ...
# Subtest: tokenizeForCompare：全角标点差异不影响
ok 473 - tokenizeForCompare：全角标点差异不影响
  ---
  duration_ms: 0.454264
  type: 'test'
  ...
# Subtest: tokenizeForCompare：数字字母大小写以外的差异要保留
ok 474 - tokenizeForCompare：数字字母大小写以外的差异要保留
  ---
  duration_ms: 1.001463
  type: 'test'
  ...
# Subtest: tokenizeForCompare：CJK 二元组（标点作分隔）
ok 475 - tokenizeForCompare：CJK 二元组（标点作分隔）
  ---
  duration_ms: 0.403348
  type: 'test'
  ...
# Subtest: tokenizeForCompare：单字汉字取自身
ok 476 - tokenizeForCompare：单字汉字取自身
  ---
  duration_ms: 0.225498
  type: 'test'
  ...
# Subtest: tokenizeForCompare：混合中英
ok 477 - tokenizeForCompare：混合中英
  ---
  duration_ms: 0.345894
  type: 'test'
  ...
# Subtest: tokenizeForCompare：空串返回空数组
ok 478 - tokenizeForCompare：空串返回空数组
  ---
  duration_ms: 0.488144
  type: 'test'
  ...
# Subtest: unknownWords：基础功能
ok 479 - unknownWords：基础功能
  ---
  duration_ms: 0.511787
  type: 'test'
  ...
# Subtest: unknownWords：去重
ok 480 - unknownWords：去重
  ---
  duration_ms: 0.509499
  type: 'test'
  ...
# Subtest: unknownWords：稳定顺序
ok 481 - unknownWords：稳定顺序
  ---
  duration_ms: 0.605977
  type: 'test'
  ...
# Subtest: unknownWords：CJK 二元组未在来源中出现
ok 482 - unknownWords：CJK 二元组未在来源中出现
  ---
  duration_ms: 0.943156
  type: 'test'
  ...
# Subtest: allowRewrite：默认不允许未知词
ok 483 - allowRewrite：默认不允许未知词
  ---
  duration_ms: 0.597159
  type: 'test'
  ...
# Subtest: allowRewrite：允许一定数量未知词
ok 484 - allowRewrite：允许一定数量未知词
  ---
  duration_ms: 0.194909
  type: 'test'
  ...
# Subtest: allowRewrite：空产物
ok 485 - allowRewrite：空产物
  ---
  duration_ms: 0.171473
  type: 'test'
  ...
# Subtest: planRemoval：20% 向下取整
ok 486 - planRemoval：20% 向下取整
  ---
  duration_ms: 0.200674
  type: 'test'
  ...
# Subtest: planRemoval：至少留 4
ok 487 - planRemoval：至少留 4
  ---
  duration_ms: 0.111552
  type: 'test'
  ...
# Subtest: planRemoval：两条上限取更严者
ok 488 - planRemoval：两条上限取更严者
  ---
  duration_ms: 0.164064
  type: 'test'
  ...
# Subtest: planRemoval：wouldDrop=0
ok 489 - planRemoval：wouldDrop=0
  ---
  duration_ms: 0.104965
  type: 'test'
  ...
# Subtest: isUserAuthored：机器沉淀不算用户手写
ok 490 - isUserAuthored：机器沉淀不算用户手写
  ---
  duration_ms: 0.150674
  type: 'test'
  ...
# Subtest: isUserAuthored：source 缺失算用户手写
ok 491 - isUserAuthored：source 缺失算用户手写
  ---
  duration_ms: 0.108556
  type: 'test'
  ...
# Subtest: isUserAuthored：REST 写入（source: You）算用户手写
ok 492 - isUserAuthored：REST 写入（source: You）算用户手写
  ---
  duration_ms: 1.121338
  type: 'test'
  ...
# Subtest: isUserAuthored：文本含 <!-- locked --> 算用户手写
ok 493 - isUserAuthored：文本含 <!-- locked --> 算用户手写
  ---
  duration_ms: 0.267879
  type: 'test'
  ...
# Subtest: protectedIds：正确挑出用户手写 id
ok 494 - protectedIds：正确挑出用户手写 id
  ---
  duration_ms: 0.218131
  type: 'test'
  ...
# Subtest: normalizeMemoryText 抹掉排版差异，但不吞掉内容
ok 495 - normalizeMemoryText 抹掉排版差异，但不吞掉内容
  ---
  duration_ms: 6.312204
  type: 'test'
  ...
# Subtest: planDedupe 把同一句话的不同写法归成一条，保留信息量最大的写法
ok 496 - planDedupe 把同一句话的不同写法归成一条，保留信息量最大的写法
  ---
  duration_ms: 3.37918
  type: 'test'
  ...
# Subtest: planDedupe 对空文本与独一份的记录不动手
ok 497 - planDedupe 对空文本与独一份的记录不动手
  ---
  duration_ms: 6.562479
  type: 'test'
  ...
# Subtest: dedupeOwnerMemories 归并后库里的条数真的减少，且温度/时间取并集
ok 498 - dedupeOwnerMemories 归并后库里的条数真的减少，且温度/时间取并集
  ---
  duration_ms: 37.562819
  type: 'test'
  ...
# Subtest: rememberMemory 写入近重复时归并而不是新增
ok 499 - rememberMemory 写入近重复时归并而不是新增
  ---
  duration_ms: 14.248188
  type: 'test'
  ...
# Subtest: rememberMemory 对新事实照常新增
ok 500 - rememberMemory 对新事实照常新增
  ---
  duration_ms: 11.304931
  type: 'test'
  ...
# Subtest: rememberMemory 遇到空文本不参与归并，直接写入
ok 501 - rememberMemory 遇到空文本不参与归并，直接写入
  ---
  duration_ms: 1.471562
  type: 'test'
  ...
# Subtest: §2.2 用户手写条目不会被自动整理删掉（keeper 是机器条目时）
ok 502 - §2.2 用户手写条目不会被自动整理删掉（keeper 是机器条目时）
  ---
  duration_ms: 16.066779
  type: 'test'
  ...
# Subtest: §2.2 两条都是用户手写时，同 key 照旧归并成一条（内容不丢，keeper 取更长者）
ok 503 - §2.2 两条都是用户手写时，同 key 照旧归并成一条（内容不丢，keeper 取更长者）
  ---
  duration_ms: 1.077754
  type: 'test'
  ...
# Subtest: §2.2 机器条目之间照旧归并（不许因为守卫而停止清理）
ok 504 - §2.2 机器条目之间照旧归并（不许因为守卫而停止清理）
  ---
  duration_ms: 0.405603
  type: 'test'
  ...
# Subtest: §2.2 删除上限：10 条同义机器记录最多删 20%（2 条），其余原样留下
ok 505 - §2.2 删除上限：10 条同义机器记录最多删 20%（2 条），其余原样留下
  ---
  duration_ms: 0.727743
  type: 'test'
  ...
# Subtest: §2.2 上限只对**较大集合**生效：5 条同义只删 1 条；小集合（≤4）照旧全归并
ok 506 - §2.2 上限只对**较大集合**生效：5 条同义只删 1 条；小集合（≤4）照旧全归并
  ---
  duration_ms: 1.898247
  type: 'test'
  ...
# Subtest: §2.2 小集合不受上限影响（既有回归锁的形态：2 条同义机器记录仍归并成 1 条）
ok 507 - §2.2 小集合不受上限影响（既有回归锁的形态：2 条同义机器记录仍归并成 1 条）
  ---
  duration_ms: 56.693518
  type: 'test'
  ...
# Subtest: §2.2 改写凭空造词 → 被拒，且原记录一个字都没动
ok 508 - §2.2 改写凭空造词 → 被拒，且原记录一个字都没动
  ---
  duration_ms: 18.577879
  type: 'test'
  ...
# Subtest: §2.2 用本轮用户消息里的新词改写 → 通过（用户改主意是正常路径）
ok 509 - §2.2 用本轮用户消息里的新词改写 → 通过（用户改主意是正常路径）
  ---
  duration_ms: 22.735026
  type: 'test'
  ...
# Subtest: §2.2 词表**不含助手回复**：模型复述自己说过的话也会被拒
ok 510 - §2.2 词表**不含助手回复**：模型复述自己说过的话也会被拒
  ---
  duration_ms: 40.618191
  type: 'test'
  ...
# Subtest: §2.3 归并落库时写一条 memory-log，字段完整（action/before/after/reason/at）
ok 511 - §2.3 归并落库时写一条 memory-log，字段完整（action/before/after/reason/at）
  ---
  duration_ms: 3.496934
  type: 'test'
  ...
# Subtest: §2.3 rollbackMemoryLog 把被删条目原样复活；重复回滚幂等（0/0）
ok 512 - §2.3 rollbackMemoryLog 把被删条目原样复活；重复回滚幂等（0/0）
  ---
  duration_ms: 4.566616
  type: 'test'
  ...
# Subtest: §2.3 沉淀新增的那条能按日志回滚删掉（before 空、after 只留 id）
ok 513 - §2.3 沉淀新增的那条能按日志回滚删掉（before 空、after 只留 id）
  ---
  duration_ms: 5.181831
  type: 'test'
  ...
# Subtest: §2.3 没给日志出口时完全不写日志（既不污染，也不报错）
ok 514 - §2.3 没给日志出口时完全不写日志（既不污染，也不报错）
  ---
  duration_ms: 3.269178
  type: 'test'
  ...
# Subtest: §2.2 rememberMemory 仍会把同义记录归并（并多回报 absorbedRecords 供写日志）
ok 515 - §2.2 rememberMemory 仍会把同义记录归并（并多回报 absorbedRecords 供写日志）
  ---
  duration_ms: 2.673369
  type: 'test'
  ...
# Subtest: memoryId 只由文本决定 —— 跨轮稳定（对话路径的 key 含每轮不同的 requestKey）
ok 516 - memoryId 只由文本决定 —— 跨轮稳定（对话路径的 key 含每轮不同的 requestKey）
  ---
  duration_ms: 7.498096
  type: 'test'
  ...
# Subtest: looksLikeSecret 拦住常见凭据形态，不误伤正常文本
ok 517 - looksLikeSecret 拦住常见凭据形态，不误伤正常文本
  ---
  duration_ms: 1.551005
  type: 'test'
  ...
# Subtest: parseSedimentPlan：裸 JSON / ```包裹 / 前后有解释 都能认出来
ok 518 - parseSedimentPlan：裸 JSON / ```包裹 / 前后有解释 都能认出来
  ---
  duration_ms: 11.662291
  type: 'test'
  ...
# Subtest: parseSedimentPlan：垃圾输入一律当没有内容，不抛异常
ok 519 - parseSedimentPlan：垃圾输入一律当没有内容，不抛异常
  ---
  duration_ms: 0.564392
  type: 'test'
  ...
# Subtest: parseSedimentPlan：凭据不进记忆、认不出的 id 不动、超量截断
ok 520 - parseSedimentPlan：凭据不进记忆、认不出的 id 不动、超量截断
  ---
  duration_ms: 1.002386
  type: 'test'
  ...
# Subtest: sedimentTurnMemories：短到像应答就不调模型，但『我改名叫白虎了』这种 7 字事实要放行
ok 521 - sedimentTurnMemories：短到像应答就不调模型，但『我改名叫白虎了』这种 7 字事实要放行
  ---
  duration_ms: 56.617602
  type: 'test'
  ...
# Subtest: sedimentTurnMemories：新增事实落库，来源标为自动沉淀、温度温热
ok 522 - sedimentTurnMemories：新增事实落库，来源标为自动沉淀、温度温热
  ---
  duration_ms: 5.819544
  type: 'test'
  ...
# Subtest: sedimentTurnMemories：新增与既有记忆近重复时归并而不是多出一条
ok 523 - sedimentTurnMemories：新增与既有记忆近重复时归并而不是多出一条
  ---
  duration_ms: 1.602764
  type: 'test'
  ...
# Subtest: sedimentTurnMemories：修正既有记忆，并记下修正前的原文
ok 524 - sedimentTurnMemories：修正既有记忆，并记下修正前的原文
  ---
  duration_ms: 23.474359
  type: 'test'
  ...
# Subtest: sedimentTurnMemories：修正后与另一条撞车时，靠收尾归并把重复收掉
ok 525 - sedimentTurnMemories：修正后与另一条撞车时，靠收尾归并把重复收掉
  ---
  duration_ms: 10.707406
  type: 'test'
  ...
# Subtest: sedimentTurnMemories：节流 —— 同一 owner 连续两次只跑一次
ok 526 - sedimentTurnMemories：节流 —— 同一 owner 连续两次只跑一次
  ---
  duration_ms: 1.118822
  type: 'test'
  ...
# Subtest: sedimentTurnMemories：模型/网关报错只当这轮没记，不抛异常
ok 527 - sedimentTurnMemories：模型/网关报错只当这轮没记，不抛异常
  ---
  duration_ms: 0.497438
  type: 'test'
  ...
# Subtest: parseSedimentPlan：模型给 {"fact": ...} 这种对象形态也能认（ministral 就这么干）
ok 528 - parseSedimentPlan：模型给 {"fact": ...} 这种对象形态也能认（ministral 就这么干）
  ---
  duration_ms: 3.267398
  type: 'test'
  ...
# Subtest: parseSedimentPlan：模型给 ```json 包裹 + 对象形态的组合（实测 ministral 的真实输出）
ok 529 - parseSedimentPlan：模型给 ```json 包裹 + 对象形态的组合（实测 ministral 的真实输出）
  ---
  duration_ms: 0.413528
  type: 'test'
  ...
# Subtest: buildSedimentPrompt：把既有记忆的短标识与整轮对话都带进提示词
ok 530 - buildSedimentPrompt：把既有记忆的短标识与整轮对话都带进提示词
  ---
  duration_ms: 0.346651
  type: 'test'
  ...
# Subtest: an unknown provider suggests the openai/ prefix only when a gateway is set
ok 531 - an unknown provider suggests the openai/ prefix only when a gateway is set
  ---
  duration_ms: 55.445174
  type: 'test'
  ...
# Subtest: the unknown provider hint reads OPENAI_BASE_URL by default
ok 532 - the unknown provider hint reads OPENAI_BASE_URL by default
  ---
  duration_ms: 0.957783
  type: 'test'
  ...
# Subtest: a transient provider failure is retried and the run completes
ok 533 - a transient provider failure is retried and the run completes
  ---
  duration_ms: 1509.547133
  type: 'test'
  ...
# Subtest: a non-retryable provider failure fails fast without a retry
ok 534 - a non-retryable provider failure fails fast without a retry
  ---
  duration_ms: 65.36623
  type: 'test'
  ...
# Subtest: retries give up after the configured attempts
ok 535 - retries give up after the configured attempts
  ---
  duration_ms: 1811.836758
  type: 'test'
  ...
# ❌ [tanstack-ai:errors] ❌ openai.processStreamChunks fatal
# {
#   error: { message: [32m'terminated'[39m, code: [90mundefined[39m },
#   source: [32m'openai.processStreamChunks'[39m
# }
# Subtest: a connection drop after the stream starts is not retried
ok 536 - a connection drop after the stream starts is not retried
  ---
  duration_ms: 223.777412
  type: 'test'
  ...
# Subtest: a provider error part after the stream starts is not retried
ok 537 - a provider error part after the stream starts is not retried
  ---
  duration_ms: 83.191954
  type: 'test'
  ...
# Subtest: a committed tool result is not re-executed when the next model call fails
ok 538 - a committed tool result is not re-executed when the next model call fails
  ---
  duration_ms: 847.444661
  type: 'test'
  ...
# ❌ [tanstack-ai:errors] ❌ openai.processStreamChunks fatal
# {
#   error: { message: [32m'terminated'[39m, code: [90mundefined[39m },
#   source: [32m'openai.processStreamChunks'[39m
# }
# Subtest: assistant output already delivered is never replayed by a retry
ok 539 - assistant output already delivered is never replayed by a retry
  ---
  duration_ms: 244.064793
  type: 'test'
  ...
# [audit] tool=run_computer_command owner=- thread=- risk=safe outcome=ok target=- egress=none egress_target=- summary=- (565ms)
# [tool] run_computer_command command=pwd cwd=/workspace operationId=check-working-directory → id,cwd,status,stderr,stdout,command,exitCode 271B (568ms)
# Subtest: CopilotKit model worker executes server tools and persists the confirmed outcome
ok 540 - CopilotKit model worker executes server tools and persists the confirmed outcome
  ---
  duration_ms: 39551.557736
  type: 'test'
  ...
# Subtest: the model worker keeps the text a model replies with when it calls no tool
ok 541 - the model worker keeps the text a model replies with when it calls no tool
  ---
  duration_ms: 24393.84159
  type: 'test'
  ...
# Subtest: replaying a completed prepared action returns its receipt without reopening approval
ok 542 - replaying a completed prepared action returns its receipt without reopening approval
  ---
  duration_ms: 17941.115951
  type: 'test'
  ...
# Subtest: browser reads keep observation identity distinct while reusing one session
ok 543 - browser reads keep observation identity distinct while reusing one session
  ---
  duration_ms: 9579.386791
  type: 'test'
  ...
# [http] POST /api/session → 200 5268ms（慢）
# [http] POST /api/agent/sample-page → 200 38ms
# [http] POST /api/agent/monitors → 201 300ms
# [http] GET /api/agent/notifications → 200 288ms
# [http] POST /api/agent/sample-page → 200 22ms
# [http] POST /api/agent/monitors/bbceccff-78fb-4d59-a8e1-043fb9002633/control → 200 64ms
# [http] POST /api/agent/monitors/bbceccff-78fb-4d59-a8e1-043fb9002633/control → 200 24ms
# [http] GET /api/agent/notifications → 200 14ms
# [http] POST /api/agent/sample-page → 200 39ms
# [http] POST /api/agent/monitors → 201 131ms
# [http] POST /api/agent/monitors/2bedd89b-b724-4ace-ac5c-e809bc620bd1/control → 200 67ms
# [http] POST /api/agent/monitors/2bedd89b-b724-4ace-ac5c-e809bc620bd1/control → 409 68ms
# [http] POST /api/agent/sample-page → 200 93ms
# [http] POST /api/agent/monitors → 201 205ms
# [http] GET /api/agent/notifications → 200 14ms
# [http] POST /api/agent/monitors/0e523e4f-532e-4a63-89b7-1e11eaf4a244/control → 200 101ms
# [http] POST /api/agent/sample-page → 200 229ms
# [http] POST /api/agent/monitors → 201 195ms
# [http] POST /api/agent/monitors/1d18a926-27a6-4a13-8f9d-968e30843c20/control → 200 266ms
# [http] POST /api/agent/sample-page → 200 18ms
# [http] POST /api/agent/monitors → 201 446ms
# [http] POST /api/agent/monitors/16b5c10c-5aad-48c8-b25d-a564b2e24dd2/control → 200 249ms
# [http] POST /api/agent/sample-page → 200 33ms
# [http] POST /api/agent/monitors → 201 1138ms
# [http] POST /api/agent/monitors/040fb0c4-9cf3-4f26-b180-08c87e96befa/control → 200 111ms
# [http] POST /api/agent/sample-page → 200 4ms
# [http] POST /api/agent/monitors → 201 103ms
# [http] POST /api/agent/monitors/9f914bbe-514c-4e7b-ab3b-64d8f78ed848/control → 200 170ms
# [http] POST /api/agent/monitors/9f914bbe-514c-4e7b-ab3b-64d8f78ed848/control → 200 404ms
# [http] POST /api/agent/sample-page → 200 9ms
# [http] POST /api/agent/monitors → 201 168ms
# [http] POST /api/agent/monitors/aafba51b-9deb-4b5d-97b3-8db9aa241e21/control → 200 1025ms
# [http] POST /api/agent/monitors/aafba51b-9deb-4b5d-97b3-8db9aa241e21/control → 200 156ms
# [http] POST /api/agent/monitors/aafba51b-9deb-4b5d-97b3-8db9aa241e21/control → 200 883ms
# [http] POST /api/agent/sample-page → 200 97ms
# [http] POST /api/agent/monitors → 201 221ms
# [http] POST /api/agent/tasks/9836f79049c6075eac676e0989c5cc3ccb0a49d7ba7bf2c7ae5f0de43af4d428/control → 200 15ms
# [http] POST /api/agent/tasks/9836f79049c6075eac676e0989c5cc3ccb0a49d7ba7bf2c7ae5f0de43af4d428/control → 200 116ms
# [http] POST /api/agent/sample-page → 200 6ms
# [http] POST /api/agent/monitors → 201 70ms
# [http] POST /api/agent/tasks/1753a71ad4a8a394052f2b6c332b0fa033b905094be480f767e99799724b72f8/control → 200 9ms
# [http] POST /api/agent/tasks/1753a71ad4a8a394052f2b6c332b0fa033b905094be480f767e99799724b72f8/control → 200 10ms
# [http] POST /api/agent/sample-page → 200 12ms
# [http] POST /api/agent/monitors → 201 165ms
# [http] POST /api/agent/monitors/886222c4-0425-4736-affe-76fc7ceb052f/control → 200 231ms
# [http] POST /api/agent/monitors/886222c4-0425-4736-affe-76fc7ceb052f/control → 200 164ms
# [http] POST /api/agent/monitors/886222c4-0425-4736-affe-76fc7ceb052f/control → 409 201ms
# [http] POST /api/agent/sample-page → 200 15ms
# [http] POST /api/agent/monitors → 201 166ms
# [http] POST /api/agent/tasks/ed688e7b6ca699ce8d11d35ccdc0d3f5b3bb361e7d43168da6b8ac6b92c7e058/control → 200 176ms
# [http] POST /api/agent/sample-page → 200 23ms
# [http] POST /api/agent/monitors → 201 391ms
# [http] POST /api/agent/monitors/159d0695-409f-4da9-aa45-78f94ebc3e5e/control → 200 281ms
# [http] POST /api/agent/monitors/159d0695-409f-4da9-aa45-78f94ebc3e5e/control → 409 371ms
# [http] POST /api/agent/sample-page → 200 52ms
# [http] POST /api/agent/monitors → 201 92ms
# [http] POST /api/agent/monitors/c83300d8-5976-444f-9649-3139d6641638/control → 409 38ms
# [http] POST /api/agent/tasks/b02d214e3d5a1f91e4f6b730afbd1131e6b16301ad5d34cee0668ff7e926aebc/control → 200 167ms
# [http] POST /api/agent/sample-page → 200 14ms
# [http] POST /api/agent/monitors → 201 101ms
# [http] POST /api/agent/sample-page → 200 16ms
# [http] POST /api/agent/monitors/7fd10735-5834-46ce-bd16-6d9450d34757/control → 200 730ms
# Subtest: a page change stays alertable when the task outcome is lost after the baseline moves
ok 544 - a page change stays alertable when the task outcome is lost after the baseline moves
  ---
  duration_ms: 42748.73562
  type: 'test'
  ...
# Subtest: resuming a monitor fails without activating it when the task transition does not commit
ok 545 - resuming a monitor fails without activating it when the task transition does not commit
  ---
  duration_ms: 468.763678
  type: 'test'
  ...
# Subtest: the paused alert is delivered when the final failure outcome is lost
ok 546 - the paused alert is delivered when the final failure outcome is lost
  ---
  duration_ms: 4676.632945
  type: 'test'
  ...
# Subtest: maintenance finishes a resume that stopped after the monitor was activated
ok 547 - maintenance finishes a resume that stopped after the monitor was activated
  ---
  duration_ms: 2438.173721
  type: 'test'
  ...
# Subtest: checking a watch retries once when its run finishes during the request
ok 548 - checking a watch retries once when its run finishes during the request
  ---
  duration_ms: 1021.811995
  type: 'test'
  ...
# Subtest: a resume during outcome publication is not paused again by the failure reconcile
ok 549 - a resume during outcome publication is not paused again by the failure reconcile
  ---
  duration_ms: 1978.506598
  type: 'test'
  ...
# Subtest: a resume finished by maintenance during the request still succeeds
ok 550 - a resume finished by maintenance during the request still succeeds
  ---
  duration_ms: 1072.083089
  type: 'test'
  ...
# Subtest: two overlapping resume requests both leave the watch active
ok 551 - two overlapping resume requests both leave the watch active
  ---
  duration_ms: 3945.142419
  type: 'test'
  ...
# Subtest: a leftover resume marker does not keep a failing watch running
ok 552 - a leftover resume marker does not keep a failing watch running
  ---
  duration_ms: 1588.555718
  type: 'test'
  ...
# Subtest: a leftover resume marker does not undo a later task pause
ok 553 - a leftover resume marker does not undo a later task pause
  ---
  duration_ms: 786.982626
  type: 'test'
  ...
# Subtest: a stop during a resume keeps the watch stopped
ok 554 - a stop during a resume keeps the watch stopped
  ---
  duration_ms: 1107.799327
  type: 'test'
  ...
# Subtest: a resume from the task screen is not paused again by a stale failure reconcile
ok 555 - a resume from the task screen is not paused again by a stale failure reconcile
  ---
  duration_ms: 2111.462419
  type: 'test'
  ...
# Subtest: a stop during a check keeps the watch stopped
ok 556 - a stop during a check keeps the watch stopped
  ---
  duration_ms: 1388.025833
  type: 'test'
  ...
# Subtest: a check does not revive a task cancelled from the task screen
ok 557 - a check does not revive a task cancelled from the task screen
  ---
  duration_ms: 562.631788
  type: 'test'
  ...
# Subtest: a check keeps the baseline from a run that finishes during the request
ok 558 - a check keeps the baseline from a run that finishes during the request
  ---
  duration_ms: 1051.81378
  type: 'test'
  ...
# Subtest: old refresh cannot overwrite a newly connected Google account
ok 559 - old refresh cannot overwrite a newly connected Google account
  ---
  duration_ms: 16301.358318
  type: 'test'
  ...
# Subtest: OAuth callbacks require a known, single-use state
ok 560 - OAuth callbacks require a known, single-use state
  ---
  duration_ms: 14657.214566
  type: 'test'
  ...
# Subtest: disconnect invalidates an OAuth callback suspended during token
ok 561 - disconnect invalidates an OAuth callback suspended during token
  ---
  duration_ms: 13595.081403
  type: 'test'
  ...
# Subtest: disconnect invalidates an OAuth callback suspended during profile
ok 562 - disconnect invalidates an OAuth callback suspended during profile
  ---
  duration_ms: 8558.502614
  type: 'test'
  ...
# Subtest: disconnect invalidates pending OAuth state before a callback contacts Google
ok 563 - disconnect invalidates pending OAuth state before a callback contacts Google
  ---
  duration_ms: 7968.651868
  type: 'test'
  ...
# Subtest: a newer connect attempt invalidates an older callback already exchanging its code
ok 564 - a newer connect attempt invalidates an older callback already exchanging its code
  ---
  duration_ms: 4984.093559
  type: 'test'
  ...
# Subtest: an in-flight refresh cannot restore credentials after disconnect
ok 565 - an in-flight refresh cannot restore credentials after disconnect
  ---
  duration_ms: 5990.710304
  type: 'test'
  ...
# Subtest: OpenBot is disabled by default and cannot call a supplied transport
ok 566 - OpenBot is disabled by default and cannot call a supplied transport
  ---
  duration_ms: 5.390988
  type: 'test'
  ...
# Subtest: enabled configuration requires an authenticated transport and an agent for runtime
ok 567 - enabled configuration requires an authenticated transport and an agent for runtime
  ---
  duration_ms: 0.732384
  type: 'test'
  ...
# Subtest: runtime is an Intelligence descriptor and reports unsupported capabilities without a connection claim
ok 568 - runtime is an Intelligence descriptor and reports unsupported capabilities without a connection claim
  ---
  duration_ms: 0.576046
  type: 'test'
  ...
# Subtest: probe verifies user identity before reporting authenticated Intelligence capabilities
ok 569 - probe verifies user identity before reporting authenticated Intelligence capabilities
  ---
  duration_ms: 417.980336
  type: 'test'
  ...
# Subtest: probe does not treat anonymous runtime discovery as authentication
ok 570 - probe does not treat anonymous runtime discovery as authentication
  ---
  duration_ms: 45.755257
  type: 'test'
  ...
# Subtest: probe rejects incompatible capability responses and exposes transport failure
ok 571 - probe rejects incompatible capability responses and exposes transport failure
  ---
  duration_ms: 2.983479
  type: 'test'
  ...
# Subtest: channel creation preserves separate channel, thread and agent identities
ok 572 - channel creation preserves separate channel, thread and agent identities
  ---
  duration_ms: 4.414736
  type: 'test'
  ...
# Subtest: computer status uses a Bot ID and rejects unknown lifecycle states or mismatched identity
ok 573 - computer status uses a Bot ID and rejects unknown lifecycle states or mismatched identity
  ---
  duration_ms: 25.438022
  type: 'test'
  ...
# Subtest: snapshot is a read that retains server-owned references
ok 574 - snapshot is a read that retains server-owned references
  ---
  duration_ms: 6.006445
  type: 'test'
  ...
# Subtest: navigation uses the policy gateway, preserves cancellation and never creates a direct computer URL
ok 575 - navigation uses the policy gateway, preserves cancellation and never creates a direct computer URL
  ---
  duration_ms: 7.025488
  type: 'test'
  ...
# Subtest: human control reads and transitions use the exact audited gateway routes
ok 576 - human control reads and transitions use the exact audited gateway routes
  ---
  duration_ms: 4.246824
  type: 'test'
  ...
# Subtest: policy refusals preserve status and rule and are never retried
ok 577 - policy refusals preserve status and rule and are never retried
  ---
  duration_ms: 1.089001
  type: 'test'
  ...
# Subtest: uncertain mutations require reconciliation after transport, server or invalid-response failure
ok 578 - uncertain mutations require reconciliation after transport, server or invalid-response failure
  ---
  duration_ms: 2.220979
  type: 'test'
  ...
# Subtest: sample is an actual two-page PDF with blank fillable fields
ok 579 - sample is an actual two-page PDF with blank fillable fields
  ---
  duration_ms: 948.495291
  type: 'test'
  ...
# Subtest: filling changes only the new PDF and round-trips text and checkbox values
ok 580 - filling changes only the new PDF and round-trips text and checkbox values
  ---
  duration_ms: 392.804233
  type: 'test'
  ...
# Subtest: PDF operations reject invalid bytes, encrypted input, unknown names, and wrong field types
ok 581 - PDF operations reject invalid bytes, encrypted input, unknown names, and wrong field types
  ---
  duration_ms: 286.013937
  type: 'test'
  ...
# Subtest: unsupported fields are disclosed and cannot be silently filled
ok 582 - unsupported fields are disclosed and cannot be silently filled
  ---
  duration_ms: 86.615246
  type: 'test'
  ...
# Subtest: PDF output removes active actions before returning a filled document
ok 583 - PDF output removes active actions before returning a filled document
  ---
  duration_ms: 230.8956
  type: 'test'
  ...
# Subtest: XFA forms fail explicitly instead of silently losing their fields
ok 584 - XFA forms fail explicitly instead of silently losing their fields
  ---
  duration_ms: 164.289408
  type: 'test'
  ...
# Subtest: PDF failures expose safe typed 422 errors including malformed field and font errors
ok 585 - PDF failures expose safe typed 422 errors including malformed field and font errors
  ---
  duration_ms: 320.553232
  type: 'test'
  ...
# Subtest: fresh nested data directory starts and survives a database restart
ok 586 - fresh nested data directory starts and survives a database restart
  ---
  duration_ms: 27116.700993
  type: 'test'
  ...
# Subtest: idle Postgres client errors are logged instead of crashing the process
ok 587 - idle Postgres client errors are logged instead of crashing the process
  ---
  duration_ms: 81.72965
  type: 'test'
  ...
# Subtest: parseUpstream：只认 socks5://，拒绝 socks5h（上游做 DNS 会在 WARP 下卡死）
ok 588 - parseUpstream：只认 socks5://，拒绝 socks5h（上游做 DNS 会在 WARP 下卡死）
  ---
  duration_ms: 5.86748
  type: 'test'
  ...
# Subtest: socksTunnel：用户名密码握手成功后双向透传
ok 589 - socksTunnel：用户名密码握手成功后双向透传
  ---
  duration_ms: 94.38395
  type: 'test'
  ...
# Subtest: socksTunnel：无认证上游也能用（覆盖 greeting 与 CONNECT 合并到一个包的情况）
ok 590 - socksTunnel：无认证上游也能用（覆盖 greeting 与 CONNECT 合并到一个包的情况）
  ---
  duration_ms: 10.09952
  type: 'test'
  ...
# Subtest: socksTunnel：认证被拒时抛错，不留下半个隧道
ok 591 - socksTunnel：认证被拒时抛错，不留下半个隧道
  ---
  duration_ms: 10.228398
  type: 'test'
  ...
# [http] POST /api/session → 200 2478ms
# [http] POST /api/files → 201 512ms
# [http] POST /api/files/b8460f95-a9c6-4fc6-88ec-cd1847714dbd/publish → 200 96ms
# [http] GET /p/MhpW8Wa8d2C4uaKYZc-qcoenkNnym5GS → 200 168ms
# [http] GET /p/MhpW8Wa8d2C4uaKYZc-qcoenkNnym5GS/raw → 200 50ms
# Subtest: 发布：拿到一条公开链接，文件载荷里有 published 但没有 token
ok 592 - 发布：拿到一条公开链接，文件载荷里有 published 但没有 token
  ---
  duration_ms: 29439.262024
  type: 'test'
  ...
# [http] POST /api/files → 201 203ms
# [http] POST /api/files/14dbc6de-07de-40e0-ae2a-20719100d33e/publish → 200 179ms
# [http] POST /api/files/14dbc6de-07de-40e0-ae2a-20719100d33e/publish → 200 88ms
# Subtest: 重复发布返回同一条链接（幂等），不会把已经分享出去的链接弄丢
ok 593 - 重复发布返回同一条链接（幂等），不会把已经分享出去的链接弄丢
  ---
  duration_ms: 530.473594
  type: 'test'
  ...
# [http] POST /api/files → 201 374ms
# [http] POST /api/files/7191407b-5687-4ddc-a2fd-bb8a21960d1a/publish → 200 76ms
# [http] GET /p/r9EL0P4TPHWh_ZQmqatu0JT0waQk6-b6 → 200 187ms
# [http] DELETE /api/files/7191407b-5687-4ddc-a2fd-bb8a21960d1a/publish → 200 25ms
# [http] GET /p/r9EL0P4TPHWh_ZQmqatu0JT0waQk6-b6 → 404 4ms
# [http] POST /api/files/7191407b-5687-4ddc-a2fd-bb8a21960d1a/publish → 200 300ms
# [http] GET /p/r9EL0P4TPHWh_ZQmqatu0JT0waQk6-b6 → 404 2ms
# [http] GET /p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa → 404 2ms
# [http] GET /p/short → 404 0ms
# [http] POST /p/short → 404 0ms
# Subtest: 停止发布：同一个 token 立刻 404（真撤销，不是标记失效）
ok 594 - 停止发布：同一个 token 立刻 404（真撤销，不是标记失效）
  ---
  duration_ms: 1106.7052
  type: 'test'
  ...
# Subtest: 乱猜或过短的 token 一律 404；公开入口不可写
ok 595 - 乱猜或过短的 token 一律 404；公开入口不可写
  ---
  duration_ms: 26.501371
  type: 'test'
  ...
# [http] POST /api/files → 201 27ms
# [http] POST /api/files/f38602b0-3904-456a-a191-902fe2fdf8f6/publish → 200 61ms
# [http] GET /api/workspace → 200 143ms
# Subtest: 列表只暴露 published 布尔，不带 token
ok 596 - 列表只暴露 published 布尔，不带 token
  ---
  duration_ms: 292.866228
  type: 'test'
  ...
# [http] POST /api/files → 201 139ms
# [http] POST /api/files/1dba603e-1bdf-4007-b0d7-1104d5fa92d6/publish → 200 107ms
# [http] GET /p/uZM4MYOwcq2T6vZj9jaS3JI8pGCta28K → 200 10ms
# [http] GET /p/uZM4MYOwcq2T6vZj9jaS3JI8pGCta28K/raw → 200 136ms
# Subtest: 发布 Markdown：/p/ 渲染成网页，/p/raw 仍给原文
ok 597 - 发布 Markdown：/p/ 渲染成网页，/p/raw 仍给原文
  ---
  duration_ms: 400.58417
  type: 'test'
  ...
# [http] POST /api/files → 201 93ms
# [http] POST /api/files/1dccc53d-50d7-4dc2-b2d1-7251964bf90e/publish → 200 73ms
# [http] GET /p/nx2etMFGO5zNZ5anG9NSSGOXJPLsHsBF → 200 103ms
# Subtest: 发布图片：/p/ 直接给字节（不是网页）
ok 598 - 发布图片：/p/ 直接给字节（不是网页）
  ---
  duration_ms: 365.228207
  type: 'test'
  ...
# [http] POST /api/files → 201 23ms
# [http] POST /api/files/ec3dc224-a303-4f68-b6e5-93bd720db2c4/export → 201 82ms
# [http] GET /api/files/149e4d62-86b5-4da8-af9d-42bdad75cf30/content → 200 19ms
# Subtest: 导出 HTML：不依赖浏览器 worker，直接产出可打开的网页文件
ok 599 - 导出 HTML：不依赖浏览器 worker，直接产出可打开的网页文件
  ---
  duration_ms: 133.994306
  type: 'test'
  ...
# [http] POST /api/files → 201 51ms
# [http] POST /api/files/0c614d04-8dc0-4f1a-8459-4b0a5c831022/publish → 200 29ms
# [http] GET /p/uLmQSJPHC77le-qBH7YbQWNB62rqIzZ3 → 200 81ms
# [http] POST /api/files/0c614d04-8dc0-4f1a-8459-4b0a5c831022/publish → 200 63ms
# [http] GET /p/uLmQSJPHC77le-qBH7YbQWNB62rqIzZ3 → 200 27ms
# [http] POST /api/files/0c614d04-8dc0-4f1a-8459-4b0a5c831022/publish → 200 63ms
# [http] GET /p/uLmQSJPHC77le-qBH7YbQWNB62rqIzZ3 → 200 11ms
# Subtest: 发布页自定义：标题与描述按设定走（重发一次就是更新）
ok 600 - 发布页自定义：标题与描述按设定走（重发一次就是更新）
  ---
  duration_ms: 365.556528
  type: 'test'
  ...
# [http] POST /api/files → 201 87ms
# [http] POST /api/files → 201 66ms
# [http] POST /api/files/4aed398f-4d3a-4c65-99cb-fc59dffda971/publish → 200 49ms
# [http] GET /p/6TwUlN0-NHOdv9d9iVfLgxlAKm3wdesU → 200 91ms
# [http] GET /p/6TwUlN0-NHOdv9d9iVfLgxlAKm3wdesU/cover → 200 96ms
# [http] POST /api/files → 201 12ms
# [http] POST /api/files/4aed398f-4d3a-4c65-99cb-fc59dffda971/publish → 400 15ms
# [http] POST /api/files/4aed398f-4d3a-4c65-99cb-fc59dffda971/publish → 200 19ms
# [http] GET /p/6TwUlN0-NHOdv9d9iVfLgxlAKm3wdesU → 200 59ms
# [http] GET /p/6TwUlN0-NHOdv9d9iVfLgxlAKm3wdesU/cover → 404 3ms
# Subtest: 发布页封面：只能用图片，且封面地址也受 token 保护
ok 601 - 发布页封面：只能用图片，且封面地址也受 token 保护
  ---
  duration_ms: 604.307911
  type: 'test'
  ...
# [http] POST /api/files → 201 11ms
# [http] POST /api/files/fe869828-9fce-4ee7-93b1-e8505fea545a/publish → 200 8ms
# [http] GET /p/tVc59d-tk7HoZQBCneOU_Snk47YuIHMC/cover → 404 2ms
# [http] GET /p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cover → 404 2ms
# Subtest: 没有封面时 /cover 是 404，不泄漏任何东西
ok 602 - 没有封面时 /cover 是 404，不泄漏任何东西
  ---
  duration_ms: 29.609659
  type: 'test'
  ...
# [http] POST /api/session → 200 2924ms
# [http] GET /api/main-thread → 200 91ms
# [http] GET /api/main-thread → 200 89ms
# [http] GET /api/main-thread → 502 67ms
# [http] GET /api/copilotkit/threads → 401 11ms
# [http] GET /api/copilotkit/threads → 200 72ms
# Subtest: main chat is provisioned for the authenticated owner before the first run
# [http] PATCH /api/copilotkit/threads/thread-1 → 200 22ms
ok 603 - main chat is provisioned for the authenticated owner before the first run
  ---
  duration_ms: 31631.48756
  type: 'test'
  ...
# [http] POST /api/copilotkit/threads/thread-1/archive → 200 86ms
# [http] GET /api/copilotkit/threads/thread-1/messages → 200 7ms
# {
#   err: Error: Platform unavailable
#       at CopilotKitIntelligence.<anonymous> (/root/work/openmuse-local/tests/rich-threads.test.ts:187:11)
#       at Object.apply (node:internal/test_runner/mock/mock:765:20)
#       at handleListThreads (/root/work/openmuse-local/node_modules/.pnpm/@copilotkit+runtime@1.70.1_@anthropic-ai+sdk@0.97.1_zod@4.6.5__@cfworker+json-schema@4._109c03b485543a26404f2509b2b156d3/node_modules/@copilotkit/runtime/src/v2/runtime/handlers/intelligence/threads.ts:93:47)
#       at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
#       at async handler (/root/work/openmuse-local/node_modules/.pnpm/@copilotkit+runtime@1.70.1_@anthropic-ai+sdk@0.97.1_zod@4.6.5__@cfworker+json-schema@4._109c03b485543a26404f2509b2b156d3/node_modules/@copilotkit/runtime/src/v2/runtime/core/fetch-handler.ts:456:20)
#       at async copilotRuntimeHandler (/root/work/openmuse-local/apps/server/src/app.ts:951:22)
#       at async dispatch (file:///root/work/openmuse-local/node_modules/.pnpm/hono@4.13.7/node_modules/hono/dist/compose.js:22:17)
#       at async ownerFromSession (/root/work/openmuse-local/apps/server/src/app.ts:259:5)
#       at async dispatch (file:///root/work/openmuse-local/node_modules/.pnpm/hono@4.13.7/node_modules/hono/dist/compose.js:22:17)
#       at async <anonymous> (/root/work/openmuse-local/apps/server/src/app.ts:142:5)
# } Error listing threads
# [http] GET /api/copilotkit/threads → 500 55ms
# [http] GET /api/workspace → 200 126ms
# Subtest: a failed main-thread connection remains an error and does not create another id
ok 604 - a failed main-thread connection remains an error and does not create another id
  ---
  duration_ms: 106.54907
  type: 'test'
  ...
# Subtest: Rich Threads lists through CopilotKit, scopes by authenticated owner and preserves pagination
ok 605 - Rich Threads lists through CopilotKit, scopes by authenticated owner and preserves pagination
  ---
  duration_ms: 129.125003
  type: 'test'
  ...
# Subtest: native and web thread rename reaches the SDK without accepting a forged owner
ok 606 - native and web thread rename reaches the SDK without accepting a forged owner
  ---
  duration_ms: 103.696338
  type: 'test'
  ...
# Subtest: archive is authenticated and routed to CopilotKit
ok 607 - archive is authenticated and routed to CopilotKit
  ---
  duration_ms: 92.660919
  type: 'test'
  ...
# Subtest: history retains rich tool messages and provider failures remain errors
ok 608 - history retains rich tool messages and provider failures remain errors
  ---
  duration_ms: 65.817001
  type: 'test'
  ...
# Subtest: workspace reports Rich Threads configuration without disclosing the project key
ok 609 - workspace reports Rich Threads configuration without disclosing the project key
  ---
  duration_ms: 131.711439
  type: 'test'
  ...
# Subtest: 沙箱里跑得起来，只有 /workspace 可写、系统目录只读
ok 610 - 沙箱里跑得起来，只有 /workspace 可写、系统目录只读
  ---
  duration_ms: 1038.16587
  type: 'test'
  ...
# Subtest: 硬指标 1：默认无网络（只有 loopback）
ok 611 - 硬指标 1：默认无网络（只有 loopback）
  ---
  duration_ms: 1117.342731
  type: 'test'
  ...
# Subtest: 硬指标 2：读不到宿主机 .env，也继承不到服务端环境变量
ok 612 - 硬指标 2：读不到宿主机 .env，也继承不到服务端环境变量
  ---
  duration_ms: 1743.424237
  type: 'test'
  ...
# Subtest: 硬指标 3：destroy 之后目录不存在（任务结束即重置，且幂等）
ok 613 - 硬指标 3：destroy 之后目录不存在（任务结束即重置，且幂等）
  ---
  duration_ms: 237.904445
  type: 'test'
  ...
# Subtest: 仓库以只读方式挂入：能读、改不了
ok 614 - 仓库以只读方式挂入：能读、改不了
  ---
  duration_ms: 1343.529737
  type: 'test'
  ...
# Subtest: 任务终态钩子用的 destroySandbox：按目录名删、幂等
ok 615 - 任务终态钩子用的 destroySandbox：按目录名删、幂等
  ---
  duration_ms: 13.720283
  type: 'test'
  ...
# [http] POST /api/session → 200 2199ms
# [http] GET /api/workspace → 200 162ms
# [http] GET /api/files/0fd7b028-957e-45cb-b69f-b1472d3d0757/content → 200 35ms
# Subtest: markdown 文本能存成文件，并出现在工作区文件列表里
ok 616 - markdown 文本能存成文件，并出现在工作区文件列表里
  ---
  duration_ms: 15703.06203
  type: 'test'
  ...
# Subtest: 没写扩展名时默认 .md；同名内容重复调用只产生一个文件（幂等）
ok 617 - 没写扩展名时默认 .md；同名内容重复调用只产生一个文件（幂等）
  ---
  duration_ms: 69.819909
  type: 'test'
  ...
# Subtest: html helpers decode entities and strip markup
ok 618 - html helpers decode entities and strip markup
  ---
  duration_ms: 25.380086
  type: 'test'
  ...
# Subtest: redirect links resolve to their real target
ok 619 - redirect links resolve to their real target
  ---
  duration_ms: 3.945069
  type: 'test'
  ...
# Subtest: bing results parse into titles, real urls and snippets
ok 620 - bing results parse into titles, real urls and snippets
  ---
  duration_ms: 3.556259
  type: 'test'
  ...
# Subtest: brave results parse from the real markup
ok 621 - brave results parse from the real markup
  ---
  duration_ms: 1.677075
  type: 'test'
  ...
# Subtest: duckduckgo results decode the uddg redirect
ok 622 - duckduckgo results decode the uddg redirect
  ---
  duration_ms: 1.590602
  type: 'test'
  ...
# Subtest: an unfamiliar serp layout still yields same-site results
ok 623 - an unfamiliar serp layout still yields same-site results
  ---
  duration_ms: 2.227062
  type: 'test'
  ...
# Subtest: article text keeps the body and drops chrome and scripts
ok 624 - article text keeps the body and drops chrome and scripts
  ---
  duration_ms: 2.511375
  type: 'test'
  ...
# Subtest: a decoy serp scores as irrelevant while real results score high
ok 625 - a decoy serp scores as irrelevant while real results score high
  ---
  duration_ms: 32.868327
  type: 'test'
  ...
# Subtest: search uses the http backend and returns structured results
ok 626 - search uses the http backend and returns structured results
  ---
  duration_ms: 134.708663
  type: 'test'
  ...
# Subtest: search with read returns pages and isolates a failing url
ok 627 - search with read returns pages and isolates a failing url
  ---
  duration_ms: 8.380909
  type: 'test'
  ...
# Subtest: a configured api key is used before scraping
ok 628 - a configured api key is used before scraping
  ---
  duration_ms: 66.665524
  type: 'test'
  ...
# Subtest: firecrawl search results parse from the documented shape
ok 629 - firecrawl search results parse from the documented shape
  ---
  duration_ms: 8.702791
  type: 'test'
  ...
# Subtest: a banned key rotates to the next one and never leaks the secret
ok 630 - a banned key rotates to the next one and never leaks the secret
  ---
  duration_ms: 32.839429
  type: 'test'
  ...
# Subtest: a pool of dead keys fails fast after the first attempt
ok 631 - a pool of dead keys fails fast after the first attempt
  ---
  duration_ms: 8.291102
  type: 'test'
  ...
# Subtest: a huge key pool only spends a few attempts per search
ok 632 - a huge key pool only spends a few attempts per search
  ---
  duration_ms: 48.658015
  type: 'test'
  ...
# Subtest: a working key is remembered and used first next time
ok 633 - a working key is remembered and used first next time
  ---
  duration_ms: 106.91605
  type: 'test'
  ...
# Subtest: a configured searxng instance is used and bad rows are dropped
ok 634 - a configured searxng instance is used and bad rows are dropped
  ---
  duration_ms: 22.398157
  type: 'test'
  ...
# Subtest: decoys are rejected instead of answered, and the error explains why
ok 635 - decoys are rejected instead of answered, and the error explains why
  ---
  duration_ms: 4.604814
  type: 'test'
  ...
# Subtest: when every backend fails the error names the fix
ok 636 - when every backend fails the error names the fix
  ---
  duration_ms: 5.542742
  type: 'test'
  ...
# Subtest: 反爬/验证页识别：拦下真实出现过的拦截页，不误伤正文
ok 637 - 反爬/验证页识别：拦下真实出现过的拦截页，不误伤正文
  ---
  duration_ms: 2.698697
  type: 'test'
  ...
# Subtest: 自动生成的密码够长、四类字符齐全、且没有易混字符
ok 638 - 自动生成的密码够长、四类字符齐全、且没有易混字符
  ---
  duration_ms: 2.974105
  type: 'test'
  ...
# Subtest: 每次生成的密码都不一样（不是固定串）
ok 639 - 每次生成的密码都不一样（不是固定串）
  ---
  duration_ms: 14.462358
  type: 'test'
  ...
# Subtest: 长度被夹在 12..64，越界输入不会崩
ok 640 - 长度被夹在 12..64，越界输入不会崩
  ---
  duration_ms: 0.401068
  type: 'test'
  ...
# Subtest: create 落库后能用站点名/登录名/id 找回，且 list 只给脱敏视图
ok 641 - create 落库后能用站点名/登录名/id 找回，且 list 只给脱敏视图
  ---
  duration_ms: 2.730527
  type: 'test'
  ...
# Subtest: forget 真的删掉了记录
ok 642 - forget 真的删掉了记录
  ---
  duration_ms: 3.591432
  type: 'test'
  ...
# Subtest: site_account 工具已挂上，且 create 缺 site/username 会明确报错
ok 643 - site_account 工具已挂上，且 create 缺 site/username 会明确报错
  ---
  duration_ms: 14.160045
  type: 'test'
  ...
# Subtest: a run cut off by the step limit ends with a note before RUN_FINISHED
ok 644 - a run cut off by the step limit ends with a note before RUN_FINISHED
  ---
  duration_ms: 18.356332
  type: 'test'
  ...
# Subtest: runs the model finished itself get no note
ok 645 - runs the model finished itself get no note
  ---
  duration_ms: 1.334379
  type: 'test'
  ...
# Subtest: 派任务时带上 credentials：服务端铸好、只把 id 记进 state、绑定到这个任务
ok 646 - 派任务时带上 credentials：服务端铸好、只把 id 记进 state、绑定到这个任务
  ---
  duration_ms: 12685.752126
  type: 'test'
  ...
# Subtest: 工具侧的 secrets 访问器：能取到明文，redact 能把明文换成后 6 位
ok 647 - 工具侧的 secrets 访问器：能取到明文，redact 能把明文换成后 6 位
  ---
  duration_ms: 91.731085
  type: 'test'
  ...
# Subtest: 吊销是**真销毁**：落库的明文被擦掉，但后 6 位仍可展示；取明文给可续接的提示
ok 648 - 吊销是**真销毁**：落库的明文被擦掉，但后 6 位仍可展示；取明文给可续接的提示
  ---
  duration_ms: 126.527294
  type: 'test'
  ...
# [http] POST /api/session → 200 1929ms
# [http] GET /api/workspace → 200 25ms
# [http] GET /api/threads → 200 59ms
# [http] PATCH /api/threads/11111111-2222-4333-8444-555555555555 → 200 11ms
# [http] POST /api/threads/11111111-2222-4333-8444-555555555555/archive → 200 8ms
# [http] GET /api/threads → 200 41ms
# [http] POST /api/threads/11111111-2222-4333-8444-555555555555/unarchive → 200 23ms
# [http] GET /api/threads → 200 108ms
# [http] DELETE /api/threads/11111111-2222-4333-8444-555555555555 → 200 7ms
# [http] GET /api/threads → 200 39ms
# [http] DELETE /api/threads/local-main → 400 5ms
# [http] PUT /api/conversation → 200 46ms
# [http] GET /api/conversation → 200 67ms
# [http] GET /api/threads → 200 9ms
# [http] GET /api/conversation → 200 67ms
# [http] PUT /api/conversation → 200 88ms
# [http] GET /api/conversation → 200 33ms
# Subtest: 会话列表自带主会话，且能力上报不再谎称云富线程
ok 649 - 会话列表自带主会话，且能力上报不再谎称云富线程
  ---
  duration_ms: 19716.386463
  type: 'test'
  ...
# Subtest: 新建会话：改名、归档、恢复、删除都落在自己库里
ok 650 - 新建会话：改名、归档、恢复、删除都落在自己库里
  ---
  duration_ms: 262.62736
  type: 'test'
  ...
# Subtest: 主会话不允许删除
ok 651 - 主会话不允许删除
  ---
  duration_ms: 6.56507
  type: 'test'
  ...
# Subtest: 每条会话各存各的历史，主会话沿用老记录不丢历史
ok 652 - 每条会话各存各的历史，主会话沿用老记录不丢历史
  ---
  duration_ms: 355.606255
  type: 'test'
  ...
# Subtest: 改名不会被自动标题覆盖，未命名才会自动起名
ok 653 - 改名不会被自动标题覆盖，未命名才会自动起名
  ---
  duration_ms: 2.390762
  type: 'test'
  ...
# Subtest: 标题从第一条用户文本里取，压平空白并截断
ok 654 - 标题从第一条用户文本里取，压平空白并截断
  ---
  duration_ms: 1.80566
  type: 'test'
  ...
# [http] POST /api/session → 200 2007ms
# [audit-persist] 审计出口抛错 id=20261016060502970-f8454553 tool=browse_web：审计库连不上
# [audit-persist] 审计出口抛错 id=20261016060502975-916360f2 tool=browse_web：审计库连不上
# [approval] 待审批登记失败 tool=wipe_disk：审批表写不进去
# [audit-persist] 审计出口抛错 id=20261016060502980-526c9496 tool=wipe_disk：审计库连不上
# [http] GET /approvals → 200 135ms
# [http] GET /approvals → 200 34ms
# [http] GET /api/approvals → 200 19ms
# [audit] tool=rest_approve_tool owner=local-user thread=rest-approve risk=sensitive outcome=ok decision=approval_approved approval=20260301080000000-597c783d
# [http] POST /approvals/20260301080000000-597c783d/approve → 200 77ms
# [audit] tool=rest_approve_tool2 owner=local-user thread=rest-approve2 risk=sensitive outcome=ok decision=approval_approved approval=20260301080000000-0323ad7b
# [http] POST /api/approvals/20260301080000000-0323ad7b/approve → 200 123ms
# [http] POST /approvals/20260301080000000-10c5871f/approve → 400 161ms
# [http] POST /approvals/20260301080000000-10c5871f/approve → 400 152ms
# [http] POST /approvals/20260301080000000-10c5871f/approve → 400 25ms
# [http] POST /approvals/20260301080000000-10c5871f/approve → 400 57ms
# [http] POST /approvals/20260301080000000-10c5871f/approve → 400 22ms
# [http] POST /approvals/20260301080000000-10c5871f/approve → 400 57ms
# [audit] tool=rest_deny_tool owner=local-user thread=rest-deny risk=sensitive outcome=blocked decision=approval_denied approval=20260301080000000-df1b1481
# [http] POST /approvals/20260301080000000-df1b1481/deny → 200 183ms
# [http] POST /approvals/20260301080000000-df1b1481/approve → 404 115ms
# [audit] tool=rest_deny_tool2 owner=local-user thread=rest-deny2 risk=sensitive outcome=ok decision=approval_approved approval=20260301080000000-c9a7323a
# [http] POST /approvals/20260301080000000-c9a7323a/approve → 200 30ms
# [http] POST /approvals/20260301080000000-c9a7323a/deny → 404 15ms
# [http] POST /approvals/20260301080000000-deadbeef/approve → 404 17ms
# [http] POST /approvals/20260301080000000-deadbeef/deny → 404 87ms
# [http] POST /approvals/20260301080000000-cafebabe/approve → 404 8ms
# [http] POST /approvals/20260301080000000-cafebabe/deny → 404 8ms
# [http] GET /approvals → 401 16ms
# [http] GET /api/approvals → 401 140ms
# [http] POST /approvals/x/approve → 401 0ms
# [http] GET /approvals → 403 11ms
# [http] GET /approvals → 200 29ms
# [http] GET /approvals → 422 40ms
# Subtest: §4.1 没有 grant 时要审批的工具被拦下，并登记一条含工具名与理由的 pending
ok 655 - §4.1 没有 grant 时要审批的工具被拦下，并登记一条含工具名与理由的 pending
  ---
  duration_ms: 14174.859725
  type: 'test'
  ...
# Subtest: §4.1 三种拦法都登记待审批：敏感能力 / 结果外流 / 声明了警告
ok 656 - §4.1 三种拦法都登记待审批：敏感能力 / 结果外流 / 声明了警告
  ---
  duration_ms: 343.042589
  type: 'test'
  ...
# Subtest: §4.2 once：批准后下一次成功、再下一次又被拦（消耗语义）
ok 657 - §4.2 once：批准后下一次成功、再下一次又被拦（消耗语义）
  ---
  duration_ms: 177.539046
  type: 'test'
  ...
# Subtest: §4.2 once 是原子消耗的：两个并发调用只能过一次（不多不少）
ok 658 - §4.2 once 是原子消耗的：两个并发调用只能过一次（不多不少）
  ---
  duration_ms: 189.549087
  type: 'test'
  ...
# Subtest: §4.3 session：同 thread 内连续放行，换 thread 仍拦，换服务实例失效
ok 659 - §4.3 session：同 thread 内连续放行，换 thread 仍拦，换服务实例失效
  ---
  duration_ms: 94.995951
  type: 'test'
  ...
# Subtest: §4.4 24h：expiresAt 算得准、过点前放行、过点后重新拦
ok 660 - §4.4 24h：expiresAt 算得准、过点前放行、过点后重新拦
  ---
  duration_ms: 104.799185
  type: 'test'
  ...
# Subtest: §4.4 授权只对批准时的那一个工具生效（不做前缀 / 通配匹配）
ok 661 - §4.4 授权只对批准时的那一个工具生效（不做前缀 / 通配匹配）
  ---
  duration_ms: 315.224202
  type: 'test'
  ...
# Subtest: §4.5 拒绝名单优先级高于 grant：批准过也照拦，且不吃掉那条授权
ok 662 - §4.5 拒绝名单优先级高于 grant：批准过也照拦，且不吃掉那条授权
  ---
  duration_ms: 413.54427
  type: 'test'
  ...
# Subtest: §4.5 拒绝名单优先级高于 24h / session 授权（不止 once）
ok 663 - §4.5 拒绝名单优先级高于 24h / session 授权（不止 once）
  ---
  duration_ms: 129.685266
  type: 'test'
  ...
# Subtest: §4.6 没声明 risk/assess 的工具：返回值同一对象、抛错同一 Error 实例（审批已接上时也一样）
ok 664 - §4.6 没声明 risk/assess 的工具：返回值同一对象、抛错同一 Error 实例（审批已接上时也一样）
  ---
  duration_ms: 63.449565
  type: 'test'
  ...
# Subtest: §4.6 有授权命中的普通工具：返回值仍是同一个对象、抛错仍是同一个实例
ok 665 - §4.6 有授权命中的普通工具：返回值仍是同一个对象、抛错仍是同一个实例
  ---
  duration_ms: 12.982865
  type: 'test'
  ...
# Subtest: §4.7 审计：授权放行记 granted:<scope>，审批登记也各写一行
ok 666 - §4.7 审计：授权放行记 granted:<scope>，审批登记也各写一行
  ---
  duration_ms: 162.271288
  type: 'test'
  ...
# Subtest: §4.7 审批落库失败不影响工具语义：仍是同一个对象 / 同一个 Error 实例
ok 667 - §4.7 审批落库失败不影响工具语义：仍是同一个对象 / 同一个 Error 实例
  ---
  duration_ms: 15.021519
  type: 'test'
  ...
# Subtest: §4.8 REST：GET /approvals 按会话 owner 取数，limit 生效，最近的在前
ok 668 - §4.8 REST：GET /approvals 按会话 owner 取数，limit 生效，最近的在前
  ---
  duration_ms: 336.488188
  type: 'test'
  ...
# Subtest: §4.8 REST：POST /approvals/:id/approve 正常路径（写出 grant + 审批置 approved）
ok 669 - §4.8 REST：POST /approvals/:id/approve 正常路径（写出 grant + 审批置 approved）
  ---
  duration_ms: 943.369017
  type: 'test'
  ...
# Subtest: §4.8 REST：非法 scope → 400，且不产生任何放行
ok 670 - §4.8 REST：非法 scope → 400，且不产生任何放行
  ---
  duration_ms: 844.178648
  type: 'test'
  ...
# Subtest: §4.8 REST：POST /approvals/:id/deny 置 denied，且不产生任何放行
ok 671 - §4.8 REST：POST /approvals/:id/deny 置 denied，且不产生任何放行
  ---
  duration_ms: 619.701751
  type: 'test'
  ...
# Subtest: §4.8 REST：别人的审批 id 与不存在的 id 一律 404（不泄露存不存在）
ok 672 - §4.8 REST：别人的审批 id 与不存在的 id 一律 404（不泄露存不存在）
  ---
  duration_ms: 183.68532
  type: 'test'
  ...
# Subtest: §4.8 REST：审批入口要鉴权，owner 只从会话取
ok 673 - §4.8 REST：审批入口要鉴权，owner 只从会话取
  ---
  duration_ms: 260.837913
  type: 'test'
  ...
# Subtest: §4.8 scope 合法性只认 once / session / 24h 三档
ok 674 - §4.8 scope 合法性只认 once / session / 24h 三档
  ---
  duration_ms: 0.628198
  type: 'test'
  ...
# [http] POST /api/session → 200 1400ms
# [audit-persist] 审计出口抛错 id=20261016060528293-1c9d82a0 tool=browse_web：审计库连不上
# [audit-persist] 审计出口抛错 id=20261016060528300-e47607b1 tool=site_account：审计库连不上
# [audit-persist] 审计出口抛错 id=20261016060528303-0a64f2de tool=wipe：审计库连不上
# [audit-persist] 审计写入失败 id=20261016060528320-6c6a5f5d tool=weather：写库超时
# [audit-persist] 审计写入失败 id=20261016060528358-77f7cdc6 tool=browse_web：写库超时
# Subtest: 每次工具调用落一条审计：放行 / 拒批 / 抛错三条路都有，字段齐全
ok 675 - 每次工具调用落一条审计：放行 / 拒批 / 抛错三条路都有，字段齐全
  ---
  duration_ms: 15366.016352
  type: 'test'
  ...
# Subtest: 缺 owner 时用 local-user 占位（不落成空字符串）
ok 676 - 缺 owner 时用 local-user 占位（不落成空字符串）
  ---
  duration_ms: 5.600405
  type: 'test'
  ...
# Subtest: 被拦时 outcome=blocked 且 reason 非空（三种拦法都有）
ok 677 - 被拦时 outcome=blocked 且 reason 非空（三种拦法都有）
  ---
  duration_ms: 102.928343
  type: 'test'
  ...
# Subtest: sink 同步抛错：返回值是同一个对象，抛错是同一个 Error 实例
ok 678 - sink 同步抛错：返回值是同一个对象，抛错是同一个 Error 实例
  ---
  duration_ms: 25.380259
  type: 'test'
  ...
# Subtest: sink 异步 reject：同样不改变返回值 / 抛错实例 / 错误形状
ok 679 - sink 异步 reject：同样不改变返回值 / 抛错实例 / 错误形状
  ---
  duration_ms: 41.457461
  type: 'test'
  ...
# Subtest: 落库失败只记一行日志，不抛到调用方（也不刷 console）
ok 680 - 落库失败只记一行日志，不抛到调用方（也不刷 console）
  ---
  duration_ms: 1.269986
  type: 'test'
  ...
# Subtest: 没挂 sink 时工具照常执行（优雅降级：只有控制台那一行）
ok 681 - 没挂 sink 时工具照常执行（优雅降级：只有控制台那一行）
  ---
  duration_ms: 9.426535
  type: 'test'
  ...
# Subtest: 查询：threadId 过滤与 limit 生效，不同 thread / 不同 owner 互不串
ok 682 - 查询：threadId 过滤与 limit 生效，不同 thread / 不同 owner 互不串
  ---
  duration_ms: 217.636551
  type: 'test'
  ...
# Subtest: 查询结果里 reason 缺省就是 null，不是 undefined（调用方不用到处判空）
ok 683 - 查询结果里 reason 缺省就是 null，不是 undefined（调用方不用到处判空）
  ---
  duration_ms: 70.56626
  type: 'test'
  ...
# Subtest: 脱敏：评估要求 redact 时，落库内容里凭据字段已被抹掉
ok 684 - 脱敏：评估要求 redact 时，落库内容里凭据字段已被抹掉
  ---
  duration_ms: 8.33973
  type: 'test'
  ...
# Subtest: 脱敏不强制：没要求 redact 时，落库内容与工具返回一致
ok 685 - 脱敏不强制：没要求 redact 时，落库内容与工具返回一致
  ---
  duration_ms: 8.355502
  type: 'test'
  ...
# Subtest: 落库内容有界：深层嵌套只留规模，不把整页正文抄进审计表
ok 686 - 落库内容有界：深层嵌套只留规模，不把整页正文抄进审计表
  ---
  duration_ms: 28.688371
  type: 'test'
  ...
# [http] GET /audit → 200 199ms
# [http] GET /audit → 200 90ms
# [http] GET /audit → 200 78ms
# [http] GET /audit → 200 149ms
# [http] GET /api/audit → 200 39ms
# [http] GET /audit → 401 43ms
# [http] GET /audit → 403 3ms
# [http] GET /audit → 200 12ms
# [http] GET /audit → 422 11ms
# Subtest: 源码级：控制台 `[audit]` 那一行还在，且格式一字未改
ok 687 - 源码级：控制台 `[audit]` 那一行还在，且格式一字未改
  ---
  duration_ms: 80.19977
  type: 'test'
  ...
# Subtest: 控制台行照旧逐次输出，落库是**另一条**出口（互不替代）
ok 688 - 控制台行照旧逐次输出，落库是**另一条**出口（互不替代）
  ---
  duration_ms: 7.380221
  type: 'test'
  ...
# Subtest: auditEventId：时间戳前缀递增 = 时间有序，后缀随机短串
ok 689 - auditEventId：时间戳前缀递增 = 时间有序，后缀随机短串
  ---
  duration_ms: 7.781311
  type: 'test'
  ...
# Subtest: 接线：Store 接上咽喉后，instrument() 包的工具调用也会落库
ok 690 - 接线：Store 接上咽喉后，instrument() 包的工具调用也会落库
  ---
  duration_ms: 15.513782
  type: 'test'
  ...
# Subtest: GET /audit：按 threadId 过滤、按 limit 限量，带 reason（无则 null）
ok 691 - GET /audit：按 threadId 过滤、按 limit 限量，带 reason（无则 null）
  ---
  duration_ms: 645.733229
  type: 'test'
  ...
# Subtest: GET /api/audit 同样可用（沿用仓库 /api 前缀）
ok 692 - GET /api/audit 同样可用（沿用仓库 /api 前缀）
  ---
  duration_ms: 41.544621
  type: 'test'
  ...
# Subtest: GET /audit 是只读且要鉴权：没令牌 401，冒用别人的 owner 403
ok 693 - GET /audit 是只读且要鉴权：没令牌 401，冒用别人的 owner 403
  ---
  duration_ms: 83.72703
  type: 'test'
  ...
# [audit] tool=blocked_probe owner=- thread=- risk=safe outcome=denied (2ms)
# [tool] blocked_probe  → 抛错 Sentinel 拦下了「blocked_probe」：工具「blocked_probe」在拒绝名单里。Do not retry the same call——改用一个在允许范围内的工具，或者把这件活交给用户自己决定。 (9ms)
# Subtest: 没声明 risk/assess 的工具：返回值原样（同一个对象），不被包装
ok 694 - 没声明 risk/assess 的工具：返回值原样（同一个对象），不被包装
  ---
  duration_ms: 31.993687
  type: 'test'
  ...
# Subtest: 没声明 risk/assess 的工具：抛错原样（同一个 Error 实例）
ok 695 - 没声明 risk/assess 的工具：抛错原样（同一个 Error 实例）
  ---
  duration_ms: 12.019943
  type: 'test'
  ...
# Subtest: 拒绝名单命中：连执行都不执行，且明确要求模型不要重试
ok 696 - 拒绝名单命中：连执行都不执行，且明确要求模型不要重试
  ---
  duration_ms: 9.130964
  type: 'test'
  ...
# Subtest: 静态 sensitive：默认拒批（没有审批入口时宁可拦住）
ok 697 - 静态 sensitive：默认拒批（没有审批入口时宁可拦住）
  ---
  duration_ms: 1.047506
  type: 'test'
  ...
# Subtest: 逐次评估说结果要流出本机（egress=review）→ 同样拒批
ok 698 - 逐次评估说结果要流出本机（egress=review）→ 同样拒批
  ---
  duration_ms: 0.595491
  type: 'test'
  ...
# Subtest: 评估自己坏了 → fail closed（拦住），并把原因写进审计
ok 699 - 评估自己坏了 → fail closed（拦住），并把原因写进审计
  ---
  duration_ms: 2.227586
  type: 'test'
  ...
# Subtest: 警告：声明 warnings 就必须拦（不是装饰结果），理由带出警告原文
ok 700 - 警告：声明 warnings 就必须拦（不是装饰结果），理由带出警告原文
  ---
  duration_ms: 2.585775
  type: 'test'
  ...
# Subtest: moderate：放行但必进审计（不因为档位高就拦）
ok 701 - moderate：放行但必进审计（不因为档位高就拦）
  ---
  duration_ms: 5.475643
  type: 'test'
  ...
# Subtest: 打码：只有评估明确要求时才动，凭据字段被抹掉、普通字段原样
ok 702 - 打码：只有评估明确要求时才动，凭据字段被抹掉、普通字段原样
  ---
  duration_ms: 8.97463
  type: 'test'
  ...
# Subtest: 审计：放行、拒批、抛错三条路各留一行，含 risk 与耗时
ok 703 - 审计：放行、拒批、抛错三条路各留一行，含 risk 与耗时
  ---
  duration_ms: 10.588812
  type: 'test'
  ...
# Subtest: 接线守卫：经过 instrument() 的工具一定走咽喉（拒绝名单能拦住合成工具）
ok 704 - 接线守卫：经过 instrument() 的工具一定走咽喉（拒绝名单能拦住合成工具）
  ---
  duration_ms: 90.793301
  type: 'test'
  ...
# Subtest: 接线守卫：两个引擎的外壳都是先套 instrument 再定义工具（源码级）
ok 705 - 接线守卫：两个引擎的外壳都是先套 instrument 再定义工具（源码级）
  ---
  duration_ms: 8.541965
  type: 'test'
  ...
# Subtest: 接线守卫：tanstack 引擎的 stateTools 也过咽喉（P1d，源码级）
ok 706 - 接线守卫：tanstack 引擎的 stateTools 也过咽喉（P1d，源码级）
  ---
  duration_ms: 46.853903
  type: 'test'
  ...
# Subtest: 接线守卫：JEV 工具文件写明收口约束（当前无消费者，P1d）
ok 707 - 接线守卫：JEV 工具文件写明收口约束（当前无消费者，P1d）
  ---
  duration_ms: 3.468659
  type: 'test'
  ...
# Subtest: 接线守卫：真正执行工具的地方只有这 4 个文件（多一个就说明有人绕过咽喉）
ok 708 - 接线守卫：真正执行工具的地方只有这 4 个文件（多一个就说明有人绕过咽喉）
  ---
  duration_ms: 94.317545
  type: 'test'
  ...
# Subtest: 拒绝名单从配置读，能解析逗号/空格/空项
ok 709 - 拒绝名单从配置读，能解析逗号/空格/空项
  ---
  duration_ms: 1.675551
  type: 'test'
  ...
# Subtest: 纯函数：拒绝名单匹配大小写与首尾空格不敏感；措辞包含「别重试」
ok 710 - 纯函数：拒绝名单匹配大小写与首尾空格不敏感；措辞包含「别重试」
  ---
  duration_ms: 0.502708
  type: 'test'
  ...
# [audit] tool=read_mail_thread owner=local-user thread=t-taint risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (2ms)
# [audit] tool=page_act owner=local-user thread=t-taint risk=moderate outcome=awaiting_approval approval=approval-1 target=- egress=none egress_target=- summary=- (4ms)
# [audit] tool=page_act owner=local-user thread=t-clean risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (20ms)
# [audit] tool=read_mail_thread owner=local-user thread=t-a risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (1ms)
# [audit] tool=page_act owner=local-user thread=t-b risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (1ms)
# [audit] tool=read_mail_thread owner=local-user thread=t-clear risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (37ms)
# [audit] tool=page_act owner=local-user thread=t-clear risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (1ms)
# [audit] tool=read_mail_thread owner=local-user thread=t-read risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (0ms)
# [audit] tool=read_image owner=local-user thread=t-read risk=moderate outcome=ok target=- egress=none egress_target=- summary=- (1ms)
# [audit] tool=whatever owner=- thread=- risk=safe outcome=ok target=- egress=none egress_target=- summary=- (1ms)
# [audit] tool=boom owner=- thread=- risk=safe outcome=error target=- egress=none egress_target=- error=工具自己的错 (1ms)
# Subtest: 读私有数据之后，同一线程的外发动作被强制审批（理由写明污染来源）
ok 711 - 读私有数据之后，同一线程的外发动作被强制审批（理由写明污染来源）
  ---
  duration_ms: 158.752088
  type: 'test'
  ...
# Subtest: 没读私有数据的线程，同一个外发工具照常放行（不误伤）
ok 712 - 没读私有数据的线程，同一个外发工具照常放行（不误伤）
  ---
  duration_ms: 21.493047
  type: 'test'
  ...
# Subtest: 污点按线程隔离：别的线程读到私信，不影响本线程
ok 713 - 污点按线程隔离：别的线程读到私信，不影响本线程
  ---
  duration_ms: 11.1335
  type: 'test'
  ...
# Subtest: 清污点之后（用户批准过这次外发），外发动作恢复按原档位判定
ok 714 - 清污点之后（用户批准过这次外发），外发动作恢复按原档位判定
  ---
  duration_ms: 39.289026
  type: 'test'
  ...
# Subtest: 读类工具自己不受污点影响（否则读完私有数据后连读都做不了）
ok 715 - 读类工具自己不受污点影响（否则读完私有数据后连读都做不了）
  ---
  duration_ms: 2.303861
  type: 'test'
  ...
# Subtest: 纯函数：taintRequiresApproval 只提升外发类；taintReason 带工具名与来源
ok 716 - 纯函数：taintRequiresApproval 只提升外发类；taintReason 带工具名与来源
  ---
  duration_ms: 0.460773
  type: 'test'
  ...
# Subtest: 行为契约不变：没声明 readsPrivate/outward 的工具，返回值与抛错逐字一致
ok 717 - 行为契约不变：没声明 readsPrivate/outward 的工具，返回值与抛错逐字一致
  ---
  duration_ms: 2.162022
  type: 'test'
  ...
# Subtest: 拒绝名单仍然压过污点与授权（顺序不变）
ok 718 - 拒绝名单仍然压过污点与授权（顺序不变）
  ---
  duration_ms: 0.331788
  type: 'test'
  ...
# [audit] tool=browse_web owner=- thread=- risk=safe outcome=ok target=- egress=none egress_target=- summary=- (1ms)
# [tool] browse_web url=https://News.Example.com/x → ok 11B (5ms)
# Subtest: hostFromUrl：https 正常地址 → 小写域名
ok 719 - hostFromUrl：https 正常地址 → 小写域名
  ---
  duration_ms: 1.588909
  type: 'test'
  ...
# Subtest: hostFromUrl：http 正常地址
ok 720 - hostFromUrl：http 正常地址
  ---
  duration_ms: 0.264303
  type: 'test'
  ...
# Subtest: hostFromUrl：主机名大小写混合 → 小写
ok 721 - hostFromUrl：主机名大小写混合 → 小写
  ---
  duration_ms: 0.338651
  type: 'test'
  ...
# Subtest: hostFromUrl：非默认端口保留
ok 722 - hostFromUrl：非默认端口保留
  ---
  duration_ms: 0.194052
  type: 'test'
  ...
# Subtest: hostFromUrl：默认端口省略
ok 723 - hostFromUrl：默认端口省略
  ---
  duration_ms: 0.357591
  type: 'test'
  ...
# Subtest: hostFromUrl：非 http(s) 协议 → null
ok 724 - hostFromUrl：非 http(s) 协议 → null
  ---
  duration_ms: 0.210327
  type: 'test'
  ...
# Subtest: hostFromUrl：相对路径 → null
ok 725 - hostFromUrl：相对路径 → null
  ---
  duration_ms: 0.32465
  type: 'test'
  ...
# Subtest: hostFromUrl：空字符串 → null
ok 726 - hostFromUrl：空字符串 → null
  ---
  duration_ms: 0.201521
  type: 'test'
  ...
# Subtest: hostFromUrl：非字符串 → null
ok 727 - hostFromUrl：非字符串 → null
  ---
  duration_ms: 0.629893
  type: 'test'
  ...
# Subtest: 接线：instrument() 之后 targets 仍可读，且在同一份 args 上返回预期域名
ok 728 - 接线：instrument() 之后 targets 仍可读，且在同一份 args 上返回预期域名
  ---
  duration_ms: 13.85329
  type: 'test'
  ...
# Subtest: 接线：数组目标经 instrument() 后去重且可读
ok 729 - 接线：数组目标经 instrument() 后去重且可读
  ---
  duration_ms: 12.20799
  type: 'test'
  ...
# Subtest: 真接线：browse_web / watch_page / read_pages 声明了 targets
ok 730 - 真接线：browse_web / watch_page / read_pages 声明了 targets
  ---
  duration_ms: 51.498197
  type: 'test'
  ...
# Subtest: unansweredUserMessage：最后一条用户消息之后有没有助手回复
ok 731 - unansweredUserMessage：最后一条用户消息之后有没有助手回复
  ---
  duration_ms: 2.000174
  type: 'test'
  ...
# Subtest: decideResume：失败/中断且用户消息没被回答 → 该续
ok 732 - decideResume：失败/中断且用户消息没被回答 → 该续
  ---
  duration_ms: 0.497139
  type: 'test'
  ...
# Subtest: decideResume：正常结束、正在跑、有回复、超次数、太密集 —— 都不动
ok 733 - decideResume：正常结束、正在跑、有回复、超次数、太密集 —— 都不动
  ---
  duration_ms: 0.300507
  type: 'test'
  ...
# Subtest: toAgUiMessages：只留 user/assistant 的文本，工具消息与空内容丢掉
ok 734 - toAgUiMessages：只留 user/assistant 的文本，工具消息与空内容丢掉
  ---
  duration_ms: 6.1624
  type: 'test'
  ...
# Subtest: selfBaseUrl：通配监听要换成回环，否则连不上自己
ok 735 - selfBaseUrl：通配监听要换成回环，否则连不上自己
  ---
  duration_ms: 0.515026
  type: 'test'
  ...
# Subtest: 巡检：用户消息没被回答 + turn 失败 → 服务端自己补跑，并记下次数
ok 736 - 巡检：用户消息没被回答 + turn 失败 → 服务端自己补跑，并记下次数
  ---
  duration_ms: 506.917389
  type: 'test'
  ...
# Subtest: 巡检：已经有回复 / 正常结束 / 到上限 —— 都不发请求
ok 737 - 巡检：已经有回复 / 正常结束 / 到上限 —— 都不发请求
  ---
  duration_ms: 1.220943
  type: 'test'
  ...
# Subtest: 巡检：投递失败时如实返回，不假装成功
ok 738 - 巡检：投递失败时如实返回，不假装成功
  ---
  duration_ms: 1.073233
  type: 'test'
  ...
# Subtest: resumeTurn：401 时清掉令牌缓存，下一轮重新取（令牌过期要能自愈）
ok 739 - resumeTurn：401 时清掉令牌缓存，下一轮重新取（令牌过期要能自愈）
  ---
  duration_ms: 1.731324
  type: 'test'
  ...
# Subtest: vault encrypts with a fresh nonce and authenticates the entire envelope
ok 740 - vault encrypts with a fresh nonce and authenticates the entire envelope
  ---
  duration_ms: 157.779849
  type: 'test'
  ...
# Subtest: vault rejects malformed keys and envelopes without echoing secrets
ok 741 - vault rejects malformed keys and envelopes without echoing secrets
  ---
  duration_ms: 92.243611
  type: 'test'
  ...
# Subtest: document job runs without a client, waits for review, and resumes from its receipt
ok 742 - document job runs without a client, waits for review, and resumes from its receipt
  ---
  duration_ms: 11380.750755
  type: 'test'
  ...
# Subtest: ideas ignore sent replies while retaining unfinished incoming requests
ok 743 - ideas ignore sent replies while retaining unfinished incoming requests
  ---
  duration_ms: 792.611842
  type: 'test'
  ...
# Subtest: cancelling a task denies its pending action
ok 744 - cancelling a task denies its pending action
  ---
  duration_ms: 329.210961
  type: 'test'
  ...
# Subtest: failed page checks back off, expose the error, and pause after repeated failures
ok 745 - failed page checks back off, expose the error, and pause after repeated failures
  ---
  duration_ms: 783.829195
  type: 'test'
  ...
# Subtest: each failure streak of a watch raises its own alerts after it is resumed
ok 746 - each failure streak of a watch raises its own alerts after it is resumed
  ---
  duration_ms: 1295.785795
  type: 'test'
  ...
# Subtest: dismissal racing acceptance never creates work for a dismissed idea
ok 747 - dismissal racing acceptance never creates work for a dismissed idea
  ---
  duration_ms: 164.992807
  type: 'test'
  ...
# Subtest: 写 / 读 / 列表：文件落在沙箱工作区里
ok 748 - 写 / 读 / 列表：文件落在沙箱工作区里
  ---
  duration_ms: 549.138505
  type: 'test'
  ...
# Subtest: 改文件：原文唯一才改，不唯一就拒绝且不写
ok 749 - 改文件：原文唯一才改，不唯一就拒绝且不写
  ---
  duration_ms: 86.596952
  type: 'test'
  ...
# Subtest: 越界一律拒绝：绝对路径、..、域外目录
ok 750 - 越界一律拒绝：绝对路径、..、域外目录
  ---
  duration_ms: 52.210103
  type: 'test'
  ...
# Subtest: 聊天里调用 → 拒绝（不建沙箱、不动文件）
ok 751 - 聊天里调用 → 拒绝（不建沙箱、不动文件）
  ---
  duration_ms: 6.070333
  type: 'test'
  ...
1..751
# tests 751
# suites 0
# pass 751
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1037330.193469
test rc=0 耗时=1043s
===== tests/ porcelain =====
```

---

## 6. 遵守的红线（本单零改动）

- 未修改 `apps/` 或 `tests/` 下任何文件。
- 未安装任何依赖（仓库用 `node:test` / `tsx --test`，无 vitest）。
- 未 `git commit` / `git push`。
- 未触碰 `/root/work` 以外的仓库。
- 仅新建本回报文件 `docs/任务单回报-openmuse-L3-复验.md`。
