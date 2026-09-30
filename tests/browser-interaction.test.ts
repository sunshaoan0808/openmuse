import assert from "node:assert/strict";
import test from "node:test";
import { chatInstructions } from "../apps/server/src/engine/chat-prompt.ts";
import type { ChatToolContext } from "../apps/server/src/engine/chat-tools.ts";
import { chatTools, lastUserText } from "../apps/server/src/engine/chat-tools.ts";
import { hasCjk, mergeSearchResults } from "../apps/server/src/search.ts";
import type { BrowserSession } from "../packages/domain/src/index.ts";
import { browserFixture } from "./helpers/browser.ts";

const sessionId = "00000000-0000-4000-8000-000000000001";
const savedSession: BrowserSession = {
  id: sessionId,
  title: "Saved page",
  url: "https://example.com/",
  status: "active",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

test("控制台动作按类型分流：后退/前进/刷新/视口用 worker 的独立端点，点击仍走 input", async (t) => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const { db, service } = await browserFixture(t, (path, body) => {
    calls.push({ path, body });
    return { data: { ...savedSession, url: body.url ?? savedSession.url } };
  });
  await db.put("local-user", "browsers", savedSession);

  await service.input("local-user", sessionId, { type: "back" });
  await service.input("local-user", sessionId, { type: "forward" });
  await service.input("local-user", sessionId, { type: "reload" });
  await service.input("local-user", sessionId, { type: "viewport", width: 390, height: 844 });
  await service.input("local-user", sessionId, { type: "click", x: 10, y: 20 });

  assert.deepEqual(
    calls.map((call) => call.path),
    [
      `/sessions/${sessionId}/back`,
      `/sessions/${sessionId}/forward`,
      `/sessions/${sessionId}/reload`,
      `/sessions/${sessionId}/viewport`,
      `/sessions/${sessionId}/input`,
    ],
  );
  assert.deepEqual(calls[3]?.body, { type: "viewport", width: 390, height: 844 });
});

test("控制台预览可以要 JPEG 低清帧（省字节），并带回当前页面信息", async (t) => {
  const calls: { path: string }[] = [];
  const { db, service } = await browserFixture(t, (path) => {
    calls.push({ path });
    return { data: savedSession };
  });
  await db.put("local-user", "browsers", savedSession);

  const still = await service.preview("local-user", sessionId);
  assert.equal(calls[0]?.path, `/sessions/${sessionId}/screenshot`);
  assert.equal(still.session.url, savedSession.url);

  await service.preview("local-user", sessionId, { quality: 45 });
  assert.equal(calls[1]?.path, `/sessions/${sessionId}/screenshot?format=jpeg&quality=45`);
});

test("agent 的眼与手：元素列表按 ref 返回，动作带上 ref 执行，截图交视觉模型", async (t) => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const { service } = await browserFixture(t, (path, body) => {
    calls.push({ path, body });
    if (path.endsWith("/elements") || path.endsWith("/act"))
      return {
        data: {
          url: "https://duckduckgo.com/",
          title: "DuckDuckGo",
          elements: [
            { ref: 1, role: "searchbox", label: "Search", value: "" },
            { ref: 2, role: "button", label: "Search" },
          ],
        },
      };
    // 线程会话的 id 是运行时生成的，桩必须回同一个 id，否则 save() 会判定"另一个会话"
    return {
      data: {
        ...savedSession,
        id: String(body.id ?? savedSession.id),
        url: body.url ?? savedSession.url,
      },
    };
  });

  const listed = await service.pageElementsForThread(
    "local-user",
    "thread-1",
    "https://duckduckgo.com/",
  );
  assert.equal(listed.elements.length, 2);
  assert.equal(listed.elements[0]?.ref, 1);
  assert.equal(calls[0]?.path, "/sessions");
  assert.equal(calls[1]?.path?.endsWith("/elements"), true);

  const acted = await service.actForThread(
    "local-user",
    "thread-1",
    { action: "fill", ref: 1, text: "hermes agent" },
    undefined,
  );
  assert.equal(acted.title, "DuckDuckGo");
  const submitted = calls.find((call) => call.path.endsWith("/act"));
  assert.deepEqual(submitted?.body, { action: "fill", ref: 1, text: "hermes agent" });

  const shot = await service.screenshotForThread("local-user", "thread-1");
  assert.ok(shot.bytes instanceof Uint8Array);
  assert.equal(
    calls.some((call) => call.path.includes("/screenshot?format=jpeg&quality=70")),
    true,
  );
});

test("眼与手是真正的工具，模型看得见", () => {
  const ctx = {
    service: {},
    owner: "local-user",
    threadId: "thread-1",
    requestKey: "key",
    key: () => "key",
    signal: new AbortController().signal,
  } as unknown as ChatToolContext;
  const names = chatTools(ctx).map((entry) => entry.name);
  for (const name of ["browse_web", "page_elements", "page_act", "look_page", "read_image"])
    assert.ok(names.includes(name), `缺少工具 ${name}`);
});

test("read_image 仍然把图片理解的答案带回给模型（重构视觉调用时最容易丢的东西）", async () => {
  const original = globalThis.fetch;
  process.env.OPENAI_BASE_URL = "http://vision.test/v1";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "图里是一只水豚。" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  try {
    const ctx = {
      service: {
        files: {
          list: async () => [{ id: "file-1", name: "capybara.png", mimeType: "image/png" }],
          bytes: async () => new Uint8Array([1, 2, 3]),
        },
      },
      owner: "local-user",
      threadId: "thread-1",
      requestKey: "key",
      key: () => "key",
      signal: new AbortController().signal,
    } as unknown as ChatToolContext;
    const tool = chatTools(ctx).find((entry) => entry.name === "read_image");
    assert.ok(tool, "缺少 read_image 工具");
    const answer = (await tool.execute({ file: "capybara.png" })) as {
      file?: string;
      answer?: string;
    };
    assert.equal(answer.file, "capybara.png");
    assert.equal(answer.answer, "图里是一只水豚。");
  } finally {
    globalThis.fetch = original;
  }
});

test("工具参数宽容：模型把数字写成字符串或 null 时不应让整次调用失败", () => {
  const ctx = {
    service: {},
    owner: "local-user",
    threadId: "thread-1",
    requestKey: "key",
    key: () => "key",
    signal: new AbortController().signal,
  } as unknown as ChatToolContext;
  const tools = chatTools(ctx);
  const search = tools.find((entry) => entry.name === "search_web");
  assert.ok(search, "缺少 search_web 工具");
  // 线上实测：模型把 count/read 发成字符串导致连续 4 次 "expected number, received string"
  assert.deepEqual(search.parameters.parse({ query: "金球奖 今年 得主", count: "5", read: "2" }), {
    query: "金球奖 今年 得主",
    count: 5,
    read: 2,
  });
  assert.deepEqual(search.parameters.parse({ query: "x", count: null, read: null }), {
    query: "x",
    count: 6,
    read: 0,
  });

  const act = tools.find((entry) => entry.name === "page_act");
  assert.ok(act, "缺少 page_act 工具");
  assert.deepEqual(act.parameters.parse({ action: "click", ref: "12" }), {
    action: "click",
    ref: 12,
  });
  assert.deepEqual(act.parameters.parse({ action: "scroll", deltaY: "-600" }), {
    action: "scroll",
    deltaY: -600,
  });
});

test("提示词要求处理歧义词：保留原词搜索并点名另一种解读", () => {
  const instructions = chatInstructions();
  assert.match(instructions, /金球奖/);
  assert.match(instructions, /Ballon d'Or/);
  assert.match(instructions, /numer|c number/i);
});

test("跨语言兜底：中文提问 + 英文查询时，同一次调用会用用户原话再搜一遍并合并", async () => {
  const queries: string[] = [];
  const ctx = {
    service: {
      search: {
        search: async (_owner: string, _thread: string, query: string) => {
          queries.push(query);
          return query.includes("金球奖")
            ? {
                query,
                backend: "tavily",
                results: [
                  {
                    title: "足球金球奖 2026 提名公布",
                    url: "https://example.com/ballon",
                    snippet: "足球",
                  },
                  { title: "重复条目", url: "https://example.com/dup", snippet: "去重验证" },
                ],
                pages: [],
              }
            : {
                query,
                backend: "tavily",
                results: [
                  {
                    title: "Golden Globes 2026 winners",
                    url: "https://example.com/globe",
                    snippet: "影视",
                  },
                  { title: "重复条目", url: "https://example.com/dup#frag", snippet: "去重验证" },
                ],
                pages: [],
              };
        },
      },
    },
    owner: "local-user",
    threadId: "thread-1",
    requestKey: "key",
    key: () => "key",
    signal: new AbortController().signal,
    userText: () => "金球奖今年是谁",
  } as unknown as ChatToolContext;
  const tool = chatTools(ctx).find((entry) => entry.name === "search_web");
  assert.ok(tool);
  const outcome = (await tool.execute({
    query: "Golden Globe Awards winners",
    count: 6,
    read: 0,
  })) as { results: { url: string }[]; queries?: string[]; note?: string };
  assert.deepEqual(queries, ["Golden Globe Awards winners", "金球奖今年是谁"]);
  assert.deepEqual(outcome.queries, ["Golden Globe Awards winners", "金球奖今年是谁"]);
  // 主查询 2 条（其中一条与被合并结果重复，保留先出现的）、次查询 1 条，都给到模型
  assert.deepEqual(
    outcome.results.map((item) => item.url),
    ["https://example.com/globe", "https://example.com/dup#frag", "https://example.com/ballon"],
  );
  assert.match(outcome.note ?? "", /原话/);
});

test("语言一致时不额外搜索（不白花钱也不拖慢）", async () => {
  const queries: string[] = [];
  const ctx = {
    service: {
      search: {
        search: async (_owner: string, _thread: string, query: string) => {
          queries.push(query);
          return { query, backend: "tavily", results: [], pages: [] };
        },
      },
    },
    owner: "local-user",
    threadId: "thread-1",
    requestKey: "key",
    key: () => "key",
    signal: new AbortController().signal,
    userText: () => "金球奖今年是谁",
  } as unknown as ChatToolContext;
  const tool = chatTools(ctx).find((entry) => entry.name === "search_web");
  assert.ok(tool);
  await tool.execute({ query: "金球奖 2026 得主", count: 6, read: 0 });
  assert.deepEqual(queries, ["金球奖 2026 得主"]);
});

test("lastUserText 能读字符串与分段两种消息格式", () => {
  assert.equal(
    lastUserText([
      { role: "user", content: "第一句" },
      { role: "assistant", content: "回答" },
      { role: "user", content: [{ type: "text", text: "最后一句" }] },
    ]),
    "最后一句",
  );
  assert.equal(lastUserText([{ role: "assistant", content: "只有回复" }]), undefined);
  assert.equal(lastUserText("不是数组"), undefined);
});

test("hasCjk 与 mergeSearchResults 的基本性质", () => {
  assert.equal(hasCjk("金球奖"), true);
  assert.equal(hasCjk("Golden Globe"), false);
  assert.deepEqual(
    mergeSearchResults(
      [
        { title: "a", url: "https://x.test/1", snippet: "" },
        { title: "b", url: "https://x.test/2", snippet: "" },
      ],
      [
        { title: "a2", url: "https://x.test/1?utm=1", snippet: "" },
        { title: "c", url: "https://x.test/3", snippet: "" },
      ],
      5,
    ).map((item) => item.url),
    // 主查询先给 ceil(5/2)=3 个名额（第 2 条与次查询重复被去掉），次查询补上 c
    ["https://x.test/1", "https://x.test/2", "https://x.test/3"],
  );
  // 名额预留：主查询很多、次查询只有 1 条时，次查询那条也必须在结果里
  assert.deepEqual(
    mergeSearchResults(
      [1, 2, 3, 4, 5, 6].map((n) => ({ title: `p${n}`, url: `https://x.test/p${n}`, snippet: "" })),
      [{ title: "s", url: "https://x.test/s", snippet: "" }],
      4,
    ).map((item) => item.url),
    // 次查询那条一定在（预留名额生效），剩下的空位再由主查询补满
    ["https://x.test/p1", "https://x.test/p2", "https://x.test/p3", "https://x.test/s"],
  );
});
