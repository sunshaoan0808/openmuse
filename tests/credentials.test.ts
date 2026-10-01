import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  isUsable,
  listCredentials,
  mintCredential,
  resolveSecret,
  revokeCredential,
  revokeForTask,
  type StoredCredential,
  secretTail,
  sweepExpired,
} from "../apps/server/src/credentials.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

let db: Store, directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-credentials-"));
  db = await createStore({ dataDir: directory });
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("铸一把就能用，明文返回一次；列表里只回后 6 位", async () => {
  const { credential, secret } = await mintCredential(db, "local-user", {
    label: "临时 git",
    kind: "git",
    scopes: ["repo:write"],
  });
  assert.equal(
    await resolveSecret(db, "local-user", credential.id),
    secret,
    "没过期没吊销就该给明文",
  );
  const listed = await listCredentials(db, "local-user");
  const found = listed.find((item) => item.id === credential.id);
  assert.ok(found, "列表里应该在");
  assert.equal(found?.secretTail, secretTail(secret), "只露后 6 位");
  assert.equal("secret" in (found as object), false, "列表绝不能带明文");
});

test("任务结束 → 绑在它名下的凭据被显式吊销（'用完就销毁'）", async () => {
  const { credential } = await mintCredential(db, "local-user", {
    label: "给它跑任务",
    kind: "api",
    taskId: "task-abc",
  });
  assert.equal(await revokeForTask(db, "local-user", "task-abc"), 1, "应该吊销 1 把");
  await assert.rejects(
    () => resolveSecret(db, "local-user", credential.id),
    /随任务结束被销毁/,
    "吊销之后取明文要给可续接的提示",
  );
  assert.equal(await revokeForTask(db, "local-user", "task-abc"), 0, "重复调用是幂等的");
});

test("手动吊销 / 到期失效 / 过期扫描", async () => {
  const { credential } = await mintCredential(db, "local-user", { label: "手动", kind: "ssh" });
  await revokeCredential(db, "local-user", credential.id, "manual");
  await assert.rejects(() => resolveSecret(db, "local-user", credential.id), /已被吊销/);

  const past: StoredCredential = {
    ...credential,
    id: "expired-one",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    revokedAt: undefined,
  };
  assert.equal(isUsable(past), false, "过期就不可用（纯函数，不依赖真实时间流逝）");
  await db.put("local-user", "credentials", past);
  assert.equal(await sweepExpired(db, "local-user"), 1, "扫描应把过期的那把标记掉");
  const swept = await db.get<StoredCredential>("local-user", "credentials", "expired-one");
  assert.equal(swept?.revokeReason, "expired");
});
