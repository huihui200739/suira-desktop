'use strict';
const assert=require('node:assert/strict');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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
  const point=await ev(`(()=>{const key=document.querySelector('[data-key="T"]'),r=key.getBoundingClientRect(),label=key.querySelector('.key-name').getBoundingClientRect();return {x:r.x+r.width*.7,y:r.y+r.width*.3,labelY:label.y};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
  await wait(320);
  const hover=await ev(`(()=>{const key=document.querySelector('[data-key="T"]'),m=new DOMMatrix(getComputedStyle(key.querySelector('.key-card')).transform);return {hover:key.classList.contains('is-key-hover'),lift:m.m42,tilt:Math.abs(m.m13)+Math.abs(m.m23),labelY:key.querySelector('.key-name').getBoundingClientRect().y};})()`);
  assert.equal(hover.hover,true);assert.ok(hover.lift< -2.5);assert.ok(hover.tilt>0);
  assert.equal(hover.labelY,point.labelY,'Tool name remains stationary');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});await wait(200);
  assert.equal(await ev('document.querySelectorAll(".is-key-hover").length'),0);
  await ev(`(()=>{const k=document.querySelector('[data-key="T"]');k.focus();k.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));return true;})()`);
  assert.equal(await ev('document.querySelector("[data-key=T]").classList.contains("is-key-pressed")'),true);
  await ev(`(()=>{const k=document.querySelector('[data-key="T"]');k.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true}));k.blur();return true;})()`);
  assert.equal(await ev('document.querySelectorAll(".is-key-pressed").length'),0);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await wait(170);
  assert.equal(await ev('getComputedStyle(document.querySelector("[data-key=T] .key-card")).transform'),'none');
  assert.equal(await ev('document.querySelectorAll(".is-key-hover").length'),0);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'no-preference'}]});
  await ev('document.getElementById("toolbox").click();true');
  assert.equal(await ev('document.querySelectorAll("#tool-grid .suira-art").length'),15);
  assert.equal(await ev('document.querySelectorAll(".is-key-hover,.is-key-pressed").length'),0);
  await ev('document.getElementById("mode-actions").click();true');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8});
  console.log('  PASS  all tool objects, neutral key faces, hover lift/tilt, fixed labels, keyboard press, reduced motion and toolbox art');
}
module.exports={checkKeycapMaterial};
