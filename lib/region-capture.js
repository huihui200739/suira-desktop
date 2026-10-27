'use strict';
const {spawn}=require('node:child_process');
class RegionCapture {
  constructor(executable,spawnImpl=spawn,{startupTimeout=12000,timeout=4000}={}) {
    this.buffer='';this.pending=null;this.stopped=false;this.error=null;this.received=false;this.stderr='';this.startupTimeout=startupTimeout;this.timeout=timeout;
    this.child=spawnImpl(executable,['--region-server'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data',chunk=>{
      this.buffer+=chunk;
      if(this.buffer.length>96*1024*1024){this.fail(Error('采集画面过大'));return;}
      let index;
      while((index=this.buffer.indexOf('\n'))>=0) {
        const line=this.buffer.slice(0,index).trim();this.buffer=this.buffer.slice(index+1);if(!line)continue;
        const pending=this.pending;if(!pending)continue;this.pending=null;clearTimeout(pending.timer);
        try{const frame=JSON.parse(line);this.received=true;if(frame.error)throw Error('区域画面采集失败：'+String(frame.error).slice(0,200));if(!frame.dataUrl?.startsWith('data:image/png;base64,'))throw Error('采集组件返回无效画面');pending.resolve(frame);}
        catch(error){pending.reject(error);}
      }
    });
    this.child.on('error',error=>this.fail(error));this.child.on('exit',(code,signal)=>this.fail(Error('区域采集已停止'+(this.stderr?'：'+this.stderr.trim():code?'（退出码 '+code+'）':signal?'（'+signal+'）':''))));
    this.child.stdin.on('error',error=>this.fail(error));this.child.stderr.setEncoding('utf8');this.child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk).slice(-600);});
  }
  fail(error) {
    if(this.stopped)return;
    this.error=error;
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}
    this.stop();
  }
  capture(rect) {
    if(this.stopped||this.pending)return Promise.reject(this.error||Error('采集窗口未就绪'));
    if(!['x','y','width','height'].every(key=>Number.isSafeInteger(rect[key])))return Promise.reject(Error('采集区域无效'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail(Error('区域采集超时'+(this.received?'':'，首次启动被阻止或组件未响应'))),this.received?this.timeout:this.startupTimeout);
      this.pending={resolve,reject,timer};this.child.stdin.write(`${rect.x} ${rect.y} ${rect.width} ${rect.height}\n`);
    });
  }
  stop() {if(this.stopped)return;this.stopped=true;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error('采集已取消'));this.pending=null;}try{this.child.stdin.end('quit\n');}catch{}this.child.kill();this.buffer='';}
}
module.exports={RegionCapture};
