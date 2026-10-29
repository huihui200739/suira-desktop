'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{fallbackBindings,ShortcutFallback}=require('./lib/shortcut-fallback');
const candidates=fallbackBindings({g:'Alt+G',good:'Alt+M',reserved:'Alt+Tab',empty:'',eq:'Control+Plus',extra:'Control+Alt+Q'},
  {g:{ok:false},good:{ok:true},reserved:{ok:false},eq:{ok:false},extra:{ok:false}});
assert.deepEqual(candidates,[{name:'g',key:71,modifiers:1},{name:'eq',key:187,modifiers:2},{name:'extra',key:81,modifiers:3}]);
assert.equal(fallbackBindings({g:'Alt+G'},{g:{ok:true,fallback:true}}).length,1);
const {panelGlobalBindings}=require('./lib/panel-shortcuts');
const {DEFAULT_BINDINGS}=require('./lib/shortcuts');
assert.equal(panelGlobalBindings({}, {...DEFAULT_BINDINGS,longCapture:''})['panelKey:G'],'');
let processStub,written='',ended=false;const events=[];
const controller=new ShortcutFallback({executable:'fixture',onKey:name=>events.push(name),spawnImpl:()=>{
  const child=processStub=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=value=>{written=value;};child.stdin.end=()=>{ended=true;};child.kill=()=>{};
  setImmediate(()=>child.stdout.emit('data','READY\n'));return child;
}});
(async()=>{await controller.update(candidates);assert.deepEqual(JSON.parse(written),candidates);processStub.stdout.emit('data','{"na');processStub.stdout.emit('data','me":"g"}\n');assert.deepEqual(events,['g']);await controller.update([]);assert.ok(ended);console.log('PASS shortcut fallback: exact modifiers, symbol keys, reserved exclusions, partial protocol, stop/reconfigure');})().catch(error=>{console.error(error);process.exitCode=1;});
