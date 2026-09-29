import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
const runs = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("response", async (r) => {
  if (/\/api\/copilotkit\/agent\/.*\/run/.test(r.url())) {
    const ct = r.headers()["content-type"] || "";
    let body = "";
    try { body = (await r.text()).slice(0, 600); } catch {}
    runs.push({ status: r.status(), ct, body });
  }
});

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
console.log("① 已进工作区（richThreads=false 模式）");

const box = (await p.$$("textarea, input[type=text]")).pop();
await box.fill("去掉云之后的探测：3 乘 7 等于几？只回数字。");
await p.keyboard.press("Enter");
console.log("② 已发送");

for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(15000);
  const t = await p.evaluate(() => document.body.innerText || "");
  process.stdout.write(`  +${(i + 1) * 15}s(${(t.match(/[\u4e00-\u9fff]/g) || []).length})`);
}
const t = await p.evaluate(() => document.body.innerText || "");
console.log("\n=== 界面末尾 ===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-10).join("\n"));
console.log("\n=== run 响应（关键：SSE 还是 envelope JSON）===");
for (const r of runs) {
  console.log(`  HTTP ${r.status}  content-type=${r.ct}`);
  console.log(`  body: ${r.body.replace(/\s+/g, " ").slice(0, 300)}`);
}
if (!runs.length) console.log("  （没抓到 run 请求）");
await b.close();
