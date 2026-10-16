# 任务单 openmuse-L1：给浏览类工具补 `targets()` 声明

工作目录（绝对路径，所有命令都在这里跑）：`/root/work/openmuse-local`

## 0. 背景

`apps/server/src/engine/tool-executor.ts` 的 `ToolPolicy` 已支持 `targets?: (args: unknown) => unknown`
（第 74 行附近，读它的注释）：这次调用「要去往的目标」——如网页工具的域名。
机制（P2b）已合入：审批按目标逐条写授权、`acquireGrant` 只在目标都命中时放行、
缺目标时理由里点名（`missingTargets`）。**但目前没有任何工具真的声明 `targets()`**，
所以「一次只放行一个目标」这条链路是死的。本单就是把它接活。

## 1. 交付物（按顺序做，不要跳步）

1. **新模块 `apps/server/src/engine/targets.ts`**：导出同步纯函数 `hostFromUrl(raw: unknown): string | null`。
   - 只接受 `string`；用 `new URL()` 解析；只认 `http:` / `https:`；其余（非法、相对路径、`mailto:`、非字符串）返回 `null`。
   - 返回**小写 hostname**；非默认端口要保留（`https://a.com:8443/x` → `a.com:8443`）。
   - 不得抛异常、不得有副作用（它在授权判定的同步阶段被调用）。
   - 文件头写一段注释：为什么不在这里做异步/网络校验。
2. **`apps/server/src/engine/tool-kit.ts`**：`NeutralTool` 接口（第 20 行附近）加
   `targets?: (args: unknown) => unknown;`，并把 `instrument()`（第 100 行附近）里的字段**透传**到它构造的
   `ToolPolicy`。先读 `tool-kit.ts` 全文 126 行再动手：现有 `risk/readsPrivate/outward` 是怎么透传的，照抄同一条路。
3. **`apps/server/src/engine/chat-tools.ts`**：给**参数里真有 URL/域名**的浏览类工具声明 `targets`：
   `browse_web`（约 186 行）、`watch_page`（约 388 行）、`read_pages`（约 253 行）。
   - 先读这三个工具的 `parameters`（zod）确定参数名与形状：单个 url → 返回该域名；url 数组 → 返回域名数组去重（空数组就返回空数组）。
   - `search_web`（query）/`page_act`（动作）这类**没有自然目标**的工具不要硬塞。
4. **新测试 `tests/tool-targets.test.ts`**（**只允许新增文件；`tests/` 下既有文件一个字都不许改**）：
   - `hostFromUrl` ≥ 8 条用例：https 正常、http 正常、大小写混合、带非默认端口、`mailto:`、相对路径 `foo/bar`、空字符串、非字符串（`null` / `123`）。
   - ≥ 1 条接线用例：一个声明了 `targets` 的假工具（或直接取 `browse_web`）经 `instrument()` 之后，
     它的 `targets` 仍能被读到、且在同一份 args 上返回预期域名。照抄 `tests/` 里既有用例的导入/断言风格。
5. **门禁**（只跑这两条，**不要跑全量 `pnpm test`**——内存上限会 OOM，全量由派单方跑）：
   - `pnpm typecheck`（必须干净，rc=0）
   - `pnpm vitest run tests/tool-targets.test.ts`（必须全绿）
6. **写回报 `docs/任务单回报-openmuse-L1.md`**：改了哪些文件 + 关键行号；每条命令的**真实输出尾部**（粘贴，不要复述）；
   明确写出「没做/没验证的事」；已知风险点；以及你对 `targets()` 语义的两条判断依据。

## 2. 红线（违反任一条即不合格）

- **不 commit、不 push**，不改 `package.json` / lockfile。
- **不碰** `/home/ubuntu` 下任何目录（那是线上树）。本单只在本机副本。
- **不改 `tests/` 下既有文件**——改考题一律当没做。
- 禁止复制任何 GPL-3.0 / nanoMuse 的源码或提示词文本进本仓库。
- 任何凭据（key / token / 密码）不许读入文件、不许写进回报、不许出现在回答里。
- 不许声称"跑过了/通过了"而实际没跑：回报里的命令输出必须是真粘贴的。

## 3. 完成判据

上面 6 条交付物齐、`pnpm typecheck` 干净、新测试文件全绿、回报文件落盘。
派单方会自己复跑门禁并逐数比对，**自述不算证据**。
