'use strict';
const assert=require('node:assert/strict');
const {connect}=require('./runtime-client');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const main=await connect(9319),root=await connect(9318,t=>t.url.endsWith('/island.html'));
  try {
    await root.evaluate('window.suira.quick.show()'); await wait(200);
    await main.evaluate(`(async()=>{
      const {BrowserWindow}=process.mainModule.require('electron');
      const panel=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/quickpanel.html'));
      const b=panel.getBounds(); panel.hide();
      const probe=new BrowserWindow({x:b.x-10,y:b.y-10,width:b.width+20,height:b.height+20,frame:false,show:false,skipTaskbar:true,backgroundColor:'#cf29c9',webPreferences:{contextIsolation:true,nodeIntegration:false}});
      probe.setAlwaysOnTop(true,'floating'); globalThis.__cornerProbe=probe; probe.showInactive();
      globalThis.__cornerPanel=panel;
      if(${process.argv.includes('--opaque')}) {
        const path=process.mainModule.require('node:path'),dir=path.dirname(process.mainModule.filename);
        const clone=new BrowserWindow({...b,frame:false,transparent:false,show:false,skipTaskbar:true,backgroundColor:'#00000000',resizable:false,hasShadow:false,webPreferences:{preload:path.join(dir,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
        clone.setAlwaysOnTop(true,'floating');clone.setBackgroundMaterial('acrylic');
        clone.setShape(process.mainModule.require('./lib/display-geometry').roundedWindowShape(b.width,b.height));
        await clone.loadFile(path.join(dir,'src','quickpanel.html'));globalThis.__cornerPanel=clone;
      }
      if(${process.argv.includes('--no-material')}) globalThis.__cornerPanel.setBackgroundMaterial('none');
    })()`);
    if(process.argv.includes('--opaque')) await main.evaluate('globalThis.__cornerPanel.show()');
    else await root.evaluate('window.suira.quick.show()');
    await wait(600);
    const result=await main.evaluate(`(async()=>{
      const {BrowserWindow,screen,desktopCapturer}=process.mainModule.require('electron');
      const w=globalThis.__cornerPanel;
      const b=w.getBounds(),d=screen.getDisplayMatching(b),s=d.scaleFactor;
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(d.size.width*s),height:Math.round(d.size.height*s)}});
      const shot=sources.find(source=>source.display_id===String(d.id)).thumbnail;
      const bitmap=shot.toBitmap(),size=shot.getSize();
      const pixel=(x,y)=>{const i=(Math.round((b.y-d.bounds.y+y)*s)*size.width+Math.round((b.x-d.bounds.x+x)*s))*4;return [bitmap[i+2],bitmap[i+1],bitmap[i],bitmap[i+3]];};
      const out=process.mainModule.require('node:path').join(process.mainModule.require('node:os').tmpdir(),'suira-corner-proof.png');
      process.mainModule.require('node:fs').writeFileSync(out,shot.crop({x:Math.round((b.x-d.bounds.x-8)*s),y:Math.round((b.y-d.bounds.y-8)*s),width:Math.round((b.width+16)*s),height:Math.round((b.height+16)*s)}).toPNG());
      return {scale:s,hwnd:w.getNativeWindowHandle().readBigUInt64LE().toString(),bounds:b,material:w.__surfaceMaterial,pixels:[pixel(1,1),pixel(b.width-2,1),pixel(1,b.height-2),pixel(b.width-2,b.height-2)],outside:pixel(-3,-3),centre:pixel(b.width/2,b.height/2),screenshot:out};
    })()`);
    console.log(JSON.stringify(result));
    assert.ok(result.pixels.every(p=>p.slice(0,3).every((v,i)=>Math.abs(v-result.outside[i])<=3)),'四个圆角外应完全露出后方测试底色');
    assert.ok(result.centre.slice(0,3).some((v,i)=>Math.abs(v-result.outside[i])>20),'窗口主体应实际可见');
    console.log('PASS 四角桌面像素均与后方一致，没有矩形底板');
  } finally {
    await root.evaluate('window.suira.quick.hide()').catch(()=>{});
    if(process.argv.includes('--opaque'))await main.evaluate('globalThis.__cornerPanel?.destroy()').catch(()=>{});
    else if(process.argv.includes('--no-material'))await main.evaluate("globalThis.__cornerPanel?.setBackgroundMaterial('acrylic')").catch(()=>{});
    await main.evaluate('globalThis.__cornerProbe?.destroy(); globalThis.__cornerProbe=null').catch(()=>{});
    main.ws.close();root.ws.close();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
