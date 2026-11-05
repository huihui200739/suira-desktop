'use strict';
(() => {
  const api=window.pinApi,$=id=>document.getElementById(id),menu=$('pin-menu');
  let baseW=300,baseH=200,scale=1,opacity=1,collapsed=false,drag=null,moveFrame=0,movePoint=null,noticeTimer,suppressRestore=false;
  const notify=(message,error=false)=>{clearTimeout(noticeTimer);$('pin-notice').textContent=message;if(!error&&/复制/.test(message))window.SuiraUI?.copyFeedback($('pin-notice'));$('pin-notice').hidden=false;$('pin-notice').classList.toggle('is-error',error);noticeTimer=setTimeout(()=>$('pin-notice').hidden=true,2200);};
  const zoom=next=>{scale=Math.min(3, Math.max(0.25,next));$('zoom-val').textContent=Math.round(scale*100)+'%';api.resize(Math.round(baseW*scale),Math.round(baseH*scale));};
  const fade=next=>{opacity=Math.max(.25,Math.min(1,next));$('opacity-val').textContent=Math.round(opacity*100)+'%';api.setOpacity(opacity);};
  function collapse(){collapsed=!collapsed;api.collapse(collapsed);document.body.classList.toggle('is-collapsed',collapsed);$('restore').hidden=!collapsed;menu.hidden=true;}
  function hideMenu(restore=false){menu.hidden=true;if(restore)$('more').focus({preventScroll:true});}
  function openMenu(x,y){
    if(collapsed)collapse();
    menu.hidden=false;
    const rect=menu.getBoundingClientRect();
    menu.style.left=Math.max(6,Math.min(innerWidth-rect.width-6,x))+'px';
    menu.style.top=Math.max(6,Math.min(innerHeight-rect.height-6,y))+'px';
    menu.querySelector('button').focus({preventScroll:true});
  }
  async function command(name){
    hideMenu();
    if(name==='close'){api.close();return;}
    if(name==='collapse'){collapse();return;}
    if(name==='reset'){zoom(1);fade(1);return;}
    try {
      const result=name==='top'?await api.toggleTop():await api[name]();
      if(result?.canceled)return;
      if(!result?.ok)throw Error(result?.error||'操作失败');
      if(name==='top')$('top-item').setAttribute('aria-checked',String(result.alwaysOnTop));
      else notify(name==='copy'?'图片已复制':'图片已保存');
    }catch(error){notify(error.message,true);}
  }
  $('zoom-in').onclick=()=>zoom(scale+.1);$('zoom-out').onclick=()=>zoom(scale-.1);
  $('opacity-up').onclick=()=>fade(opacity+.1);$('opacity-down').onclick=()=>fade(opacity-.1);
  $('copy').onclick=()=>command('copy');$('close').onclick=()=>command('close');
  $('collapse').onclick=collapse;
  $('restore').onclick=event=>{if(suppressRestore&&event.detail>0){suppressRestore=false;return;}collapse();};
  $('more').onclick=()=>{const rect=$('more').getBoundingClientRect();menu.hidden?openMenu(rect.left,rect.top-220):hideMenu();};
  menu.addEventListener('click',event=>{const button=event.target.closest('[data-command]');if(button)command(button.dataset.command);});
  document.addEventListener('contextmenu',event=>{event.preventDefault();openMenu(event.clientX,event.clientY);});
  document.addEventListener('pointerdown',event=>{
    if(!menu.hidden&&!menu.contains(event.target)&&!event.target.closest('#more'))hideMenu();
    const restoring=collapsed&&event.target.closest('#restore');
    if(event.button!==0||(!restoring&&event.target.closest('button,.pin-menu,.pin-bar')))return;
    suppressRestore=false;
    drag={sx:event.screenX,sy:event.screenY,x:window.screenX,y:window.screenY,pointer:event.pointerId,moved:false,capture:restoring?$('restore'):$('pin-surface')};
    drag.capture.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    if(!drag.moved&&Math.hypot(event.screenX-drag.sx,event.screenY-drag.sy)<4)return;
    drag.moved=true;
    movePoint={x:Math.round(drag.x+event.screenX-drag.sx),y:Math.round(drag.y+event.screenY-drag.sy)};
    if(!moveFrame)moveFrame=requestAnimationFrame(()=>{moveFrame=0;if(movePoint)api.move(movePoint);});
  });
  const endDrag=()=>{if(moveFrame){cancelAnimationFrame(moveFrame);moveFrame=0;if(movePoint)api.move(movePoint);}if(collapsed&&drag?.moved)suppressRestore=true;const pointer=drag?.pointer,capture=drag?.capture;drag=movePoint=null;if(pointer!==undefined&&capture.hasPointerCapture(pointer))capture.releasePointerCapture(pointer);};
  document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
  document.addEventListener('lostpointercapture',endDrag);
  document.addEventListener('dblclick',event=>{if(!event.target.closest('button,.pin-menu'))command('reset');});
  document.addEventListener('wheel',event=>{if(event.ctrlKey){event.preventDefault();zoom(scale+(event.deltaY<0?.1:-.1));}},{passive:false});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();if(!menu.hidden)hideMenu(true);else api.close();return;}
    if((event.ctrlKey||event.metaKey)&&['c','s'].includes(event.key.toLowerCase())){event.preventDefault();command(event.key.toLowerCase()==='c'?'copy':'save');return;}
    if(menu.hidden)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const buttons=[...menu.querySelectorAll('button')];let index=buttons.indexOf(document.activeElement);
      index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index].focus();
    }else if(event.key==='Tab'){event.preventDefault();hideMenu(true);}
  });
  window.addEventListener('blur',()=>{hideMenu();endDrag();});
  api.getData().then(result=>{
    if(!result.ok)throw Error(result.error);
    $('pin-image').src=result.data.url;baseW=result.data.width;baseH=result.data.height;
  }).catch(error=>notify(error.message,true));
})();
