'use strict';
// Real Windows backdrop with a shared glass finish. No wallpaper or screenshots.
(() => {
 const root=document.documentElement,api=window.suira,modes=['clear','liquid','soft','solid'],labels=['轻透玻璃','实时玻璃','柔和磨砂','纯色'];let mode='liquid',reduced=false,isPanel=false;
 function sync(settings={}){
  mode=['liquid','soft','clear','solid'].includes(settings.panelMaterial)?settings.panelMaterial:'liquid';
  const solid=!isPanel||(root.dataset.themeRevision?root.dataset.themeForcedSolid==='true':reduced);
  root.dataset.glassMode=solid?'solid':mode;
  document.querySelectorAll('[data-glass-setting]').forEach(input=>{input.value=String(modes.indexOf(mode));input.setAttribute('aria-valuetext',labels[Number(input.value)]);input.nextElementSibling.textContent=labels[Number(input.value)];});
 }
 async function mount(){
  isPanel=/\/quickpanel\.html(?:$|[?#])/i.test(String(location.pathname||location.href||''));
  const surface=isPanel?document.querySelector('.panel'):document.querySelector('.app-shell,.bar,.note');if(!surface)return;
  root.classList.add('liquid-ui');surface.classList.add('glass-window');
  const scene=document.createElement('div');scene.className='glass-scene';scene.setAttribute('aria-hidden','true');surface.prepend(scene);
  const card=document.getElementById('setting-theme')?.closest('.setting-card');
  if(card){
   const row=document.createElement('label');row.className='setting-row';row.innerHTML='<span><b>悬浮板通透度</b><small>仅作用于悬浮板；工作台、剪贴板条、日历与 Markdown 保持清晰纯色</small></span><span class="glass-density"><input data-glass-setting type="range" min="0" max="3" step="1" value="1" aria-label="悬浮板通透度"><output>实时玻璃</output></span>';
   card.append(row);const input=row.querySelector('input');input.addEventListener('input',()=>{input.setAttribute('aria-valuetext',labels[Number(input.value)]);input.nextElementSibling.textContent=labels[Number(input.value)];});input.addEventListener('change',async event=>{try{const result=await api.settings.update({panelMaterial:modes[Number(event.target.value)]});sync(result?.settings||{panelMaterial:mode});}catch{sync({panelMaterial:mode});}});
  }
  api?.settings?.get?.().then(sync).catch(()=>sync());api?.settings?.onChanged?.(sync);sync();
  try{const prefs=await api?.material?.preferences?.();root.dataset.glassBackend=prefs?.nativeGlass?'native':'alpha';reduced=Boolean(prefs?.reducedTransparency||prefs?.highContrast);sync({panelMaterial:mode});}catch{root.dataset.glassBackend='alpha';}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
