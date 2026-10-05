/**
 * 网站账户（注册账号）—— 对标 Muse 的"注册/连接一个网站账户"能力。
 *
 * 分工：
 *  - `generatePassword` 产出**强且能被打出来**的密码（去掉易混字符，保证字符类）
 *  - `createSiteAccount` 把"站点 + 登录名 + 密码"落库，作为注册流程的唯一事实源
 *  - `publicView` 只回密码尾部 6 位；明文只在创建那一刻返回一次
 *
 * 为什么单独建一张记录而不复用 `credentials.ts`：
 *  那边是**任务级短时凭据**（默认 30 分钟、任务结束即吊销、明文当场擦掉），
 *  而网站账户是**长期**的 —— 语义正好相反，混在一起会让"用完就销毁"的保证失效。
 *
 * 存量取舍（如实说明）：明文要能被后续的浏览器工具填进表单，所以要落库。
 * 部署在自己机器上时这与 .env 同一信任域；要再上一层可以接 KMS。
 */
import { randomInt, randomUUID } from "node:crypto";
import type { Store } from "./db.ts";

export const SITE_ACCOUNT_RECORD = "site_accounts";

/** 易混字符：0/O、1/l/I，去掉后用户能看着屏幕抄对。 */
const AMBIGUOUS = new Set(["O", "o", "l", "I", "1", "0"]);
const LOWER = "abcdefghijkmnpqrstuvwxyz"; // 无 l、o
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // 无 I、O
const DIGIT = "23456789"; // 无 0、1
const SYMBOL = "!@#$%^&*-_=+";

export const DEFAULT_PASSWORD_LENGTH = 20;

export interface SiteAccount {
  id: string;
  /** 站点显示名，例如 "GitHub" */
  site: string;
  /** 站点首页/注册页地址（可选，但强烈建议存，方便回看） */
  url?: string;
  /** 登录名：邮箱或用户名 */
  username: string;
  /** 明文密码：只在创建时返回给调用方一次；这里落库是为了后续填表/回看 */
  password: string;
  /** 后 6 位（脱敏展示用，与明文分开存） */
  passwordTail: string;
  /** 注册过程中的备注：是否已验证邮箱、是否开了 2FA、账号 ID 等 */
  note?: string;
  createdAt: string;
}

export function passwordTail(password: string): string {
  return password.length > 6 ? `…${password.slice(-6)}` : "…";
}

/**
 * 生成密码：保证每种字符类至少一个，其余在全集里随机取（用 randomInt 而非
 * Math.random，避免可预测的伪随机）。默认 20 位。
 */
export function generatePassword(length = DEFAULT_PASSWORD_LENGTH): string {
  const size = Math.min(64, Math.max(12, Math.trunc(length) || DEFAULT_PASSWORD_LENGTH));
  const pools = [LOWER, UPPER, DIGIT, SYMBOL];
  const all = pools.join("");
  // 先保证四个字符类各出一个
  const chars = pools.map((pool) => pool[randomInt(pool.length)]);
  // 再从全集补足到目标长度，最后洗牌，避免"固定位置固定字符类"
  while (chars.length < size) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export interface CreateSiteAccountInput {
  site: string;
  url?: string;
  username: string;
  /** 不传就自动生成一个强密码 */
  password?: string;
  note?: string;
  length?: number;
}

export async function createSiteAccount(
  db: Store,
  owner: string,
  input: CreateSiteAccountInput,
): Promise<{ account: SiteAccount; password: string }> {
  const password = input.password ?? generatePassword(input.length ?? DEFAULT_PASSWORD_LENGTH);
  const account: SiteAccount = {
    id: randomUUID(),
    site: input.site.trim(),
    url: input.url?.trim() || undefined,
    username: input.username.trim(),
    password,
    passwordTail: passwordTail(password),
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  await db.put(owner, SITE_ACCOUNT_RECORD, account);
  return { account, password };
}

/** 按站点名或 id 查一个账户（取明文，给浏览器工具填表用）。 */
export async function findSiteAccount(
  db: Store,
  owner: string,
  key: string,
): Promise<SiteAccount | null> {
  const needle = key.trim().toLowerCase();
  const all = await db.list<SiteAccount>(owner, SITE_ACCOUNT_RECORD);
  return (
    all.find((a) => a.id === key) ??
    all.find((a) => a.site.toLowerCase() === needle) ??
    all.find((a) => a.username.toLowerCase() === needle) ??
    null
  );
}

/** 列表：只给脱敏视图（不吐明文）。 */
export async function listSiteAccounts(db: Store, owner: string) {
  const all = await db.list<SiteAccount>(owner, SITE_ACCOUNT_RECORD);
  return all
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ password: _password, ...rest }) => rest);
}

export async function forgetSiteAccount(
  db: Store,
  owner: string,
  key: string,
): Promise<SiteAccount | null> {
  const account = await findSiteAccount(db, owner, key);
  if (!account) return null;
  await db.remove(owner, SITE_ACCOUNT_RECORD, account.id);
  return account;
}
