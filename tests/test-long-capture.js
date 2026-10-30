'use strict';
const assert=require('node:assert/strict');
const {LongCapture,matchFrames,frameDifference}=require('../lib/long-capture');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const W=120,H=240;
function frame(offset,{header=0,footer=0,reverseX=false,blank=false}={}) {
  const data=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
    const p=(y*W+x)*4,row=y<header?y:y>=H-footer?10000+y:y+offset;
    let n=((row*7919)^(x*104729)^(row*x*23))>>>0;if(blank)n=0;
    data[p]=n%251;data[p+1]=(n>>>5)%241;data[p+2]=(n>>>11)%239;data[p+3]=255;
  }
  if(reverseX)for(let y=0;y<H;y++)data.copy(data,y*W*4,y*W*4+4,(y+1)*W*4);
  return {width:W,height:H,data};
}
check('普通画面精确识别纵向滚动距离',()=>assert.equal(matchFrames(frame(0),frame(73)).shift,73));
check('固定侧栏不参与正文位移匹配，滚动区域不必居中',()=>{
  for(const [left,right] of [[36,88],[12,54]]) {
    const first=frame(0),next=frame(61);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(x<left||x>=right)first.data.copy(next.data,(y*W+x)*4,(y*W+x)*4,(y*W+x+1)*4);
    assert.equal(matchFrames(first,next).shift,61);
    assert.equal(matchFrames(next,first).shift,-61);
  }
});
check('不变画面不重复追加',()=>assert.equal(matchFrames(frame(0),frame(0)).status,'duplicate'));
check('向上滚动识别有符号距离',()=>assert.equal(matchFrames(frame(80),frame(20)).shift,-60));
check('触控板一像素微滚动仍可对齐',()=>assert.equal(matchFrames(frame(0),frame(1)).shift,1));
check('固定页眉/页脚只保留一次',()=>{
  const model=new LongCapture(frame(0,{header:26,footer:18}));assert.equal(model.append(frame(61,{header:26,footer:18})).status,'matched');
  assert.equal(model.append(frame(119,{header:26,footer:18})).status,'matched');
  const pixels=model.bitmap();assert.equal(model.height,H+119);assert.equal(pixels.length,W*(H+119)*4);
  const expected=Buffer.alloc(pixels.length),first=frame(0,{header:26,footer:18}),last=frame(119,{header:26,footer:18});
  first.data.copy(expected,0,0,(H-18)*W*4);frame(61,{header:26,footer:18}).data.copy(expected,(H-18)*W*4,(H-18-61)*W*4,(H-18)*W*4);
  last.data.copy(expected,(H-18+61)*W*4,(H-18-58)*W*4);assert.deepEqual(pixels,expected);
});
check('大固定输入框和页眉按实际边界排除，输出只保留一次',()=>{
  const header=72,footer=64,model=new LongCapture(frame(0,{header,footer}));
  for(const offset of [19,38,57])assert.equal(model.append(frame(offset,{header,footer})).status,'matched');
  assert.deepEqual(model.bands,{top:header,bottom:footer});
  const expected=Buffer.alloc(W*(H+57)*4),first=frame(0,{header,footer}),last=frame(57,{header,footer});
  first.data.copy(expected,0,0,(H-footer)*W*4);
  for(const offset of [19,38,57])frame(offset,{header,footer}).data.copy(expected,(H-footer+offset-19)*W*4,(H-footer-19)*W*4,(H-footer)*W*4);
  last.data.copy(expected,(H-footer+57)*W*4,(H-footer)*W*4);
  assert.equal(model.height,H+57);assert.deepEqual(model.bitmap(),expected);
});
check('全空白不会制造长图',()=>assert.equal(matchFrames(frame(0,{blank:true}),frame(100,{blank:true})).status,'duplicate'));
check('窗口尺寸改变不能拼接',()=>assert.equal(matchFrames(frame(0),{...frame(40),width:121}).status,'size-changed'));
check('横向位移拒绝拼接',()=>assert.notEqual(matchFrames(frame(0),frame(70,{reverseX:true})).status,'matched'));
check('没有足够重叠时拒绝拼接',()=>assert.notEqual(matchFrames(frame(0),frame(350)).status,'matched'));
check('周期性重复内容不能猜测拼接距离',()=>{
  const repeating=offset=>{const image=frame(0);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,v=(y+offset)%20;image.data[i]=v*11;image.data[i+1]=v*7;image.data[i+2]=x;}return image;};
  assert.equal(matchFrames(repeating(0),repeating(7)).status,'ambiguous');
});
check('高度上限保留最后一幅有效结果',()=>{const model=new LongCapture(frame(0),{maxHeight:H+50});assert.equal(model.append(frame(70)).status,'limit');assert.equal(model.height,H);assert.deepEqual(model.bitmap(),frame(0).data);});
check('帧大小校验与变化比例',()=>{assert.throws(()=>new LongCapture({width:1,height:1,data:Buffer.alloc(4)}));assert.equal(frameDifference(frame(0),frame(0)),0);assert.ok(frameDifference(frame(0),frame(70))>.1);});
check('预览缩略图按比例覆盖整幅长图且尺寸受控',()=>{
  const model=new LongCapture(frame(0,{header:20,footer:16}));
  model.append(frame(90,{header:20,footer:16}));
  model.append(frame(160,{header:20,footer:16}));
  const thumb=model.thumbnail(60,140);
  assert.equal(thumb.data.length,thumb.width*thumb.height*4);
  assert.ok(thumb.width<=60&&thumb.height<=140,'缩略图不能超过请求尺寸');
  assert.ok(Math.abs(thumb.width/thumb.height-model.width/model.height)<.12,'缩略图要等比');
  // 逐行与长图对应区间的均值比较：既能发现上下颠倒，也能发现只截了局部。
  const full=model.bitmap(),stride=W*4;
  for(const row of [1,Math.floor(thumb.height/2),thumb.height-2]){
    const from=Math.floor(row*model.height/thumb.height),to=Math.max(from+1,Math.floor((row+1)*model.height/thumb.height));
    let source=0,count=0;
    for(let y=from;y<Math.min(to,model.height);y++)for(let x=0;x<W;x+=3){source+=full[y*stride+x*4];count++;}
    let target=0,other=0;
    for(let x=0;x<thumb.width;x++){target+=thumb.data[(row*thumb.width+x)*4];other++;}
    assert.ok(Math.abs(target/other-source/count)<14,`缩略图第 ${row} 行应与长图对应区间一致`);
  }
});
check('单帧长图也能生成缩略图',()=>{
  const model=new LongCapture(frame(0)),thumb=model.thumbnail(48,96);
  assert.ok(thumb.width>0&&thumb.height>0&&thumb.height<=96);
  assert.equal(thumb.data.length,thumb.width*thumb.height*4);
});
check('向上追加与来回滚动逐像素去重，固定页眉页脚只留一次',()=>{
  const header=26,footer=18,firstOffset=200,model=new LongCapture(frame(firstOffset,{header,footer}));
  for(const offset of [140,90,140,200,250,200,140,70]) {
    const result=model.append(frame(offset,{header,footer}));
    assert.ok(['matched','duplicate'].includes(result.status),JSON.stringify(result));
  }
  const min=70,max=250,stride=W*4,expected=Buffer.alloc((H+max-min)*stride);
  const upper=frame(min,{header,footer}),lower=frame(max,{header,footer});
  upper.data.copy(expected,0,0,header*stride);
  // 任一正文行必须等于其全局内容行，与到达这个位置的滚动路径无关。
  for(let y=header;y<H-footer+max-min;y++) {
    const source=frame(min+y-header,{header,footer});
    source.data.copy(expected,y*stride,header*stride,(header+1)*stride);
  }
  lower.data.copy(expected,(H-footer+max-min)*stride,(H-footer)*stride);
  assert.equal(model.height,H+max-min);assert.deepEqual(model.bitmap(),expected);
  const before=model.height;model.append(frame(90,{header,footer}));assert.equal(model.height,before);
  const thumb=model.thumbnail(60,200);assert.equal(thumb.data.length,thumb.width*thumb.height*4);
});
check('向上滚动达到上限时保留原结果',()=>{
  const model=new LongCapture(frame(200),{maxHeight:H+30});
  assert.equal(model.append(frame(150)).status,'limit');assert.deepEqual(model.bitmap(),frame(200).data);
});
check('底部悬浮按钮和变化的链接提示只在最终视口保留一次',()=>{
  const floating=offset=>{
    const f=frame(offset);
    for(let y=H-65;y<H-35;y++)for(let x=W-18;x<W;x++)f.data.set([20,130,240,255],(y*W+x)*4);
    for(let y=H-18;y<H;y++)for(let x=0;x<50+offset%11;x++)f.data.set([offset%200,20,30,255],(y*W+x)*4);
    return f;
  };
  const model=new LongCapture(floating(0));
  for(const offset of [31,67,105,144,185])assert.equal(model.append(floating(offset)).status,'matched');
  const actual=model.bitmap(),stride=W*4;
  for(let y=0;y<model.height-65;y++) {
    const expected=frame(y).data.subarray(0,stride);
    assert.deepEqual(actual.subarray(y*stride,(y+1)*stride),expected,'旧视口的悬浮控件不能留在正文：第 '+y+' 行');
  }
});
console.log(`\n${count} 通过 / 0 失败`);
