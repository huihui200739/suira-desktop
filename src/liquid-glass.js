'use strict';
// Real Windows backdrop with a shared glass finish. No wallpaper or screenshots.
(() => {
 const root=document.documentElement,api=window.suira;let mode='liquid',reduced=false;
 function sync(settings={}){
  mode=['liquid','soft','clear','solid'].includes(settings.panelMaterial)?settings.panelMaterial:'liquid';
  root.dataset.glassMode=reduced?'solid':mode;
  document.querySelectorAll('[data-glass-setting]').forEach(input=>input.value=mode);
 }
 async function mount(){
  const surface=document.querySelector('.panel,.app-shell,.bar,.note');if(!surface)return;
  root.classList.add('liquid-ui');surface.classList.add('glass-window');
  const scene=document.createElement('div');scene.className='glass-scene';scene.setAttribute('aria-hidden','true');surface.prepend(scene);
  const card=document.getElementById('setting-theme')?.closest('.setting-card');
  if(card){
   const row=document.createElement('label');row.className='setting-row';row.innerHTML='<span><b>窗口材质</b><small>Windows 11 使用实时背景玻璃，其余环境使用磨砂底色</small></span><select data-glass-setting><option value="liquid">实时玻璃</option><option value="soft">柔和磨砂</option><option value="clear">轻透玻璃</option><option value="solid">纯色</option></select>';
   card.append(row);row.querySelector('select').addEventListener('change',async event=>{try{const result=await api.settings.update({panelMaterial:event.target.value});sync(result?.settings||{panelMaterial:mode});}catch{sync({panelMaterial:mode});}});
  }
  api?.settings?.get?.().then(sync).catch(()=>sync());api?.settings?.onChanged?.(sync);sync();
  try{const prefs=await api?.material?.preferences?.();root.dataset.glassBackend=prefs?.nativeGlass?'native':'alpha';reduced=Boolean(prefs?.reducedTransparency||prefs?.highContrast);sync({panelMaterial:mode});}catch{root.dataset.glassBackend='alpha';}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
