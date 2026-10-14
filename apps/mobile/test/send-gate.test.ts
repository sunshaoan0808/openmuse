import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
/** 断言前先剥注释：上面的说明里就有 agent.isRunning / QueueBusyError 字样，不剥会误报 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const source = strip(readFileSync(join(root, "src/chat.tsx"), "utf8"));

/** 取某个函数体的近似片段：从它的声明到下一个顶层 const/function。 */
function bodyOf(declaration: string): string {
  const start = source.indexOf(declaration);
  assert.ok(start > 0, `chat.tsx 里应能找到 ${declaration}`);
  const rest = source.slice(start + declaration.length);
  const nextTop = rest.search(/\n {2}(?:const|function|async function|useEffect\()/);
  return nextTop > 0 ? rest.slice(0, nextTop) : rest.slice(0, 2000);
}

/**
 * 守一条"重试/发送的判据必须在服务端"的回归。
 *
 * 真机现场：静默断流（服务端 tee 了后台一支、回复照样落库，客户端收不到终态事件）
 * 让 `agent.isRunning` 永远挂着 true，而发送路径当时这样把关：
 *
 *   flush() { if (!loaded || !isReady || runLock.current || agent.isRunning) return; }
 *
 * 于是**之后每一条消息都发不出去**，永远「排队中」，服务端连一个 run 请求都收不到。
 * 服务端本来就有并发护栏（durable-runner：同轮重复忽略、同会话第二轮排队），
 * 客户端这层门禁既多余又脆弱 —— 这两条断言防它被加回去。
 */
test("发送路径不得再看 agent.isRunning 决定发不发", () => {
  const flush = bodyOf("const flush = useCallback(() => {");
  assert.ok(flush.includes("if (!loaded || !isReady) return;"), "flush 只该在会话未就绪时让位");
  assert.equal(flush.includes("agent.isRunning"), false, "flush 不得再被 agent.isRunning 挡住");
  assert.equal(flush.includes("runLock.current"), false, "flush 不得再被 runLock 挡住");
});

test("run() 里「忙」要走让位重试（QueueBusyError），不能当失败", () => {
  const run = bodyOf("const run = useCallback(");
  assert.ok(run.includes("new QueueBusyError()"), "忙/未就绪应抛 QueueBusyError（退避重试、不计失败）");
  assert.equal(
    run.includes("agent.isRunning ||"),
    false,
    "run() 不得再用 agent.isRunning 一票否决",
  );
});

test("客户端说在跑时要问服务端，判据复用同一个纯函数", () => {
  const release = bodyOf("const releaseStaleRun = useCallback(async () => {");
  assert.ok(
    release.includes("shouldReclaimRun("),
    "必须用 run-watchdog 的纯函数判断，避免两处判据漂移",
  );
  assert.ok(
    release.includes("syncConversation("),
    "判据要来自服务端的 turn 记录（它是权威）",
  );
});
