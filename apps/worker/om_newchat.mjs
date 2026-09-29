import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
const bad = [];
p.on("response", (r) => {
  const u = r.url();
  if (r.status() >= 400 && !u.includes("favicon")) bad.push(`${r.status()} ${r.request().method()} ${u.slice(0, 110)}`);
});
p.on("console", (m) => { if (m.type() === "error") bad.push("console: " + m.text().slice(0, 120)); });

await p.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForTimeout(25000);

const inputs = await p.$$("input, textarea");
if (inputs.length >= 2) {
  await inputs[0].fill("https://openmuse.claw.ssan.me");
  await inputs[1].fill(KEY);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll("div,button,a")];
    els.reverse().find((e) => /打开工作区|Open workspace/i.test(e.innerText || ""))?.click();
  });
  await p.waitForTimeout(20000);
}
console.log("① 已进工作区");

// 打开会话/菜单（表头按钮）
const opened = await p.evaluate(() => {
  const cands = [...document.querySelectorAll("[aria-label],[role=button],div,button,a")];
  const el = cands.find((e) => /打开会话与菜单|conversations and menu|Side chat|话题/i.test(e.getAttribute?.("aria-label") || e.innerText || ""));
  if (el) { el.click(); return el.getAttribute?.("aria-label") || el.innerText?.slice(0, 30); }
  return null;
});
console.log("② 打开会话面板:", opened);
await p.waitForTimeout(3000);

// 点"新建侧边聊天"
const created = await p.evaluate(() => {
  const els = [...document.querySelectorAll("div,button,a")];
  const el = els.reverse().find((e) => /新建侧边聊天|New side chat/i.test(e.innerText || ""));
  if (el) { el.click(); return true; }
  return false;
});
console.log("③ 新建会话:", created);
await p.waitForTimeout(4000);

const box = (await p.$$("textarea, input[type=text]")).pop();
if (!box) { console.log("找不到输入框"); await b.close(); process.exit(0); }
await box.fill("这是新会话的测试消息，请用一句话回答：1+1 等于几？");
await p.keyboard.press("Enter");
console.log("④ 已在新会话发送消息");

for (let i = 0; i < 12; i++) {
  await p.waitForTimeout(15000);
  const t = await p.evaluate(() => document.body.innerText || "");
  process.stdout.write(`  +${(i + 1) * 15}s(汉字${(t.match(/[\u4e00-\u9fff]/g) || []).length})`);
}
const t = await p.evaluate(() => document.body.innerText || "");
console.log("\n=== 界面末尾 ===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-12).join("\n"));
console.log("\n=== 失败请求/控制台错误 ===");
console.log(bad.length ? [...new Set(bad)].slice(0, 8).join("\n") : "无");
await b.close();
