'use strict';
const assert=require('node:assert/strict');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fs=require('node:fs'),path=require('node:path');

// Called against the real quickpanel markup and renderer by panel-shot.js.
async function checkKeycapMaterial({send,evaluate}) {
  const ev=source=>evaluate(send,source);
  const facts=await ev(`(()=>{
    const keys=[...document.querySelectorAll('.key.is-bound')];
    return {
      count:keys.length,
      objects:keys.every(key=>key.querySelector('.suira-art')),
      inside:keys.every(key=>{const a=key.querySelector('.suira-art').getBoundingClientRect(),k=key.getBoundingClientRect();return a.width>k.width*.6&&a.width<k.width*.72;}),
      faceColors:new Set(keys.map(key=>getComputedStyle(key.querySelector('.key-face')).backgroundImage)).size,
      borders:keys.every(key=>getComputedStyle(key.querySelector('.key-card')).borderTopWidth==='0px')
    };
  })()`);
  assert.equal(facts.count,14);assert.equal(facts.objects,true);assert.equal(facts.inside,true);
  assert.equal(facts.faceColors,1,'All tool keys use one neutral surface');
  assert.equal(facts.borders,true,'Old colored key outlines must not leak through');
  assert.equal(await ev('new Set([...document.querySelectorAll(".key.is-bound .suira-art")].map(n=>[...n.classList].find(c=>c.startsWith("family-")))).size'),5,'The full keyboard has five meaningful tool families');
  await ev(`(()=>{
    window.__keycapProbe={entries:[],paint:[],sweeps:[],admissions:0};
    const grid=document.getElementById('key-grid');
    const seenSweep=new WeakMap();
    new MutationObserver(records=>{for(const {target} of records){
      if(!target.classList.contains('key'))continue;const on=target.classList.contains('is-key-sheen');
      if(on&&!seenSweep.get(target))window.__keycapProbe.admissions++;seenSweep.set(target,on);
    }}).observe(grid,{subtree:true,attributes:true,attributeFilter:['class']});
    grid.addEventListener('animationstart',e=>{if(e.animationName==='keycap-sweep')window.__keycapProbe.sweeps.push({key:e.target.closest('.key').dataset.key,time:performance.now()});});
    grid.addEventListener('pointerover',e=>{
      const key=e.target.closest('.key');if(!key||key.contains(e.relatedTarget))return;
      const start=performance.now();window.__keycapProbe.entries.push({key:key.dataset.key,time:start});
      const sample=()=>{const m=new DOMMatrix(getComputedStyle(key.querySelector('.key-card')).transform),delay=performance.now()-start;
        if(m.m42<-.1){window.__keycapProbe.paint.push({key:key.dataset.key,delay});return;}
        if(delay<90)requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    },true);return true;
  })()`);
  const point=await ev(`(()=>{const key=document.querySelector('[data-key="T"]'),r=key.getBoundingClientRect(),label=key.querySelector('.key-name').getBoundingClientRect();return {x:r.x+r.width*.7,y:r.y+r.width*.3,labelY:label.y};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
  assert.equal(await ev('document.querySelector("[data-key=T]").classList.contains("is-key-near")'),true,'Entry must respond without a dwell timer');
  await wait(320);
  const hover=await ev(`(()=>{const key=document.querySelector('[data-key="T"]'),m=new DOMMatrix(getComputedStyle(key.querySelector('.key-card')).transform);return {hover:key.classList.contains('is-key-hover'),lift:m.m42,tilt:Math.abs(m.m13)+Math.abs(m.m23),labelY:key.querySelector('.key-name').getBoundingClientRect().y};})()`);
  assert.equal(hover.hover,true);assert.ok(hover.lift< -2.5);assert.ok(hover.tilt>0);
  assert.equal(hover.labelY,point.labelY,'Tool name remains stationary');
  await wait(260);
  assert.equal(await ev('window.__keycapProbe.sweeps.length'),1,'A stationary hover plays exactly one reflection');
  assert.equal(await ev('document.querySelectorAll(".is-key-sheen").length'),0,'The reflection finishes and cleans up');
  await ev(`(()=>{const k=document.querySelector('[data-key="T"]');window.__originalKeyBounds=k.getBoundingClientRect;window.__frameLayoutReads=0;k.getBoundingClientRect=function(){window.__frameLayoutReads++;return window.__originalKeyBounds.call(this);};return true;})()`);
  for(let n=0;n<4;n++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+n,y:point.y+n});await wait(16);}
  assert.equal(await ev('window.__frameLayoutReads'),0,'Moving within a key never re-reads its layout');
  await ev('document.querySelector("[data-key=T]").getBoundingClientRect=window.__originalKeyBounds;true');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await wait(65);
  const sweepCount=await ev('window.__keycapProbe.admissions');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await wait(70);
  assert.equal(await ev('window.__keycapProbe.admissions'),sweepCount,'Rapid re-entry does not restart a queued reflection');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});await wait(200);
  assert.equal(await ev('document.querySelectorAll(".is-key-hover").length'),0);
  await ev(`(()=>{const k=document.querySelector('[data-key="T"]');k.focus();k.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));return true;})()`);
  assert.equal(await ev('document.querySelector("[data-key=T]").classList.contains("is-key-pressed")'),true);
  await ev(`(()=>{const k=document.querySelector('[data-key="T"]');k.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true}));k.blur();return true;})()`);
  assert.equal(await ev('document.querySelectorAll(".is-key-pressed").length'),0);
  const rows=await ev(`[...document.querySelectorAll('.key-row')].map(row=>{const keys=[...row.querySelectorAll('.key')],a=keys[0].getBoundingClientRect(),b=keys.at(-1).getBoundingClientRect();return {from:a.left+a.width*.2,to:b.right-b.width*.2,y:a.top+a.width*.5,count:keys.length};})`);
  const runs=[];
  for(const speed of [250,700,1400]){
    let count=0,maxDelay=0;
    for(const row of rows){
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});
      await ev('window.__keycapProbe.entries=[];window.__keycapProbe.paint=[];true');
      const duration=(row.to-row.from)/speed*1000,start=performance.now();
      for(;;){const t=Math.min(1,(performance.now()-start)/duration);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:row.from+(row.to-row.from)*t,y:row.y});if(t===1)break;await wait(8);}
      await wait(110);
      const seen=await ev('({entered:[...new Set(window.__keycapProbe.entries.map(x=>x.key))],responded:[...new Set(window.__keycapProbe.paint.map(x=>x.key))],maxPaintMs:Math.max(...window.__keycapProbe.paint.map(x=>x.delay))})');
      assert.equal(seen.entered.length,row.count,'Sweep visits every key at '+speed+'px/s');
      assert.equal(seen.responded.length,row.count,'Every key visibly responds at '+speed+'px/s: '+JSON.stringify(seen));
      assert.ok(seen.maxPaintMs<80,'First visible response must precede the old 120ms dwell');
      count+=seen.responded.length;maxDelay=Math.max(maxDelay,seen.maxPaintMs);
    }
    runs.push({speed,keys:count,maxFirstVisibleMs:Math.round(maxDelay*10)/10});
    console.log('  SWEEP '+JSON.stringify(runs.at(-1)));
  }
  fs.writeFileSync(path.join(__dirname,'../.workbuddy/vivid-motion-verification.json'),JSON.stringify({version:require('../package.json').version,runs,oneShotReflection:true,reentryCooldown:true,perFrameLayoutReads:0},null,2)+'\n');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await wait(170);
  assert.equal(await ev('getComputedStyle(document.querySelector("[data-key=T] .key-card")).transform'),'none');
  assert.equal(await ev('document.querySelectorAll(".is-key-near,.is-key-hover,.is-key-sheen").length'),0);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'no-preference'}]});
  await ev('document.getElementById("toolbox").click();true');
  assert.equal(await ev('document.querySelectorAll("#tool-grid .suira-art").length'),15);
  assert.equal(await ev('document.querySelectorAll(".is-key-hover,.is-key-pressed").length'),0);
  await ev('document.getElementById("mode-actions").click();true');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});
  console.log('  PASS  all tool objects, neutral key faces, hover lift/tilt, fixed labels, keyboard press, reduced motion and toolbox art');
}
module.exports={checkKeycapMaterial};
