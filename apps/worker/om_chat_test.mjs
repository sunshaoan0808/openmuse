const { chromium } = await import('playwright');

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

await p.goto('http://127.0.0.1:8081', { waitUntil: 'load', timeout: 120000 });
await p.waitForTimeout(12000);

console.log('=== 初始界面 ===');
console.log((await p.innerText('body')).replace(/\n+/g, ' | ').slice(0, 700));

// 找输入框
const input = await p.$('textarea, input[type="text"], [contenteditable="true"]');
if (!input) {
  console.log('!! 没找到输入框');
} else {
  await input.click();
  await input.type('用一句话中文说明你是谁，以及你现在能不能联网查资料。', { delay: 30 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: '/tmp/om-chat1.png' });

  // 发送：优先按钮，其次回车
  let sent = false;
  for (const sel of ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button:has-text("Send")']) {
    const el = await p.$(sel);
    if (el) { await el.click(); sent = true; break; }
  }
  if (!sent) { await p.keyboard.press('Enter'); sent = true; }
  console.log('已发送，等待回复…');

  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(10000);
    const t = (await p.innerText('body')).replace(/\n+/g, ' | ');
    console.log('[%3ds] %s' % ((i + 1) * 10, t.slice(0, 260)));
  }
  await p.screenshot({ path: '/tmp/om-chat2.png', fullPage: false });
}
console.log('\n=== 控制台错误（前 5 条）===');
console.log(errs.slice(0, 5).join('\n') || '（无）');
await b.close();
