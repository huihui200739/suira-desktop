'use strict';

const MAX_HEIGHT=16384,MAX_PIXELS=40_000_000;
function validFrame(frame) {
  if(!frame||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<32||frame.height<96||
    frame.width>16384||frame.height>MAX_HEIGHT||frame.width*frame.height>MAX_PIXELS||frame.data?.length!==frame.width*frame.height*4)throw Error('长截图画面尺寸无效');
  return frame;
}
function features(frame) {
  const cols=40,out=new Uint8Array(frame.height*cols*3),{width,height,data}=frame;
  for(let y=0;y<height;y++)for(let c=0;c<cols;c++) {
    const x=Math.round(8+c*(width-25)/(cols-1)),i=(y*width+x)*4,j=(y*cols+c)*3;
    out[j]=data[i];out[j+1]=data[i+1];out[j+2]=data[i+2];
  }
  return out;
}
function rowError(a,ay,b,by) {
  let error=0;const n=120,ai=ay*n,bi=by*n;
  for(let x=0;x<n;x++)error+=Math.min(80,Math.abs(a[ai+x]-b[bi+x]));
  return error/n;
}
function frameDifference(a,b) {
  if(a.width!==b.width||a.height!==b.height)return Infinity;
  let changed=0,count=0;const stride=Math.max(4,Math.floor(a.data.length/4/5000)*4);
  for(let i=0;i<a.data.length;i+=stride){count++;if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>24)changed++;}
  return changed/Math.max(1,count);
}
function matchFrames(previous,current,bands=null) {
  if(previous.width!==current.width||previous.height!==current.height)return {status:'size-changed'};
  const a=features(previous),b=features(current),h=current.height;
  if(frameDifference(previous,current)<.0015)return {status:'duplicate'};
  let top=bands?.top??0,bottom=bands?.bottom??0;
  if(!bands) {
    while(top<Math.floor(h*.28)&&rowError(a,top,b,top)<.7)top++;
    while(bottom<Math.floor(h*.22)&&rowError(a,h-bottom-1,b,h-bottom-1)<.7)bottom++;
  }
  const body=h-top-bottom,minOverlap=Math.max(48,Math.floor(body*.18)),scores=[];
  for(let direction of [1,-1])for(let distance=2;distance<=body-minOverlap;distance++) {
    const overlap=body-distance;let error=0;
    // 同时覆盖整个重叠区，避免只凭一条空白行/重复文本判断拼接位置。
    for(let n=0;n<32;n++) {
      const y=top+Math.round(n*(overlap-1)/31);
      error+=rowError(a,y+(direction>0?distance:0),b,y+(direction<0?distance:0));
    }
    scores.push({distance,direction,score:error/32});
  }
  scores.sort((x,y)=>x.score-y.score);
  const best=scores[0];if(!best||best.score>3.6)return {status:'unmatched',score:best?.score};
  const rival=scores.find(x=>x.direction!==best.direction||Math.abs(x.distance-best.distance)>3);
  // 精确像素重合优先；只有多个候选同样可靠时才视为重复内容。
  if(rival&&rival.score<=best.score+Math.max(.06,best.score*.4))return {status:'ambiguous',score:best.score,rivalScore:rival.score};
  if(best.direction<0)return {status:'reverse'};
  return {status:'matched',shift:best.distance,top,bottom,score:best.score};
}
class LongCapture {
  constructor(frame,options={}) {
    validFrame(frame);this.previous=frame;this.initial=frame;this.width=frame.width;this.frameHeight=frame.height;
    this.height=frame.height;this.parts=[];this.frames=1;this.bands=null;
    this.maxHeight=Math.min(MAX_HEIGHT,options.maxHeight||MAX_HEIGHT,Math.floor(MAX_PIXELS/this.width));
  }
  append(frame) {
    validFrame(frame);const match=matchFrames(this.previous,frame,this.bands);
    if(match.status!=='matched')return match;
    if(this.height+match.shift>this.maxHeight||this.frames>=120)return {status:'limit'};
    const stride=this.width*4,bottom=match.bottom;
    if(!this.bands){this.bands={top:match.top,bottom};this.parts.push(Buffer.from(this.initial.data.subarray(0,(this.frameHeight-bottom)*stride)));this.initial=null;}
    this.parts.push(Buffer.from(frame.data.subarray((this.frameHeight-bottom-match.shift)*stride,(this.frameHeight-bottom)*stride)));
    this.previous=frame;this.height+=match.shift;this.frames++;
    return {...match,height:this.height,frames:this.frames};
  }
  bitmap() {
    if(!this.bands)return Buffer.from(this.initial.data);
    const footer=this.previous.data.subarray((this.frameHeight-this.bands.bottom)*this.width*4);
    return Buffer.concat([...this.parts,footer],this.width*this.height*4);
  }
}
module.exports={LongCapture,matchFrames,frameDifference,MAX_HEIGHT,MAX_PIXELS};
