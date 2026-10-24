'use strict';
const assert=require('node:assert/strict');
const {connect}=require('./runtime-client');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const root=await connect(9318,t=>t.url.endsWith('/island.html'));let panel,main;
  try {
    await root.evaluate('window.suira.quick.show()');await wait(200);
    panel=await connect(9318,t=>t.url.endsWith('/quickpanel.html'));
    for(let i=0;i<40;i++) {
      if(await panel.evaluate("document.readyState==='complete'&&document.querySelectorAll('.key').length===38"))break;
      await wait(100);
    }
    await panel.evaluate("document.getElementById('mode-apps').click()");
    let result;
    for(let i=0;i<80;i++){
      await wait(200);
      result=await panel.evaluate(`(()=>{const apps=Array.from(document.querySelectorAll('.app-item'));const images=apps.map(n=>n.querySelector('img')).filter(Boolean);return {apps:apps.length,icons:images.filter(n=>n.complete&&n.naturalWidth>0).length,unique:new Set(images.map(n=>n.src)).size,names:apps.slice(0,7).map(n=>n.textContent.trim())};})()`);
      if(result.icons>=Math.min(result.apps,20)&&result.unique>=6)break;
    }
    console.log(JSON.stringify(result));assert.ok(result.icons>=Math.min(result.apps,12)&&result.unique>=6,'应显示多个真实应用图标，而非相同白纸图标');
    main=await connect(9319);
    const screenshot=await main.evaluate(`(async()=>{const {BrowserWindow,screen,desktopCapturer}=process.mainModule.require('electron');const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/quickpanel.html')),b=w.getBounds(),d=screen.getDisplayMatching(b),s=d.scaleFactor;const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(d.size.width*s),height:Math.round(d.size.height*s)}});const image=sources.find(x=>x.display_id===String(d.id)).thumbnail.crop({x:Math.round((b.x-d.bounds.x)*s),y:Math.round((b.y-d.bounds.y)*s),width:Math.round(b.width*s),height:Math.round(b.height*s)});const out=process.mainModule.require('node:path').join(process.mainModule.require('node:os').tmpdir(),'suira-real-app-icons.png');process.mainModule.require('node:fs').writeFileSync(out,image.toPNG());return out;})()`);
    console.log('PASS 真实应用图标 '+screenshot);
    // 真实点击入口，然后检查原生横栏可见；只读历史，不写入或复制内容。
    const barVisible=()=>main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/clipboardbar.html')&&w.isVisible())");
    const waitForBar=async()=>{for(let i=0;i<40;i++){if(await barVisible())return true;await wait(100);}return false;};
    await panel.evaluate("document.getElementById('open-clipboard').click()");
    assert.equal(await waitForBar(),true);
    console.log('PASS 剪贴板按钮打开实际底部横栏');
    await root.evaluate('window.suira.clipboardBar.hide();window.suira.quick.show()');await wait(180);
    await panel.send('Input.dispatchKeyEvent',{type:'keyDown',key:'x',code:'KeyX',windowsVirtualKeyCode:88,text:'x'});
    await panel.send('Input.dispatchKeyEvent',{type:'keyUp',key:'x',code:'KeyX',windowsVirtualKeyCode:88});
    assert.equal(await waitForBar(),true);
    console.log('PASS X 键打开实际底部横栏');
  }finally{
    await root.evaluate('window.suira.quick.hide();window.suira.clipboardBar.hide()').catch(()=>{});
    root.ws.close();panel?.ws.close();main?.ws.close();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
