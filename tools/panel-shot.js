'use strict';
/*
 * 用无头 Chrome 渲染真实 quickpanel 页面并截图，用于与浮引参考图对照。
 *
 * 本机 Electron 无法创建 GUI 窗口（进程被系统中断），所以这里用 Chrome 加载同一份
 * src/quickpanel.html + src/quickpanel.css + src/quickpanel.js，只把 window.suira
 * 换成与主进程返回结构一致的 mock。样式、布局、DOM 都是真实产物。
 *
 * 用法：node tools/panel-shot.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const TMP = path.join(ROOT, 'tools', '.panel-shot');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const MOCK = `
const now = Date.now();
const items = [
  { id:'i1', kind:'text', title:'产品需求摘要', text:'把面板做成 38 键固定布局，键位不随内容变化。', source:{type:'clipboard'}, createdAt:now-120000 },
  { id:'i2', kind:'image', title:'屏幕截图', filePath:'C:\\\\demo\\\\shot.png', thumbnail:'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="240" height="130"><rect width="240" height="130" fill="%23dfe5ef"/></svg>', source:{type:'screenshot'}, createdAt:now-300000, meta:{width:1920,height:1080} },
  { id:'i3', kind:'text', title:'识别文字', text:'这是从截图识别出的文字内容。', source:{type:'ocr'}, createdAt:now-280000, parentIds:['i2'] }
];
const handlers = {};
const on = (ch) => (cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; };
window.__handlers = handlers;
window.suira = {
  quick:{ hide:async()=>({ok:true}), show:async()=>({ok:true}), showMain:async()=>({ok:true}), openApp:async(p)=>({ok:true,path:p}), openMain:async()=>({ok:true}), onShown:on('quick:shown') },
  panel:{
    state: async () => {
      const rows = [
        ['1','2','3','4','5','6','7','8','9','0','-','='],
        ['Q','W','E','R','T','Y','U','I','O','P'],
        ['A','S','D','F','G','H','J','K','L'],
        ['Z','X','C','V','B','N','M']
      ];
      const bound = { Z:['capture','截图','框选屏幕区域并标注'], B:['annotate','标注','截图后标注'],
        O:['ocr','提取文字','对最近一张图片离线 OCR'], P:['pin','钉图文','把最近的图片钉在桌面'],
        X:['clipboard','剪贴板','打开内容库查看历史'], V:['text-clean','文本转换','合并换行、去多余空格'],
        D:['desktop','回到桌面','显示桌面'], L:['lock','锁屏','锁定当前会话'] };
      const planned = { W:'壁纸', S:'录屏', G:'长截图', T:'文本翻译', I:'改图', F:'日历', N:'速记', M:'Markdown' };
      const keys = [];
      rows.forEach(function (row, rowIndex) {
        row.forEach(function (key) {
          const b = bound[key];
          keys.push({
            key: key, row: rowIndex,
            actionId: b ? b[0] : '',
            label: b ? b[1] : (planned[key] || ''),
            hint: b ? b[2] : (planned[key] ? planned[key] + '：尚未实现' : ''),
            state: b ? 'bound' : planned[key] ? 'unimplemented' : 'unbound'
          });
        });
      });
      return { rows: rows, keys: keys, count: 38, tools: [
        { id:'capture', label:'截图', hint:'框选屏幕区域', implemented:true },
        { id:'ocr', label:'提取文字', hint:'离线 OCR', implemented:true },
        { id:'clipboard', label:'剪贴板', hint:'历史与来源', implemented:true },
        { id:'pin', label:'钉图文', hint:'图片置顶', implemented:true },
        { id:'text-clean', label:'文本转换', hint:'合并换行 / 清理', implemented:true },
        { id:'shelf', label:'任务匣', hint:'临时收集与整理', implemented:true, open:'shelf' },
        { id:'library', label:'内容库', hint:'全部捕获内容', implemented:true, open:'library' },
        { id:'settings', label:'设置', hint:'快捷键 / 保留策略', implemented:true, open:'settings' },
        { id:'record', label:'录屏', hint:'尚未实现', implemented:false },
        { id:'long-capture', label:'长截图', hint:'尚未实现', implemented:false },
        { id:'translate', label:'翻译', hint:'尚未实现', implemented:false },
        { id:'note', label:'速记', hint:'尚未实现', implemented:false }
      ] };
    },
    run: async (id) => ({ ok:true, message:'已执行 ' + id })
  },
  apps:{
    list: async () => ([
      { name:'Visual Studio Code', filePath:'C:\\\\Demo\\\\code.lnk' },
      { name:'微信', filePath:'C:\\\\Demo\\\\wechat.lnk' },
      { name:'飞书', filePath:'C:\\\\Demo\\\\feishu.lnk' },
      { name:'Word', filePath:'C:\\\\Demo\\\\word.lnk' },
      { name:'Excel', filePath:'C:\\\\Demo\\\\excel.lnk' },
      { name:'记事本', filePath:'C:\\\\Demo\\\\notepad.lnk' },
      { name:'计算器', filePath:'C:\\\\Demo\\\\calc.lnk' },
      { name:'画图', filePath:'C:\\\\Demo\\\\paint.lnk' },
      { name:'终端', filePath:'C:\\\\Demo\\\\wt.lnk' },
      { name:'设置', filePath:'C:\\\\Demo\\\\settings.lnk' },
      { name:'Edge', filePath:'C:\\\\Demo\\\\edge.lnk' },
      { name:'网易云音乐', filePath:'C:\\\\Demo\\\\music.lnk' },
      { name:'哔哩哔哩', filePath:'C:\\\\Demo\\\\bili.lnk' },
      { name:'Obsidian', filePath:'C:\\\\Demo\\\\obsidian.lnk' }
    ]),
    icons: async () => ({})
  },
  search:{ query: async (q) => q ? [
    { id:'cmd.capture', kind:'command', title:'区域截图', subtitle:'框选屏幕区域并标注', action:'capture' },
    { id:'cmd.ocr', kind:'command', title:'截图提字', subtitle:'截图后离线识别文字', action:'recipe:capture-to-text' }
  ] : [] },
  content:{ list: async (o) => items.slice(0, (o && o.limit) || 3), addText: async(p)=>({ok:true,item:{id:'new',...p}}), onChanged: on('content:changed') },
  actions:{ run: async()=>({ok:true,output:{id:'o1',text:'合并后的文字'}}) },
  recipes:{ run: async()=>({ok:true,steps:[],output:null}) },
  returnTo:{ target: async () => ({ processName:'WINWORD', title:'季度报告.docx' }), commit: async()=>({ok:true,copied:true,message:'已复制'}) }
};
`;

function buildPage() {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'quickpanel.html'), 'utf8')
    .replace('<link rel="stylesheet" href="quickpanel.css">', '<link rel="stylesheet" href="quickpanel.css">')
    .replace('<script src="quickpanel.js"></script>', '<script src="__mock.js"></script><script src="quickpanel.js"></script>');
  fs.writeFileSync(path.join(TMP, '__mock.js'), MOCK, 'utf8');
  fs.writeFileSync(path.join(TMP, 'panel.html'), html, 'utf8');
  for (const asset of ['quickpanel.css', 'quickpanel.js']) {
    fs.copyFileSync(path.join(ROOT, 'src', asset), path.join(TMP, asset));
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({ ws, send }));
    ws.addEventListener('error', () => reject(new Error('WS error')));
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
        else entry.resolve(msg.result);
      }
    });
    function send(method, params = {}) {
      return new Promise((r, j) => {
        const mid = ++id;
        pending.set(mid, { resolve: r, reject: j });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); j(new Error('timeout ' + method)); } }, 15000);
      });
    }
  });
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
  return r.result ? r.result.value : undefined;
}

async function capture(send, name) {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: true,
    clip: { x: 0, y: 0, width: 720, height: 620, scale: 1 }
  });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return fs.statSync(file).size;
}

(async () => {
  if (!CHROME) throw new Error('未找到 Chrome/Edge');
  buildPage();

  const userDataDir = path.join(TMP, 'profile');
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=720,620',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  try {
    let targets = null;
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = await res.json();
        if (targets.length) break;
      } catch { /* 端口还没起来 */ }
      await sleep(250);
    }
    if (!targets || !targets.length) throw new Error('Chrome 调试端口未就绪');

    const page = targets.find((t) => t.type === 'page');
    const { ws, send } = await connect(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    // 参考图是浅色材质；强制浅色便于逐项对照（深色模式由 test-render 断言覆盖）
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await send('Emulation.setDeviceMetricsOverride', {
      width: 720, height: 620, deviceScaleFactor: 2, mobile: false
    });
    const url = 'file:///' + path.join(TMP, 'panel.html').replace(/\\/g, '/');
    await send('Page.navigate', { url });
    await sleep(1200);
    // 模拟主进程唤起面板
    await evaluate(send, `(function(){ var cbs = window.__handlers['quick:shown'] || []; for (var i=0;i<cbs.length;i++){ try{ cbs[i](); }catch(e){} } return 'ok'; })()`);
    await sleep(900);

    const facts = await evaluate(send, `JSON.stringify({
      keys: document.querySelectorAll('.key').length,
      rows: document.querySelectorAll('.key-row').length,
      bound: document.querySelectorAll('.key.is-bound').length,
      unbound: document.querySelectorAll('.key.is-unbound').length,
      unimplemented: document.querySelectorAll('.key.is-unimplemented').length,
      labels: Array.from(document.querySelectorAll('.key.is-bound .key-label')).map(function(n){return n.textContent;}),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.body.scrollHeight - window.innerHeight
    })`);
    console.log('FACTS ' + facts);

    console.log('12-panel-actions.png  ' + await capture(send, '12-panel-actions.png') + ' bytes');

    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})), 'ok'`);
    await sleep(900);
    const appCount = await evaluate(send, `document.querySelectorAll('.app-item').length`);
    console.log('13-panel-apps.png     ' + await capture(send, '13-panel-apps.png') + ' bytes  apps=' + appCount);

    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})), 'ok'`);
    await sleep(300);
    await evaluate(send, `document.getElementById('toolbox').click(), 'ok'`);
    await sleep(500);
    console.log('14-panel-toolbox.png  ' + await capture(send, '14-panel-toolbox.png') + ' bytes');

    ws.close();
  } finally {
    child.kill();
    await sleep(400);
  }
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
