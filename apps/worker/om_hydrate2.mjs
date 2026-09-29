import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
const info = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("request", (r) => {
  const u = r.url();
  if (u.includes("/connect")) { try { info.push("connect req: " + (r.postData() || "{}").slice(0, 160)); } catch {} }
});
p.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/connect")) {
    try { info.push("connect res: " + (await r.text()).slice(0, 260)); } catch {}
  }
  if (u.includes("/api/copilotkit/threads?")) {
    try { info.push("threads: " + (await r.text()).slice(0, 400)); } catch {}
  }
});

await p.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForTimeout(25000);
const ins = await p.$$("input, textarea");
if (ins.length >= 2) {
  await ins[0].fill("https://openmuse.claw.ssan.me");
  await ins[1].fill(KEY);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll("div,button,a")];
    els.reverse().find((e) => /打开工作区|Open workspace/i.test(e.innerText || ""))?.click();
  });
  await p.waitForTimeout(20000);
}
await p.evaluate(() => {
  const els = [...document.querySelectorAll("[aria-label],[role=button],div,button,a")];
  els.find((e) => /打开会话与菜单|conversations and menu/i.test(e.getAttribute?.("aria-label") || e.innerText || ""))?.click();
});
await p.waitForTimeout(3000);
const entries = await p.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll("div,button,a,[role=button]")) {
    const t = (e.innerText || "").trim().replace(/\s+/g, " ");
    if (/未命名会话|Side chat/.test(t) && t.length < 40) out.push(t);
  }
  return [...new Set(out)];
});
console.log("面板条目:", JSON.stringify(entries));
await p.evaluate(() => {
  for (const e of [...document.querySelectorAll("div,button,a,[role=button]")].reverse()) {
    const t = (e.innerText || "").trim().replace(/\s+/g, " ");
    if (/^未命名会话$|^Side chat \d+$/.test(t)) { e.click(); return; }
  }
});
await p.waitForTimeout(14000);
console.log("\n=== 抓到的关键流量 ===");
info.slice(0, 8).forEach((l) => console.log("  " + l.replace(/\n/g, " ")));
await b.close();
