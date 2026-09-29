import { chromium } from "playwright";
import fs from "node:fs";

// 从 .env 读访问密钥（不打印值）
const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
p.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)));

await p.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForTimeout(25000);

const dump = async (tag) => {
  const t = await p.evaluate(() => document.body.innerText || "");
  const zh = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (t.match(/[A-Za-z]{3,}/g) || []).length;
  console.log(`\n===== ${tag} ===== 汉字 ${zh} / 英文词 ${en}`);
  console.log(t.replace(/\n{2,}/g, "\n").slice(0, 900));
  return t;
};

await dump("① 连接页");

// 找输入框：第一个文本输入 = 服务器地址，第二个 = 访问密钥
const inputs = await p.$$("input, textarea");
console.log(`\n输入框数量: ${inputs.length}`);
for (let i = 0; i < inputs.length; i++) {
  const ph = await inputs[i].getAttribute("placeholder");
  const val = await inputs[i].inputValue().catch(() => "");
  console.log(`  [${i}] placeholder=${JSON.stringify(ph)} value=${JSON.stringify(val)}`);
}

if (inputs.length >= 2 && KEY) {
  await inputs[0].fill("https://openmuse.claw.ssan.me");
  await inputs[1].fill(KEY);
  console.log("\n已填入服务器地址 + 访问密钥，点击打开…");
  const clicked = await p.evaluate(() => {
    const els = [...document.querySelectorAll("div,button,a")];
    const target = els.reverse().find((e) => /打开工作区|Open workspace/i.test(e.innerText || ""));
    if (target) { target.click(); return true; }
    return false;
  });
  console.log("点击结果:", clicked);
  await p.waitForTimeout(20000);
  await dump("② 进入工作区后");

  // 发一条中文消息，观察流式
  const box = (await p.$$("textarea, input[type=text]")).pop();
  if (box) {
    await box.fill("用一句话中文回答：你是谁？");
    await p.keyboard.press("Enter");
    console.log("\n已发送消息，观察流式响应…");
    let last = 0, grew = 0;
    for (let i = 0; i < 12; i++) {
      await p.waitForTimeout(5000);
      const t = await p.evaluate(() => document.body.innerText || "");
      const zh = (t.match(/[\u4e00-\u9fff]/g) || []).length;
      console.log(`  +${(i + 1) * 5}s  页面汉字数 ${zh}`);
      if (zh > last) { grew++; last = zh; }
    }
    await dump("③ 对话后");
    console.log(`\n流式证据：12 次采样中有 ${grew} 次文本增长（>1 即说明 SSE 逐块到达，未被缓冲）`);
  } else {
    console.log("\n找不到聊天输入框");
  }
}

console.log(`\n控制台错误: ${errs.length}`);
errs.slice(0, 8).forEach((e) => console.log("  - " + e));
await p.screenshot({ path: "/tmp/zh-ui.png", fullPage: false });
console.log("截图: /tmp/zh-ui.png");
await b.close();
