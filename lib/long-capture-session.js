'use strict';
const {LongCapture}=require('./long-capture');
const {frameSettled}=require('./frame-comparison');
function sameSource(a,b) {
  if(!a||!b||String(a.hwnd)!==String(b.hwnd)||a.pid!==b.pid||(a.processStartedAt&&b.processStartedAt&&a.processStartedAt!==b.processStartedAt))return false;
  if(a.title&&b.title&&a.title!==b.title)return false;
  return !a.bounds||!b.bounds||['x','y','width','height'].every(key=>a.bounds[key]===b.bounds[key]);
}
const MESSAGES={
  ambiguous:'内容重复，暂时无法可靠对齐。请继续向上或向下滚动，或回滚一点再滚下来。',
  unmatched:'这一段没有和上一段接上。请往回滚一点，看到之前的内容后再继续向上或向下滚动。',
  'size-changed':'窗口尺寸已变化，请完成当前长图后重新框选。',
  limit:'已达到长图尺寸上限，请点击完成。'
};
const HINTS={ambiguous:'内容重复，正在等待画面移动…',unmatched:'正在等待和上一段接上…'};
/**
 * 长截图采集会话。
 *
 * 与旧实现的差别（参照微信原生手感）：
 *   - 采集间隔更短，滚动过程中也允许拼接，而不是等画面完全停稳才出图；
 *   - 「没接上」不再立刻暂停。滚动中本来就会频繁对不上，只有画面已经停住
 *     且连续多次仍然对不上时，才提示用户回滚，避免滚快一点就卡死；
 *   - 状态只在真正变化时下发，避免渲染层被高频 IPC 刷屏。
 */
class LongCaptureSession {
  constructor({first,target,capture,current,onState=()=>{},onPreview=()=>{},interval=150,maxIdle=60000,auto=true,maxMisses=5}) {
    this.model=new LongCapture(first);this.target=target;this.capture=capture;this.current=current;
    this.onState=onState;this.onPreview=onPreview;
    this.interval=interval;this.maxIdle=maxIdle;this.auto=auto;this.maxMisses=maxMisses;
    this.lastChange=Date.now();this.paused=false;this.stopped=false;this.candidate=null;this.misses=0;
    this.timer=null;this.inflight=null;this.generation=0;this.stage='capturing';
    this.message='在选区内向上或向下滚动，回车完成并复制';this.published='';
  }
  state(){
    return {
      width:this.model.width,height:this.model.height,frames:this.model.frames,
      paused:this.paused,stopped:this.stopped,stage:this.stage,message:this.message
    };
  }
  publish(force=false){
    if(this.stopped)return;
    const state=this.state(),key=JSON.stringify(state);
    if(!force&&key===this.published)return;
    this.published=key;this.onState(state);
  }
  schedule(){clearTimeout(this.timer);if(this.auto&&!this.paused&&!this.stopped)this.timer=setTimeout(()=>this.poll(),this.interval);}
  start(){this.stage='capturing';this.publish(true);this.schedule();}
  pause(message='已暂停，点击继续后再滚动',stage='paused'){
    this.generation++;this.paused=true;this.candidate=null;this.misses=0;this.stage=stage;this.message=message;clearTimeout(this.timer);this.publish(true);
  }
  resume(){
    if(this.stopped)return;
    this.generation++;this.paused=false;this.candidate=null;this.misses=0;this.lastChange=Date.now();
    this.stage='capturing';this.message='继续向上或向下滚动，画面停稳后自动拼接';this.publish(true);this.schedule();
  }
  async poll(){
    if(this.paused||this.stopped||this.inflight)return;
    const generation=this.generation;
    this.inflight=(async()=>{
      try {
        if(!sameSource(this.target,await this.current())){this.pause('当前窗口或页面已切换，已暂停采集。回到选中的页面后点击继续。','blocked');return;}
        if(this.paused||this.stopped||generation!==this.generation)return;
        const frame=await this.capture();if(this.paused||this.stopped||generation!==this.generation)return;
        if(!sameSource(this.target,await this.current())){this.pause('当前窗口或页面已切换，已暂停采集。回到选中的页面后点击继续。','blocked');return;}
        if(this.paused||this.stopped||generation!==this.generation)return;
        if(!this.candidate) {
          // 首帧只作为停稳判定基准：此刻画面可能还在从框选层收起的过程中。
          this.candidate=frame;this.publish();return;
        }
        const settled=frameSettled(this.candidate,frame);
        const result=this.model.append(frame);
        if(result.status==='matched') {
          this.lastChange=Date.now();this.misses=0;this.stage='capturing';
          this.message=`已拼接 ${this.model.frames} 段，继续滚动，回车完成并复制`;
          this.candidate=frame;this.onPreview();
        }else if(result.status==='duplicate') {
          this.misses=0;this.candidate=frame;
        }else if(result.status==='limit') {
          this.candidate=frame;this.pause(MESSAGES.limit,'limit');return;
        }else if(result.status==='size-changed') {
          this.candidate=frame;this.pause(MESSAGES['size-changed'],'blocked');return;
        }else {
          // unmatched / ambiguous：滚动过程中对不上是常态，先继续跟；画面已经停住
          // 还连续对不上才提示回滚，避免出现「滚快一点就一直卡在暂停」。
          this.candidate=frame;
          if(settled) {
            this.misses++;
            if(this.misses>=this.maxMisses){this.pause(MESSAGES[result.status]||MESSAGES.unmatched,'misaligned');return;}
            this.message=HINTS[result.status]||HINTS.unmatched;this.stage='waiting';
          }else {
            this.misses=0;this.message='正在跟随滚动…';this.stage='capturing';
          }
        }
        if(Date.now()-this.lastChange>this.maxIdle){this.pause('长时间没有新增内容，已暂停。可继续采集或完成。','idle');return;}
        this.publish();
      }catch(error){if(!this.stopped&&generation===this.generation)this.pause(error.message||'采集失败，当前长图已保留','error');}
    })();
    try{await this.inflight;}finally{this.inflight=null;this.schedule();}
  }
  async stop(){this.stopped=true;clearTimeout(this.timer);if(this.inflight)await this.inflight;this.candidate=null;}
}
module.exports={LongCaptureSession,sameSource,MESSAGES};
