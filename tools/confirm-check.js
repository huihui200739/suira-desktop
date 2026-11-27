'use strict';
/*
 * 用无头 Chrome 验证「确认词」校验在真实 DOM 里生效。
 *
 * 复现的缺陷：删除任务 / 清空剪贴板弹窗只判断「输入非空」，
 * 输入任意一个字符就能确认，等于没有确认。
 *
 * 用法：node tools/confirm-check.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'tools', '.panel-shot');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(TMP, { recursive: true });

// 只加载 index.html 的确认框部分 + 真实 styles.css + 从 app.js 抽出的 openModal 逻辑。
// 直接加载整个 index.html 会因为没有 preload 而报错，所以这里构造最小页面。
const appJs = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const modalStart = appJs.indexOf('function openModal(');
const modalEnd = appJs.indexOf('/* ---------- events ---------- */');
if (modalStart < 0 || modalEnd < 0) throw new Error('无法从 app.js 抽取 openModal');
const modalSrc = 'let modalVersion = 0;\n' + appJs.slice(modalStart, modalEnd);

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="theme.css">
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="ui-motion.css">
<link rel="stylesheet" href="glass-select.css">
</head><body>
<div class="modal" id="modal" hidden>
  <div class="modal-card">
    <div class="modal-head"><div><h2 id="modal-title">新建任务</h2></div><button type="button" id="modal-close">×</button></div>
    <input class="modal-input" id="modal-input" type="text" placeholder="例如：竞品研究">
    <p class="modal-hint" id="modal-hint" hidden></p>
    <div class="modal-foot"><button class="quiet-btn" type="button" id="modal-cancel">取消</button><button class="primary-btn" type="button" id="modal-confirm">创建</button></div>
  </div>
</div>
<script src="ui-motion.js"></script>
<script src="icons.js"></script><script src="glass-select.js"></script>
<button id="dialog-origin" type="button">打开确认</button>
<form id="select-form"><label for="select-probe">测试选项</label><select id="select-probe"><option value="alpha">Alpha</option><option value="bravo" disabled>Bravo</option><option value="charlie">Charlie</option><option value="delta">Delta</option><option value="echo" hidden>Echo</option><optgroup label="Unavailable" disabled><option value="foxtrot">Foxtrot</option></optgroup></select><input id="checkbox-probe" type="checkbox" aria-label="测试复选框"></form><div id="select-destination"></div>
<script>
const $ = (s, r = document) => r.querySelector(s);
${modalSrc}
window.__openModal = openModal;
window.__closeModal = closeModal;
</script>
</body></html>`;

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluate failed');
  return r.result ? r.result.value : undefined;
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

(async () => {
  if (!CHROME) throw new Error('未找到 Chrome/Edge');
  fs.writeFileSync(path.join(TMP, 'confirm.html'), PAGE, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'src', 'styles.css'), path.join(TMP, 'styles.css'));
  for (const asset of ['theme.css','ui-motion.css','ui-motion.js','icons.js','glass-select.css','glass-select.js']) fs.copyFileSync(path.join(ROOT,'src',asset),path.join(TMP,asset));

  const userDataDir = path.join(TMP, 'profile-confirm');
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=900,700', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  try {
    let targets = null;
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = await res.json();
        if (targets.length) break;
      } catch { /* 端口未就绪 */ }
      await sleep(250);
    }
    if (!targets || !targets.length) throw new Error('Chrome 调试端口未就绪');
    const page = targets.find((t) => t.type === 'page');
    const { ws, send } = await connect(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await send('Page.navigate', { url: 'file:///' + path.join(TMP, 'confirm.html').replace(/\\/g, '/') });
    await sleep(900);

    console.log('\n== 确认词校验（真实 DOM）==');

    const state = () => evaluate(send, `JSON.stringify({
      disabled: document.getElementById('modal-confirm').disabled,
      hint: document.getElementById('modal-hint').textContent,
      hintHidden: document.getElementById('modal-hint').hidden,
      hintOk: document.getElementById('modal-hint').classList.contains('is-ok')
    })`);

    // 打开一个要求输入「清空」的确认框
    await evaluate(send, `window.__openModal('清空剪贴板记录','输入「清空」以确认',
      async (v)=>{ window.__confirmed = v; }, { expect:'清空' }), 'ok'`);
    await sleep(120);
    let s = JSON.parse(await state());
    check('初始状态确认按钮禁用', s.disabled === true, JSON.stringify(s));
    check('初始状态显示需要输入什么', s.hint.includes('清空'), s.hint);

    // 输入错误内容
    await evaluate(send, `(function(){
      var i = document.getElementById('modal-input');
      i.value = '删除'; i.dispatchEvent(new Event('input',{bubbles:true}));
    })(), 'ok'`);
    await sleep(80);
    s = JSON.parse(await state());
    check('输入错误内容仍然禁用', s.disabled === true, JSON.stringify(s));

    // 点确认也不能通过（关键：之前这里会直接执行）
    await evaluate(send, `(function(){
      window.__confirmed = null;
      document.getElementById('modal-confirm').click();
    })(), 'ok'`);
    await sleep(200);
    const wrongConfirm = await evaluate(send, `JSON.stringify({
      confirmed: window.__confirmed,
      stillOpen: !document.getElementById('modal').hidden
    })`);
    const wc = JSON.parse(wrongConfirm);
    check('输入错误内容点确认不执行回调', wc.confirmed === null, wrongConfirm);
    check('输入错误内容时弹窗不关闭', wc.stillOpen === true, wrongConfirm);

    // 输入正确内容
    await evaluate(send, `(function(){
      var i = document.getElementById('modal-input');
      i.value = '清空'; i.dispatchEvent(new Event('input',{bubbles:true}));
    })(), 'ok'`);
    await sleep(80);
    s = JSON.parse(await state());
    check('输入正确内容后确认按钮启用', s.disabled === false, JSON.stringify(s));
    check('输入正确后提示变绿', s.hintOk === true, JSON.stringify(s));

    // 现在点确认应当执行
    await evaluate(send, `(function(){
      window.__confirmed = null;
      document.getElementById('modal-confirm').click();
    })(), 'ok'`);
    await sleep(300);
    const okConfirm = await evaluate(send, `JSON.stringify({
      confirmed: window.__confirmed,
      closed: document.getElementById('modal').hidden
    })`);
    const oc = JSON.parse(okConfirm);
    check('输入正确内容后确认执行回调', oc.confirmed === '清空', okConfirm);
    check('确认后弹窗关闭', oc.closed === true, okConfirm);

    console.log('\n== 无确认词时行为不变 ==');
    await evaluate(send, `window.__openModal('新建任务','例如：竞品研究',
      async (v)=>{ window.__created = v; }), 'ok'`);
    await sleep(120);
    await evaluate(send, `(function(){
      var i = document.getElementById('modal-input');
      i.value = '竞品研究'; i.dispatchEvent(new Event('input',{bubbles:true}));
    })(), 'ok'`);
    await sleep(40);
    s = JSON.parse(await state());
    check('普通新建弹窗输入标题后无需确认词', s.disabled === false, JSON.stringify(s));
    check('普通弹窗不显示确认提示', s.hintHidden === true, JSON.stringify(s));
    await evaluate(send, `(function(){
      document.getElementById('modal-confirm').click();
    })(), 'ok'`);
    await sleep(250);
    const created = JSON.parse(await evaluate(send, `JSON.stringify({ v: window.__created })`));
    check('普通弹窗输入即创建', created.v === '竞品研究', JSON.stringify(created));

    console.log('\n== 弹层来源与键盘焦点 ==');
    const focus = await evaluate(send, `(function(){
      const origin=document.getElementById('dialog-origin');origin.focus();
      window.__openModal('新建任务','名称',async()=>{});
      const input=document.getElementById('modal-input');
      const first=document.getElementById('modal-close');
      const last=document.getElementById('modal-confirm');
      const initial=document.activeElement===input;
      input.value='任务';input.dispatchEvent(new Event('input',{bubbles:true}));
      last.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      const forward=document.activeElement===first;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
      const backward=document.activeElement===last;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      return {initial,forward,backward,closed:document.getElementById('modal').hidden,restored:document.activeElement===origin};
    })()`);
    for(const [name,ok] of Object.entries(focus)) check('焦点 '+name,ok);

    console.log('\n== 玻璃下拉框：真实键盘与原生值契约 ==');
    const press=async key=>{const vk={ArrowDown:40,ArrowUp:38,Home:36,End:35,Enter:13,Escape:27,Tab:9}[key]||key.toUpperCase().charCodeAt(0);await send('Input.dispatchKeyEvent',{type:'keyDown',key,windowsVirtualKeyCode:vk});await send('Input.dispatchKeyEvent',{type:'keyUp',key,windowsVirtualKeyCode:vk});};
    await evaluate(send, `(()=>{const s=document.getElementById('select-probe');window.__selectEvents={input:0,change:0};s.addEventListener('input',()=>__selectEvents.input++);s.addEventListener('change',()=>__selectEvents.change++);s.nextElementSibling.querySelector('button').focus();return true;})()`);
    const selectState=()=>evaluate(send,`(()=>{const s=document.getElementById('select-probe'),b=s.nextElementSibling.querySelector('button');return {value:s.value,caption:b.textContent,open:b.getAttribute('aria-expanded')==='true',active:document.querySelector('.glass-select-menu:not([hidden]) .is-active')?.textContent,focus:document.activeElement===b,disabled:b.disabled,events:window.__selectEvents};})()`);
    await press('ArrowDown');let combo=await selectState();
    check('向下打开并跳过禁用项',combo.open&&combo.active==='Charlie'&&combo.value==='alpha',JSON.stringify(combo));
    await press('Enter');combo=await selectState();
    check('Enter 提交并保留焦点',!combo.open&&combo.value==='charlie'&&combo.focus,JSON.stringify(combo));
    check('提交只触发一次 input/change',combo.events.input===1&&combo.events.change===1,JSON.stringify(combo.events));
    await press('Home');combo=await selectState();check('Home 定位首项但尚不改值',combo.active==='Alpha'&&combo.value==='charlie');
    await press('Escape');combo=await selectState();check('Esc 取消选择且关闭列表',!combo.open&&combo.value==='charlie'&&combo.events.change===1);
    await press('End');combo=await selectState();check('End 跳过隐藏项和禁用分组',combo.active==='Delta');
    await press('Enter');await press('ArrowUp');combo=await selectState();check('向上定位上一可选项',combo.active==='Charlie');await press('Escape');
    await press('c');combo=await selectState();check('首字母定位选项',combo.open&&combo.active==='Charlie');await press('Enter');
    const programmatic=await evaluate(send,`(()=>{const s=document.getElementById('select-probe'),before=__selectEvents.change;s.value='alpha';const first=s.nextElementSibling.textContent;s.selectedIndex=3;return {first,last:s.nextElementSibling.textContent,value:s.value,unchanged:before===__selectEvents.change};})()`);
    check('程序赋 value/selectedIndex 同步且不发伪事件',programmatic.first.includes('Alpha')&&programmatic.last.includes('Delta')&&programmatic.value==='delta'&&programmatic.unchanged,JSON.stringify(programmatic));
    await evaluate(send,`document.getElementById('select-form').reset();true`);await sleep(60);combo=await selectState();check('表单 reset 恢复原生默认值和显示',combo.value==='alpha'&&combo.caption.includes('Alpha'));
    await evaluate(send,`document.getElementById('select-probe').disabled=true;true`);await sleep(30);combo=await selectState();check('禁用状态同步可见按钮',combo.disabled);
    await evaluate(send,`document.getElementById('select-probe').disabled=false;document.getElementById('select-destination').append(document.getElementById('select-probe'));true`);await sleep(40);
    check('原生控件移动后玻璃按钮一起移动',await evaluate(send,`document.getElementById('select-probe').nextElementSibling.classList.contains('glass-select')&&document.getElementById('select-destination').querySelectorAll('[role="combobox"]').length===1`));
    await evaluate(send,`(()=>{const s=document.getElementById('select-probe');s.innerHTML='<option value="new">New option</option>';return true;})()`);await sleep(30);combo=await selectState();check('动态选项列表刷新',combo.value==='new'&&combo.caption.includes('New option'));
    await evaluate(send,`(()=>{window.__openModal('下拉测试','',async()=>{});const s=document.createElement('select');s.id='modal-select';s.innerHTML='<option>A</option><option>B</option>';document.getElementById('modal-input').after(s);SuiraGlassSelect.mount(s);s.nextElementSibling.querySelector('button').focus();return true;})()`);
    await press('Enter');await press('Escape');check('列表 Esc 不关闭所属对话框',await evaluate(send,`!SuiraGlassSelect.isOpen()&&!document.getElementById('modal').hidden`));await press('Escape');
    await evaluate(send,`document.getElementById('checkbox-probe').click();true`);await sleep(160);
    const checkbox=await evaluate(send,`(()=>{const c=document.getElementById('checkbox-probe'),s=getComputedStyle(c);return {checked:c.checked,background:s.backgroundColor,width:s.width,appearance:s.appearance};})()`);
    check('复选框保留原生交互并使用 Iris 勾选面',checkbox.checked&&checkbox.background==='rgb(24, 24, 27)'&&checkbox.width==='16px'&&checkbox.appearance==='none',JSON.stringify(checkbox));
    check('复选框样式不修改编辑器管理的 DOM',await evaluate(send,`(()=>{const c=document.getElementById('checkbox-probe'),before=c.outerHTML;SuiraGlassSelect.mount(c);return c.outerHTML===before&&!c.className;})()`));
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const reduced=await evaluate(send,`(()=>{const box=document.createElement('div');box.className='panel is-revealing';document.body.append(box);const c=getComputedStyle(box);const result={animation:c.animationName,transition:getComputedStyle(document.querySelector('[role="combobox"]')).transitionDuration};box.remove();return result;})()`);
    check('减少动态效果关闭动画与控件过渡',reduced.animation==='none'&&reduced.transition==='0s',JSON.stringify(reduced));
    console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
    ws.close();
  } finally {
    child.kill();
    await sleep(400);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
