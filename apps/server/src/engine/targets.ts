/**
 * 授权判定用的「目标」折算（P2b §2.1）。
 *
 * `ToolPolicy.targets` / `NeutralTool.targets` 声明一次调用**要去往哪里**（如网页工具的域名）。
 * 咽喉在授权判定（`acquireGrant`）那一步就要把它算出来，而那一层是**同步**的：
 * 命中一条「限定目标」的授权才可能直接放行，否则登记待审批。
 *
 * 所以这里只做**纯粹的字符串解析**：不解析 DNS、不发起网络请求、不读配置、不碰磁盘。
 *   - 同步：判定必须能在同一个 tick 内拿到结果，没有 await 的位置；
 *   - 纯函数：同样的输入永远同样输出，没有副作用，授权判定才可复现（也才好测）；
 *   - 不抛异常：调用点在判定热路径上，坏输入只能退化成「没有目标」（返回 null），
 *     绝不能让一个畸形 URL 把整条工具调用打挂。真实可达性由工具执行阶段自己去报错。
 */

/**
 * 把参数里的一个 URL 折算成授权目标（域名/主机）。
 *
 * 规则（单子 §1）：
 *   - 只接受 `string`；其余（`null` / 数字 / 对象 / `undefined`…）一律 `null`；
 *   - 用 `new URL()` 解析；解析失败（非法 URL、相对路径等）`null`；
 *   - 只认 `http:` / `https:`；`mailto:` / `ftp:` / `file:` 等一律 `null`；
 *   - 返回**小写 hostname**；非默认端口保留（`https://a.com:8443/x` → `a.com:8443`）。
 *
 * 用 `url.host`（而不是 `url.hostname`）是因为它正好覆盖上面两条：URL 规范会统一小写主机名，
 * 默认端口（443/80）会被省略，非默认端口原样带出。
 */
export function hostFromUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // `host` 可能为空串（例如 `http:///x` 这类畸形输入），空串不算目标。
  return parsed.host || null;
}
