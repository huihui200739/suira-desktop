'use strict';
// Real compositor checks over a synthetic local window. Never reads user windows.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{ensureNativeHost}=require('../lib/key-watch'),{PNG}=require('pngjs');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),control=path.join(tmp,'control.json'),sockets=[];let child;
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){let last;for(let i=0;i<150;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await wait(80);}throw last||Error('Native glass check timed out');}
async function run(){
 fs.writeFileSync(control,'{}');const response=path.join(tmp,'response.json');
 const entry=path.join(tmp,'app.js');fs.writeFileSync(entry,`const fs=require('fs'),{app,BrowserWindow,screen,ipcMain,clipboard,globalShortcut}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))});clipboard.read=async()=>[];clipboard.readText=async()=>'';globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.unregisterAll=()=>{};
app.getVersion=()=>${JSON.stringify(require('../package.json').version)};
let bg,busy=false;require(${JSON.stringify(path.join(root,'main.js'))});setInterval(async()=>{if(busy||!app.isReady())return;busy=true;let command;
try{
 command=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));if(!command.id)return;fs.writeFileSync(${JSON.stringify(control)},'{}');
 let w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(command.suffix||'/index.html'));
 if(!w)throw Error('Window not ready');
 if(command.expression){const value=await w.webContents.executeJavaScript(command.expression);fs.writeFileSync(${JSON.stringify(response)},JSON.stringify({id:command.id,value}));return;}
 if(command.color&&w){w.hide();const b=w.getBounds();if(!bg)bg=new BrowserWindow({frame:false,show:false,alwaysOnTop:true,skipTaskbar:true});bg.setBounds({x:b.x-20,y:b.y-20,width:b.width+40,height:b.height+40});
  const background=command.color==='stripes'?'repeating-linear-gradient(90deg,black 0 2px,white 2px 4px)':command.color==='scene'?'linear-gradient(105deg,#7d927f 0%,#c7b39a 34%,#7b95a1 70%,#99a68b 100%)':command.color;
  await bg.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{margin:0;height:100%;background:'+background+'}</style>'));
  bg.showInactive();bg.moveTop();await bg.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,100));if(!w.isAlwaysOnTop())w.setAlwaysOnTop(true);w.show();w.moveTop();w.focus();
 }
 if(command.hide&&w)w.hide();
 fs.writeFileSync(${JSON.stringify(response)},JSON.stringify({id:command.id,value:{target:{handle:w.getNativeWindowHandle().readBigUInt64LE().toString(),native:w.__nativeBlur,frame:w.__glassFrameReady,system:w.__systemGlass,scale:screen.getDisplayMatching(w.getBounds()).scaleFactor}}}));
}catch(e){if(command?.id)fs.writeFileSync(${JSON.stringify(response)},JSON.stringify({id:command.id,error:e.message}));}finally{busy=false;}},20).unref();`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=fs.openSync(path.join(tmp,'app.log'),'w');child=spawn('C:/suira-electron/electron.exe',[entry],{cwd:root,env,windowsHide:false,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 let requestId=0;const request=async value=>{const id=++requestId;fs.writeFileSync(control,JSON.stringify({...value,id}));const answer=await until(()=>{if(!fs.existsSync(response))return;const v=JSON.parse(fs.readFileSync(response,'utf8'));return v.id===id?v:null;});if(answer.error)throw Error(answer.error);return answer.value;};
 const page=async suffix=>{const client={evaluate:expression=>request({suffix,expression})};await until(()=>client.evaluate('Boolean(window.suira)'));return client;};
 const main=await page('/index.html');await until(()=>main.evaluate('Boolean(window.WorkspaceUI)'));
 const source=path.join(tmp,'pixels.cs');fs.writeFileSync(source,`using System;using System.Drawing;using System.Drawing.Imaging;using System.Runtime.InteropServices;
class Pixels{
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr w,int i);
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr w,int a,out Rect v,int n);
 [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")]static extern int DwmValue(IntPtr w,int a,out int v,int n);
 struct Rect{public int l,t,r,b;}
 static void Main(string[] args){SetProcessDpiAwarenessContext(new IntPtr(-4));Rect r;
  if(args[0]=="rect"){var w=new IntPtr(long.Parse(args[1]));DwmGetWindowAttribute(w,9,out r,16);int corner,transitions;DwmValue(w,33,out corner,4);int transitionStatus=DwmValue(w,3,out transitions,4);Console.WriteLine(r.l+","+r.t+","+(r.r-r.l)+","+(r.b-r.t)+","+corner+","+((GetWindowLong(w,-20)&0x80000)!=0?1:0)+","+transitions+","+transitionStatus);return;}
  int x=int.Parse(args[1]),y=int.Parse(args[2]),width=int.Parse(args[3]),height=int.Parse(args[4]);using(var b=new Bitmap(width,height)){using(var g=Graphics.FromImage(b)){g.CopyFromScreen(x,y,0,0,b.Size);}b.Save(args[0],ImageFormat.Png);}
 }
}`);
 const pixels=await ensureNativeHost({sourcePath:source,targetPath:path.join(tmp,'pixels.exe'),references:['System.Drawing.dll']});assert.ok(pixels);
 const command=request;
 const capture=(file,rect)=>{execFileSync(pixels,[file,...rect.slice(0,4).map(String)],{windowsHide:true,timeout:5000});return PNG.sync.read(fs.readFileSync(file));};
 const results=[];
 for(const [name,suffix,open] of [['panel','/quickpanel.html','window.suira.quick.show()'],['notes','/notes.html','window.suira.notes.create()'],['workbench','/index.html',null],['calendar','tool=calendar',"window.suira.workspace.open('calendar')"],['markdown-home','tool=markdown',"window.suira.workspace.open('markdown')"]].filter(([name])=>(!process.argv.includes('--panel-only')||name==='panel')&&(!process.argv.includes('--notes-only')||name==='notes')&&(!process.argv.includes('--glass-only')||['panel','notes'].includes(name)))){
  if(open)await main.evaluate(open);const client=await page(suffix);await until(()=>client.evaluate('document.documentElement.dataset.glassBackend==="native"'));
  if(name==='panel')await client.evaluate('document.getElementById("guide-close").click();true');
  if(name==='notes'){await until(()=>client.evaluate('document.getElementById("note").dataset.state==="ready"'));await client.evaluate('(()=>{const e=document.getElementById("note-body");e.value="随手记下，接着做\\n\\n今天的三个想法：\\n1. 把零散的参考收进任务匣\\n2. 写下讨论中最重要的一句话\\n3. 为下一步留一个明确的入口";e.dispatchEvent(new Event("input",{bubbles:true}));return true})()');}
  const snapshots=[];let rect,info;
  for(const color of ['#b02030','#2050b0','stripes']){
   info=await command({suffix,color});assert.equal(info.target.native,true,name+' must enable real native blur');assert.equal(info.target.system,true);assert.equal(info.target.frame,true,'Full-client DWM frame must succeed');
   await wait(280);rect=execFileSync(pixels,['rect',info.target.handle],{encoding:'utf8',windowsHide:true}).trim().split(',').map(Number);assert.equal(rect[4],2,'DWM round corners');assert.equal(rect[5],0,'Native glass must not be per-pixel layered');if(name==='panel'){console.log('DWM transition readback HRESULT:',rect[7]);if(rect[7]===0)assert.equal(rect[6],1,'DWM native show/hide transitions are disabled');}
   snapshots.push(capture(path.join(tmp,name+'-'+snapshots.length+'.png'),rect));
   if(color!=='stripes'){await command({suffix,hide:true});const expected=color.match(/[a-f0-9]{2}/g).map(v=>parseInt(v,16));await until(()=>{const controlImage=capture(path.join(tmp,'control.png'),rect),i=(Math.round(rect[3]*.5)*controlImage.width+Math.round(16*info.target.scale))*4;return expected.every((value,c)=>Math.abs(controlImage.data[i+c]-value)<4);});}
  }
  const scale=info.target.scale,x=Math.round(16*scale),y=Math.round(rect[3]*.5),sample=png=>[...png.data.slice((y*png.width+x)*4,(y*png.width+x)*4+3)];
  const red=sample(snapshots[0]),blue=sample(snapshots[1]);
  assert.ok(red[0]-blue[0]>8&&blue[2]-red[2]>8,name+' must transmit changing real background colors: '+JSON.stringify({red,blue}));
  await command({suffix,hide:true});await wait(180);const bare=capture(path.join(tmp,name+'-bare.png'),rect),glass=snapshots[2];
  let total=0,max=0,count=0;const radius=8*scale;
  for(let cy=0;cy<Math.ceil(radius);cy++)for(let cx=0;cx<Math.ceil(radius);cx++){
   if((radius-cx-.5)**2+(radius-cy-.5)**2<(radius+.75)**2)continue;
   for(const [px,py] of [[cx,cy],[glass.width-1-cx,cy],[cx,glass.height-1-cy],[glass.width-1-cx,glass.height-1-cy]])for(let c=0;c<3;c++){
    const d=Math.abs(glass.data[(py*glass.width+px)*4+c]-bare.data[(py*bare.width+px)*4+c]);total+=d;max=Math.max(max,d);count++;
   }
  }
  assert.ok(count>100);const cornerMean=total/count;assert.ok(cornerMean<24,name+' must not paint opaque rectangular corners: '+cornerMean);
  const energy=png=>{let sum=0,n=0;for(let px=Math.round(10*scale);px<Math.round(110*scale);px++){sum+=Math.abs(png.data[(y*png.width+px)*4]-png.data[(y*png.width+px-1)*4]);n++;}return sum/n;};
  assert.ok(energy(bare)>35,'Sharp native background must be visible in control capture');assert.ok(energy(glass)<5,name+' must blur live background stripes');
  assert.equal(await client.evaluate('document.querySelector(".glass-scene").children.length'),0,'No wallpaper or screenshot background layer');
  results.push({name,transitionReadback:rect[7]===0?rect[6]:'set-only attribute',red,blue,cornerMean,cornerMax:max,cornerSamples:count,blurEnergy:energy(glass),bareEnergy:energy(bare)});console.log('PASS live blur, dynamic colors and four compositor corners:',name);
  if(process.argv.includes('--screenshots')){await command({suffix,color:'scene'});await wait(200);capture(path.join(root,'docs/product',name+'.png'),rect);}
  await command({suffix,hide:true});
 }
 fs.writeFileSync(path.join(root,'docs/native-glass-'+require('../package.json').version+'.json'),JSON.stringify({version:require('../package.json').version,source:'real DWM compositor over synthetic windows; no user screen content',results},null,2)+'\n');
}
run().catch(e=>{console.error(e);if(fs.existsSync(path.join(tmp,'app.log')))console.error(fs.readFileSync(path.join(tmp,'app.log'),'utf8').slice(-1200));process.exitCode=1;}).finally(async()=>{sockets.forEach(ws=>ws.close());if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await wait(300);if(path.dirname(tmp)!==os.tmpdir())throw Error('Invalid temporary root');fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:200});});
