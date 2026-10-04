/**
 * 输入/上传的**限制类常量**（一处定义，客户端各处引用）。
 *
 * 对标 Muse：那边的上限是**显式且可被远端配置**的，超限是带类型的异常 + 说人话的文案
 * （`AttachmentTooLargeException`、`文件过大。上限是%1$s MB`、`你最多可附加%1$d项内容`、
 * `已输入%1$d个字符，最多不能超过%2$d个字符`）。我们的问题不是"没有限制"，而是
 * **限制藏在服务端、且只在传完之后才发作**——所以这里把数字提到客户端，选完就判。
 */

/**
 * 单文件上传上限（MB）——**必须与服务端的 bodyLimit 一致**
 * （`apps/server/src/app.ts` 的 `maxSize: 12 * 1024 * 1024`）。
 * 比服务端松 → 用户传完才失败（正是要消灭的体验）；比服务端紧 → 明明能收的文件被本地拦掉。
 * `test/limits.test.ts` 会去读服务端那个字面量核对：改一边不改另一边就会红。
 */
export const MAX_UPLOAD_MB = 12;

/**
 * 输入框字符上限。Muse 的上限由服务端下发，我们还没有服务端值，取与计算机工作区
 * （`computer-workspace.tsx` 的 16000）同一量级；只在临界时才显示计数，平时不打扰。
 */
export const MAX_MESSAGE_CHARS = 16000;

/** 一条消息最多附加几份工作区文档（Muse：`你最多可附加%1$d项内容`）。 */
export const MAX_ATTACHMENTS = 10;

/** 剩余多少字符开始显示计数。 */
export const COUNTER_VISIBLE_FROM = 200;

/** 给人看的 MB 数：12 / 3.4（不摆无意义的小数位）。 */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)}` : mb.toFixed(1).replace(/\.0$/, "");
}

/**
 * 选完文件/图片就先判体积。返回 undefined = 放行；返回字符串 = 直接给用户的错误文案。
 */
export function tooLargeMessage(name: string, bytes?: number): string | undefined {
  if (bytes === undefined || bytes <= MAX_UPLOAD_MB * 1024 * 1024) return undefined;
  return `文件过大。上限是 ${MAX_UPLOAD_MB} MB（「${name}」是 ${formatMb(bytes)} MB）。`;
}

/** 输入框计数文案：离上限还远时返回 undefined（不显示）。 */
export function messageCounterLabel(length: number): string | undefined {
  const left = MAX_MESSAGE_CHARS - length;
  if (left <= 0) return `已达到 ${MAX_MESSAGE_CHARS} 个字符的上限`;
  if (left > COUNTER_VISIBLE_FROM) return undefined;
  return `还可输入 ${left} 个字符`;
}
