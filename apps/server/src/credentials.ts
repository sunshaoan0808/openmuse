/**
 * 任务级短时凭据 —— 照 Muse 的 `LinkDeviceTokenMinter.mint/revoke` +
 * `ConfidentialVmTemporaryAccess`（临时访问）+ `StoredCredentialContinuation`（失效续接）。
 *
 * 和"把长期 key 写进配置"的区别：
 *  - 铸一把就用一把，**默认 30 分钟过期**
 *  - 绑到任务上：任务一结束**显式吊销**（不是等它自己过期）
 *  - 接口里**永远只回后 6 位**，明文只在铸的那一刻返回一次，日志里不出现
 * 存量取舍（如实说明）：明文要能被后续的工具进程取用，所以落库保存；
 * 部署在自己机器上时这与 .env 同一信任域。要再上一层可以加 KMS/密封加密。
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { CredentialKind, TemporaryCredential } from "../../../packages/domain/src/agent.ts";
import type { Store } from "./db.ts";

export const CREDENTIAL_RECORD = "credentials";
export const DEFAULT_TTL_MS = 30 * 60_000;

export interface StoredCredential extends TemporaryCredential {
  /** 明文：**只在有效期内**有值，吊销时会被擦掉（只留 secretTail） */
  secret: string;
  /** 后 6 位（脱敏展示用；与明文分开存，擦掉明文后仍能显示） */
  secretTail: string;
}

export function newSecret(): string {
  return randomBytes(24).toString("base64url");
}

/** 只露后 6 位（项目铁律：密钥不进日志、不进接口回包） */
export function secretTail(secret: string): string {
  return secret.length > 6 ? `…${secret.slice(-6)}` : "…";
}

export function isUsable(credential: StoredCredential, now = Date.now()): boolean {
  return !credential.revokedAt && Date.parse(credential.expiresAt) > now;
}

export function publicView(credential: StoredCredential) {
  const { secret: _secret, ...rest } = credential;
  return { ...rest, usable: isUsable(credential) };
}

export async function mintCredential(
  db: Store,
  owner: string,
  input: {
    label: string;
    kind: CredentialKind;
    scopes?: string[];
    ttlMs?: number;
    taskId?: string;
    secret?: string;
  },
): Promise<{ credential: StoredCredential; secret: string }> {
  const now = Date.now();
  const secret = input.secret ?? newSecret();
  const credential: StoredCredential = {
    id: randomUUID(),
    secretTail: secretTail(secret),
    label: input.label,
    kind: input.kind,
    scopes: input.scopes ?? [],
    taskId: input.taskId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(60_000, input.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    secret,
  };
  await db.put(owner, CREDENTIAL_RECORD, credential);
  return { credential, secret };
}

export async function listCredentials(db: Store, owner: string) {
  const all = await db.list<StoredCredential>(owner, CREDENTIAL_RECORD);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicView);
}

export async function revokeCredential(
  db: Store,
  owner: string,
  id: string,
  reason: TemporaryCredential["revokeReason"] = "manual",
): Promise<StoredCredential | null> {
  const current = await db.get<StoredCredential>(owner, CREDENTIAL_RECORD, id);
  if (!current) return null;
  if (current.revokedAt) return current;
  return (
    (await db.compareAndSwap<StoredCredential>(
      owner,
      CREDENTIAL_RECORD,
      id,
      {},
      // 真销毁：把落库的明文擦掉，只留后 6 位 —— "用完就销毁"不该只是改个状态
      { revokedAt: new Date().toISOString(), revokeReason: reason, secret: "" },
    )) ?? current
  );
}

/** 任务收尾时调用：把这个任务名下的凭据全部吊销（"用完就销毁"）。 */
export async function revokeForTask(
  db: Store,
  owner: string,
  taskId: string,
  reason: TemporaryCredential["revokeReason"] = "task_finished",
): Promise<number> {
  const all = await db.list<StoredCredential>(owner, CREDENTIAL_RECORD);
  let revoked = 0;
  for (const credential of all)
    if (credential.taskId === taskId && !credential.revokedAt) {
      await revokeCredential(db, owner, credential.id, reason);
      revoked += 1;
    }
  return revoked;
}

/** 到期的顺手收掉（没有后台定时器也能保证下次读的时候状态是对的）。 */
export async function sweepExpired(db: Store, owner: string): Promise<number> {
  const all = await db.list<StoredCredential>(owner, CREDENTIAL_RECORD);
  let swept = 0;
  for (const credential of all)
    if (!credential.revokedAt && Date.parse(credential.expiresAt) <= Date.now()) {
      await revokeCredential(db, owner, credential.id, "expired");
      swept += 1;
    }
  return swept;
}

/** 取明文给工具用：只在"未吊销且未过期"时给，否则按 Muse 的 StoredCredentialContinuation 抛可续接的错误。 */
export async function resolveSecret(db: Store, owner: string, id: string): Promise<string> {
  const credential = await db.get<StoredCredential>(owner, CREDENTIAL_RECORD, id);
  if (!credential) throw new Error("找不到这把凭据");
  if (credential.revokedAt)
    throw new Error(
      credential.revokeReason === "task_finished"
        ? "这个任务的凭据已随任务结束被销毁，请重新铸一把。"
        : "这把凭据已被吊销，请重新铸一把。",
    );
  if (Date.parse(credential.expiresAt) <= Date.now())
    throw new Error("这把凭据已过期，请重新铸一把。");
  return credential.secret;
}

/**
 * 任务级的凭据访问器（照 Muse 的"密钥只在需要时交给执行侧"）。
 * 放进 TaskContext 后，工具可以：
 *   - `secrets.ids` / `secrets.has(id)` 看这个任务有哪些凭据
 *   - `secrets.get(id)` 取明文（**每次都重新校验**是否已吊销/过期，失效就给可续接的提示）
 *   - `secrets.redact(text)` 把文本里出现过的明文换成 …后6位（日志/事件/工具回包都该过它）
 */
export interface TaskSecrets {
  ids: string[];
  has(id: string): boolean;
  get(id: string): Promise<string>;
  redact(text: string): string;
}

export async function taskSecrets(
  db: Store,
  owner: string,
  task: { state?: Record<string, unknown> },
): Promise<TaskSecrets> {
  const ids = Array.isArray(task.state?.credentialIds)
    ? (task.state?.credentialIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  // 把明文读进闭包，redact 才有东西可替换。
  // 注意：**已吊销但库里明文还在**的也要收进来（吊销是擦库里的明文，但内存里可能还留着，
  // 之后若被写进日志仍需要能脱敏）；真正擦干净之后自然就收不到了。
  const live = new Map<string, string>();
  for (const id of ids) {
    const record = await db.get<StoredCredential>(owner, CREDENTIAL_RECORD, id).catch(() => null);
    if (record?.secret) live.set(id, record.secret);
  }
  return {
    ids,
    has: (id) => ids.includes(id),
    get: (id) => resolveSecret(db, owner, id),
    redact: (text) => {
      let out = text;
      for (const secret of live.values())
        if (secret && out.includes(secret)) out = out.split(secret).join(secretTail(secret));
      return out;
    },
  };
}
