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
- [ ] **②b 记忆自动沉淀** —— 现在**只有模型主动调 `remember_fact` 才写**，缺"这段对话值不值得记"的判断。
      上游对应 `memory_manager.py` 的提炼环节。
- [ ] **②c 记忆去重 / 归并** —— `id = sha256(owner+text)` 只能挡住**完全相同**的文本，挡不住近重复。
      库里的真实证据：`我的代号是「白虎」。` 与 `我的代号是白虎`（同一事实、不同标点）。
      另有一条**语义冲突**待人工定夺：`我的代号是「青龙」。`(03:49) vs `我的代号是「白虎」。`(04:20/06:21)。
- [ ] **③ 情绪引擎** —— 上游 `emotion_updater.py` 407 行，规则式无外部依赖，读 7 维光谱
      （人设已接入，接口现成）：`_detect_negation` / `_detect_intensity_modifier` / `_detect_subject_direction`
- [ ] **④ 社交图谱** —— 上游 `social_graph.py` 1005 行，多角色关系演化
- [ ] **⑤ 圆桌 / 多角色同席** —— 产品级差异点，等 ②③ 站住再做

## 🟢 产品与杂项

- [ ] **人设编辑器** —— 角色现在是磁盘文件，用户改不了；已有 `SCHEMA.md` 图纸 + 14 个样板可用
- [ ] **角色资产授权边界** —— `apps/server/personas/{templates,runtime}` 源自柳如烟，为
      **CC BY-NC-ND 4.0**（禁再分发 / 禁演绎），已 gitignore 不入库、未拷立绘。**对外分发的产物
      必须自行撰写角色内容**，只可借鉴结构。详见 `apps/server/personas/ORIGIN.md`。
- [ ] **Deva（Linux 实验台）** —— 是否做 systemd 常驻；550B 已恢复健康，是否从 `super-120b` 换回
