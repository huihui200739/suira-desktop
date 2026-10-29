'use strict';
const {spawn}=require('node:child_process');
const {parseAcceleratorToVk}=require('./key-watch');
const {findReserved}=require('./shortcuts');
function fallbackBindings(bindings,status){
  return Object.entries(bindings).flatMap(([name,accelerator])=>{
    const entry=status[name],parsed=parseAcceleratorToVk(accelerator);
    if(!accelerator||!entry||(!entry.fallback&&entry.ok)||entry.optional||findReserved(accelerator)||!parsed.ok)return [];
    const keys=parsed.vks.slice(),key=keys.pop();
    const modifiers=keys.reduce((mask,vk)=>mask|({18:1,17:2,16:4,91:8}[vk]||0),0);
    return [{name,key,modifiers}];
  });
}
class ShortcutFallback {
  constructor({executable,onKey,onExit,spawnImpl=spawn}){Object.assign(this,{executable,onKey,onExit,spawnImpl});this.child=null;this.ready=null;}
  async update(bindings){
    if(!bindings.length){this.stop();return;}
    if(!this.child){
      const child=this.child=this.spawnImpl(this.executable,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});
      this.ready=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('兼容快捷键助手启动超时')),5000);let buffer='',settled=false;
        const fail=error=>{clearTimeout(timer);if(!settled){settled=true;reject(error);}};
        child.on('error',fail);child.stdin.on('error',()=>{});
        child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(line==='READY'){clearTimeout(timer);settled=true;resolve();}else if(line.startsWith('ERROR'))fail(Error(line));else try{const event=JSON.parse(line);if(event.name)this.onKey(event.name);}catch{}}});
        child.once('exit',()=>{fail(Error('兼容快捷键助手已退出'));if(this.child===child){this.child=null;this.ready=null;this.onExit?.();}});
      });
    }
    await this.ready;
    this.child.stdin.write(JSON.stringify(bindings)+'\n');
  }
  stop(){const child=this.child;this.child=null;this.ready=null;if(child){child.stdin.end();const timer=setTimeout(()=>child.kill(),1000);timer.unref?.();}}
}
module.exports={fallbackBindings,ShortcutFallback};
