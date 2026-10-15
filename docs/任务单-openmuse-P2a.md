# 任务单：nanoMuse 机制落地 P2a —— 记忆整理的"代码裁决"三条硬规则 + 可回滚日志

> 派单时间：2026-10-15 · 受派：dsh（DeepSeek Harness，本机 3080）
> 来源：`docs/nanoMuse-调研.md` §4.5（记忆：模型提案 / 代码裁决）+ §7 第 4 条
> 工程仓库：**副本** `/home/ubuntu/openmuse-dsh`（分支 `apk/preview`）
> 派单前基线（派单方已测）：`pnpm test` **661/661**、`pnpm typecheck` 干净

## 0. 一句话

nanoMuse 的记忆整理是「**模型提案、代码裁决**」：合并只能用原句里出现过的词（防凭空造词）、
**永不删用户手写条目**、单次删改有上限、每次改动写日志**可回滚**。
OpenMuse 已有沉淀（`memory-sediment.ts`）与形式归并（`memory-dedupe.ts`），**缺的正是这层裁决**。
本次把裁决层补上。**只借机制，不搬代码**（GPL 红线）。

## 1. 硬约束（违反任一条即不合格）

1. **许可红线**：nanoMuse 全仓 GPL-3.0-or-later，**禁止复制其任何源码/文件/提示词文本**；照设计自己实现。
2. 不读、不写、不打印任何凭据文件（`.env` / `/etc/dsh-web.env` / key）。
3. **不 commit、不 push**：改完留在工作区等人工 review。
4. **不装新依赖**（确实需要就写进回报，别自行安装）。
5. **回归必须绿**：`pnpm test` 全绿（基线 **661/661**）、`pnpm typecheck` 干净。
   **不许改既有测试文件**（`tests/memory-dedupe.test.ts`、`tests/memory-sediment.test.ts` 一字不动）——
   新用例一律放**新文件**；既有测试就是本单的回归锁。
6. **范围**：只改 `apps/server/src/**` + 新增 `tests/**`。`apps/mobile/` 不动，路由/UI 本次不接。
7. **绝不碰线上**：在副本 `/home/ubuntu/openmuse-dsh` 里做；**不要**碰 `/home/ubuntu/openmuse`（线上服务 tsx 直跑源码）。
   不要 `systemctl` 重启任何服务。
8. **每改完一个文件立刻** `pnpm exec tsc -p tsconfig.json --noEmit`；报错当场修，不许带着错误继续改下一个。
9. 不许留 `*.bak`、临时脚本、数据目录、`console.log` 调试残留。

## 2. 交付内容

### 2.1 新增纯裁决模块 `apps/server/src/engine/memory-adjudicate.ts`（纯函数，不碰 IO）

**(a) 词表约束 —— 合并/改写产物不得凭空造词**

- `tokenizeForCompare(text: string): string[]`
  —— ASCII 按 `\p{L}\p{N}` 连续段切（小写化）；**CJK 按二元组**（连续汉字段做 2 字滑窗，长度 1 的字段取其自身）。
  归一化复用 `normalizeMemoryText()`（`memory-dedupe.ts:45`）的同一套思路（全角转半角 / 小写 / 去标点），**不要另造一套**。
- `unknownWords(nextText: string, allowedSources: readonly string[]): string[]`
  —— 返回 `nextText` 里**未在** `allowedSources` 任一文本中出现过的词（去重、稳定顺序）。
- `allowRewrite(nextText, allowedSources, opts?: { allowUnknown?: number })`
  → `{ ok: boolean; unknown: string[]; reason?: string }`：`unknown.length > (allowUnknown ?? 0)` 即 `ok:false`。

**(b) 删除上限**

- `planRemoval(total: number, wouldDrop: number, opts?: { maxRatio?: number; keepAtLeast?: number }): number`
  —— 返回**实际允许删多少条**：单次最多删 `floor(total * (maxRatio ?? 0.2))`，且删后总数不得低于 `keepAtLeast ?? 4`；
  两条上限取更严者；`total <= keepAtLeast` 或算出来 ≤0 时返回 0。边界：`total=5,wouldDrop=3` → 1 条；`total=10,wouldDrop=5` → 2 条。

**(c) 用户手写保护判定（保守）**

- `isUserAuthored(record): boolean` —— **只有**明确标记为机器沉淀（`source === "自动沉淀"`，见
  `memory-sediment.ts:269`）的条目才**不**算用户手写；其余一律算用户手写：`source` 缺失、REST 写入
  （`routes.ts:156` 起的接口）、工具写入、文本含 `<!-- locked -->` 标记（`memory-dedupe.ts:23` 已提到该约定）。
- `protectedIds(records): Set<string>`。

### 2.2 接进既有两处（**不要重写它们**，只挂守卫）

- **`memory-dedupe.ts`**：自动删除只有两处 —— `:157`（`rememberMemory` 的归并吸收）与 `:187`（`dedupeOwnerMemories` 的全量归并）。
  1. `dedupeOwnerMemories()`（`:164`）：先算 `protectedIds` 与 `planRemoval`，**只对允许范围内的 absorbed 执行删除**；
     被守卫挡下的记录原样保留（不删、不改其 text）。
     返回值**新增**字段 `skippedByGuard: { dropped: string; keeper: string }[]`（既有字段名与含义一字不改）。
  2. `rememberMemory()`（`:127`）：同 key 归并时**不得吸收用户手写条目** —— 若分组里存在用户手写条目，
     以它作 keeper；若候选本身是用户手写而既有是机器沉淀，keeper 取候选。
  3. **行为兼容**：对"全部为机器沉淀、删改在限内"的输入，返回值与改造前**逐字一致**（这是本单最重要的验收点）。
- **`memory-sediment.ts` 的 revise 分支（`:277-289`）**：模型改写出的文本先过 `allowRewrite()`，
  词表 = `{ 该条原记忆的 text ∪ 本轮 userText }`（**不含助手回复** —— 防止模型自说自话被固化成"用户事实"）。
  不过 → **丢弃这条 revise**（不改写、不新建、不动原记录），并把原因与未知词写进 outcome 的新增字段
  `rejected: { id: string; text: string; unknown: string[] }[]`（既有字段不动）。
  同时：`add` 分支不需要词表约束（新事实本来就来自本轮对话），但**必须保留**现有的 `looksLikeSecret` 与去重行为。

### 2.3 可回滚日志

- 每次自动整理/沉淀造成的落库改动写一条 `records` 行：**`kind='memory-log'`**（沿用 `db.ts` 的通用 `put/list`，**不新建表**）。
  字段：`{ id, at, action: "sediment-add" | "sediment-revise" | "dedupe-merge", owner, before: [...], after: [...], reason }`。
  `before`/`after` 存**足以还原**的最小快照（被删条目完整 data、被改写条目的旧 `text`+旧 `temp`、被新增条目的 id）。
  日志写入失败**不得**影响主流程（静默降级，但要在 outcome 里标记）。
- `rollbackMemoryLog(store, owner, logId): Promise<{ restored: number; removed: number }>`
  —— 按日志把 owner 的记忆恢复到该条日志的 `before` 状态；**幂等**（同一条日志回滚两次结果相同）。
  导出给日后接 API 用，本单**不接路由/UI**。

### 2.4 测试（新文件；≥24 例）

- `tests/memory-adjudicate.test.ts`（≥14 例）：词表约束（中文二元组、英文词大小写、全角标点差异、允许源确实含该词、
  凭空造词被拒并给出 unknown、空产物、单字字段、混合中英）；删除上限（20% 向下取整、至少留 4、`total<=4` 一个不删、
  `wouldDrop=0`、上限取更严者）；手写保护（`source` 缺失 / `"自动沉淀"` / `<!-- locked -->` / REST 写入形态）。
- `tests/memory-guards.test.ts`（≥10 例，内存 store，风格照抄 `tests/memory-dedupe.test.ts` 的假 store）：
  混合数据下**用户手写条目零删除**；超额删除被截断且删后总数 ≥4；revise 造新词被拒**且原记录未被改**；
  `memory-log` 落库字段完整；`rollbackMemoryLog` 真能还原被删条目 + 二次回滚幂等；
  **纯机器数据**的归并结果与改造前一致（回归锁，逐字比对返回值）。

## 3. 回报格式（写到 `docs/任务单回报-openmuse-P2a.md`，同时 stdout 打一份）

```
## 做到了什么（逐条对应上面的编号）
## 证据
- pnpm test：<通过数>/<总数>   （基线 661）
- pnpm test 连续两次 / typecheck 输出
- git status --short 的文件清单
- grep -rn "store.remove" apps/server/src 的输出
- 每个 memories 写入点的来源分类表（文件:行 → 机器/用户）
## 没做到 / 存疑
## 建议的下一单（≤5 行）
```

## 4. 参考

- `docs/nanoMuse-调研.md` §4.5 / §7 第 4 条 —— **只作设计对照**；发现与代码不符以代码为准，并在回报里指出。
- 既有模块：`apps/server/src/engine/memory-{dedupe,sediment,temperature}.ts`；测试风格：`tests/memory-dedupe.test.ts`。
- 命名与注释风格：中文、说"为什么"而不是复述代码；函数导出即写清契约。
