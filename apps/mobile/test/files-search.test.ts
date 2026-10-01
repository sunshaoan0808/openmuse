import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const app = join(import.meta.dirname, "..");

test("文件页搜索：网格渲染过滤后的列表，且不会再冒出绕过搜索的列表", () => {
  const body = readFileSync(join(app, "src/screens.tsx"), "utf8");
  assert.match(body, /accessibilityLabel="搜索文件"/, "要有搜索框");
  assert.match(body, /const needle = query\.trim\(\)\.toLowerCase\(\)/, "要有过滤计算");
  assert.match(
    body,
    /\[f\.name, fileFormatLabel\(f\.name\), f\.source\]/,
    "文件名/格式/来源都要参与匹配",
  );
  assert.match(body, /shown\.map\(/, "网格必须渲染过滤后的列表");
  assert.equal(
    (body.match(/w\.files\.map\(/g) ?? []).length,
    0,
    "不该有绕过搜索的文件列表（新增列表也要走 shown）",
  );
});
