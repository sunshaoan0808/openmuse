# 任务单 openmuse-L2：收尾 L1（跑门禁 + 写回报）

工作目录（绝对路径）：`/root/work/openmuse-local`

## 0. 背景

`openmuse-L1`（见 `docs/任务单-openmuse-L1.md`）已经把改动落在工作树里，但**没跑完门禁、没写回报**就中断了。
本轮只做收尾：核对 + 跑门禁 + 写回报。**不要新增功能、不要动别的文件。**

## 1. 现场（先 `git status --porcelain` 与 `git diff` 自己确认）

- 新增 `apps/server/src/engine/targets.ts`
- 改 `apps/server/src/engine/tool-kit.ts`（`NeutralTool` 加 `targets?`）
- 改 `apps/server/src/engine/chat-tools.ts`（`browse_web` / `read_pages` / `watch_page` 声明 `targets`）
- 新增 `tests/tool-targets.test.ts`

## 2. 交付物

1. **核对**：把上面四个文件的改动对着 L1 单的 §1 逐条核一遍（新模块语义、透传、三个工具的目标折算、测试覆盖点）。
   有不符的地方**就地修好**；有疑问的地方写进回报的「风险点」，不要擅自扩范围。
2. **门禁**（本仓库用的是 `node:test` + `tsx`，**没有 vitest**，别去装）：
   - `pnpm typecheck` —— 必须干净（rc=0）
   - `./node_modules/.bin/tsx --test tests/tool-targets.test.ts` —— 必须全绿
   - **不要跑全量 `pnpm test`**（由派单方跑）。这两条命令都要**前台**跑完再继续。
3. **写回报 `docs/任务单回报-openmuse-L1.md`**：
   - 改动清单：文件 + 关键行号 + 一句话说明
   - 上面两条命令的**真实输出尾部**（原样粘贴）
   - 「没做 / 没验证的事」
   - 风险点（例如：`targets` 的语义边界、哪些工具故意没声明）

## 3. 红线（违反任一条即不合格）

- **不 commit、不 push**；不改 `package.json` / lockfile；不装任何新依赖（含 `pnpm dlx`）。
- **不改 `tests/` 下既有文件**（只允许动本轮新增的 `tests/tool-targets.test.ts`）。
- **不碰** `/home/ubuntu` 下任何目录。
- 不许把任何凭据（key / token / 密码）写进文件或回答。
- 不许声称「跑过了」而实际没跑：回报里的输出必须原样粘贴。
- 长命令请前台跑并等它返回；**不要用后台 job 然后继续往下写**。

## 4. 完成判据

`pnpm typecheck` rc=0、`tests/tool-targets.test.ts` 全绿、回报文件落盘。派单方会自己复跑并逐数比对。
