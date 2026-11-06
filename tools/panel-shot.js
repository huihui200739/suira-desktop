'use strict';
/*
 * 用无头 Chrome 渲染真实 quickpanel 页面并截图，用于与浮引参考图对照。
 *
 * Chrome 加载同一份 quickpanel 页面，IPC 使用可注入故障/延迟的 fixture，
 * 键位与工具箱直接来自生产模型。真实 Electron/IPC 另用 electron-panel-check.js 验证。
 *
 * 用法：node tools/panel-shot.js；只回归不更新图片：加 --check。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('node:assert/strict');
const { QUICK_PANEL_SIZE } = require('../lib/display-geometry');
const { keyLayout, TOOLBOX_TOOLS } = require('../lib/keybindings');
const { bindingFixture, checkBindings } = require('./panel-bindings-check');
const { checkKeycapMaterial } = require('./keycap-material-check');
const CHECK_ONLY = process.argv.includes('--check');

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
  quick:{ hide:async()=>({ok:true}), show:async()=>({ok:true}), showMain:async()=>({ok:true}), openApp:async(p)=>({ok:true,path:p}), openMain:async()=>({ok:true}), onShown:on('quick:shown'), onPrepare:on('quick:prepare'),prepared:()=>{},onMode:on('quick:mode') },
  // 面板点「浮引岛」工具时会调它；缺了会让 init 直接抛异常，整块键位不渲染
  island:{ toggle: async()=>({ok:true, visible:true}), getState: async()=>({ok:true, items:[], policy:'copy', mode:'sleep', maxItems:24}), addPaths: async()=>({ok:true}), setMode: async()=>({ok:true}), onState:on('island:state'), onMode:on('island:mode'), onExpanded:on('island:expanded') },
  // 翻译结果区：语言下拉与重翻都走这里
  translate:{ status: async()=>({ ok:true, provider:'openai', providerLabel:'OpenAI 兼容接口', configured:true, hasKey:true, source:'en', target:'zh', sourceLabel:'自动识别', targetLabel:'中文', targets:[{code:'zh',label:'中文'},{code:'en',label:'英文'},{code:'ja',label:'日文'}] }), run: async()=>({ ok:true, text:'翻译后的文字' }), test: async()=>({ ok:true, text:'已可用' }) },
  panel:{
    state: async () => (${JSON.stringify({ ...keyLayout(), tools: TOOLBOX_TOOLS })}),
    // 与主进程返回结构一致：O 键返回 ocr 结果（带 itemId 供查看原图反查），
    // 其余返回 message/closePanel/openPage。记录调用用于断言链路真的走通。
    run: async (id) => {
      window.__runs = window.__runs || [];
      window.__runs.push(id);
      if (id === 'translate') {
        return { ok:true, translate:{
          text:'The panel keeps a fixed 38-key layout so muscle memory survives version updates.',
          source:'面板保持 38 键固定布局，让肌肉记忆不被版本更新打断。',
          itemId:'i3', outputId:'o2', provider:'openai', from:'zh', to:'en', hasImage:false
        } };
      }
      if (id === 'ocr') {
        return { ok:true, ocr:{ text:'框选区域识别出的文字。\\n第二行内容。', itemId:'i3' } };
      }
      if (id === 'clipboard') return { ok:true, openClipboardBar:true, closePanel:true };
      if (id === 'text-clean') return { ok:true, message:'已生成整理后的文字', openPage:'library', closePanel:true };
      return { ok:true, message:'已执行 ' + id, closePanel:true };
    }
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
    search: async q => {window.__appQueries=(window.__appQueries||[]).concat(q);if(window.__appSearchError)throw Error(window.__appSearchError);if(window.__appSearchDelay)await new Promise(r=>setTimeout(r,window.__appSearchDelay));return (await window.suira.apps.list()).filter(app=>!q||app.name.toLowerCase().includes(q.toLowerCase())||(app.name==='微信'&&['wx','weixin'].includes(q.toLowerCase())));},
    icons: async paths => Object.fromEntries(paths.map(p=>[p,'data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#2388ee"/><path d="M16 32h32M32 16v32" stroke="white" stroke-width="6"/></svg>').toString('base64')}']))
  },
  search:{ query: async (q) => q ? [
    { id:'cmd.capture', kind:'command', title:'区域截图', subtitle:'框选屏幕区域并标注', action:'capture' },
    { id:'cmd.ocr', kind:'command', title:'截图提字', subtitle:'截图后离线识别并整理文字', action:'recipe:capture-to-clean-text' }
  ] : [] },
  content:{ list: async (o) => items.slice(0, (o && o.limit) || 3), addText: async(p)=>({ok:true,item:{id:'new',...p}}), openOriginal: async()=>({ok:true}), onChanged: on('content:changed') },
  actions:{ run: async()=>({ok:true,output:{id:'o1',text:'合并后的文字'}}) },
  recipes:{ run: async()=>({ok:true,steps:[],output:null}) },
  returnTo:{ target: async () => ({ processName:'WINWORD', title:'季度报告.docx' }), commit: async()=>({ok:true,copied:true,message:'已复制'}) }
};
window.__barOpened=0;
window.suira.clipboardBar={show:async()=>{window.__barOpened++;return {ok:true};}};
`;

function buildPage() {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'quickpanel.html'), 'utf8')
    .replace('../assets/suira-icon.png', 'suira-icon.png')
    .replace('<link rel="stylesheet" href="quickpanel.css">', '<link rel="stylesheet" href="quickpanel.css">')
    .replace('<script src="quickpanel.js"></script>',
      '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message||e.error));});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+String((e.reason&&e.reason.message)||e.reason));});</script>'
      + '<script src="__mock.js"></script><script src="quickpanel.js"></script>');
  fs.writeFileSync(path.join(TMP, '__mock.js'), MOCK + bindingFixture, 'utf8');
  fs.writeFileSync(path.join(TMP, 'panel.html'), html, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'assets', 'suira-icon.png'), path.join(TMP, 'suira-icon.png'));
  for (const asset of ['theme.css', 'quickpanel.css', 'quickpanel.js', 'ui-motion.css', 'ui-motion.js', 'tool-art.css', 'tool-art.js', 'icons.js','glass-select.js','glass-select.css','liquid-glass.js','liquid-glass.css','companion.js', 'companion.css', 'art/companion-courier.png', 'keycap-material.css', 'keycap-motion.js']) {
    fs.mkdirSync(path.dirname(path.join(TMP,asset)),{recursive:true});
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
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
        else entry.resolve(msg.result);
      }
    });
    function send(method, params = {}) {
      return new Promise((r, j) => {
        const mid = ++id;
        const entry = { resolve: r, reject: j };
        pending.set(mid, entry);
        ws.send(JSON.stringify({ id: mid, method, params }));
        entry.timer = setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); j(new Error('timeout ' + method)); } }, 15000);
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
  if (CHECK_ONLY) return 0;
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: true,
    clip: { x: 0, y: 0, ...QUICK_PANEL_SIZE, scale: 1 }
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
    `--window-size=${QUICK_PANEL_SIZE.width},${QUICK_PANEL_SIZE.height}`,
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
      ...QUICK_PANEL_SIZE, deviceScaleFactor: 2, mobile: false
    });
    const url = 'file:///' + path.join(TMP, 'panel.html').replace(/\\/g, '/');
    await send('Page.navigate', { url });
    await sleep(1200);
    // 模拟主进程唤起面板
    await evaluate(send, `(async function(){ for(const cb of window.__handlers['quick:prepare']||[])await cb({token:1}); var cbs = window.__handlers['quick:shown'] || []; for (var i=0;i<cbs.length;i++){ try{ cbs[i](); }catch(e){} } return 'ok'; })()`);
    await sleep(900);

    const facts = await evaluate(send, `JSON.stringify({
      keys: document.querySelectorAll('.key').length,
      rows: document.querySelectorAll('.key-row').length,
      bound: document.querySelectorAll('.key.is-bound').length,
      unbound: document.querySelectorAll('.key.is-unbound').length,
      unimplemented: document.querySelectorAll('.key.is-unimplemented').length,
      actions: Array.from(document.querySelectorAll('.key.is-bound')).map(function(n){return n.getAttribute('aria-label');}),
      errs: (window.__errs || []).slice(0, 4),
      gridHtmlLength: (document.getElementById('key-grid') || {}).innerHTML ? document.getElementById('key-grid').innerHTML.length : 0,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.body.scrollHeight - window.innerHeight
    })`);
    console.log('FACTS ' + facts);
    const initial = JSON.parse(facts);
    assert.equal(initial.keys, 38, '固定键位必须完整');
    assert.equal(initial.rows, 4);
    assert.deepEqual(initial.errs, [], '面板初始化不应报错');

    console.log('12-panel-actions.png  ' + await capture(send, '12-panel-actions.png') + ' bytes');

    // 真实键盘事件验证分段按钮：聚焦「动作」后按空格不能误切成「应用」。
    await evaluate(send, `document.getElementById('mode-actions').focus(), true`);
    await send('Input.dispatchKeyEvent', {type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,text:' '});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    assert.equal(await evaluate(send, `document.getElementById('panel').dataset.mode`), 'actions');
    await evaluate(send, `document.getElementById('mode-apps').focus(), true`);
    await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.equal(await evaluate(send, `document.getElementById('panel').dataset.mode`), 'apps');
    assert.equal(await evaluate(send, `document.getElementById('mode-apps').getAttribute('aria-pressed')`), 'true');
    await evaluate(send, `document.getElementById('mode-actions').click(); document.activeElement.blur(); true`);
    console.log('  PASS  分段控件支持空格 / Enter 激活并同步选中态');

    await evaluate(send, `document.querySelector('.key').focus(), true`);
    await sleep(30);
    const hint = await evaluate(send, `(()=>{const h=document.getElementById('surface-hint'),r=h.getBoundingClientRect();return {visible:!h.hidden,text:Boolean(h.textContent),within:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,described:document.activeElement.getAttribute('aria-describedby')===h.id,native:document.querySelector('.key').hasAttribute('title')};})()`);
    assert.deepEqual(hint,{visible:true,text:true,within:true,described:true,native:false});
    await evaluate(send, `document.activeElement.blur(), true`);
    assert.equal(await evaluate(send, `document.getElementById('surface-hint').hidden`),true);
    console.log('  PASS  键位提示可由焦点访问、贴合屏幕边界并随焦点离开关闭');

    await evaluate(send, `window.suira.clipboardBar.show(), true`);
    await sleep(30);
    assert.equal(await evaluate(send, `window.__barOpened`),1);
    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'v',bubbles:true})), true`);
    await sleep(30);
    assert.equal(await evaluate(send, `window.__barOpened`),2);
    console.log('  PASS  剪贴板按钮和 V 键均打开底部历史横栏');

    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})), 'ok'`);
    await sleep(900);
    const appCount = await evaluate(send, `document.querySelectorAll('.app-item').length`);
    console.log('13-panel-apps.png     ' + await capture(send, '13-panel-apps.png') + ' bytes  apps=' + appCount);

    await evaluate(send, `document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})), 'ok'`);
    await sleep(300);
    await evaluate(send, `document.getElementById('toolbox').click(), 'ok'`);
    await sleep(500);
    console.log('14-panel-toolbox.png  ' + await capture(send, '14-panel-toolbox.png') + ' bytes');

    // ---- 第二批：从面板按键进入工具，验证真的走通到结果 ----
    await evaluate(send, `document.getElementById('toolbox').click(), 'ok'`);
    await sleep(400);

    // O 键：提字 → OCR 结果面板（含「查看原图」）
    const ocrFlow = await evaluate(send, `(async function(){
      window.__runs = [];
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'o',bubbles:true}));
      await new Promise(function(r){ setTimeout(r, 400); });
      var panel = document.getElementById('ocr-panel');
      return JSON.stringify({
        runs: window.__runs,
        panelShown: !panel.hidden,
        itemId: panel.dataset.itemId || '',
        text: (document.getElementById('ocr-text').value || '').slice(0, 40),
        hasOriginalBtn: !!document.getElementById('ocr-original'),
        buttons: Array.from(panel.querySelectorAll('.ocr-actions button')).map(function(b){ return b.textContent.trim(); }),
        rects: (function(){
          function r(sel){ var el = document.querySelector(sel); if (!el) return null; var b = el.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), top: Math.round(b.top) }; }
          return {
            panel: r('#translate-panel'), split: r('.translate-split'), block: r('.translate-block'),
            source: r('.translate-source'), textarea: r('#translate-text'), actions: r('#translate-panel .ocr-actions')
          };
        })()
      });
    })()`);
    console.log('OCR-FLOW ' + ocrFlow);
    assert.equal(JSON.parse(ocrFlow).panelShown, true, 'O 键打开真实结果区');
    console.log('15-panel-ocr-result.png ' + await capture(send, '15-panel-ocr-result.png') + ' bytes');

    // 「查看原图」必须真的调用主进程，不能只是能点
    const originalFlow = await evaluate(send, `(async function(){
      window.__originalCalls = [];
      var before = window.suira.content.openOriginal;
      window.suira.content.openOriginal = async function(id){ window.__originalCalls.push(id); return { ok:true }; };
      document.getElementById('ocr-original').click();
      await new Promise(function(r){ setTimeout(r, 300); });
      window.suira.content.openOriginal = before;
      return JSON.stringify({ calls: window.__originalCalls });
    })()`);
    console.log('ORIGINAL-FLOW ' + originalFlow);
    assert.deepEqual(JSON.parse(originalFlow).calls, ['i3']);

    // T 键：翻译 → 原文/译文对照面板
    const translateFlow = await evaluate(send, `(async function(){
      window.__runs = [];
      // 上一段留下的 OCR 面板会吃掉按键：先关掉再按 T
      document.getElementById('ocr-close').click();
      await new Promise(function(r){ setTimeout(r, 200); });
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true}));
      await new Promise(function(r){ setTimeout(r, 600); });
      var panel = document.getElementById('translate-panel');
      return JSON.stringify({
        runs: window.__runs,
        panelShown: panel ? !panel.hidden : false,
        sourceChars: (document.getElementById('translate-source').textContent || '').length,
        textChars: (document.getElementById('translate-text').value || '').length,
        targets: document.getElementById('translate-target').options.length,
        originalHidden: document.getElementById('translate-original').hidden,
        buttons: Array.from(panel.querySelectorAll('.ocr-actions button')).map(function(b){ return b.textContent.trim(); }),
        rects: (function(){
          function r(sel){ var el = document.querySelector(sel); if (!el) return null; var b = el.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), top: Math.round(b.top) }; }
          return {
            panel: r('#translate-panel'), split: r('.translate-split'), block: r('.translate-block'),
            source: r('.translate-source'), textarea: r('#translate-text'), actions: r('#translate-panel .ocr-actions')
          };
        })()
      });
    })()`);
    console.log('TRANSLATE-FLOW ' + translateFlow);
    assert.equal(JSON.parse(translateFlow).panelShown, true, 'T 键打开翻译结果区');
    console.log('21-panel-translate.png ' + await capture(send, '21-panel-translate.png') + ' bytes');

    // 换目标语言应重新调用一次翻译，而不是原地不动
    const retranslate = await evaluate(send, `(async function(){
      window.__translateCalls = [];
      var before = window.suira.translate.run;
      window.suira.translate.run = async function(payload){ window.__translateCalls.push(payload); return { ok:true, text:'重新翻译后的文字' }; };
      var select = document.getElementById('translate-target');
      select.value = 'ja';
      select.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(function(r){ setTimeout(r, 400); });
      window.suira.translate.run = before;
      return JSON.stringify({ calls: window.__translateCalls, text: document.getElementById('translate-text').value.slice(0,12) });
    })()`);
    console.log('RETRANSLATE ' + retranslate);

    // 关闭 OCR 面板后回到键位面板
    const backFlow = await evaluate(send, `(async function(){
      document.getElementById('ocr-close').click();
      await new Promise(function(r){ setTimeout(r, 300); });
      return JSON.stringify({
        ocrHidden: document.getElementById('ocr-panel').hidden,
        keysVisible: document.querySelectorAll('.key').length,
        mode: document.getElementById('panel').dataset.mode
      });
    })()`);
    console.log('BACK-FLOW ' + backFlow);

    console.log('\n== 搜索 / 错误反馈 / 面板重开回归 ==');
    const regression = await evaluate(send, `(async function(){
      const out = {};
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const input = document.getElementById('search');
      const type = text => { input.value = text; input.dispatchEvent(new Event('input', { bubbles:true })); };
      document.getElementById('translate-close').click();
      let hides = 0;
      const originalHide = window.suira.quick.hide;
      window.suira.quick.hide = async () => { hides++; return {ok:true}; };
      input.focus(); type('截图');
      await wait(150);
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
      out.escapeClearsOnly = input.value === '' && hides === 0;
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
      out.escapeHidesOnce = hides === 1;
      window.suira.quick.hide = originalHide;

      const originalQuery = window.suira.search.query;
      const pending = {};
      window.suira.search.query = q => new Promise(r => { pending[q] = r; });
      type('old'); await wait(130);
      type('new'); await wait(130);
      out.oldResultsCleared = document.querySelectorAll('.command-item').length === 0;
      pending.new([{id:'new',kind:'command',title:'新查询结果',action:'capture'}]); await wait(20);
      pending.old([{id:'old',kind:'command',title:'旧查询结果',action:'capture'}]); await wait(20);
      out.latestSearchWins = document.getElementById('command-list').textContent.includes('新查询结果') && !document.getElementById('command-list').textContent.includes('旧查询结果');
      type('clear'); await wait(130);
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
      pending.clear([{id:'ghost',kind:'command',title:'过期结果',action:'capture'}]); await wait(20);
      out.clearCancelsResults = document.querySelectorAll('.command-item').length === 0 && document.getElementById('command-section').hidden;
      window.suira.search.query = async () => { throw new Error('索引暂不可用'); };
      type('fail'); await wait(150);
      out.searchFailureVisible = document.getElementById('command-list').textContent.includes('搜索失败');
      window.suira.search.query = originalQuery;
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));

      document.getElementById('toolbox').click();
      type('工具'); await wait(150);
      out.toolboxNotStacked = document.getElementById('toolbox-panel').hidden && !document.getElementById('command-section').hidden;
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));

      const originalApps = window.suira.apps.list;
      window.suira.apps.list = async () => { throw new Error('开始菜单读取失败'); };
      document.getElementById('apps-retry').click(); await wait(80);
      document.dispatchEvent(new KeyboardEvent('keydown', {key:' ',bubbles:true,cancelable:true})); await wait(80);
      out.appsFailureVisible = !document.getElementById('empty-state').hidden && document.getElementById('empty-description').textContent.includes('读取失败') && !document.getElementById('apps-retry').hidden;
      window.suira.apps.list = originalApps;
      document.getElementById('apps-retry').click(); await wait(100);
      out.appsRetryWorks = document.getElementById('empty-state').hidden && document.querySelectorAll('.app-item').length > 0;
      const originalOpen = window.suira.quick.openApp;
      window.suira.quick.openApp = async () => { throw new Error('启动被拒绝'); };
      document.querySelector('.app-item').click(); await wait(40);
      out.launchErrorFeedback = document.getElementById('toast').classList.contains('is-error') && document.getElementById('toast').textContent.includes('启动被拒绝');
      window.suira.quick.openApp = originalOpen;

      document.dispatchEvent(new KeyboardEvent('keydown', {key:' ',bubbles:true,cancelable:true}));
      document.querySelector('[data-key="O"]').click(); await wait(40);
      const originalAdd = window.suira.content.addText;
      window.suira.content.addText = async () => { throw new Error('保存被拒绝'); };
      document.getElementById('ocr-copy').click(); await wait(40);
      out.ocrRejectionFeedback = document.getElementById('toast').textContent.includes('保存被拒绝');
      window.suira.content.addText = originalAdd;
      document.getElementById('ocr-close').click();
      document.querySelector('[data-key="T"]').click(); await wait(50);
      const originalTranslate = window.suira.translate.run;
      const translations = {};
      window.suira.translate.run = p => new Promise(r => { translations[p.target] = r; });
      const select = document.getElementById('translate-target');
      select.value = 'en'; select.dispatchEvent(new Event('change')); await wait(20);
      select.value = 'ja'; select.dispatchEvent(new Event('change')); await wait(20);
      translations.ja({ok:true,text:'最新日文'}); await wait(20);
      translations.en({ok:true,text:'过期英文'}); await wait(20);
      out.latestTranslationWins = document.getElementById('translate-text').value === '最新日文';
      window.suira.translate.run = originalTranslate;
      for (const cb of window.__handlers['quick:prepare'] || []) await cb({token:2});
      for (const cb of window.__handlers['quick:shown'] || []) cb();
      await wait(60);
      out.reopenClosesTranslation = document.getElementById('translate-panel').hidden;
      out.reopenClearsToast = !document.getElementById('toast').classList.contains('is-visible');
      out.noUnhandledErrors = window.__errs.length === 0;
      return out;
    })()`);
    for (const [name, passed] of Object.entries(regression)) {
      assert.equal(passed, true, name);
      console.log('  PASS  ' + name);
    }

    console.log('\n== 浅色 / 深色 / 小屏布局 ==');
    await checkKeycapMaterial({send,evaluate});
    for (const [width, height, scheme] of [[QUICK_PANEL_SIZE.width,QUICK_PANEL_SIZE.height,'light'], [QUICK_PANEL_SIZE.width,QUICK_PANEL_SIZE.height,'dark'], [800,560,'light'], [640,480,'dark']]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:2, mobile:false });
      await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-color-scheme',value:scheme}] });
      const layout = await evaluate(send, `(function(){
        const body = document.getElementById('panel-body');
        body.scrollTop = body.scrollHeight;
        const panel = document.getElementById('panel');
        const b = body.getBoundingClientRect();
        const keys = Array.from(document.querySelectorAll('.key-card'));
        return {
          keys:keys.length,
          within:keys.every(k=>{const r=k.getBoundingClientRect(); return r.left>=b.left && r.right<=b.right+1;}),
          horizontalOverflow:body.scrollWidth>body.clientWidth+1,
          verticalOverflow:body.scrollHeight>body.clientHeight+1,
          lastKeyReachable:keys.at(-1).getBoundingClientRect().bottom<=b.bottom+1,
          footerVisible:document.querySelector('.panel-foot').getBoundingClientRect().bottom<=panel.getBoundingClientRect().bottom,
          keySize:keys[0].getBoundingClientRect().width,
          square:keys.every(k=>Math.abs(k.getBoundingClientRect().width-k.getBoundingClientRect().height)<1),
          numberBorders:keys.slice(0,12).every(k=>{const face=k.querySelector('.key-face')||k;return getComputedStyle(face).borderTopStyle==='solid'&&getComputedStyle(face).borderTopColor!=='rgba(0, 0, 0, 0)';}),
          brandLoaded:document.querySelector('.brand-symbol img').naturalWidth>0,
          removedText:!document.querySelector('.key-label, .context-strip, #source-card, #return-bar'),
          errors:window.__errs
        };
      })()`);
      assert.equal(layout.keys,38);
      assert.equal(layout.square,true,'所有键位应为正方形');
      assert.equal(layout.numberBorders,true,'数字行应有可见边框');
      assert.equal(layout.brandLoaded,true,'产品图标应成功加载');
      assert.equal(layout.removedText,true,'不再呈现按键标签和底部内容条');
      assert.equal(layout.within,true, '键帽不能横向裁切 ' + width);
      assert.equal(layout.horizontalOverflow,false, '不应出现横向滚动 ' + width);
      assert.equal(layout.footerVisible,true);
      assert.equal(layout.lastKeyReachable,true, '滚动后能完整看到最后一行键帽');
      if (width === QUICK_PANEL_SIZE.width) assert.equal(layout.verticalOverflow,false, '默认尺寸无需滚动 ' + JSON.stringify(layout));
      assert.deepEqual(layout.errors,[]);
      console.log('  PASS  ' + width + '×' + height + ' ' + scheme + ' ' + JSON.stringify(layout));
      if (width === QUICK_PANEL_SIZE.width && scheme === 'dark') await capture(send, '22-panel-actions-dark.png');
    }
    await checkBindings({ send, evaluate, capture });
    console.log('\n== 六个主题预设 / 明暗模式 ==');
    const {PRESET_NAMES,presetPalette,generatePalette}=require('../lib/palette');
    // The binding regression changes keys deliberately. Preview a fresh default
    // panel so the preset gallery contains no test bindings or leftover feedback.
    await send('Page.reload',{ignoreCache:true});await sleep(1200);
    await evaluate(send,`(async()=>{for(const cb of window.__handlers['quick:prepare']||[])await cb({token:1});for(const cb of window.__handlers['quick:shown']||[])cb();return true;})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});await sleep(350);
    await send('Emulation.setDeviceMetricsOverride',{...QUICK_PANEL_SIZE,deviceScaleFactor:2,mobile:false});
    for(const mode of ['light','dark'])for(const name of PRESET_NAMES){
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:mode}]});
      const palette=(name==='wallpaper'?generatePalette('#478f80'):presetPalette(name))[mode];
      await evaluate(send,`(()=>{const root=document.documentElement;root.dataset.theme=${JSON.stringify(name)};for(const scale of ['slate','accent'])for(let i=0;i<12;i++){const key='--'+scale+'-'+(i+1);root.style.removeProperty(key);if(${JSON.stringify(name)}==='wallpaper')root.style.setProperty(key,${JSON.stringify(palette)}[scale][i]);}document.getElementById('panel-body').scrollTop=0;return true;})()`);
      await sleep(160);
      assert.equal(await evaluate(send,'getComputedStyle(document.documentElement).getPropertyValue("--slate-2").trim()'),palette.slate[1]);
      await capture(send,`theme-${name}-${mode}.png`);
      console.log('  PASS '+name+' '+mode);
    }
    console.log('\n面板交互、键位绑定、拖动、错误路径与四组显示条件全部通过。');

    ws.close();
  } finally {
    child.kill();
    await sleep(400);
  }
})().catch((e) => { console.error('FAIL ' + e.stack); process.exit(1); });
