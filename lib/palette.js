'use strict';
// Local sRGB palette extraction. Median cut works on at most a 64px sample;
// no image data or wallpaper paths are sent to a renderer.
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const hex=rgb=>'#'+rgb.map(n=>Math.round(clamp(n,0,255)).toString(16).padStart(2,'0')).join('');
function rgb(color){
  if(Array.isArray(color)&&color.length===3&&color.every(Number.isFinite))return color.map(n=>clamp(n,0,255));
  const value=String(color||'').replace(/^#/,'');
  return /^(?:[\da-f]{6}|[\da-f]{8})$/i.test(value)?[0,2,4].map(i=>parseInt(value.slice(i,i+2),16)):null;
}
function hsl(color){
  const [r,g,b]=rgb(color).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,l=(max+min)/2;
  let h=0;if(delta)h=max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
  return [h*60,delta?delta/(1-Math.abs(2*l-1)):0,l];
}
function fromHsl(h,s,l){
  h=((h%360)+360)%360;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;
  const v=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return v.map(n=>Math.round((n+m)*255));
}
function luminance(color){return rgb(color).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function solidInk(color){return contrast(color,'ffffff')>=contrast(color,'000000')?'#ffffff':'#000000';}
function readable(color,backgrounds,dark){
  let [h,s,l]=hsl(color);
  for(let i=0;i<250;i++){
    const value=hex(fromHsl(h,s,l));if(backgrounds.every(bg=>contrast(value,bg)>=4.5))return value;
    l=clamp(l+(dark?.004:-.004),0,1);
  }
  return dark?'#ffffff':'#000000';
}
function normalizeDominant(color){
  let [h,s,l]=hsl(rgb(color)||[24,24,27]);if(s<.08)h=210;
  return hex(fromHsl(h,clamp(s,.4,.75),clamp(l,.45,.6)));
}
function dominantColor(data,{order='rgba',maxColors=8}={}){
  const histogram=new Map();
  for(let i=0;i+3<data.length;i+=4){
    if(data[i+3]<128)continue;
    const value=order==='bgra'?[data[i+2],data[i+1],data[i]]:[data[i],data[i+1],data[i+2]];
    const key=value.map(n=>n>>3).join(',');let entry=histogram.get(key);
    if(!entry){entry={sum:[0,0,0],weight:0};histogram.set(key,entry);}entry.weight++;value.forEach((n,c)=>entry.sum[c]+=n);
  }
  const colors=[...histogram.values()].map(e=>({value:e.sum.map(n=>n/e.weight),weight:e.weight}));
  if(!colors.length)return '#18181b';
  const box=list=>{const ranges=[0,1,2].map(c=>Math.max(...list.map(e=>e.value[c]))-Math.min(...list.map(e=>e.value[c])));return {list,ranges,weight:list.reduce((sum,e)=>sum+e.weight,0)};};
  const boxes=[box(colors)];
  while(boxes.length<clamp(maxColors,1,16)){
    const candidates=boxes.filter(b=>b.list.length>1).sort((a,b)=>Math.max(...b.ranges)*b.weight-Math.max(...a.ranges)*a.weight);
    const selected=candidates[0];if(!selected)break;
    const channel=selected.ranges.indexOf(Math.max(...selected.ranges)),sorted=selected.list.slice().sort((a,b)=>a.value[channel]-b.value[channel]);
    let cut=0,count=0;while(cut<sorted.length-1&&count<selected.weight/2)count+=sorted[cut++].weight;
    boxes.splice(boxes.indexOf(selected),1,box(sorted.slice(0,cut)),box(sorted.slice(cut)));
  }
  const chosen=boxes.sort((a,b)=>b.weight-a.weight||Math.max(...b.ranges)-Math.max(...a.ranges))[0];
  return hex([0,1,2].map(c=>chosen.list.reduce((sum,e)=>sum+e.value[c]*e.weight,0)/chosen.weight));
}
const MIST={
 light:{slate:['#fcfcfd','#f9f9fb','#f0f0f3','#e8e8ec','#e0e1e6','#d9d9e0','#cdced6','#b9bbc6','#8b8d98','#80838d','#60646c','#1c2024'],accent:['#fafafa','#f4f4f5','#ececef','#e4e4e7','#d4d4d8','#c4c4ca','#a1a1aa','#71717a','#18181b','#09090b','#27272a','#18181b']},
 dark:{slate:['#111113','#18191b','#212225','#272a2d','#2e3135','#363a3f','#43484e','#5a6169','#696e77','#777b84','#b0b4ba','#edeef0'],accent:['#141416','#1b1b1e','#27272a','#323236','#3f3f46','#52525b','#71717a','#a1a1aa','#f4f4f5','#e4e4e7','#e4e4e7','#fafafa']}
};
function neutralScale(base,dark,text){
  const [h,s]=hsl(base),levels=dark?[.04,.07,.11,.145,.185,.23,.29,.39,.49,.56,.74,.94]:[.989,.973,.95,.919,.879,.833,.76,.665,.56,.48,.36,.14];
  const scale=levels.map(l=>hex(fromHsl(h,s,l)));scale[1]=hex(rgb(base));if(text)scale[11]=text;
  scale[10]=readable(scale[10],scale.slice(0,4),dark);scale[11]=readable(scale[11],scale.slice(0,4),dark);return scale;
}
function accentScale(color,slate,dark,{exact=false}={}){
  const [h,s]=hsl(color),levels=dark?[.065,.09,.16,.205,.25,.30,.37,.46,.51,.57,.77,.92]:[.995,.983,.958,.93,.887,.835,.76,.65,.5,.46,.35,.18];
  const scale=levels.map((l,i)=>hex(fromHsl(h,s*(i<8?(dark?.5:.65):1),l)));
  scale[8]=exact?hex(rgb(color)):readable(color,dark?['#ffffff']:['#ffffff',...slate.slice(0,3)],false);
  scale[9]=hex(fromHsl(h,s,clamp(hsl(scale[8])[2]+(dark?.06:-.035),0,1)));
  scale[10]=readable(scale[10],[...slate.slice(0,4),...scale.slice(0,3)],dark);
  scale[11]=readable(scale[11],[...slate.slice(0,4),...scale.slice(0,3)],dark);return scale;
}
function generatePalette(color,{normalize=true}={}){
  const dominant=normalize?normalizeDominant(color):hex(rgb(color)||[24,24,27]),[h,s]=hsl(dominant),result={dominant};
  for(const mode of ['light','dark']){const dark=mode==='dark',slate=neutralScale(hex(fromHsl(h,Math.min(.16,s*.18),dark?.08:.975)),dark);result[mode]={slate,accent:accentScale(dominant,slate,dark)};}
  return result;
}
const PRESET_NAMES=['mist','ink','paper','pine','midnight','wallpaper'];
function presetPalette(name){
  if(name==='mist'||!PRESET_NAMES.includes(name)||name==='wallpaper')return JSON.parse(JSON.stringify(MIST));
  const anchors={ink:['#f7f7f8','#111113','#18181b'],paper:['#f6f2ea','#211c17','#cc4e00','#2a251f'],pine:['#eef3f0','#141d19','#29a383'],midnight:['#f0f4fa','#0f1722','#00a2c7']}[name];
  const result={};for(const mode of ['light','dark']){const dark=mode==='dark',slate=neutralScale(anchors[dark?1:0],dark,!dark?anchors[3]:undefined);result[mode]={slate,accent:accentScale(anchors[2],slate,dark,{exact:true})};}
  if(name==='ink')for(const mode of ['light','dark'])result[mode].accent=MIST[mode].accent.slice();
  return result;
}
module.exports={rgb,hex,hsl,fromHsl,luminance,contrast,solidInk,normalizeDominant,dominantColor,generatePalette,presetPalette,PRESET_NAMES};
