# TODO / 路线图

> 最后更新：2026-10-14 · 分支 `apk/preview`

## 🔴 待人工操作（agent 权限之外）

- [ ] **APK 打包被 GitHub 挡住** —— fork `sunshaoan0808/openmuse` 的 Actions 被停用，
      手动触发返回 `HTTP 422: Actions has been disabled for this repository`。
      已排除的可能（均有实测证据）：账号级（同账号 `quill-server` 10/13 成功、`drama-service` 10/14 在跑）、
      上游（`CopilotKit/openmuse` 10/13 成功）、仓库权限位（API 返回 `enabled:true`，关掉再打开 + 单独
      `workflow enable` 均无效）、push 触发（当天 push 未产生任何运行 → 整个 Actions 都停了）。
      **修法**：打开 <https://github.com/sunshaoan0808/openmuse/actions> ，点横幅里的
      `I understand my workflows, go ahead and enable them`。
      **备选**：在本账号下建一个**非 fork** 仓库推上去跑（非 fork 的 dispatch 已验证可用）。
- [ ] **Hermes 网关重启** —— `model.default` 已从 550B 改为更强的 `nemotron-3-super-120b`，
      需重启 Hermes 进程才生效；重启会掐断当前会话，所以要在会话外执行。

## 🟡 进行中：从柳如烟（Ruyan AI）合并机制

平台不同（OpenMuse 移动端 + Node，柳如烟 Windows 桌面 + Python），**只移植机制，不搬代码**。

- [x] **① 人设分文件** —— `engine/personas.ts` 加载 + Schema v2 逐条校验；`conversation.ts` /
      `mastra-engine.ts` 两个引擎接线；App「人格与记忆」角色选择器；`GET /personas`
- [x] **② 记忆温度模型** —— `engine/memory-temperature.ts`：🔥/🌡️/❄️ 三档 + `<!-- locked -->`
      免衰减 + 温热 14 天降冷存 + 按温度排序 + token 预算截断
- [x] **②b 记忆自动沉淀** —— `engine/memory-sediment.ts`：一轮结束后把「既有记忆 + 刚发生的一轮」
      交给模型，只取结构化 JSON（`{"add":[...],"revise":[{"id":"短标识","text":"..."}]}`），
      再经 `rememberMemory()` 落库。revise 让模型能主动纠正矛盾记忆，并留 `revisedFrom` 痕。
      闸门：<5 字或纯应答不调模型、同一 owner 15 秒内只跑一次、凭据正则拦截、
      `max_tokens=1200`（推理模型会把预算吃光，给少了 content 为 null）。
      接线：`app.ts` 回合结束后调用，静默失败。
      **真机验证**：真网关 + `openai/gpt-oss-20b`，12.8s 准确提取一条新事实，
      没有重复记已有的「白虎」，寒暄未误记。
- [x] **②c 记忆去重 / 归并** —— `engine/memory-dedupe.ts`：归一化（全角转半角 + 只留 `\p{L}\p{N}`）
      后按 key 分组归并，保留信息量最大的写法、温度取高者、写 `updatedAt`。
      写入侧 `remember_fact` 改走 `rememberMemory()`；存量清理脚本 `scripts/dedupe-memories.ts`
      （默认 dry-run）。**实测库里 3 条 → 2 条**。
      仍留一条**语义冲突**待人工定夺：`我的代号是「青龙」。`(03:49) vs `我的代号是「白虎」。`(04:20/06:21)
      —— 内容不同，归并不动它（只做形式归并，不做语义判断）。
- [x] **③ 情绪引擎** —— `engine/emotion.ts`：关键词打分 → 否定/强度语境过滤 → 角色 7 维光谱加权
      → 弧线累积（同情感连续升温、切换平滑过渡、峰值追踪）。上游 `emotion_updater.py` 407 行。
      **移植时修掉上游两个 bug**（都与中文无词边界有关）：否定窗口右边界用
      `text[pos:].split()[0]` 在无空格中文下等于整段剩余文本，且关键词自身含否定词会自我抵消
      （「不要脸」判成被否定）。已改为只扫关键词前 4 字。
      接线：`app.ts` 回合结束后 `advanceEmotionFromTurn()` 落 `kind='emotion'` 记录，
      `loadAssistantContext()` 下一轮注入。用真实角色文件端到端验证：三轮对话把情绪
      从「开心 0.71」推到 0.95 再切「感动 0.75」。
      待办：另一条引擎路径（`conversation.ts` 自带引擎）尚未挂同一个钩子 —— 线上是 mastra，暂不影响。
- [ ] **④ 社交图谱** —— 上游 `social_graph.py` 1005 行，多角色关系演化
- [ ] **⑤ 圆桌 / 多角色同席** —— 产品级差异点，等 ②③ 站住再做

## 🔧 已修复的环境问题（2026-10-14）

- [x] **OpenMuse 的模型链路此前是断的**：`.env` 里 `OPENAI_API_KEY` 是 17 字符的占位符
      （`loca…`），`MODEL=openai/nemotron-3-super-120b-a12b` 的前缀也不对 ——
      实测该 id 会被网关拒（`400 付费模型不可用`），占位 key 一律 `401 Invalid API key`。
      已改为真 zen key + `MODEL=nvidia/nemotron-3-super-120b-a12b`（`.env` 权限 600），
      并新增 `SEDIMENT_MODEL=openai/gpt-oss-20b`。服务重启后启动日志无 shadowed 警告,
      即 `.env` 生效。**注意**：库内最近一次真实对话是 2026-10-05，之后没人用过，
      所以这个断链一直没被发现。
- [x] **网关的可用模型有付费限制**：zh 网关（`10.7.0.1:9527`）对未带 `:free` 的付费模型返回
      `400 付费模型不可用，请使用免费模型（:free 后缀）`。已实测可用的有
      `nvidia/nemotron-3-super-120b-a12b`、`openai/gpt-oss-20b`、`ministral-8b-latest`；
      不可用：`nvidia/nemotron-3-nano-30b-a3b`、`mistral-small-latest`。
- [x] **推理类模型的小 `max_tokens` 会拿到空 `content`**：额度会被 `reasoning_content` 吃光
      （实测 `max_tokens=10` 时 `content` 为 `null`）。沉淀调用已设为 1200。
- [ ] **`10.7.0.3:9527` 直连已被禁用**：返回 `403 直连已禁用: 本机请求必须经隐私网关
      (http://127.0.0.1:18712/v1)`。文档里那套"从东京打 .3:9527"的做法已过时；
      本机可用的入口是 `10.7.0.1:9527`（`.3:18712` 从本机不可达）。

## 🐛 真机问题

- [x] **第二条消息永远「排队中」，服务端收不到任何请求**（2026-10-14 用户真机撞到，已修）
      症状：第一条消息正常收到回复；第二条一直显示「排队中」，服务端日志里只有
      `GET /api/agent` / `GET /api/workspace` 轮询，**没有任何 `POST .../run`**；
      服务端 turn 表显示第一条已 `succeeded`。
      根因：跨境链路上 run 的长连接常被掐，而"流断了"**不一定触发 onError**
      （服务端 tee 了后台一支，回复照样落库）。这种"静默断流"下客户端已把回复捞回来、
      界面也不报错，但 **`agent.isRunning` 一直挂着 true** —— `flush()` 的守卫
      （`if (... || agent.isRunning) return`）于是把之后每条消息都挡回去，永远排队。
      （既有的 `recoverDroppedTurn` 只负责"把回复捞回来 / 重发一次"，**不收回运行态**。）
      修法：加看门狗 —— 判据用**服务端的 turn 记录**（权威）：客户端的 turn 已终态
      （succeeded/failed/interrupted）而客户端还说在跑，等 6 秒宽限期后 stopAgent
      复位客户端状态机（服务端早已跑完，停止请求是幂等的）。
      纯函数落在 `apps/mobile/src/run-watchdog.ts`，单测 `apps/mobile/test/run-watchdog.test.ts`
      （4 例，含"服务端还在 running 时绝不能误收"）。
      **注意：这是客户端修复，要重打 APK 才对现有手机生效。**
- [x] **聊天一直 401，但同一把 key 用 curl 却 200**（2026-10-14 用户真机撞到，已修）
      症状：app 聊天报 `Runtime info request failed with status 401` / 网关侧
      `401 Invalid API key`；**同一把 key 用 curl 或直接调 agent（同一段代码）都是 200**，
      只有走 HTTP 聊天这条路才 401。
      根因链（用本地回声代理抓包定位，非猜测）：
      1. CopilotKit 运行时**按设计**把入站 `authorization` 转发到 agent 上 ——
         默认黑名单只挡 `x-forwarded-*`/`x-real-ip` 之类代理头，**不挡 authorization**
         （见 `ForwardHeadersConfig` 文档与 `DEFAULT_DENY_HEADER_NAMES`）
      2. `@ag-ui/mastra` 把 agent 的 headers 塞进模型调用的 `modelSettings.headers`
      3. 于是 app 的会话令牌（`Bearer <43 字>`）**覆盖了 provider 的 apiKey**，被当模型 key 发给网关
      修法：`new CopilotRuntime({ ..., forwardHeaders: { deny: ["authorization"] } })`
      （两条运行时分支都要加）。守卫：`tests/copilotkit-forward-auth.test.ts`（验证过会红）。
      排查手段留档：`scripts/echo-proxy.py`（回声代理，只记头指纹）+ `scripts/check-sdk-call.ts`
      + `apps/server/src/index.ts` 的 `[config]` 启动自检（打印 key 长度/前缀/sha256 前 8 位）。
- [x] **聊天报 401「Runtime info request failed」且会话过期后不自愈**（2026-10-14 用户真机撞到）
      症状：自己的 API 全部正常（`/api/workspace` 200），唯独聊天一直 401，
      且**必须冷启动 App 才恢复**。
      成因：服务端会话 24 小时过期；`api.ts` 的 401 续期只更新自己的副本并 `saveToken`，
      **不更新 `App.tsx` 的 `token` state**；而 CopilotKit Provider 的 headers 正是从这个
      state 来的，它不走那条续期钩子 —— 于是永远拿着死令牌。
      修复：续期成功后 `setToken(session.token)`（`App.tsx`），库侧 `setHeaders` 的 effect
      会把新令牌同步给 runtime 客户端。已加回归守卫 `apps/mobile/test/token-refresh.test.ts`
      （验证过：撤掉修复即红）。
      **注意：要重打 APK 才对现有手机生效** —— 当前包遇到同样情况仍是冷启动解决。

## 🟢 产品与杂项

- [ ] **人设编辑器** —— 角色现在是磁盘文件，用户改不了；已有 `SCHEMA.md` 图纸 + 14 个样板可用
- [ ] **角色资产授权边界** —— `apps/server/personas/{templates,runtime}` 源自柳如烟，为
      **CC BY-NC-ND 4.0**（禁再分发 / 禁演绎），已 gitignore 不入库、未拷立绘。**对外分发的产物
      必须自行撰写角色内容**，只可借鉴结构。详见 `apps/server/personas/ORIGIN.md`。
- [ ] **Deva（Linux 实验台）** —— 是否做 systemd 常驻；550B 已恢复健康，是否从 `super-120b` 换回
