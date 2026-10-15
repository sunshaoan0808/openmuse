# 任务单 openmuse-P1d — 补齐执行咽喉缺口 + 污点追踪

> 前置：P0 工具执行收口（`3ca903d`）、P1a 审计落库（`c74868f`）、P1b 审批往返（`a967277`）、P1c App 侧审批入口 +
> 工具风险标注（`a373f79`、`18c6bb7`）均已落地。基线 `18c6bb7`，`pnpm test` 基线 **646/646**。
> 验收由派单方执行，你的自述不作为验收依据。

## 0. 环境与红线

- 工作目录：本副本根目录。**禁止** `systemctl`/服务操作；**禁止**改 `tests/` 下既有文件（`tests/tool-executor.test.ts`
  的守卫白名单是**唯一例外**：新增执行点必须同步加进去并写明理由）；禁止新增依赖；禁止改 mobile/web UI；
  禁止改控制台 `[audit] …` 那一行的格式；全量测试**必须前台跑**。

## 1. 交付物 A：补齐执行咽喉的缺口

已经查清的事实（别重复探索）：
- `computer-tools.ts` 的产物**已经**进咽喉（`model.ts:111/122`、`conversation.ts:144`、`mastra-engine.ts:106`
  都经 `forAgUi`/`forMastra` → `instrument`）；它自己的 `execute` 吞错返回 `{error}` 是**工具既有契约**，不要动。
- **真缺口一**：`apps/server/src/engine/tanstack-agent.ts` 把 `stateTools`（`AGUISendStateSnapshot`/`Delta`）
  **原样**塞进 `chat({ tools: [...] })`，没经 `instrument` → 绕过咽喉。修：让这条路径也走咽喉
  （与其他引擎同一套 `instrument` 包装，别复制粘贴第四份实现）。
- **真缺口二**：`apps/server/src/jev/tools.ts`（`present_choices` 等，`JEV_MODE=off` 时休眠；**当前无人 import**）。
  修：JEV 工具在被启用的那条路径上也要经咽喉（同 `instrument`）；若该路径当前确实无消费者，就在文件顶部写明
  「消费者必须经咽喉」并**把这条约束写进守卫测试**（见 B.3），不要留一段随时可能被接上去的裸执行点。

## 2. 交付物 B：污点追踪（读私有数据 → 外发必须审批）

1. **打污点**：经由咽喉执行、且被判定为「读了私有数据」的工具调用（至少包含已标 `moderate` 的
   `search_mail` / `read_mail_thread` / `read_image`，以及任何 `assess` 返回 `readPrivate: true` 的工具）
   → 给**该 thread** 打上「含私有数据」标记。
2. **外发强制审批**：线程带污点时，调用**外发类**工具（`site_account` / `page_act` / `git_push`，以及任何
   `assess` 返回 `egress: "review"` 的工具）**一律走审批**（即使它的 `risk` 不是 `sensitive`）：
   登记待审批 + 审计里写明**是因为污染**（`reason` 要能回答「为什么被拦」）。
3. **清污点**：用户对该次外发**批准一次**后，清除该 thread 的污点（`once` 语义）；线程结束/服务重启按实例界定。
   设计要说清并写进测试，不许含混。
4. **不误伤**：没读过私有数据的线程，调用同一个外发工具**照常按原档位判定**（`sensitive` 才拦，
   `moderate`/`safe` 放行）—— 这条必须有测试钉住。
5. **审计**：污点相关判定在审计行/事件里可区分（例如 `outcome` 或 `reason` 写明污染来源工具）。

## 3. 交付物 C：测试（新增文件 `tests/tool-taint.test.ts`，另可在既有测试文件**追加**用例）

1. 读私有数据 → 同线程外发被强制审批（含 `reason` 说明污染来源）。
2. 未读私有数据 → 同一外发工具按原档位判定（`safe`/`moderate` 放行，不拦）。
3. 批准一次外发后污点被清除（下一次同线程外发恢复按原档位判定）。
4. 换线程不受影响（污点按 thread 隔离）。
5. **守卫测试**（源码级，写进 `tests/tool-executor.test.ts` 或新的守卫文件）：把「真正执行工具的地方」
   白名单更新为**完整**清单，并断言 `tanstack-agent.ts` 与 JEV 路径都经 `instrument`/咽喉 ——
   即再出现绕过咽喉的新路径时测试变红。
6. 未声明 `risk`/`assess` 的工具行为仍与改造前**逐字一致**（返回值同一对象、抛错同一 Error 实例）。

## 4. 机械验收（派单方执行）

```bash
pnpm test        # ≥646 且 fail 0（基线 646/646）
pnpm typecheck   # 根 + apps/mobile 退出码 0
grep -n '\[audit\]' apps/server/src/engine/tool-executor.ts   # 该行仍在且格式未变
git status --porcelain tests/ apps/mobile/test/               # 既有测试文件只应出现在你明确允许修改的那一个
```

## 5. 回报

`docs/任务单回报-openmuse-P1d.md`：改了哪些文件、§4 每条命令的**原始输出**、未做项与已知边界。

## 6. 明确不做

- App 侧 UI 改动（审批入口已在 P1c 完成）；
- 给具体工具调档（用户已拍板：`page_act`/`site_account`/`git_push`=sensitive，其余写读类=moderate，别改）；
- 网关/模型侧任何事。
