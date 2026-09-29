import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
const log = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("response", async (r) => {
  const u = r.url();
  if (!u.includes("/api/copilotkit/")) return;
  let body = "";
  try { body = (await r.text()).slice(0, 220); } catch {}
  log.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "")}  ${body.replace(/\s+/g, " ")}`);
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
log.length = 0;
await p.evaluate(() => {
  const els = [...document.querySelectorAll("[aria-label],[role=button],div,button,a")];
  els.find((e) => /打开会话与菜单|conversations and menu/i.test(e.getAttribute?.("aria-label") || e.innerText || ""))?.click();
});
await p.waitForTimeout(3000);
await p.evaluate(() => {
  for (const e of [...document.querySelectorAll("div,button,a,[role=button]")].reverse()) {
    const txt = (e.innerText || "").trim().replace(/\s+/g, " ");
    if (/^未命名会话$|^Side chat \d+$/.test(txt)) { e.click(); return; }
  }
});
await p.waitForTimeout(12000);

console.log("=== 打开线程时的 /api/copilotkit 流量 ===");
log.slice(0, 14).forEach((l) => console.log("  " + l));
console.log(`  （共 ${log.length} 条）`);
await b.close();
