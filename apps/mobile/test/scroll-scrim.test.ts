import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

/**
 * 回归：Animated.event(..., { useNativeDriver: true }) 返回的是 AnimatedEvent **对象**，
 * 只有 Animated.ScrollView / createAnimatedComponent 会调 __getHandler 取出函数。
 * 我们把它直接交给普通 ScrollView，React 派发滚动事件时当函数调用 →
 * release 包 TypeError: Object is not a function → 无提示闪退（真机上表现为"滚动/发送就闪退"）。
 */
test("滚动磨砂的处理器不能走原生驱动（普通 ScrollView 会把它当函数调用而崩）", () => {
  const raw = read("src/header-scrim.ts");
  // 注释里会提到这个陷阱名，判断前先去注释
  const src = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(src.includes("useNativeDriver: false"), "应显式使用 useNativeDriver: false");
  assert.ok(!/useNativeDriver:\s*true/.test(src), "不能改回 useNativeDriver: true");
  assert.ok(src.includes("typeof handler === \"function\""), "应保留函数兜底");
});

test("调用点用的是普通 ScrollView（这正是必须 JS 驱动的原因）", () => {
  for (const file of ["src/chat.tsx", "App.tsx"]) {
    const src = read(file);
    assert.ok(src.includes("<ScrollView"), `${file} 应使用普通 ScrollView`);
    assert.ok(!src.includes("<Animated.ScrollView"), `${file} 不应改成 Animated.ScrollView`);
  }
});
