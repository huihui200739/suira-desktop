'use strict';
(() => {
  const api=window.suira?.settings;if(!api?.get)return;
  let options={companionEnabled:true,companionStyle:'courier',companionSize:32,companionMotion:true};
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');let timer=0,lastSaved=-Infinity,host;
  const dock=document.createElement('aside');dock.className='suira-companion';dock.dataset.pose='idle';dock.setAttribute('aria-label','像素伙伴');
  dock.innerHTML='<button class="companion-button" type="button" aria-label="小信：像素伙伴设置" aria-expanded="false" title="小信 · 伙伴设置"><span class="companion-sprite" aria-hidden="true"></span></button><span class="companion-caption">小信在这里</span><div class="companion-options" hidden><b>像素伙伴</b><label>配色<select data-buddy="companionStyle"><option value="courier">暖橘信使</option><option value="mint">薄荷信使</option></select></label><label>大小<select data-buddy="companionSize"><option value="32">小 · 32</option><option value="40">大 · 40</option></select></label><label>安静模式<input data-buddy="quiet" type="checkbox"></label><button type="button" data-buddy-hide>隐藏伙伴</button><small>可在设置 → 通用与外观中重新开启</small><span class="companion-settings-error" role="status"></span></div>';
  const button=dock.querySelector('button'),popover=dock.querySelector('.companion-options');
  function reset(){clearTimeout(timer);timer=0;dock.dataset.pose='idle';}
  function react(pose,duration=700){reset();if(document.hidden||!document.hasFocus()||reduce.matches||!options.companionEnabled||!options.companionMotion)return;dock.dataset.pose=pose;timer=setTimeout(()=>{reset();if(pose==='wave')timer=setTimeout(()=>react('blink',160),1800);},duration);}
  function close(){popover.hidden=true;button.setAttribute('aria-expanded','false');}
  function sync(settings){options={...options,...settings};dock.hidden=!options.companionEnabled;dock.dataset.style=options.companionStyle;dock.style.setProperty('--buddy-size',options.companionSize+'px');reset();if(dock.hidden)close();document.querySelectorAll('[data-buddy]').forEach(input=>{const key=input.dataset.buddy;if(key==='quiet')input.checked=!options.companionMotion;else if(input.type==='checkbox')input.checked=options[key];else input.value=String(options[key]);});}
  async function save(patch){try{const result=await api.update(patch);if(!result?.ok)throw Error(result?.error||'设置未保存');sync(result.settings);dock.querySelector('[role=status]').textContent='';}catch(error){sync(options);dock.querySelector('[role=status]').textContent=error.message;}}
  function bindControls(root){root.querySelectorAll('[data-buddy]').forEach(input=>input.addEventListener('change',()=>{const key=input.dataset.buddy;save(key==='quiet'?{companionMotion:!input.checked}:{[key]:input.type==='checkbox'?input.checked:key==='companionSize'?Number(input.value):input.value});}));}
  function mount(){
    const tool=document.documentElement.dataset.tool;
    if(document.querySelector('.panel')){host=document.querySelector('.panel');document.body.dataset.companionHost='panel';}
    else if(tool==='markdown'){host=document.querySelector('.titlebar .brand');document.body.dataset.companionHost='document';}
    else if(tool==='calendar'){host=document.querySelector('.titlebar .brand');document.body.dataset.companionHost='calendar';}
    else if(document.querySelector('.bar-head')){host=document.querySelector('.bar-head');document.body.dataset.companionHost='clipboard';}
    else if(document.querySelector('.note-foot')){host=document.querySelector('.note-foot');document.body.dataset.companionHost='note';}
    else {host=document.querySelector('.sidebar');document.body.dataset.companionHost='workbench';}
    if(!host)return;host.append(dock);bindControls(dock);
    const settingsCard=document.getElementById('setting-theme')?.closest('.setting-card');
    if(settingsCard){const controls=document.createElement('div');controls.innerHTML='<label class="setting-row"><span><b>像素伙伴</b><small>小信陪在窗口边缘，不遮挡正文</small></span><input data-buddy="companionEnabled" type="checkbox"></label><label class="setting-row"><span><b>伙伴配色</b></span><select data-buddy="companionStyle"><option value="courier">暖橘信使</option><option value="mint">薄荷信使</option></select></label><label class="setting-row"><span><b>伙伴大小</b><small>紧凑顶栏自动缩小</small></span><select data-buddy="companionSize"><option value="32">小 · 32</option><option value="40">大 · 40</option></select></label><label class="setting-row"><span><b>安静模式</b><small>保留角色，关闭姿态变化</small></span><input data-buddy="quiet" type="checkbox"></label>';settingsCard.append(controls);bindControls(controls);}
    api.get().then(sync).catch(()=>sync(options));api.onChanged?.(sync);
    button.addEventListener('pointerenter',()=>react('wave'));button.addEventListener('click',()=>{popover.hidden=!popover.hidden;if(!popover.hidden){const r=button.getBoundingClientRect(),p=popover.getBoundingClientRect();popover.style.left=Math.max(8,Math.min(r.left,innerWidth-p.width-8))+'px';popover.style.top=Math.max(8,Math.min(r.bottom+8,innerHeight-p.height-8))+'px';}button.setAttribute('aria-expanded',String(!popover.hidden));react('wave');});
    dock.querySelector('[data-buddy-hide]').onclick=()=>save({companionEnabled:false});
    document.addEventListener('pointerdown',event=>{if(!dock.contains(event.target))close();});
    dock.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){close();button.focus();}});
    window.addEventListener('focus',()=>react('wave',600));window.addEventListener('blur',()=>{reset();close();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});reduce.addEventListener('change',reset);
    react('wave',600);
  }
  window.SuiraCompanion={saved(){if(performance.now()-lastSaved<4000)return;lastSaved=performance.now();react('saved',850);},react,reset};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
