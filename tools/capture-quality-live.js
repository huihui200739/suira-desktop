'use strict';
const assert=require('node:assert/strict');
const {connect}=require('./runtime-client');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const main=await connect(9319),root=await connect(9318,t=>t.url.endsWith('/island.html'));let overlay;
  try {
    await main.evaluate(`(async()=>{
      const {BrowserWindow}=process.mainModule.require('electron');
      const w=new BrowserWindow({x:500,y:300,width:300,height:240,frame:false,show:false,resizable:false,skipTaskbar:true,webPreferences:{contextIsolation:true,nodeIntegration:false}});
      globalThis.__qualityWindow=w;w.setAlwaysOnTop(true,'floating');
      await w.loadURL('data:text/html,'+encodeURIComponent('<html><body style="margin:0"><canvas id="c"></canvas><script>const c=document.getElementById("c");c.width=innerWidth*devicePixelRatio;c.height=innerHeight*devicePixelRatio;c.style.width=innerWidth+"px";c.style.height=innerHeight+"px";const x=c.getContext("2d");for(let i=0;i<c.width;i++){x.fillStyle=i%2?"white":"black";x.fillRect(i,0,1,c.height);}x.fillStyle="red";x.font="20px sans-serif";x.fillText("SUIRA pixel test",20,30);</script></body></html>'));w.showInactive();
    })()`);
    await wait(250);
    const started=Date.now();await root.evaluate('window.suira.capture.start()');const captureMs=Date.now()-started;
    overlay=await connect(9318,t=>t.url.endsWith('/overlay.html'));
    for(let i=0;i<80;i++){if(await overlay.evaluate("document.getElementById('loading-state').hidden"))break;await wait(100);}
    const proof=await overlay.evaluate(`(()=>{
      const tile=state.rawTiles?.[0];if(!tile)return {backend:state.payload?.captureBackend,error:document.getElementById('action-toast').textContent};
      state.selection={x:520.25,y:350.5,w:110.5,h:80.25};state.annotations=[];
      const out=compositeSelection();
      const source=document.createElement('canvas');source.width=tile.image.width;source.height=tile.image.height;source.getContext('2d').drawImage(tile.image,0,0);
      const sx=Math.round(state.selection.x/tile.width*tile.image.width),sy=Math.round(state.selection.y/tile.height*tile.image.height);
      const a=out.getContext('2d').getImageData(0,0,out.width,out.height).data,b=source.getContext('2d').getImageData(sx,sy,out.width,out.height).data;
      let differences=0;const colors=new Set();for(let i=0;i<a.length;i++){if(a[i]!==b[i])differences++;if(i%4===0)colors.add(a[i]+','+a[i+1]+','+a[i+2]);}
      return {backend:state.payload.captureBackend,source:{width:tile.image.width,height:tile.image.height},output:{width:out.width,height:out.height},differences,colors:colors.size,png:out.toDataURL('image/png')};
    })()`);
    const png=proof.png;delete proof.png;proof.captureMs=captureMs;console.log(JSON.stringify(proof));
    assert.equal(proof.backend,'native');assert.equal(proof.differences,0);assert.equal(proof.colors,2,'单像素黑白条纹应保留两种颜色，不能被插值成灰色');
    const output=require('node:path').join(require('node:os').tmpdir(),'suira-native-pixel-crop.png');require('node:fs').writeFileSync(output,Buffer.from(png.split(',')[1],'base64'));
    console.log('PASS 真实采集 → 覆盖层 → PNG 裁剪逐像素无损 '+output);
  } finally {
    await root.evaluate('window.suira.capture.cancel()').catch(()=>{});
    await main.evaluate('globalThis.__qualityWindow?.destroy();globalThis.__qualityWindow=null').catch(()=>{});
    overlay?.ws.close();root.ws.close();main.ws.close();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
