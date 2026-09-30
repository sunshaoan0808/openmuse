import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assistantMarkdown,
  isSafeAssistantUrl,
  tidyAssistantText,
} from "../src/assistant-markdown.ts";

test("assistant Markdown structures the reported response", () => {
  const html = assistantMarkdown.render(
    "**Short answer:** Use `SKILL.md`.\n\n- First check\n- Second check\n\n**Source URL:** https://docs.copilotkit.ai/learning",
  );
  assert.match(html, /<strong>Short answer:<\/strong>/);
  assert.match(html, /<code>SKILL\.md<\/code>/);
  assert.match(html, /<li>/);
  assert.match(html, /href="https:\/\/docs\.copilotkit\.ai\/learning"/);
  assert.doesNotMatch(html, /\*\*Short answer/);
});

test("incomplete Markdown and raw HTML stay harmless", () => {
  assert.doesNotThrow(() => assistantMarkdown.render("**Still streaming"));
  assert.match(assistantMarkdown.render("<script>alert(1)</script>"), /&lt;script&gt;/);
});

test("only absolute HTTP(S) links can open", () => {
  assert.equal(isSafeAssistantUrl("https://docs.copilotkit.ai/learning"), true);
  assert.equal(isSafeAssistantUrl("http://example.com"), true);
  for (const url of ["javascript:alert(1)", "file:///tmp/private", "//example.com", "not a URL"]) {
    assert.equal(isSafeAssistantUrl(url), false);
  }
});

test("清洗抄写抖动：书名号内的杂符号、重复片名、只开不闭", () => {
  // 线上实测出现的形态
  assert.equal(
    tidyAssistantText("- 最佳剧情片男主角：Adrien Brody（《The Brutalist*）"),
    "- 最佳剧情片男主角：Adrien Brody（《The Brutalist》）",
  );
  assert.equal(tidyAssistantText("《Hamnet》（《Hamnet》）"), "《Hamnet》");
  assert.equal(tidyAssistantText("《The Pitt《The Studio》"), "《The Pitt《The Studio》》");
  assert.equal(tidyAssistantText("正常的一行，没有书名号"), "正常的一行，没有书名号");
  assert.equal(tidyAssistantText("《Hamnet》 是剧情片"), "《Hamnet》 是剧情片");
});

test("清洗不碰片名里的正当字符（连字符、撇号、数字）", () => {
  assert.equal(tidyAssistantText("《Spider-Man: No Way Home》"), "《Spider-Man: No Way Home》");
  assert.equal(tidyAssistantText("《I'm Still Here》"), "《I'm Still Here》");
  assert.equal(tidyAssistantText("《KPop Demon Hunters》"), "《KPop Demon Hunters》");
});
