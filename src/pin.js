'use strict';
(() => {
  const api=window.pinApi,$=id=>document.getElementById(id),menu=$('pin-menu');
  let textMode=false;let baseW=300,baseH=200,scale=1,opacity=1,collapsed=false,drag=null,moveFrame=0,movePoint=null,noticeTimer,suppressRestore=false;
  const notify=(message,error=false,copied=false)=>{clearTimeout(noticeTimer);$('pin-notice').textContent=message;if(!error&&copied)window.SuiraUI?.copyFeedback($('pin-notice'));$('pin-notice').hidden=false;$('pin-notice').classList.toggle('is-error',error);noticeTimer=setTimeout(()=>$('pin-notice').hidden=true,2200);};
  let menuAnchor;
  function updateControls() {
    const zoomLabel = Math.round(scale * 100) + '%';
    const opacityLabel = Math.round(opacity * 100) + '%';
    $('zoom-val').textContent = menu.querySelector('[data-value=zoom]').textContent = zoomLabel;
    $('opacity-val').textContent = menu.querySelector('[data-value=opacity]').textContent = opacityLabel;
    const unavailable = {'zoom-out': scale <= .25, 'zoom-in': scale >= 3, 'opacity-down': opacity <= .25, 'opacity-up': opacity >= 1};
    for (const [id, disabled] of Object.entries(unavailable)) {
      $(id).disabled = menu.querySelector(`[data-adjust=${id}]`).disabled = disabled;
    }
  }
  function zoom(next) {
    if (collapsed) return;
    scale = Math.min(3, Math.max(.25, Math.round(next * 100) / 100));
    updateControls();
    api.resize(Math.round(baseW * scale), Math.round(baseH * scale));
    if (textMode) $('pin-text').style.setProperty('--text-pin-size', (15 * scale) + 'px');
  }
  function fade(next) {
    opacity = Math.min(1, Math.max(.25, Math.round(next * 100) / 100));
    updateControls();
    api.setOpacity(opacity);
  }
  function collapse() {
    collapsed = !collapsed;
    api.collapse(collapsed);
    document.body.classList.toggle('is-collapsed', collapsed);
    $('restore').hidden = !collapsed;
    hideMenu();
  }
  function hideMenu(restore = false) {
    menu.hidden = true;
    $('more').setAttribute('aria-expanded', 'false');
    if (restore) $(collapsed ? 'restore' : 'more').focus({preventScroll:true});
  }
  function positionMenu() {
    if (menu.hidden) return;
    const anchor = $(collapsed ? 'restore' : 'more').getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const x = menuAnchor?.x ?? anchor.right - width;
    const y = menuAnchor?.y ?? anchor.top - height - 6;
    menu.style.left = Math.max(6, Math.min(innerWidth - width - 6, x)) + 'px';
    menu.style.top = Math.max(6, Math.min(innerHeight - height - 6, y)) + 'px';
  }
  function openMenu(anchor, focus = true) {
    menuAnchor = anchor;
    menu.hidden = false;
    $('more').setAttribute('aria-expanded', 'true');
    positionMenu();
    if (focus) menu.querySelector('[data-command=copy]').focus({preventScroll:true});
  }
  new ResizeObserver(positionMenu).observe(menu);
  window.addEventListener('resize', positionMenu);
  window.PinUI = {revealMenu: () => openMenu(undefined, false)};
  updateControls();
  async function command(name){
    hideMenu();
    if(name==='close'){api.close();return;}
    if(name==='collapse'){collapse();return;}
    if(name==='reset'){if(collapsed)collapse();zoom(1);fade(1);return;}
    try {
      const result=name==='top'?await api.toggleTop():await api[name]();
      if(result?.canceled)return;
      if(!result?.ok)throw Error(result?.error||'操作失败');
      if(name==='top')$('top-item').setAttribute('aria-checked',String(result.alwaysOnTop));
      else notify(name==='copy'?(textMode?'文字已复制':'图片已复制'):(textMode?'文字已保存':'图片已保存'),false,name==='copy');
    }catch(error){notify(error.message,true);}
  }
  $('zoom-in').onclick=()=>zoom(scale+.1);$('zoom-out').onclick=()=>zoom(scale-.1);
  $('opacity-up').onclick=()=>fade(opacity+.1);$('opacity-down').onclick=()=>fade(opacity-.1);
  $('copy').onclick=()=>command('copy');$('close').onclick=()=>command('close');
  $('collapse').onclick=collapse;
  $('restore').onclick=event=>{if(suppressRestore&&event.detail>0){suppressRestore=false;return;}collapse();};
  $('more').onclick=()=>{if(menu.hidden)openMenu();else hideMenu();};
  menu.addEventListener('click', event => {
    const item = event.target.closest('[data-command],[data-adjust]');
    if (!item) return;
    if (item.dataset.command) command(item.dataset.command);
    else { $(item.dataset.adjust).click(); hideMenu(true); }
  });
  document.addEventListener('contextmenu',event=>{event.preventDefault();openMenu({x:event.clientX,y:event.clientY});});
  document.addEventListener('pointerdown',event=>{
    if(!menu.hidden&&!menu.contains(event.target)&&!event.target.closest('#more'))hideMenu();
    const restoring=collapsed&&event.target.closest('#restore');
    if(textMode&&event.target.closest('.pin-text')&&!event.ctrlKey&&!event.metaKey)return;
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
    if(textMode&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'&&window.getSelection().toString())return;
    if((event.ctrlKey||event.metaKey)&&['c','s'].includes(event.key.toLowerCase())){event.preventDefault();command(event.key.toLowerCase()==='c'?'copy':'save');return;}
    if(menu.hidden)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const buttons=[...menu.querySelectorAll('button')].filter(button=>button.getClientRects().length&&!button.disabled);let index=buttons.indexOf(document.activeElement);
      index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index].focus();
    }else if(event.key==='Tab'){event.preventDefault();hideMenu(true);}
  });
  window.addEventListener('blur',()=>{hideMenu();endDrag();});
  api.getData().then(result=>{
    if(!result.ok)throw Error(result.error);
    textMode=result.data.kind==='text';$('pin-image').hidden=textMode;$('pin-text').hidden=!textMode;if(textMode){$('copy').setAttribute('aria-label','复制文字');$('copy').dataset.hint='复制文字';$('pin-text').textContent=result.data.text;document.title='随序 · 文字钉图';menu.querySelector('[data-command=copy]').firstChild.textContent='复制文字 ';menu.querySelector('[data-command=save]').firstChild.textContent='文字另存为 ';}else $('pin-image').src=result.data.url;baseW=result.data.width;baseH=result.data.height;
  }).catch(error=>notify(error.message,true));
})();
