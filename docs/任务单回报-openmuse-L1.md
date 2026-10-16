# 任务单回报：openmuse-L1 —— 给浏览类工具补 `targets()` 声明

> 执行：`openmuse-L2`（收尾轮：核对 + 跑门禁 + 写回报）
> 单子：`docs/任务单-openmuse-L1.md` · 收尾单：`docs/任务单-openmuse-L2.md`
> 工作目录：`/root/work/openmuse-local` · 分支：`apk/preview`
> 说明：L1 的代码改动已在工作树里；本轮**只核对、跑门禁、写回报**，未新增功能、未动其他文件。

---

## 1. 核对结果（对着 L1 §1 逐条）

**结论：四条全部符合，无需就地修改。**

| L1 要求 | 现场 | 判定 |
|---|---|---|
| §1.1 新模块 `hostFromUrl(raw: unknown): string \| null`；只收 string、`new URL()`、只认 http/https、其余 null、返回小写 hostname 且保留非默认端口、不抛/无副作用、文件头注释说明为何不做异步/网络校验 | `apps/server/src/engine/targets.ts`：函数在 L27-38，文件头注释 L1-13 明确写了「同步 / 纯函数 / 不抛」三条理由 | ✅ |
| §1.2 `NeutralTool` 加 `targets?`；`instrument()` 透传 | `tool-kit.ts` L34-40（接口字段 + 注释）、L110-111（透传）；`withActivity` 用 `{...tool}` 展开也天然保留 | ✅ |
| §1.3 三个浏览类工具声明 `targets`：`browse_web` / `read_pages` / `watch_page`；单 url→域名，url 数组→去重（空数组→空数组）；`search_web`（query）/`page_act`（动作）不硬塞 | `chat-tools.ts`：helper L125-138，接线 `browse_web` L211、`read_pages` L279、`watch_page` L415；`search_web`（L232）与 `page_act`（L474）均未声明 | ✅ |
| §1.4 新测试 `tests/tool-targets.test.ts`：`hostFromUrl` ≥8 例 + ≥1 条 `instrument()` 接线例，风格对齐既有用例 | 共 12 个 test：`hostFromUrl` 9 例（L23-62）、假工具经 `instrument` 接线 2 例（L68-112）、`chatTools()` 真接线 1 例（L118-143）；`node:test` + `node:assert/strict` | ✅ |

补充核对（关键接线点，确认不是"声明了但读不到"）：

- `monitorInputSchema`（`watch_page` 的参数）确实有 `url: z.url().max(4096)`（`packages/domain/src/agent.ts` L249），所以 `targetHostsFromUrl` 读 `args.url` 是对的。
- `chatTools()` 返回的是 `withActivity(ctx, [...])`；`withActivity` 用 `{...tool}` 重建（`live-activity.ts` L148），`targets` 不丢。
- 两条引擎（`forAgUi` / `forMastra`）都先过 `instrument()`；`instrument` 的 `execute` 闭包把**原始 tool** 交给 `runToolCall`，`runToolCall` 在 L401 同步读 `tool.targets?.(args)` —— 目标能真正到达授权判定那一步。
- `normalizeTargets()`（`approvals.ts` L190-199）接受 string / string[] / null / undefined，去重去空白、跳过非字符串，与本单两个 helper 的返回形状兼容。

---

## 2. 改动清单

| 文件 | 关键行号 | 一句话说明 |
|---|---|---|
| `apps/server/src/engine/targets.ts`（**新增**，38 行） | L1-13 文件头注释；L27-38 `hostFromUrl` | 同步纯函数：`new URL()` + 只认 http/https + `parsed.host \|\| null`（`url.host` 天然小写、默认端口省略、非默认端口保留）。 |
| `apps/server/src/engine/tool-kit.ts`（改） | L34-40（接口字段）；L110-111（透传） | `NeutralTool` 增加 `targets?: (args: unknown) => unknown;`，并在 `instrument()` 返回对象上原样透传。 |
| `apps/server/src/engine/chat-tools.ts`（改） | L24 import；L125-127 `targetHostsFromUrl`；L129-138 `targetHostsFromUrls`；L211 / L279 / L415 三处声明 | 浏览类工具把参数里的 URL 折算成授权目标（单 url → 域名；url 数组 → 去重数组）；`search_web` / `page_act` 故意不声明。 |
| `tests/tool-targets.test.ts`（**新增**，143 行） | L23-62（9 例）；L68-112（2 例）；L118-143（1 例） | 覆盖 `hostFromUrl` 解析规则 + `instrument()` 不丢 `targets` + `chatTools()` 真接线。 |

工作树状态（`git status --porcelain`）：

```
 M apps/server/src/engine/chat-tools.ts
 M apps/server/src/engine/tool-kit.ts
?? apps/server/src/engine/targets.ts
?? "docs/\344\273\273\345\212\241\345\215\225-openmuse-L1.md"
?? "docs/\344\273\273\345\212\241\345\215\225-openmuse-L2.md"
?? tests/tool-targets.test.ts
```

（`docs/任务单-*.md` 是派单文档，不是本轮改的代码；无 `package.json` / lockfile 变更，无临时文件残留。）

---

## 3. 门禁（真实输出，原样粘贴）

### 3.1 `pnpm typecheck` —— rc=0

命令与结果：`pnpm typecheck > /tmp/typecheck.log 2>&1; rc=$?` → `RC=0`。

完整输出（本命令全部输出只有这两行）：

```
$ tsc --noEmit && pnpm --dir apps/mobile typecheck
$ tsc --noEmit
```

### 3.2 `./node_modules/.bin/tsx --test tests/tool-targets.test.ts` —— rc=0，12/12 全绿

命令与结果：`./node_modules/.bin/tsx --test tests/tool-targets.test.ts > /tmp/tool-targets.log 2>&1; rc=$?` → `RC=0`。

输出尾部（原样粘贴 `tail -40`）：

```
  ...
# Subtest: hostFromUrl：空字符串 → null
ok 8 - hostFromUrl：空字符串 → null
  ---
  duration_ms: 0.20736
  type: 'test'
  ...
# Subtest: hostFromUrl：非字符串 → null
ok 9 - hostFromUrl：非字符串 → null
  ---
  duration_ms: 0.511703
  type: 'test'
  ...
# Subtest: 接线：instrument() 之后 targets 仍可读，且在同一份 args 上返回预期域名
ok 10 - 接线：instrument() 之后 targets 仍可读，且在同一份 args 上返回预期域名
  ---
  duration_ms: 6.960456
  type: 'test'
  ...
# Subtest: 接线：数组目标经 instrument() 后去重且可读
ok 11 - 接线：数组目标经 instrument() 后去重且可读
  ---
  duration_ms: 1.099448
  type: 'test'
  ...
# Subtest: 真接线：browse_web / watch_page / read_pages 声明了 targets
ok 12 - 真接线：browse_web / watch_page / read_pages 声明了 targets
  ---
  duration_ms: 25.634638
  type: 'test'
  ...
1..12
# tests 12
# suites 0
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3171.042673
```

两条命令均**前台**跑完拿到 rc 后才继续。

---

## 4. 没做 / 没验证的事

- **没跑全量 `pnpm test`** —— 按单子 §2 明确要求，全量由派单方跑。
- **没跑 `pnpm lint` / `biome check`** —— 单子只要求 typecheck + 新测试两条门禁。
- **没做端到端授权链路验证**：没有用真实 `ApprovalBackend` 走「审批 → 按目标写授权 → `acquireGrant` 命中放行」；本单只覆盖到「`targets()` 折算正确 + 经 `instrument()` 不丢」。真实审批/replay 行为未测。
- **没做真实联网校验**：`hostFromUrl` 是纯字符串解析，按设计不解析 DNS、不发请求，也没有必要联网验证。
- **没验证 UI / App 侧**：无客户端改动。
- **没改动的红线项（全部遵守）**：未 commit / 未 push；未改 `package.json` / lockfile；未装任何依赖（含 `pnpm dlx`）；未改 `tests/` 下既有文件；未碰 `/home/ubuntu`；回报与回答里无任何凭据。

---

## 5. 风险点 / 存疑

1. **`targets` 的语义边界**：它只表达「这次调用要去往的授权目标」，**不参与**审计里的 `target` / `egressTarget`，也不改变工具是否要审批。不声明 = 不限定目标 = 改造前行为（普通授权照样放行）；声明了才可能出现「限定目标的授权」匹配。取的是 `url.host`（**含非默认端口**），不是 `hostname`：所以 `https://a.com:8443/x` → `a.com:8443`，而 `:443` / `:80` 会被 URL 规范省略。IPv6 会得到 `[::1]:8080` 这种形状——单子未规定，属未覆盖边界。
2. **`search_web` 的真实缺口（值得下一单看）**：它没有自然单一目标（query 不是目标），但 `read > 0` 时会实际去抓搜索引擎返回的若干个结果页——**这是一次真实外发，却拿不到"限定目标"授权**，只能整工具走审批。单子明确让「不要硬塞」，本轮遵守，但这是有意留下的语义缺口。
3. **`page_act` 有可选 `url` 参数但故意不声明**：单子点名「动作类不硬塞」。后果是给 `page_act` 的授权无法按目标收窄（`url` 省略时本来也依赖当前页面）。同理 `page_elements` / `look_page` 有可选 `url`、`site_account` 有可选 `url`，均未声明——都不在本单规定范围内，未擅自扩。
4. **`instrument()` 里那行 `targets: tool.targets` 与 `...tool` 重叠**：真正让 `runToolCall` 读到目标是「execute 闭包把原始 `tool` 传给 `runToolCall`」，显式那一行保证的是 `instrument()` 包装后的对象仍暴露 `.targets`（供测试 / 未来包装读）。不影响行为，但旁边注释「咽喉的授权判定才读得到目标」的措辞容易被读成"咽喉读的是返回对象"——属**表述**问题，按"不擅自扩范围"未改。
5. **`targets()` 抛错会向上抛**：`runToolCall` L401 没有 try/catch 包住 `tool.targets?.(args)`。本单只接 `hostFromUrl`（保证不抛），但后续给别的工具声明 `targets` 时必须继续守「同步、不抛」这条契约，否则畸形参数会直接打断工具调用。
6. **`read_pages` 的 zod 是 `.min(1)`**：模型侧传不出空数组，`targetHostsFromUrls` 的「空数组 → 空数组」只是防御性分支（有测试钉住）。
