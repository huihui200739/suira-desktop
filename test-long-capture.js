'use strict';
const assert=require('node:assert/strict');
const {LongCapture,matchFrames,frameDifference}=require('./lib/long-capture');
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
check('不变画面不重复追加',()=>assert.equal(matchFrames(frame(0),frame(0)).status,'duplicate'));
check('反向滚动不追加',()=>assert.equal(matchFrames(frame(80),frame(20)).status,'reverse'));
check('固定页眉/页脚只保留一次',()=>{
  const model=new LongCapture(frame(0,{header:26,footer:18}));assert.equal(model.append(frame(61,{header:26,footer:18})).status,'matched');
  assert.equal(model.append(frame(119,{header:26,footer:18})).status,'matched');
  const pixels=model.bitmap();assert.equal(model.height,H+119);assert.equal(pixels.length,W*(H+119)*4);
  const expected=Buffer.alloc(pixels.length),first=frame(0,{header:26,footer:18}),last=frame(119,{header:26,footer:18});
  first.data.copy(expected,0,0,(H-18)*W*4);frame(61,{header:26,footer:18}).data.copy(expected,(H-18)*W*4,(H-18-61)*W*4,(H-18)*W*4);
  last.data.copy(expected,(H-18+61)*W*4,(H-18-58)*W*4);assert.deepEqual(pixels,expected);
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
console.log(`\n${count} 通过 / 0 失败`);
