import assert from "node:assert/strict";
import test from "node:test";
import {
  tokenizeForCompare,
  unknownWords,
  allowRewrite,
  planRemoval,
  isUserAuthored,
  protectedIds,
} from "../apps/server/src/engine/memory-adjudicate.ts";

test("tokenizeForCompare：英文词小写", () => {
  assert.deepEqual(tokenizeForCompare("Hello World"), ["hello", "world"]);
});

test("tokenizeForCompare：全角标点差异不影响", () => {
  assert.deepEqual(tokenizeForCompare("Ｈｅｌｌｏ！"), ["hello"]);
});

test("tokenizeForCompare：数字字母大小写以外的差异要保留", () => {
  assert.deepEqual(tokenizeForCompare("温度 20 度"), ["温度", "20", "度"]);
  assert.deepEqual(tokenizeForCompare("温度 21 度"), ["温度", "21", "度"]);
});

test("tokenizeForCompare：CJK 二元组（标点作分隔）", () => {
  assert.deepEqual(tokenizeForCompare("我的代号是「白虎」。"), [
    "我的",
    "的代",
    "代号",
    "号是",
    "白虎",
  ]);
});

test("tokenizeForCompare：单字汉字取自身", () => {
  assert.deepEqual(tokenizeForCompare("猫"), ["猫"]);
});

test("tokenizeForCompare：混合中英", () => {
  assert.deepEqual(tokenizeForCompare("喜欢AI绘画"), ["喜欢", "ai", "绘画"]);
});

test("tokenizeForCompare：空串返回空数组", () => {
  assert.deepEqual(tokenizeForCompare(""), []);
});

test("unknownWords：基础功能", () => {
  const allowed = ["hello world", "foo"];
  assert.deepEqual(unknownWords("hello bar", allowed), ["bar"]);
});

test("unknownWords：去重", () => {
  const allowed = ["hello"];
  assert.deepEqual(unknownWords("hello hello world", allowed), ["world"]);
});

test("unknownWords：稳定顺序", () => {
  const allowed = ["bat"];
  assert.deepEqual(unknownWords("cat bat ant", allowed), ["cat", "ant"]);
});

test("unknownWords：CJK 二元组未在来源中出现", () => {
  const allowed = ["我的代号是「青龙」。", "我改名叫白虎了"];
  assert.deepEqual(unknownWords("我的代号是「玄武」。", allowed), ["玄武"]);
});

test("allowRewrite：默认不允许未知词", () => {
  const res = allowRewrite("我的代号是白虎", ["我的代号是青龙"]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.unknown, ["是白", "白虎"]);
  assert.match(res.reason ?? "", /原句中没有的词/);
});

test("allowRewrite：允许一定数量未知词", () => {
  const res = allowRewrite("我的代号是白虎", ["我的代号是青龙"], {
    allowUnknown: 2,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.unknown, ["是白", "白虎"]);
});

test("allowRewrite：空产物", () => {
  const res = allowRewrite("", ["任何"], {});
  assert.equal(res.ok, true);
  assert.deepEqual(res.unknown, []);
});

test("planRemoval：20% 向下取整", () => {
  assert.equal(planRemoval(10, 5), 2); // floor(10*0.2)=2
  assert.equal(planRemoval(10, 1), 1);
});

test("planRemoval：至少留 4", () => {
  assert.equal(planRemoval(5, 3), 1); // total-keptAtLeast=1
  assert.equal(planRemoval(4, 3), 0); // total<=keepAtLeast => 0
});

test("planRemoval：两条上限取更严者", () => {
  assert.equal(planRemoval(5, 4), 1); // cap1=1, cap2=1, wouldDrop=4 => min=1
  assert.equal(planRemoval(10, 8), 2); // cap1=2, cap2=6, wouldDrop=8 => min=2
});

test("planRemoval：wouldDrop=0", () => {
  assert.equal(planRemoval(10, 0), 0);
});

test("isUserAuthored：机器沉淀不算用户手写", () => {
  assert.equal(isUserAuthored({ source: "自动沉淀", text: "hello" }), false);
});

test("isUserAuthored：source 缺失算用户手写", () => {
  assert.equal(isUserAuthored({ text: "hello" }), true);
});

test("isUserAuthored：REST 写入（source: You）算用户手写", () => {
  assert.equal(isUserAuthored({ source: "You", text: "hello" }), true);
});

test("isUserAuthored：文本含 <!-- locked --> 算用户手写", () => {
  assert.equal(
    isUserAuthored({ source: "自动沉淀", text: "hello <!-- locked -->" }),
    true
  );
});

test("protectedIds：正确挑出用户手写 id", () => {
  const records = [
    { id: "u1", source: "You", text: "rest" },
    { id: "a1", source: "自动沉淀", text: "auto" },
    { id: "u2", text: "no-source" },
    { id: "l1", source: "自动沉淀", text: "text <!-- locked -->" },
  ];
  const ids = protectedIds(records);
  // Set 保持插入顺序：u1 → u2 → l1
  assert.deepEqual([...ids], ["u1", "u2", "l1"]);
});