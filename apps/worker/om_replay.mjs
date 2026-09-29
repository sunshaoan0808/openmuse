import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
let saved = "";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("response", async (r) => {
  if (r.url().includes("/connect") && !saved) {
    try {
      const t = await r.text();
      if (t.includes("8e5feb10") || t.includes("RUN_STARTED")) { saved = t; fs.writeFileSync("/tmp/connect-replay.txt", t); }
    } catch {}
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
await p.evaluate(() => {
  for (const e of [...document.querySelectorAll("div,button,a,[role=button]")].reverse()) {
    const t = (e.innerText || "").trim().replace(/\s+/g, " ");
    if (/^未命名会话$|^Side chat \d+$/.test(t)) { e.click(); return; }
  }
});
await p.waitForTimeout(15000);
await b.close();

const raw = saved || fs.existsSync("/tmp/connect-replay.txt") ? fs.readFileSync("/tmp/connect-replay.txt", "utf8") : "";
console.log("connect 响应长度:", raw.length);
const types = {};
const texts = [];
for (const line of raw.split("\n")) {
  if (!line.startsWith("data:")) continue;
  try {
    const d = JSON.parse(line.slice(5).trim());
    types[d.type] = (types[d.type] || 0) + 1;
    if (d.type === "TEXT_MESSAGE_CONTENT" && typeof d.delta === "string") texts.push(d.delta);
  } catch {}
}
console.log("事件类型统计:", types);
console.log("重放文本:", JSON.stringify(texts.join("").slice(0, 200)));
console.log("含「青龙」:", raw.includes("青龙"));
