/**
 * 记忆裁决 —— 合并/改写的硬约束与删除上限。
 * 纯函数，不碰 IO。
 */

const HAN = /\p{Script=Han}/u;
const WORDISH = /[\p{L}\p{N}]/u;

/**
 * 分词用的折叠：与 `normalizeMemoryText()` 同一套思路（全角转半角 / 小写 / 去标点）。
 *
 * 唯一的区别是**保留标点与空白当分隔符**：`normalizeMemoryText()` 把它们直接抹掉，
 * 那适合"两条是不是同一句"的整串比较，却会让相邻英文词粘成一个词、让被标点隔开的
 * 汉字粘成一段。分词需要边界，所以这里不抹掉、只当分隔。
 */
function foldForTokenize(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/**
 * 分词：ASCII/字母数字按连续段切（小写化，一段作一词）；
 * CJK 按二元组（连续汉字段做 2 字滑窗，长度 1 的字段取其自身）。
 *
 * 标点、空白只作分隔符，本身不产生词 —— 于是「我的代号是「白虎」」被拆成
 * 「我的代号是」与「白虎」两个连续汉字段，不会造出「是白」这种跨界二元组。
 */
export function tokenizeForCompare(text: string): string[] {
  const norm = foldForTokenize(text);
  const tokens: string[] = [];
  let i = 0;
  while (i < norm.length) {
    if (!WORDISH.test(norm[i]!)) {
      i++;
      continue;
    }
    const isHan = HAN.test(norm[i]!);
    let j = i;
    while (j < norm.length && WORDISH.test(norm[j]!) && HAN.test(norm[j]!) === isHan) {
      j++;
    }
    const segment = norm.slice(i, j);
    if (isHan) {
      if (segment.length === 1) {
        tokens.push(segment);
      } else {
        // 滑窗二元组
        for (let k = 0; k < segment.length - 1; k++) {
          tokens.push(segment.slice(k, k + 2));
        }
      }
    } else {
      // 字母数字连续段：整段作一词
      tokens.push(segment);
    }
    i = j;
  }
  return tokens;
}

/**
 * 返回 nextText 中未在 allowedSources 任一文本中出现过的词（去重、稳定顺序）。
 */
export function unknownWords(
  nextText: string,
  allowedSources: readonly string[]
): string[] {
  const allowed = new Set<string>();
  for (const src of allowedSources) {
    for (const t of tokenizeForCompare(src)) {
      allowed.add(t);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokenizeForCompare(nextText)) {
    if (allowed.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 模型改写的词表约束检查。
 * @param nextText 模型给出的新文本
 * @param allowedSources 允许的来源文本（原记忆 + 本轮 userText）
 * @param opts 可选：{ allowUnknown } 未知词容忍度，默认 0
 * @returns { ok, unknown, reason? }
 */
export function allowRewrite(
  nextText: string,
  allowedSources: readonly string[],
  opts: { allowUnknown?: number } = {}
): { ok: boolean; unknown: string[]; reason?: string } {
  const unknown = unknownWords(nextText, allowedSources);
  const limit = opts.allowUnknown ?? 0;
  if (unknown.length > limit) {
    return {
      ok: false,
      unknown,
      reason: `出现 ${unknown.length} 个原句中没有的词：${unknown.join("、")}`,
    };
  }
  return { ok: true, unknown };
}

/**
 * 删除上限：返回实际允许删多少条。
 * 单次最多删 floor(total * (maxRatio ?? 0.2))，且删后总数不得低于 keepAtLeast ?? 4；
 * 两条上限取更严者；total <= keepAtLeast 或算出来 ≤0 时返回 0。
 */
export function planRemoval(
  total: number,
  wouldDrop: number,
  opts: { maxRatio?: number; keepAtLeast?: number } = {}
): number {
  const maxRatio = opts.maxRatio ?? 0.2;
  const keepAtLeast = opts.keepAtLeast ?? 4;
  if (total <= keepAtLeast) return 0;
  const cap1 = Math.floor(total * maxRatio);
  const cap2 = total - keepAtLeast;
  let allowed = Math.min(cap1, cap2, wouldDrop);
  if (allowed <= 0) return 0;
  return allowed;
}

/**
 * 判定是否为用户手写条目（保守）。
 * 只有明确标记为机器沉淀（source === "自动沉淀”）的条目才不算用户手写；
 * 其余一律算用户手写：source 缺失、REST 写入、工具写入、文本含 <!-- locked --> 标记。
 */
export function isUserAuthored(record: {
  id?: string;
  source?: string;
  text?: string;
}): boolean {
  const text = typeof record.text === "string" ? record.text : "";
  if (text.includes("<!-- locked -->")) return true;
  return record.source !== "自动沉淀";
}

/**
 * 返回用户手写条目的 id 集合。
 */
export function protectedIds(records: readonly { id: string }[]): Set<string> {
  const set = new Set<string>();
  for (const r of records) {
    if (isUserAuthored(r)) {
      set.add(r.id);
    }
  }
  return set;
}