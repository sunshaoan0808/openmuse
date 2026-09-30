/**
 * 控制台页面：只渲染截图，远程页面代码永远不会在这个文档里执行。
 *
 * 两处体验改造（对照真实使用）：
 * 1. 帧率：2 秒一张 PNG → 600ms 一张 JPEG（同一延迟下字节数少 5-10 倍）。
 * 2. 补上缺的手脚：后退/前进/刷新/桌面↔手机视口，以及"现在到底在哪一页"。
 */
export function browserConsole(previewUrl: string) {
  const preview = JSON.stringify(previewUrl).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenMuse browser</title><style>
*{box-sizing:border-box}body{margin:0;background:#fcfcfc;color:#172125;font:14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
header{padding:12px 12px 8px;display:flex;align-items:center;justify-content:space-between;gap:12px}#status{color:#697176;font-size:12px}#status.live{color:#248258}
button,input{font:inherit;border:1px solid #e9edef;border-radius:24px;padding:10px 14px;background:white;color:inherit;min-height:42px}
button{cursor:pointer}button:hover{background:#edf7fd}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #1473c8;outline-offset:2px}
form{padding:0 12px 8px;display:flex;gap:8px}input{flex:1;min-width:0;background:#f1f3f4;border-color:transparent}#type{background:#c8e7ff}
nav{display:flex;gap:6px;padding:0 12px 10px;flex-wrap:wrap}nav button{font-size:12px;min-height:36px;padding:7px 12px}nav button[aria-pressed="true"]{background:#c8e7ff;border-color:#8fc9f5}
#where{margin:0 12px 8px;padding:8px 10px;background:#f1f3f4;border-radius:12px;font-size:12px;color:#697176;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#stage{overflow:hidden;background:#eef1f3;border-radius:18px;min-height:160px;margin:0 8px;display:flex;justify-content:center}
img{display:block;width:100%;height:auto;cursor:crosshair;touch-action:pan-y}img.stale{opacity:.45;pointer-events:none}
body[data-mode="mobile"] #stage{padding:0 22%}body[data-mode="mobile"] img{border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.15)}
#error{margin:0 12px 12px;color:#984a41;background:#fbefed;padding:12px;border-radius:14px}#error:empty{display:none}footer{padding:12px;color:#697176;font-size:12px;line-height:1.5}
</style><header><strong>Browser</strong><span id="status" role="status">Connecting…</span></header>
<nav aria-label="Browser navigation"><button id="back" aria-label="Back">←</button><button id="forward" aria-label="Forward">→</button><button id="reload" aria-label="Reload page">↻</button><button id="desktop" aria-pressed="true">桌面</button><button id="mobile" aria-pressed="false">手机</button><button id="refresh" aria-label="Refresh browser preview">刷新画面</button></nav>
<div id="where">—</div>
<form><input id="text" aria-label="Text to type in browser" placeholder="Type into the selected field" autocomplete="off"><button id="type" type="submit">Send text</button></form>
<nav aria-label="Browser keyboard"><button data-key="Enter">Enter ↵</button><button data-key="Tab">Tab ⇥</button><button data-key="Backspace">Delete ⌫</button><button id="up">Scroll ↑</button><button id="down">Scroll ↓</button></nav>
<div id="error" role="alert"></div><div id="stage"><img id="screen" class="stale" alt="Live browser session, click to interact" draggable="false"></div>
<footer>Tap the page to select a field, then send text above. You’re controlling the agent’s browser.</footer><script>
const image=document.querySelector('#screen'),error=document.querySelector('#error'),status=document.querySelector('#status'),field=document.querySelector('#text'),where=document.querySelector('#where');
let refreshing=false,sending=false,imageUrl,live=false,previewError=false,timer;
const view={width:1280,height:800};
function controls(){document.querySelectorAll('nav button,#type').forEach(b=>b.disabled=sending||!live);image.classList.toggle('stale',!live||sending);}
function describe(url,title){let host=url;try{const u=new URL(url);host=u.host+(u.pathname==='/'?'':u.pathname)+(u.search||'');}catch(_){}
where.textContent=(title?title+' — ':'')+host;where.title=url;}
async function refresh(){if(refreshing||sending||document.hidden)return;refreshing=true;try{
const r=await fetch(${preview}+(${preview}.includes('?')?'&':'?')+'quality=45&t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
if(!r.ok)throw new Error(r.status===401?'Session access expired. Close this view and open the browser again.':'Browser disconnected. Reopen the session from OpenMuse.');
const pageUrl=r.headers.get('x-page-url'),pageTitle=r.headers.get('x-page-title');
if(pageUrl)describe(pageUrl,pageTitle?decodeURIComponent(pageTitle):'');
const blob=await r.blob();const next=URL.createObjectURL(blob);await new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=()=>{URL.revokeObjectURL(next);reject(new Error('The browser preview could not be displayed.'));};probe.src=next;});
if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=next;image.src=next;live=true;status.textContent='Live';status.className='live';if(previewError){error.textContent='';previewError=false;}
}catch(e){live=false;previewError=true;status.textContent='Disconnected';status.className='';error.textContent=e.message;}finally{refreshing=false;controls();}}
async function send(body){if(sending||!live)return false;sending=true;controls();error.textContent='';status.textContent='Updating…';let ok=false;try{
const r=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
if(!r.ok){const data=await r.json();throw new Error(typeof data.error==='string'?data.error:'Browser action failed. Your text is still here.');}ok=true;
}catch(e){error.textContent=e.message;}finally{sending=false;controls();await refresh();}return ok;}
function setMode(mobile){view.width=mobile?390:1280;view.height=mobile?844:800;document.body.dataset.mode=mobile?'mobile':'desktop';
document.querySelector('#desktop').setAttribute('aria-pressed',String(!mobile));document.querySelector('#mobile').setAttribute('aria-pressed',String(mobile));}
image.onclick=e=>{if(!live||sending)return;const r=image.getBoundingClientRect();send({type:'click',x:Math.min(view.width-1,Math.max(0,Math.floor((e.clientX-r.left)*view.width/r.width))),y:Math.min(view.height-1,Math.max(0,Math.floor((e.clientY-r.top)*view.height/r.height)))});};
document.querySelector('form').onsubmit=async e=>{e.preventDefault();const text=field.value;if(text&&await send({type:'text',text})&&field.value===text)field.value='';};
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>send({type:'key',key:b.dataset.key}));
document.querySelector('#up').onclick=()=>send({type:'scroll',deltaY:-600});document.querySelector('#down').onclick=()=>send({type:'scroll',deltaY:600});
document.querySelector('#back').onclick=()=>send({type:'back'});document.querySelector('#forward').onclick=()=>send({type:'forward'});document.querySelector('#reload').onclick=()=>send({type:'reload'});
document.querySelector('#desktop').onclick=async()=>{if(document.body.dataset.mode==='mobile'){setMode(false);await send({type:'viewport',width:1280,height:800});}};
document.querySelector('#mobile').onclick=async()=>{if(document.body.dataset.mode!=='mobile'){setMode(true);await send({type:'viewport',width:390,height:844});}};
document.querySelector('#refresh').onclick=()=>{error.textContent='';refresh();};
setMode(false);controls();refresh();
// 600ms 一帧：有头 Chromium 出图约 80-150ms，这个节奏跟得上操作又不会把 WebView 压满。
function startTimer(){clearInterval(timer);timer=setInterval(refresh,600);}
startTimer();document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInterval(timer);else{startTimer();refresh();}});
window.addEventListener('pagehide',()=>{clearInterval(timer);if(imageUrl)URL.revokeObjectURL(imageUrl);});
</script></html>`;
}
