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
  secret: string;
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
  const { secret, ...rest } = credential;
  return { ...rest, secretTail: secretTail(secret), usable: isUsable(credential) };
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
      { revokedAt: new Date().toISOString(), revokeReason: reason },
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
