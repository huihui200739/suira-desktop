'use strict';
function frameDifference(a,b) {
  if(a.width!==b.width||a.height!==b.height)return Infinity;
  let changed=0,count=0;const stride=Math.max(4,Math.floor(a.data.length/4/5000)*4);
  for(let i=0;i<a.data.length;i+=stride){count++;if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>24)changed++;}
  return changed/Math.max(1,count);
}
function frameSettled(previous,current) {
  if(frameDifference(previous,current)<.0015)return true;
  if(previous.width!==current.width||previous.height!==current.height)return false;
  // 输入光标、鼠标悬停和小型加载图标不能让首帧永远失败。允许最多 2% 的像素
  // 在少数局部网格变化；滚动文字、窗口收起动画等跨区域变化仍须等到停稳。
  const cells=new Set(),{width,height}=current;let changed=0,count=0;
  const step=Math.max(1,Math.floor(Math.sqrt(width*height/12000)));
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step) {
    const i=(y*width+x)*4;count++;
    if(Math.abs(previous.data[i]-current.data[i])+Math.abs(previous.data[i+1]-current.data[i+1])+Math.abs(previous.data[i+2]-current.data[i+2])>24){
      changed++;cells.add(Math.floor(y*8/height)*8+Math.floor(x*8/width));
      if(cells.size>4)return false;
    }
  }
  return changed/Math.max(1,count)<=.02;
}
module.exports={frameDifference,frameSettled};
