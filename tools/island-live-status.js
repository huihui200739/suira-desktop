'use strict';
// 只读当前随序的 UI 版本和真实窗口状态；--exercise 仅开关浮层，不改暂存内容。
const assert = require('node:assert/strict');
const PORT = Number(process.env.SUIRA_CDP_PORT || 9318);
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  let target;
  for(let attempt=0;attempt<60;attempt++){
    try { target=(await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t=>t.url.endsWith('/island.html')); } catch {}
    if(target)break;
    await wait(150);
  }
  assert.ok(target,'找不到当前随序的文件暂存窗口');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;
  const pending=new Map();
  ws.onmessage=event=>{
    const message=JSON.parse(event.data), request=pending.get(message.id);
    if(!request)return;
    pending.delete(message.id);clearTimeout(request.timer);
    if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
  };
  const evaluate=expression=>new Promise((resolve,reject)=>{
    const key=++id,timer=setTimeout(()=>reject(new Error('随序未响应')),10000);
    pending.set(key,{resolve,reject,timer});
    ws.send(JSON.stringify({id:key,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  }).then(result=>{
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result?.value;
  });
  try{
    const state=await evaluate(`(async()=>{
      const s=await window.suira.island.getState();
      return {revision:s.uiRevision,mode:s.mode,windowVisible:s.windowVisible,domMode:document.getElementById('island').dataset.mode,wake:s.wake};
    })()`);
    assert.equal(state.revision,'edge-shelf-20261023.2');
    assert.equal(state.mode,'sleep');assert.equal(state.domMode,'sleep');assert.equal(state.windowVisible,false);
    console.log('PASS 当前运行实例已加载贴边版本，原生窗口实际隐藏：'+JSON.stringify(state));
    if(process.argv.includes('--exercise')){
      await wait(350);
      const view=await evaluate(`(async()=>{
        await window.suira.island.setMode('sheet');
        await new Promise(r=>setTimeout(r,260));
        const s=await window.suira.island.getState(), sheet=document.getElementById('sheet');
        const r=sheet.getBoundingClientRect(), c=getComputedStyle(sheet);
        return {mode:s.mode,domMode:document.getElementById('island').dataset.mode,count:s.items.length,windowVisible:s.windowVisible,x:screenX,y:screenY,top:screen.availTop,width:innerWidth,height:innerHeight,rect:{x:r.x,y:r.y,w:r.width,h:r.height},shadow:c.boxShadow,radius:c.borderRadius,background:c.backgroundColor};
      })()`);
      console.log('VIEW '+JSON.stringify(view));
      assert.equal(view.windowVisible,true);assert.equal(view.y,view.top);
      assert.deepEqual(view.rect,{x:0,y:0,w:view.width,h:view.height});
      assert.equal(view.shadow,'none');assert.equal(view.radius,'0px 0px 16px 16px');
      assert.equal(view.width,view.count?520:440);assert.equal(view.height,view.count?148:108);
      console.log('PASS 当前实例展开后贴住屏幕上沿，无外围底板：'+JSON.stringify(view));
      await evaluate(`window.suira.island.setMode('rail')`);
      await wait(100);
      const hidden=await evaluate(`(async()=>{const s=await window.suira.island.getState();return {mode:s.mode,windowVisible:s.windowVisible};})()`);
      assert.deepEqual(hidden,{mode:'sleep',windowVisible:false});
      console.log('PASS 旧胶囊请求也只能隐藏，不再裸露入口。');
      const drag = await evaluate(`(async()=>{
        const root=document.getElementById('island');
        root.dispatchEvent(new MouseEvent('mouseenter'));
        await new Promise(r=>setTimeout(r,200));
        const hover=await window.suira.island.getState();
        const text=new DataTransfer();text.setData('text/plain','文字');
        root.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:text}));
        const plain=await window.suira.island.getState();
        const files=new DataTransfer();files.items.add(new File(['probe'],'probe.txt'));
        root.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:files}));
        await new Promise(r=>setTimeout(r,230));
        const entered=await window.suira.island.getState();
        root.dispatchEvent(new DragEvent('dragleave',{bubbles:true,cancelable:true,dataTransfer:files}));
        await new Promise(r=>setTimeout(r,350));
        const left=await window.suira.island.getState();
        return {hoverHidden:!hover.windowVisible,textHidden:!plain.windowVisible,fileVisible:entered.windowVisible,leftHidden:!left.windowVisible};
      })()`);
      assert.deepEqual(drag,{hoverHidden:true,textHidden:true,fileVisible:true,leftHidden:true});
      console.log('PASS 当前实例文件拖入才出现、拖离后隐藏：'+JSON.stringify(drag));
    }
    if(process.argv.includes('--restart')) {
      await evaluate('window.suira.app.restart()');
      console.log('已请求正常重启并关闭临时调试端口。');
    }
  }finally{
    if(process.argv.includes('--exercise'))await evaluate("window.suira.island.setMode('sleep')").catch(()=>{});
    ws.close();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
