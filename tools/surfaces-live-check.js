'use strict';
// 真实窗口验证；只读取历史，不复制、不收藏、不修改用户内容。
const assert = require('node:assert/strict');
const path = require('node:path');
const { clipboardShelfBounds } = require('../lib/display-geometry');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(port, select = () => true) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find(select);
  assert.ok(target, `找不到 ${port} 对应的运行窗口`);
  const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
  ws.onmessage = event => {
    const message=JSON.parse(event.data), request=pending.get(message.id);
    if(!request)return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  };
  const evaluate = expression => new Promise((resolve,reject) => {
    const key=++id, timer=setTimeout(()=>{pending.delete(key);reject(new Error('运行实例未响应'));},15000);
    pending.set(key,{resolve,reject,timer});
    ws.send(JSON.stringify({id:key,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  }).then(result => {
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  });
  return {evaluate,ws};
}
(async()=>{
  const root = await connect(9318,t=>t.url.endsWith('/island.html'));
  let bar, native;
  try {
    if(process.argv.includes('--reload')) {
      native=await connect(9319);
      await native.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().filter(w=>/quickpanel|clipboardbar/.test(w.webContents.getURL())).forEach(w=>w.webContents.reload())`);
      await wait(400);
    }
    await root.evaluate('window.suira.clipboardBar.show()');
    await wait(500);
    bar = await connect(9318,t=>t.url.endsWith('/clipboardbar.html'));
    const view = await bar.evaluate(`({width:innerWidth,height:innerHeight,x:screenX,y:screenY,
      area:{x:screen.availLeft,y:screen.availTop,width:screen.availWidth,height:screen.availHeight},
      rect:(()=>{const r=document.getElementById('bar').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})(),
      search:Boolean(document.getElementById('bar-search')), filters:document.querySelectorAll('[data-filter]').length,
      cards:document.querySelectorAll('.bar-card').length,overflow:document.documentElement.scrollWidth>innerWidth,
      background:getComputedStyle(document.getElementById('bar')).backgroundColor})`);
    const expected=clipboardShelfBounds(view.area);
    assert.deepEqual({x:view.x,y:view.y,width:view.width,height:view.height},expected);
    assert.deepEqual(view.rect,{x:0,y:0,w:view.width,h:view.height});
    assert.equal(view.filters,6);assert.ok(view.search);assert.equal(view.overflow,false);
    console.log('PASS 运行实例底部横栏、搜索分类、贴边工作区和无矩形留白 '+JSON.stringify(view));
    const motion=await bar.evaluate(`(async()=>{
      const group=document.querySelector('[data-selection-group]'),indicator=group.querySelector('.shared-selection');
      const filter=value=>group.querySelector('[data-filter="'+value+'"]').click();
      filter('text');await new Promise(r=>setTimeout(r,230));
      const frames=[];filter('image');const start=performance.now();
      await new Promise(resolve=>{
        const sample=()=>{frames.push({ms:Math.round(performance.now()-start),x:Math.round(indicator.getBoundingClientRect().x*10)/10});
          if(performance.now()-start<230)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);
      });
      filter('files');filter('all');await new Promise(r=>setTimeout(r,230));
      const target=group.querySelector('[aria-pressed="true"]');
      return {helper:Boolean(window.SuiraUI),indicators:group.querySelectorAll('.shared-selection').length,
        rapidSelected:target.dataset.filter,aligned:Math.abs(indicator.getBoundingClientRect().left-target.getBoundingClientRect().left)<1,
        reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,frames};
    })()`);
    assert.ok(motion.helper);assert.equal(motion.indicators,1);assert.equal(motion.rapidSelected,'all');assert.ok(motion.aligned);
    if(!motion.reduced)assert.ok(new Set(motion.frames.map(frame=>frame.x)).size>2,'选中背景应连续运动');
    console.log('PASS 运行实例共享选中态、快速打断和逐帧采样 '+JSON.stringify(motion));
    if(process.argv.includes('--native')) {
      native ||= await connect(9319);
      const windows = await native.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().filter(w=>/quickpanel|clipboardbar/.test(w.webContents.getURL())).map(w=>({page:w.webContents.getURL().split('/').pop(),material:w.__surfaceMaterial,bounds:w.getBounds()}))`);
      assert.ok(windows.length>=1);assert.ok(windows.every(w=>w.material==='transparent'));
      console.log('PASS 真实浮层关闭越过圆角绘制的系统底板 '+JSON.stringify(windows));
      if(process.argv.includes('--capture')) {
        const out=path.join(require('node:os').tmpdir(),'suira-native-shelf.png');
        const result=await native.evaluate(`(async()=>{
          const {desktopCapturer,screen,BrowserWindow}=process.mainModule.require('electron');
          const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/clipboardbar.html'));
          const b=w.getBounds(),d=screen.getDisplayMatching(b),s=d.scaleFactor;
          const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(d.size.width*s),height:Math.round(d.size.height*s)}});
          const source=sources.find(source=>source.display_id===String(d.id));
          if(!source)throw new Error('找不到对应显示器');
          const image=source.thumbnail.crop({x:Math.round((b.x-d.bounds.x)*s),y:Math.round((b.y-d.bounds.y)*s),width:Math.round(b.width*s),height:Math.round(b.height*s)});
          process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(out)},image.toPNG());return image.getSize();
        })()`);
        console.log('原生桌面合成截图 '+out+' '+JSON.stringify(result));
        await root.evaluate('window.suira.quick.show()');
        await wait(400);
        const panelOut=path.join(require('node:os').tmpdir(),'suira-native-panel.png');
        await native.evaluate(`(async()=>{
          const {desktopCapturer,screen,BrowserWindow}=process.mainModule.require('electron');
          const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/quickpanel.html'));
          const b=w.getBounds(),d=screen.getDisplayMatching(b),s=d.scaleFactor;
          const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(d.size.width*s),height:Math.round(d.size.height*s)}});
          const source=sources.find(source=>source.display_id===String(d.id));
          const image=source.thumbnail.crop({x:Math.round((b.x-d.bounds.x)*s),y:Math.round((b.y-d.bounds.y)*s),width:Math.round(b.width*s),height:Math.round(b.height*s)});
          process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(panelOut)},image.toPNG());
        })()`);
        console.log('原生动作面板截图 '+panelOut);
      }
    }
  } finally {
    await root.evaluate('window.suira.quick.hide()').catch(()=>{});
    if(bar){await bar.evaluate('window.suira.clipboardBar.hide()').catch(()=>{});bar.ws.close();}
    native?.ws.close(); root.ws.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
