const { chromium } = await import('playwright');

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.url().includes('/api/copilotkit')) console.log('   [net] ' + r.status() + ' ' + r.url().slice(-40)); });

await p.goto('http://127.0.0.1:8081', { waitUntil: 'load', timeout: 120000 });
await p.waitForTimeout(12000);

console.log('=== 初始（截断）===');
console.log((await p.innerText('body')).replace(/\n+/g, ' | ').slice(0, 300));
console.log('');

const input = await p.$('textarea, input[type="text"], [contenteditable="true"]');
console.log('输入框:', input ? '找到' : '未找到');
if (input) {
  await input.click();
  await input.type('你好，用一句话中文说明你是谁。', { delay: 30 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: '/tmp/om-chat1.png' });

  let sent = false;
  for (const sel of ['button[aria-label*="Send" i]']) {
    const el = await p.$(sel);
    if (el) { await el.click(); sent = true; console.log('发送: 按钮'); break; }
  }
  if (!sent) { await p.keyboard.press('Enter'); console.log('发送: 回车'); }

  let prev = '';
  for (let i = 1; i <= 12; i++) {
    await p.waitForTimeout(10000);
    const t = (await p.innerText('body')).replace(/\n+/g, ' | ');
    if (t !== prev) {
      console.log('[' + (i * 10) + 's] ' + t.slice(0, 420));
      prev = t;
    } else {
      console.log('[' + (i * 10) + 's] (无变化)');
    }
  }
  await p.screenshot({ path: '/tmp/om-chat2.png' });
}
console.log('');
console.log('=== 控制台错误 ===');
console.log(errs.slice(0, 6).join('\n') || '（无）');
await b.close();
