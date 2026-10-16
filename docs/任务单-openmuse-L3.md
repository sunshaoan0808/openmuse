# 任务单 openmuse-L3（复验单）

## 背景
L1 的代码交付已在本地副本落地并通过独立验收（typecheck 干净、全量 751 通过 / 0 失败、`tests/` 只有新增文件 `tests/tool-targets.test.ts`）。L2 收尾单已完成并写了回报。
这一单只做**长命令复验**：验证「长命令不再被掐断」，并把结果写成回报。**不要改任何源码或测试。**

## 工作目录（绝对路径）
`/root/work/openmuse-local`

## 要求
1. 在仓库根目录**前台**依次执行下列命令，各自记录 `rc` 与耗时（秒）：
   - `pnpm typecheck`
   - `pnpm test`
   - `git status --porcelain tests/`
2. 全量测试的输出里，抄下最终的 `pass` / `fail` 计数（形如 `ℹ pass 751` / `ℹ fail 0`）。
3. 把结果写进 `docs/任务单回报-openmuse-L3-复验.md`，必须包含：
   - 三条命令的 `rc` 与耗时
   - 全量测试的 pass / fail 计数
   - `git status --porcelain tests/` 的原始输出
   - 结论一句话：门禁是否全绿、`tests/` 是否只有新增文件

## 禁止
- 不要修改 `apps/` 或 `tests/` 下任何文件（本单零代码改动）
- 不要安装任何依赖（仓库用 `node:test`/`tsx --test`，**没有 vitest**，不要装）
- 不要 `git commit` / `git push`
- 不要碰 `/root/work` 以外的仓库

## 注意（2026-10-16 更新）
- 本机 harness 的单条命令上限已从 10 分钟抬高到 60 分钟，所以上面两条命令**可以前台跑完**（全量测试实测约 937s）。给命令设 `timeoutMs` 时请给足（例如 1800000）。
- 如果仍然被掐断（出现 `BASH_TIMEOUT` / `timed out after …ms`），把错误原文和当时设的 `timeoutMs` 一起抄进回报——这是复验的关键证据。

## 完整 Bash 命令（直接照抄）

```bash
cd /root/work/openmuse-local || exit 1
echo "PWD=$(pwd)  HEAD=$(git rev-parse --short HEAD)"

echo "===== typecheck ====="; s=$(date +%s); pnpm typecheck; echo "typecheck rc=$? 耗时=$(( $(date +%s) - s ))s"

echo "===== test ====="; s=$(date +%s); pnpm test; echo "test rc=$? 耗时=$(( $(date +%s) - s ))s"

echo "===== tests/ porcelain ====="; git status --porcelain tests/
```

## 完成
把上面全部输出原样落进回报文件，然后回一句「L3-DONE」。
