'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DEFAULT_BINDINGS, ShortcutManager } = require('./lib/shortcuts');
const { SuiraStore } = require('./lib/store');
const { assignPanelBinding, movePanelBinding } = require('./lib/panel-bindings');
const { acceleratorKey, actionKey, alignPanelShortcuts, shortcutPatchForPanel, migrateLegacyPanelBindings } = require('./lib/panel-shortcuts');
let count=0;
function check(name,fn){fn();count++;console.log('PASS '+name);}

check('新默认与全局组合键主键一致，迁移 Z/X/V 时文本转换不丢失',()=>{
  const old=migrateLegacyPanelBindings({});
  assert.equal(actionKey(old,'capture'),'Z');assert.equal(actionKey(old,'clipboard'),'X');
  const result=alignPanelShortcuts(old,DEFAULT_BINDINGS);
  assert.equal(result.ok,true);
  assert.equal(actionKey(result.bindings,'capture'),'C');
  assert.equal(actionKey(result.bindings,'clipboard'),'V');
  assert.equal(actionKey(result.bindings,'text-clean'),'X');
});
check('迁移保留用户文件绑定和自定义动作，设置中的主键优先',()=>{
  const custom={type:'file',target:'C:\\Demo\\sample.txt',name:'示例'};
  const result=alignPanelShortcuts(migrateLegacyPanelBindings({C:custom,Q:{type:'action',id:'capture'},Z:{type:'none'}}),DEFAULT_BINDINGS);
  assert.equal(result.ok,true);assert.equal(actionKey(result.bindings,'capture'),'C');
  assert.deepEqual(result.bindings.Q,custom);
});
check('设置中的自定义剪贴板键也会对齐，重复主键不会悄悄覆盖',()=>{
  const result=alignPanelShortcuts({}, {...DEFAULT_BINDINGS,clipboardBar:'Control+Shift+K'});
  assert.equal(actionKey(result.bindings,'clipboard'),'K');
  assert.equal(alignPanelShortcuts({}, {capture:'Alt+C',clipboardBar:'Ctrl+C'}).ok,false);
});
check('拖动保留修饰键，两项交换时同时生成两个新组合键',()=>{
  const moved=movePanelBinding({},'C','Q');
  assert.deepEqual(shortcutPatchForPanel({},moved.bindings,{capture:'Control+Shift+C',clipboardBar:'Alt+V'}),{capture:'Control+Shift+Q'});
  const swapped=assignPanelBinding({},'V',{type:'action',id:'capture'});
  assert.deepEqual(shortcutPatchForPanel({},swapped.bindings,DEFAULT_BINDINGS),{capture:'Alt+V',clipboardBar:'Alt+C'});
});
check('禁用的全局组合键不被拖动重新启用，清除面板动作时同步解绑',()=>{
  assert.deepEqual(shortcutPatchForPanel({},movePanelBinding({},'C','Q').bindings,{capture:''}),{});
  assert.deepEqual(shortcutPatchForPanel({},assignPanelBinding({},'C',null).bindings,DEFAULT_BINDINGS),{capture:''});
  assert.equal(acceleratorKey('Control+F8'),'');assert.equal(acceleratorKey('Alt+Minus'),'-');
});
check('创建钉图与钉图显隐、唤起面板与布局轮换不会错误地互相改键',()=>{
  const moved=movePanelBinding({},'P','Q');
  assert.deepEqual(shortcutPatchForPanel({},moved.bindings,DEFAULT_BINDINGS),{});
});

const active=new Map(), blocked=new Set();
const api={register:(key,fn)=>{if(blocked.has(key)||active.has(key))return false;active.set(key,fn);return true;},unregister:key=>active.delete(key)};
const manager=new ShortcutManager({globalShortcut:api,handlers:Object.fromEntries([...Object.keys(DEFAULT_BINDINGS),'legacy'].map(name=>[name,()=>{}]))});
manager.registerAll();
check('批量交换 C/V 不被中间状态的重复键阻止',()=>{
  const result=manager.rebindMany({capture:'Alt+V',clipboardBar:'Alt+C'});
  assert.equal(result.ok,true);assert.equal(manager.snapshot().bindings.capture,'Alt+V');
  assert.equal(active.has('Alt+C'),true);assert.equal(active.has('Alt+V'),true);
});
check('新组合键被占用时恢复旧注册，不更新任何绑定',()=>{
  const before=manager.snapshot();blocked.add('Alt+Q');
  assert.equal(manager.rebindMany({capture:'Alt+Q',clipboardBar:'Alt+K'}).ok,false);
  assert.deepEqual(manager.snapshot(),before);
  assert.equal(active.has('Alt+V'),true);assert.equal(active.has('Alt+C'),true);assert.equal(active.has('Alt+K'),false);
  blocked.clear();
});
check('与唤起等其他组合键撞键会整批拒绝',()=>{
  assert.equal(manager.rebindMany({capture:'Alt+S'}).ok,false);
  assert.equal(manager.snapshot().bindings.quick,'Alt+S');
});
check('磁盘失败时恢复快照；原键被外部抢占时状态如实报告失败',()=>{
  const before=manager.snapshot();
  assert.equal(manager.rebindMany({capture:'Alt+Q'}).ok,true);
  blocked.add(before.bindings.capture);
  const restored=manager.restoreSnapshot(before);
  assert.deepEqual(restored.bindings,before.bindings);assert.equal(restored.status.capture.ok,false);assert.equal(active.has('Alt+Q'),false);
  blocked.clear();manager.restoreSnapshot(before);
});
check('显式 Alt+F 不会被兼容唤起键覆盖，重启注册与移走后恢复都正确',()=>{
  assert.equal(manager.rebindMany({capture:'Alt+F'}).ok,true);
  assert.equal(active.get('Alt+F'),manager.handlers.capture);
  manager.restoreSnapshot(manager.snapshot());
  assert.equal(active.get('Alt+F'),manager.handlers.capture);
  assert.equal(manager.rebindMany({capture:'Alt+Q'}).ok,true);
  assert.equal(active.get('Alt+F'),manager.handlers.legacy);
});
manager.dispose();

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-bindings-'));
  try{
    const file=path.join(tmp,'data.json'),store=new SuiraStore(file);
    const next=movePanelBinding(store.getPanelBindings(),'C','Q').bindings;
    await store.setPanelConfiguration(next,{shortcutCapture:'Alt+Q',shortcutClipboardBar:'Alt+2'});
    const reopened=new SuiraStore(file);
    assert.equal(actionKey(reopened.getPanelBindings(),'capture'),'Q');
    assert.equal(reopened.getSettings().shortcutCapture,'Alt+Q');assert.equal(reopened.getSettings().shortcutClipboardBar,'Alt+2');
    const before=reopened.getPanelBindings(),settings=reopened.getSettings();
    reopened.save=async()=>{throw Error('disk error');};
    await assert.rejects(reopened.setPanelConfiguration({}, {shortcutCapture:'Alt+C'}),/disk error/);
    assert.deepEqual(reopened.getPanelBindings(),before);assert.deepEqual(reopened.getSettings(),settings);
    console.log('PASS  面板绑定和两项组合键一次落盘，失败时一起回退');count++;
    active.clear();
    const disabled=new ShortcutManager({globalShortcut:api,handlers:{capture:()=>{},clipboardBar:()=>{}},bindings:{capture:'',clipboardBar:''}});
    disabled.registerAll();assert.equal(active.has('Alt+C'),false);assert.equal(active.has('Alt+V'),false);
    assert.equal(disabled.snapshot().status.clipboardBar.cleared,true);disabled.dispose();
    console.log('PASS  清除过的快捷键启动时不会被默认值重新注册');count++;
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  console.log(`${count} passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
