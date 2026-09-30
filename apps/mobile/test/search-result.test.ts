import assert from "node:assert/strict";
import { test } from "node:test";
import { hostOf, readPages, readSearchOutcome } from "../src/search-result.ts";

const live = {
  query: "CopilotKit OpenMuse personal agent",
  backend: "http-serp",
  results: [
    {
      title: "GitHub - CopilotKit/openmuse: A personal agent with a browser",
      url: "https://github.com/CopilotKit/openmuse",
      snippet: "A personal agent with a browser, terminal, files.",
    },
    { title: "OpenMuse | CopilotKit", url: "https://www.copilotkit.ai/openmuse", snippet: "" },
  ],
  pages: [
    {
      url: "https://github.com/CopilotKit/openmuse",
      title: "GitHub - CopilotKit/openmuse",
      text: "OpenMuse A personal agent with a browser",
      truncated: false,
    },
    { url: "https://example.org/broken", text: "", truncated: false, error: "HTTP 503" },
  ],
};

test("a search result payload becomes card-ready results and pages", () => {
  const view = readSearchOutcome(JSON.stringify(live));
  assert.equal(view.query, "CopilotKit OpenMuse personal agent");
  assert.equal(view.failure, "");
  assert.equal(view.results.length, 2);
  assert.equal(view.results[0]?.url, "https://github.com/CopilotKit/openmuse");
  assert.equal(view.results[1]?.snippet, "");
  assert.equal(view.pages.length, 2);
  // 出错的那一篇不算"已读"
  assert.deepEqual(
    readPages(view.pages).map((page) => page.url),
    ["https://github.com/CopilotKit/openmuse"],
  );
});

test("read_pages arrays and wrapped payloads both parse", () => {
  const array = readSearchOutcome(JSON.stringify(live.pages));
  assert.equal(array.results.length, 0);
  assert.equal(array.pages.length, 2);
  const wrapped = readSearchOutcome({ pages: live.pages });
  assert.equal(wrapped.pages.length, 2);
});

test("a failure payload keeps its message instead of inventing results", () => {
  const view = readSearchOutcome({
    error: "搜索暂时不可用（duckduckgo 返回与查询无关的结果（疑似反爬诱饵，相关度 0.00））。",
  });
  assert.match(view.failure, /搜索暂时不可用/);
  assert.equal(view.results.length, 0);
  assert.equal(view.pages.length, 0);
});

test("garbage results never render as results", () => {
  for (const value of [undefined, null, "", "not json", "{", 42, { results: "nope" }]) {
    const view = readSearchOutcome(value);
    assert.equal(view.results.length, 0);
    assert.equal(view.pages.length, 0);
    assert.equal(view.failure, "");
  }
});

test("hosts are shown without the www prefix", () => {
  assert.equal(hostOf("https://www.copilotkit.ai/openmuse"), "copilotkit.ai");
  assert.equal(hostOf("https://github.com/CopilotKit/openmuse"), "github.com");
  assert.equal(hostOf("not a url"), "not a url");
});
