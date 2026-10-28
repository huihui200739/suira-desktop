'use strict';
const {frameDifference,frameSettled}=require('./frame-comparison');

const MAX_HEIGHT=16384,MAX_PIXELS=40_000_000;
const FEATURE_COLS=96,FEATURE_STRIDE=FEATURE_COLS*3;
function validFrame(frame) {
  if(!frame||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<32||frame.height<96||
    frame.width>16384||frame.height>MAX_HEIGHT||frame.width*frame.height>MAX_PIXELS||frame.data?.length!==frame.width*frame.height*4)throw Error('长截图画面尺寸无效');
  return frame;
}
function features(frame) {
  const cols=FEATURE_COLS,out=new Uint8Array(frame.height*cols*3),{width,height,data}=frame;
  for(let y=0;y<height;y++)for(let c=0;c<cols;c++) {
    const x=Math.round(8+c*(width-25)/(cols-1)),i=(y*width+x)*4,j=(y*cols+c)*3;
    out[j]=data[i];out[j+1]=data[i+1];out[j+2]=data[i+2];
  }
  return out;
}
function movingChannels(a,b,height) {
  // 分列统计同一屏幕位置的变化。固定导航、推荐栏不参与滚动配准；少量
  // 在线人数/动画变化也不能压过整列正文的持续位移。
  const changes=new Float64Array(FEATURE_COLS);let samples=0;
  for(let y=0;y<height;y+=3){samples++;for(let c=0;c<FEATURE_COLS;c++){
    const i=y*FEATURE_STRIDE+c*3;
    if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>24)changes[c]++;
  }}
  const threshold=Math.max(2,samples*.03,Math.max(...changes)*.15),channels=[];
  for(let c=0;c<FEATURE_COLS;c++)if(changes[c]>=threshold)channels.push(c*3,c*3+1,c*3+2);
  return channels.length>=6&&channels.length<FEATURE_STRIDE?channels:null;
}
function registrationFeatures(input,height) {
  // 分数 DPI 下，同一行文字可能落在相邻物理像素之间。轻微纵向抗锯齿
  // 降低这类栅格化差异，避免相同的帖子背景比真正重叠的文字得分更好。
  const out=new Uint8Array(input.length);
  for(let y=0;y<height;y++)for(let x=0;x<FEATURE_STRIDE;x++)out[y*FEATURE_STRIDE+x]=
    (input[Math.max(0,y-1)*FEATURE_STRIDE+x]+input[y*FEATURE_STRIDE+x]+input[Math.min(height-1,y+1)*FEATURE_STRIDE+x])/3;
  return out;
}
function rowError(a,ay,b,by,channels=null) {
  let error=0;const n=FEATURE_STRIDE,ai=ay*n,bi=by*n;
  if(channels){for(const x of channels)error+=Math.min(80,Math.abs(a[ai+x]-b[bi+x]));return error/channels.length;}
  for(let x=0;x<n;x++)error+=Math.min(80,Math.abs(a[ai+x]-b[bi+x]));
  return error/n;
}
function matchFrames(previous,current,bands=null) {
  if(previous.width!==current.width||previous.height!==current.height)return {status:'size-changed'};
  const a=features(previous),b=features(current),h=current.height;
  if(frameSettled(previous,current))return {status:'duplicate'};
  const channels=movingChannels(a,b,h);
  const alignedA=channels?registrationFeatures(a,h):a,alignedB=channels?registrationFeatures(b,h):b;
  const movingRows=channels?Uint8Array.from({length:h},(_,y)=>rowError(a,y,b,y,channels)>.7?1:0):null;
  let top=bands?.top??0,bottom=bands?.bottom??0;
  if(!bands) {
    // 聊天输入框和固定工具栏可能超过选区的四分之一。按实际不动的
    // 连续边缘裁出正文，保留至少 96 行用于验证，而不是按百分比截断。
    const minimumBody=96;
    while(top<h-minimumBody&&rowError(a,top,b,top,channels)<.7)top++;
    while(bottom<h-top-minimumBody&&rowError(a,h-bottom-1,b,h-bottom-1,channels)<.7)bottom++;
  }
  const body=h-top-bottom,minOverlap=Math.max(48,Math.floor(body*.18)),scores=[],sampleRows=channels?64:32;
  for(let direction of [1,-1])for(let distance=1;distance<=body-minOverlap;distance++) {
    const overlap=body-distance;let error=0,count=0;
    // 同时覆盖整个重叠区，避免只凭一条空白行/重复文本判断拼接位置。
    for(let n=0;n<sampleRows;n++) {
      const y=top+Math.round(n*(overlap-1)/(sampleRows-1));
      const ay=y+(direction>0?distance:0),by=y+(direction<0?distance:0);
      if(movingRows&&(!movingRows[ay]||!movingRows[by]))continue;
      error+=rowError(alignedA,ay,alignedB,by,channels);count++;
    }
    scores.push({distance,direction,score:count>=(channels?6:1)?error/count:Infinity});
  }
  scores.sort((x,y)=>x.score-y.score);
  if(channels) {
    // 稀疏采样先找候选，再用整段重叠正文复核。帖子卡片的背景和布局高度
    // 相似，必须让文字边缘参与校验，不能凭几条背景扫描线选中相邻帖子。
    const candidates=scores.slice(0,24);
    for(const candidate of candidates) {
      const overlap=body-candidate.distance;let error=0,weightSum=0;
      for(let y=top;y<top+overlap;y+=2) {
        const ay=y+(candidate.direction>0?candidate.distance:0),by=y+(candidate.direction<0?candidate.distance:0);
        if(!movingRows[ay]||!movingRows[by])continue;
        const contrast=rowError(alignedA,ay,alignedA,Math.min(h-1,ay+1),channels);
        const weight=1+Math.min(4,contrast/3);
        error+=rowError(alignedA,ay,alignedB,by,channels)*weight;weightSum+=weight;
      }
      candidate.score=weightSum>=12?error/weightSum:Infinity;
    }
    candidates.sort((x,y)=>x.score-y.score);scores.splice(0,scores.length,...candidates);
  }
  const best=scores[0];if(!best||best.score>3.6)return {status:'unmatched',score:best?.score};
  const rival=scores.find(x=>x.direction!==best.direction||Math.abs(x.distance-best.distance)>3);
  // 精确像素重合优先；只有多个候选同样可靠时才视为重复内容。
  if(rival&&rival.score<=best.score+Math.max(.06,best.score*.4))return {status:'ambiguous',score:best.score,rivalScore:rival.score};
  return {status:'matched',shift:best.distance*best.direction,top,bottom,score:best.score};
}
const MAX_FRAMES=400;
class LongCapture {
  constructor(frame,options={}) {
    validFrame(frame);this.previous=frame;this.width=frame.width;this.frameHeight=frame.height;
    this.height=frame.height;this.parts=[Buffer.from(frame.data)];this.frames=1;this.bands=null;
    this.position=0;this.minimum=0;this.maximum=0;
    this.anchors=[{position:0,data:features(frame)}];
    this.maxHeight=Math.min(MAX_HEIGHT,options.maxHeight||MAX_HEIGHT,Math.floor(MAX_PIXELS/this.width));
  }
  append(frame) {
    validFrame(frame);
    const match=matchFrames(this.previous,frame,this.bands);
    const covered=match.status==='matched'&&this.position+match.shift>=this.minimum&&this.position+match.shift<=this.maximum;
    if(frame.width===this.width&&frame.height===this.frameHeight&&(covered||match.status==='ambiguous'||match.status==='unmatched')){
      const data=features(frame),channels=movingChannels(features(this.previous),data,this.frameHeight);
      const anchor=this.locateAnchor(data,channels);
      if(anchor){this.previous=frame;this.position=anchor.position;this.rememberAnchor(data);return {status:'duplicate'};}
    }
    if(match.status!=='matched')return match;
    const position=this.position+match.shift,minimum=Math.min(this.minimum,position),maximum=Math.max(this.maximum,position);
    const added=(this.minimum-minimum)+(maximum-this.maximum);
    if(added&&(this.height+added>this.maxHeight||this.frames>=MAX_FRAMES))return {status:'limit'};
    const stride=this.width*4,top=match.top,bottom=match.bottom;
    if(!this.bands){this.bands={top,bottom};}
    if(added) {
      // 接缝放在两帧正文的重叠区。旧帧底部的悬浮按钮、链接状态条等被新帧
      // 的真实正文覆盖，而不是把每次出现的悬浮层永久追加进长图。
      const seam=top+Math.floor((this.frameHeight-top-bottom-match.shift)/2);
      const cut=position-this.minimum+seam;
      if(position>this.maximum)this.parts=[...this.sliceRows(0,cut),Buffer.from(frame.data.subarray(seam*stride))];
      else this.parts=[Buffer.from(frame.data.subarray(0,seam*stride)),...this.sliceRows(cut,this.height)];
    }
    this.previous=frame;this.position=position;this.minimum=minimum;this.maximum=maximum;
    this.rememberAnchor(features(frame));
    if(!added)return {status:'duplicate'};
    this.height+=added;this.frames++;
    return {...match,height:this.height,frames:this.frames};
  }
  locateAnchor(data,channels) {
    // 回到已截画面时先验证同一屏幕坐标的内容指纹，避免重复卡片把回滚位置
    // 错配到相邻帖子。只接受近乎相同且明显优于其他锚点的结果。
    const candidates=this.anchors.map(anchor=>{
      let error=0,count=0;
      for(let y=Math.floor(this.frameHeight*.15);y<this.frameHeight*.85;y+=2){
        error+=rowError(anchor.data,y,data,y,channels);count++;
      }
      return {...anchor,score:error/count};
    }).sort((a,b)=>a.score-b.score);
    const best=candidates[0];
    return best&&best.score<.2&&(!candidates[1]||candidates[1].score>best.score+.12)?best:null;
  }
  rememberAnchor(data) {
    const old=this.anchors.findIndex(anchor=>anchor.position===this.position);
    if(old>=0)this.anchors.splice(old,1);
    this.anchors.push({position:this.position,data});
    while(this.anchors.length>1&&(this.anchors.length>32||this.anchors.length*data.length>16*1024*1024))this.anchors.shift();
  }
  bitmap() {
    return Buffer.concat(this.segments().map(segment=>segment.data),this.width*this.height*4);
  }
  sliceRows(from,to) {
    const stride=this.width*4,out=[];let start=0;
    for(const part of this.parts) {
      const rows=part.length/stride,lo=Math.max(0,from-start),hi=Math.min(rows,to-start);
      if(hi>lo)out.push(lo===0&&hi===rows?part:Buffer.from(part.subarray(lo*stride,hi*stride)));
      start+=rows;
    }
    return out;
  }
  /** 当前长图按行切成的段（屏幕坐标 → 像素缓冲），预览缩略图与导出共用。 */
  segments() {
    const stride=this.width*4;
    const out=[];let start=0;
    for(const part of this.parts){const rows=part.length/stride;out.push({start,rows,data:part});start+=rows;}
    return out.filter(segment=>segment.rows>0);
  }
  /**
   * 等比缩略图（最近邻 + 有限盒式平均）。
   *
   * 预览窗只需要几十 KB 的画面，直接缩放整幅位图（可能几十 MB）会卡住主线程；
   * 这里按目标像素反查源区域，只读取需要的行，成本与缩略图尺寸成正比。
   */
  thumbnail(maxWidth=200,maxHeight=560) {
    const scale=Math.min(maxWidth/this.width,maxHeight/Math.max(1,this.height),1);
    const width=Math.max(1,Math.min(this.width,Math.round(this.width*scale)));
    const height=Math.max(1,Math.min(this.height,Math.round(this.height*scale)));
    const segments=this.segments(),stride=this.width*4,data=Buffer.alloc(width*height*4,255);
    const spanX=this.width/width,spanY=this.height/height;
    const taps=Math.max(1,Math.min(3,Math.floor(Math.min(spanX,spanY))));
    let cursor=0;
    for(let y=0;y<height;y++) {
      const sourceY=Math.min(this.height-1,Math.floor(y*spanY));
      while(cursor<segments.length-1&&sourceY>=segments[cursor].start+segments[cursor].rows)cursor++;
      const segment=segments[cursor],row=Math.min(segment.rows-1,sourceY-segment.start);
      const base=row*stride,target=y*width*4;
      for(let x=0;x<width;x++) {
        const sourceX=Math.min(this.width-1,Math.floor(x*spanX));
        let r=0,g=0,b=0,n=0;
        for(let ty=0;ty<taps;ty++)for(let tx=0;tx<taps;tx++) {
          const sy=Math.min(segment.rows-1,row+Math.round(ty*(spanY-1)/taps)),sx=Math.min(this.width-1,sourceX+Math.round(tx*(spanX-1)/taps));
          const index=sy*stride+sx*4;r+=segment.data[index];g+=segment.data[index+1];b+=segment.data[index+2];n++;
        }
        const offset=target+x*4;data[offset]=r/n;data[offset+1]=g/n;data[offset+2]=b/n;data[offset+3]=255;
      }
    }
    return {width,height,data};
  }
}
module.exports={LongCapture,matchFrames,frameDifference,MAX_HEIGHT,MAX_PIXELS,MAX_FRAMES};
