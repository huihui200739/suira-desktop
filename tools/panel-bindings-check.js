'use strict';

// Browser interaction regression. Load the production binding model in the fixture
// so mouse/keyboard assertions exercise the same move semantics as Electron IPC.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const bindingFixture = `
window.__keyModel = (() => {const module={exports:{}};
${fs.readFileSync(path.join(root, 'lib/keybindings.js'), 'utf8')}
return module.exports;})();
window.__bindingModel = (() => {const module={exports:{}};const require=()=>window.__keyModel;
${fs.readFileSync(path.join(root, 'lib/panel-bindings.js'), 'utf8')}
return module.exports;})();
window.__shortcutModel = (() => {const module={exports:{}};
${fs.readFileSync(path.join(root, 'lib/shortcuts.js'), 'utf8')}
return module.exports;})();
window.__panelShortcuts = (() => {const module={exports:{}};const require=id=>id==='./keybindings'?window.__keyModel:id==='./panel-bindings'?window.__bindingModel:window.__shortcutModel;
${fs.readFileSync(path.join(root, 'lib/panel-shortcuts.js'), 'utf8')}
return module.exports;})();
window.__bindings={};window.__moves=[];window.__sets=[];
window.__globals={...window.__shortcutModel.DEFAULT_BINDINGS};
window.suira.shortcuts={get:async()=>({bindings:window.__globals}),onChanged:()=>()=>{}};
window.__applyBinding=result=>{if(result.ok){window.__globals={...window.__globals,...window.__panelShortcuts.shortcutPatchForPanel(window.__bindings,result.bindings,window.__globals)};window.__bindings=result.bindings;}};
window.suira.panel.state=async()=>{const layout=window.__keyModel.keyLayout(null,window.__bindings);for(const key of layout.keys){const name=Object.keys(window.__panelShortcuts.PANEL_SHORTCUT_ACTIONS).find(name=>window.__panelShortcuts.PANEL_SHORTCUT_ACTIONS[name]===key.actionId);if(name)key.accelerator=window.__globals[name]||'';}return {...layout,tools:window.__keyModel.TOOLBOX_TOOLS,actions:window.__keyModel.implementedPanelActions()};};
window.suira.panel.setBinding=async p=>{
 window.__sets.push(p);
 if(window.__bindingError)return {ok:false,error:window.__bindingError};
 const result=window.__bindingModel.assignPanelBinding(window.__bindings,p.key,p.binding);
 window.__applyBinding(result);
 return {ok:result.ok,error:result.error,message:result.message};
};
window.suira.panel.moveBinding=async p=>{
 window.__moves.push(p);
 if(window.__moveDelay)await new Promise(r=>setTimeout(r,window.__moveDelay));
 if(window.__bindingError)return {ok:false,error:window.__bindingError};
 const result=window.__bindingModel.movePanelBinding(window.__bindings,p.fromKey,p.toKey);
 window.__applyBinding(result);
 return {ok:result.ok,error:result.error,message:result.message};
};
window.suira.panel.pickPath=async()=>window.__picked||{ok:false,canceled:true};
`;

async function checkBindings({ send, evaluate, capture }) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ev = expression => evaluate(send, expression);
  const query = key => `.key[data-key="${key}"]`;
  const state = key => ev(`document.querySelector(${JSON.stringify(query(key))}).dataset.state`);
  async function shown() {
    await ev(`(async()=>{for(const cb of window.__handlers['quick:shown']||[])await cb();document.activeElement?.blur();document.getElementById('panel-body').scrollTop=0;return true;})()`);
  }
  async function point(key) {
    return ev(`(()=>{const e=document.querySelector(${JSON.stringify(query(key))});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  }
  async function mouse(type, p, extra = {}) {
    await send('Input.dispatchMouseEvent', { type, ...p, ...extra });
  }
  async function start(from, to) {
    const a = await point(from), b = await point(to);
    await mouse('mouseMoved', a);
    await mouse('mousePressed', a, {button:'left',buttons:1,clickCount:1});
    for (let n=1;n<=5;n++) await mouse('mouseMoved', {x:a.x+(b.x-a.x)*n/5,y:a.y+(b.y-a.y)*n/5}, {button:'left',buttons:1});
    return b;
  }
  async function drop(from, to) {
    const p = await start(from, to);
    await mouse('mouseReleased', p, {button:'left',buttons:0,clickCount:1});
    await wait(100);
  }
  async function key(key, code = key.toUpperCase()) {
    await send('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});
  }
  async function open(char) {
    const p=await point(char);
    await mouse('mousePressed',p,{button:'right',buttons:2,clickCount:1});
    await mouse('mouseReleased',p,{button:'right',buttons:0,clickCount:1});
    await wait(160);
    assert.equal(await ev(`document.getElementById('binding-editor').hidden`),false);
  }
  const close = () => ev(`document.getElementById('binding-close').click(),true`);
  async function within() {
    const facts=await ev(`(()=>{const r=document.querySelector('.binding-card').getBoundingClientRect();return {within:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,blur:getComputedStyle(document.getElementById('binding-editor')).backdropFilter,buttons:[...document.querySelectorAll('#binding-categories button')].map(e=>e.textContent.trim())};})()`);
    assert.equal(facts.within,true,'绑定菜单必须完整落在窗口内');
    assert.equal(facts.blur,'none','展开菜单时不模糊整个键盘');
    return facts;
  }

  console.log('\n== 键位菜单与真实左键拖动 ==');
  await send('Emulation.setDeviceMetricsOverride',{width:1160,height:620,deviceScaleFactor:2,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await shown();
  await ev('window.__runs=[],true');
  assert.equal(await ev(`document.querySelector('[data-key="C"]').dataset.action`),'capture');
  assert.equal(await ev(`document.querySelector('[data-key="V"]').dataset.action`),'clipboard');
  assert.equal(await ev(`document.getElementById('capture-kbd').textContent`),'Alt C');
  assert.equal(await ev(`document.getElementById('clipboard-kbd').textContent`),'Alt V');
  const held=await start('C','R');
  assert.equal(await ev('document.querySelectorAll(".is-key-near,.is-key-hover,.is-key-trail,.is-key-sheen,.is-key-pressed").length'),0,'Dragging suspends key feedback, trails, reflection and press');
  assert.equal(await ev('Boolean(document.querySelector(".key-drag-preview .suira-art"))'),true,'Dragging retains the actual tool object');
  assert.equal(await ev('getComputedStyle(document.querySelector(".key-drag-preview .key-face")).backgroundImage.includes("linear-gradient")'),true,'Dragging retains the key material');
  const anchor=await ev(`(()=>{const r=document.querySelector('.key-drag-preview').getBoundingClientRect();const original=document.querySelector('[data-key="C"]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,sourceW:original.width,sourceH:original.height};})()`);
  assert.ok(Math.abs(held.x-anchor.x-anchor.sourceW/2)<1,'拖动保留鼠标按下时的横向抓取点');
  assert.ok(Math.abs(held.y-anchor.y-anchor.sourceH/2)<1,'拖动保留鼠标按下时的纵向抓取点');
  assert.ok(Math.abs(anchor.w-anchor.sourceW)<.05);assert.ok(Math.abs(anchor.h-anchor.sourceH)<.05);
  assert.equal(await ev(`document.querySelector('.is-drop-over')?.dataset.key`),'R');
  assert.equal(await ev(`document.querySelectorAll('.is-drop-target').length>10`),true);
  await capture(send,'25-panel-key-drag.png');
  await mouse('mouseReleased',held,{button:'left',buttons:0,clickCount:1});await wait(100);
  assert.equal(await state('C'),'unbound');
  assert.equal(await ev(`document.querySelector('[data-key="R"]').dataset.action`),'capture');
  assert.equal(await ev(`document.querySelector('[data-key="R"] .key-badge').textContent`),'R');
  assert.equal(await ev(`document.getElementById('capture-kbd').textContent`),'Alt R');
  assert.deepEqual(await ev('window.__runs'),[],'拖动不能顺带执行源动作');
  await key('r','KeyR');await wait(30);
  assert.deepEqual(await ev('window.__runs'),['capture']);
  await ev('window.__runs=[],document.activeElement.blur(),true');
  await key('c','KeyC');await wait(180);
  assert.deepEqual(await ev('window.__runs'),[],'原按键不再触发截图');
  await shown();
  assert.equal(await state('R'),'bound','重新打开仍使用新键位');
  console.log('  PASS  左键 C → R、角标同步、新键执行、旧键失效、重新打开保持绑定');

  await open('R');await within();
  assert.equal(await ev(`document.getElementById('binding-clear').hidden`),false);
  await capture(send,'23-panel-binding-menu.png');
  await ev(`document.getElementById('binding-tools').click(),true`);await wait(140);await within();
  assert.equal(await ev(`document.querySelector('[data-binding-action="capture"] kbd').textContent`),'R');
  assert.equal(await ev(`document.querySelector('[data-binding-action="capture"]').disabled`),true);
  await capture(send,'24-panel-binding-tools.png');
  await ev(`document.getElementById('binding-back').click(),true`);
  await key('Escape','Escape');
  assert.equal(await ev(`document.getElementById('binding-editor').hidden`),true);
  assert.equal(await ev(`document.activeElement.dataset.key`),'R');
  console.log('  PASS  分类菜单、工具当前键位、返回、Esc 关闭并还原焦点');

  const moves=await ev('window.__moves.length');
  await ev('window.__runs=[],true');await drop('R','X');
  assert.equal(await ev('window.__moves.length'),moves);
  assert.deepEqual(await ev('window.__runs'),[]);
  assert.equal(await state('R'),'bound');assert.equal(await state('X'),'bound');
  const again = await point('R');
  await mouse('mousePressed', again, {button:'left',buttons:1,clickCount:1});
  await mouse('mouseReleased', again, {button:'left',buttons:0,clickCount:1});
  assert.deepEqual(await ev('window.__runs'),['capture'],'取消拖动后的下一次左键立即可用');
  await ev('window.__runs=[],true');
  const cancel=await start('R','Q');
  await key('Escape','Escape');
  await mouse('mouseReleased',cancel,{button:'left',buttons:0,clickCount:1});await wait(50);
  assert.equal(await ev('window.__moves.length'),moves);
  assert.equal(await ev(`document.querySelector('.key-drag-preview')===null`),true);
  await start('R','Q');
  await mouse('mouseMoved',{x:5,y:115},{button:'left',buttons:1});
  await mouse('mouseReleased',{x:5,y:115},{button:'left',buttons:0,clickCount:1});
  assert.equal(await ev('window.__moves.length'),moves);
  console.log('  PASS  已占用键拒绝、Esc 取消、放到键盘外取消，都不执行功能');

  await ev(`window.__bindingError='保存被拒绝',true`);await drop('R','Q');
  assert.equal(await state('R'),'bound');assert.equal(await state('Q'),'unbound');
  assert.equal(await ev(`document.getElementById('toast').textContent.includes('保存被拒绝')`),true);
  assert.equal(await ev(`document.getElementById('key-grid').getAttribute('aria-busy')`),'false');
  await ev(`window.__bindingError='',true`);await shown();
  console.log('  PASS  保存失败保留原位、显示错误并恢复交互');

  await open('Q');await ev(`document.getElementById('binding-url').click(),document.getElementById('binding-url-input').value='javascript:alert(1)',document.getElementById('binding-url-save').click(),true`);
  assert.equal(await ev('window.__sets.length'),0);
  assert.equal(await ev(`document.getElementById('binding-editor').hidden`),false);
  await ev(`document.getElementById('binding-url-input').value='example.com',document.getElementById('binding-url-save').click(),true`);await wait(100);
  assert.equal(await state('Q'),'custom');
  assert.equal(await ev('window.__bindings.Q.target'),'https://example.com/');
  await ev('window.__runs=[],true');await key('q','KeyQ');await wait(40);
  assert.deepEqual(await ev('window.__runs'),['binding:Q']);
  await open('A');await ev(`document.getElementById('binding-app').click(),true`);await wait(30);
  assert.equal(await ev(`document.getElementById('binding-editor').hidden`),false,'取消选文件后保持菜单');
  await ev(`window.__picked={ok:true,path:'C:\\\\Demo\\\\Editor.exe'},document.getElementById('binding-app-browse').click(),true`);await wait(80);
  assert.equal(await state('A'),'custom');
  await drop('A','E');
  assert.equal(await state('A'),'unbound');assert.equal(await state('E'),'custom');
  assert.equal(await ev('window.__bindings.E.type'),'app');
  await ev('window.__runs=[],true');await key('e','KeyE');await wait(30);
  assert.deepEqual(await ev('window.__runs'),['binding:E']);
  console.log('  PASS  网页协议校验、网址绑定、选择取消、应用绑定移动与新键触发');

  await open('E');await ev(`document.getElementById('binding-clear').click(),true`);await wait(80);
  assert.equal(await state('E'),'unbound');
  await open('1');await ev(`document.getElementById('binding-tools').click(),document.querySelector('[data-binding-action="capture"]').click(),true`);await wait(80);
  assert.equal(await state('R'),'unbound');assert.equal(await state('1'),'bound');
  console.log('  PASS  清除绑定和从工具菜单改绑，原位置均正确空出');

  for(const [width,height,scheme] of [[1160,620,'light'],[1160,620,'dark'],[640,480,'dark'],[800,560,'light']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
    await shown();
    for(const char of ['1','=','C','M']){
      await open(char);await within();
      await ev(`document.getElementById('binding-tools').click(),true`);await wait(140);await within();
      await close();
    }
    if(width===1160&&scheme==='dark'){
      await open('1');await capture(send,'26-panel-binding-menu-dark.png');await close();
    }
    console.log(`  PASS  菜单四角与工具子页完整可见 ${width}×${height} ${scheme}`);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1160,height:620,deviceScaleFactor:2,mobile:false});
  await shown();await open('=');await ev(`document.getElementById('binding-app').click(),true`);await wait(120);
  assert.equal(await ev(`document.querySelectorAll('.binding-app-option').length`),14);
  await ev(`(()=>{const input=document.getElementById('binding-app-search');input.value='wx';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  assert.equal(await ev(`document.querySelectorAll('.binding-app-option').length`),0,'新查询等待期间不保留旧的可绑定结果');
  await wait(200);assert.equal(await ev(`document.querySelectorAll('.binding-app-option').length`),1);
  assert.equal(await ev(`document.querySelector('.binding-app-option').textContent.trim()`),'微信');
  assert.equal(await ev(`Boolean(document.querySelector('.picker-app-icon img'))`),true);
  await ev(`document.getElementById('binding-app-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})),true`);
  assert.equal(await ev(`document.getElementById('binding-editor').hidden`),false);
  await ev(`document.getElementById('binding-app-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})),true`);await wait(100);
  assert.equal(await state('='),'custom');assert.equal(await ev(`window.__bindings['='].name`),'微信');
  await open('=');await ev(`document.getElementById('binding-clear').click(),true`);await wait(60);
  await open('=');await ev(`window.__appSearchError='扫描失败';document.getElementById('binding-app').click();true`);await wait(80);
  assert.equal(await ev(`document.getElementById('binding-app-status').textContent`),'扫描失败');
  await ev(`window.__appSearchError='';document.getElementById('binding-app-refresh').click();true`);await wait(120);
  assert.equal(await ev(`document.querySelectorAll('.binding-app-option').length`),14);
  await close();await open('=');await ev(`window.__appSearchDelay=180;document.getElementById('binding-app').click();document.getElementById('binding-back').click();true`);await wait(250);
  assert.equal(await ev(`document.getElementById('binding-apps-view').hidden`),true);
  assert.equal(await ev(`document.getElementById('binding-categories').hidden`),false);await ev('window.__appSearchDelay=0;true');await close();
  console.log('  PASS  搜索绑定带图标、拼音查询、候选输入不误绑、异步新查询清空旧结果、失败重试与迟到响应保护');
  assert.deepEqual(await ev('window.__errs'),[]);
}

module.exports = { bindingFixture, checkBindings };
