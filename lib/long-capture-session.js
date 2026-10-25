'use strict';
const {LongCapture,frameDifference}=require('./long-capture');
function sameSource(a,b) {
  if(!a||!b||String(a.hwnd)!==String(b.hwnd)||a.pid!==b.pid||(a.processStartedAt&&b.processStartedAt&&a.processStartedAt!==b.processStartedAt))return false;
  if(a.title&&b.title&&a.title!==b.title)return false;
  return !a.bounds||!b.bounds||['x','y','width','height'].every(key=>a.bounds[key]===b.bounds[key]);
}
const MESSAGES={ambiguous:'内容重复，无法可靠对齐。请回滚后少量向下滚动，再点继续。',unmatched:'滚动过快或画面已变化。请回滚到上一段附近，再点继续。','size-changed':'窗口尺寸已变化，请完成当前长图后重新框选。',limit:'已达到长图尺寸上限，请点击完成。'};
class LongCaptureSession {
  constructor({first,target,capture,current,onState=()=>{},interval=240,maxIdle=60000,auto=true}) {
    this.model=new LongCapture(first);this.target=target;this.capture=capture;this.current=current;this.onState=onState;
    this.interval=interval;this.maxIdle=maxIdle;this.auto=auto;this.lastChange=Date.now();this.paused=false;this.stopped=false;this.candidate=null;this.timer=null;this.inflight=null;this.message='在选区内向下滚动，停止滚动后自动拼接';
  }
  state(){return {width:this.model.width,height:this.model.height,frames:this.model.frames,paused:this.paused,stopped:this.stopped,message:this.message};}
  publish(){if(!this.stopped)this.onState(this.state());}
  schedule(){clearTimeout(this.timer);if(this.auto&&!this.paused&&!this.stopped)this.timer=setTimeout(()=>this.poll(),this.interval);}
  start(){this.publish();this.schedule();}
  pause(message='已暂停，点击继续后再向下滚动'){this.paused=true;this.message=message;clearTimeout(this.timer);this.publish();}
  resume(){if(this.stopped)return;this.paused=false;this.candidate=null;this.lastChange=Date.now();this.message='继续向下滚动，画面停稳后自动拼接';this.publish();this.schedule();}
  async poll(){
    if(this.paused||this.stopped||this.inflight)return;
    this.inflight=(async()=>{
      try {
        if(!sameSource(this.target,await this.current())){this.pause('当前窗口或页面已切换，已暂停采集。回到选中的页面后点击继续。');return;}
        if(this.paused||this.stopped)return;
        const frame=await this.capture();if(this.paused||this.stopped)return;
        if(this.candidate&&frameDifference(this.candidate,frame)<.0015) {
          const result=this.model.append(frame);
          if(result.status==='matched'){this.lastChange=Date.now();this.message=`已拼接 ${this.model.frames} 段，继续向下滚动或点击完成`;}
          else if(MESSAGES[result.status]){this.pause(MESSAGES[result.status]);return;}
          else if(result.status==='reverse')this.message='已忽略向上滚动，继续向下滚动即可';
        }
        this.candidate=frame;
        if(Date.now()-this.lastChange>this.maxIdle){this.pause('长时间没有新增内容，已暂停。可继续采集或完成。');return;}
        this.publish();
      }catch(error){this.pause(error.message||'采集失败，当前长图已保留');}
    })();
    try{await this.inflight;}finally{this.inflight=null;this.schedule();}
  }
  async stop(){this.stopped=true;clearTimeout(this.timer);if(this.inflight)await this.inflight;this.candidate=null;}
}
module.exports={LongCaptureSession,sameSource};
