'use strict';
(() => {
  const api=window.suira.longCapture,root=document.getElementById('picker'),region=document.getElementById('region'),message=document.getElementById('message'),retry=document.getElementById('retry');
  let origin=null,raf=0,pending=null;
  const state={ready:false,revision:0,rect:null,busy:false,error:'',shownAt:0};window.__longPickerState=state;
  const point=e=>({x:Math.max(0,Math.min(innerWidth,e.clientX)),y:Math.max(0,Math.min(innerHeight,e.clientY))});
  function box(id,x,y,w,h){Object.assign(document.getElementById(id).style,{left:x+'px',top:y+'px',width:Math.max(0,w)+'px',height:Math.max(0,h)+'px'});}
  function draw(){
    raf=0;if(pending&&origin){const p=pending;state.rect={x:Math.min(origin.x,p.x),y:Math.min(origin.y,p.y),width:Math.abs(p.x-origin.x),height:Math.abs(p.y-origin.y)};pending=null;}
    const r=state.rect;region.hidden=!r;
    if(!r){box('dim-top',0,0,innerWidth,innerHeight);for(const id of ['left','right','bottom'])box('dim-'+id,0,0,0,0);return;}
    Object.assign(region.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});document.getElementById('size').textContent=`${Math.round(r.width)} × ${Math.round(r.height)}`;
    box('dim-top',0,0,innerWidth,r.y);box('dim-bottom',0,r.y+r.height,innerWidth,innerHeight-r.y-r.height);box('dim-left',0,r.y,r.x,r.height);box('dim-right',r.x+r.width,r.y,innerWidth-r.x-r.width,r.height);
  }
  async function start(){
    if(state.busy||!state.ready||!state.rect)return;state.busy=true;root.classList.add('is-busy');retry.hidden=true;message.textContent='正在准备滚动采集…';
    try{const result=await api.start({...state.rect,revision:state.revision});if(!result?.ok)throw Error(result?.error||'无法开始长截图');}
    catch(error){state.error=error.message;root.classList.add('is-error');message.textContent=state.error;retry.hidden=false;}
    finally{state.busy=false;root.classList.remove('is-busy');}
  }
  root.addEventListener('pointerdown',e=>{
    if(e.button!==0||state.busy||!state.ready||e.target.closest('.picker-hint'))return;
    origin=point(e);state.rect=null;state.error='';root.classList.remove('is-error');retry.hidden=true;message.textContent='松开后开始，右键取消';root.setPointerCapture(e.pointerId);pending=origin;draw();
  });
  root.addEventListener('pointermove',e=>{if(!origin)return;pending=point(e);if(!raf)raf=requestAnimationFrame(draw);});
  root.addEventListener('pointerup',e=>{if(!origin||e.button!==0)return;pending=point(e);if(raf){cancelAnimationFrame(raf);raf=0;}draw();origin=null;root.releasePointerCapture(e.pointerId);start();});
  root.addEventListener('pointercancel',()=>{origin=null;pending=null;});
  root.addEventListener('contextmenu',e=>{e.preventDefault();api.cancelPicker();});
  document.getElementById('cancel').addEventListener('click',()=>api.cancelPicker());retry.addEventListener('click',start);
  api.onPickerShown(payload=>{
    if(raf)cancelAnimationFrame(raf);raf=0;origin=pending=null;Object.assign(state,{ready:true,revision:payload.revision,rect:null,busy:false,error:'',shownAt:performance.now()});root.classList.remove('is-busy','is-error');retry.hidden=true;message.textContent='拖动框选滚动内容，松开后开始';draw();api.pickerReady(payload.revision);
  });
})();
