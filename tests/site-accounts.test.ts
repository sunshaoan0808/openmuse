import assert from "node:assert/strict";
import test from "node:test";
import { chatTools, type ChatToolContext } from "../apps/server/src/engine/chat-tools.ts";
import {
  createSiteAccount,
  findSiteAccount,
  forgetSiteAccount,
  generatePassword,
  listSiteAccounts,
  passwordTail,
} from "../apps/server/src/site-accounts.ts";
import type { Store } from "../apps/server/src/db.ts";

/** 最小内存 store：site-accounts 只用到 put/list/get/remove 这四个 */
function memoryStore(): Store {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (owner: string, kind: string) => {
    const key = `${owner}/${kind}`;
    let t = tables.get(key);
    if (!t) tables.set(key, (t = new Map()));
    return t;
  };
  return {
    async put(owner: string, kind: string, value: { id: string }) {
      table(owner, kind).set(value.id, value as Record<string, unknown>);
      return value as never;
    },
    async get(owner: string, kind: string, id: string) {
      return (table(owner, kind).get(id) as never) ?? undefined;
    },
    async list(owner: string, kind: string) {
      return [...table(owner, kind).values()] as never;
    },
    async remove(owner: string, kind: string, id: string) {
      table(owner, kind).delete(id);
    },
  } as unknown as Store;
}

const AMBIGUOUS = /[OolI10]/;

test("自动生成的密码够长、四类字符齐全、且没有易混字符", () => {
  for (const length of [12, 20, 32, 64]) {
    const password = generatePassword(length);
    assert.equal(password.length, length);
    assert.match(password, /[a-z]/, "缺小写");
    assert.match(password, /[A-Z]/, "缺大写");
    assert.match(password, /[0-9]/, "缺数字");
    assert.match(password, /[^a-zA-Z0-9]/, "缺符号");
    // 用户要看着屏幕把密码抄进网页，易混字符会抄错
    assert.doesNotMatch(password, AMBIGUOUS, `长度 ${length} 的密码出现了易混字符`);
  }
});

test("每次生成的密码都不一样（不是固定串）", () => {
  const seen = new Set(Array.from({ length: 200 }, () => generatePassword(16)));
  assert.ok(seen.size > 190, `200 次只出了 ${seen.size} 个不同密码，随机性不足`);
});

test("长度被夹在 12..64，越界输入不会崩", () => {
  assert.equal(generatePassword(4).length, 12);
  assert.equal(generatePassword(999).length, 64);
  assert.equal(generatePassword(Number.NaN).length, 20);
});

test("create 落库后能用站点名/登录名/id 找回，且 list 只给脱敏视图", async () => {
  const db = memoryStore();
  const { account, password } = await createSiteAccount(db, "local-user", {
    site: "GitHub",
    url: "https://github.com/join",
    username: "zhaozilong@example.com",
  });

  assert.equal(account.password, password);
  assert.equal(account.passwordTail, passwordTail(password));

  // 三种 key 都要能命中
  assert.equal((await findSiteAccount(db, "local-user", account.id))?.site, "GitHub");
  assert.equal((await findSiteAccount(db, "local-user", "github"))?.id, account.id);
  assert.equal(
    (await findSiteAccount(db, "local-user", "ZHAOZILONG@EXAMPLE.COM"))?.id,
    account.id,
  );

  // list 绝不能带明文
  const [listed] = await listSiteAccounts(db, "local-user");
  assert.equal("password" in listed, false, "list 泄露了明文密码");
  assert.equal(listed.passwordTail, passwordTail(password));

  // 别人的 owner 看不到
  assert.equal(await findSiteAccount(db, "someone-else", "GitHub"), null);
  assert.deepEqual(await listSiteAccounts(db, "someone-else"), []);
});

test("forget 真的删掉了记录", async () => {
  const db = memoryStore();
  const { account } = await createSiteAccount(db, "local-user", {
    site: "Notion",
    username: "me",
  });
  assert.ok(await forgetSiteAccount(db, "local-user", "Notion"));
  assert.equal(await findSiteAccount(db, "local-user", account.id), null);
  assert.equal(await forgetSiteAccount(db, "local-user", "Notion"), null);
});

test("site_account 工具已挂上，且 create 缺 site/username 会明确报错", async () => {
  const db = memoryStore();
  const ctx = {
    service: { db },
    owner: "local-user",
    threadId: "t1",
    requestKey: "key",
    key: () => "key",
    signal: new AbortController().signal,
  } as unknown as ChatToolContext;

  const tools = chatTools(ctx);
  assert.ok(
    tools.map((entry) => entry.name).includes("site_account"),
    "工具没注册进 chatTools",
  );

  const tool = tools.find((entry) => entry.name === "site_account")!;
  // create 缺必填项 → 抛错而不是默默建个残缺账户
  await assert.rejects(() => tool.execute({ action: "create", username: "me@example.com" }), /site/);

  const created = (await tool.execute({
    action: "create",
    site: "GitHub",
    username: "me@example.com",
  })) as { password: string; passwordTail: string };

  // 明文只在 create 返回一次
  assert.ok(created.password.length >= 12);
  assert.equal(created.passwordTail, passwordTail(created.password));

  // get 能取回明文，list 不能
  const got = (await tool.execute({ action: "get", key: "GitHub" })) as { password: string };
  assert.equal(got.password, created.password);

  const listed = (await tool.execute({ action: "list" })) as {
    accounts: Record<string, unknown>[];
  };
  assert.equal("password" in listed.accounts[0], false);
});
