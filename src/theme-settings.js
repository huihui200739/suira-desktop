'use strict';
(() => {
  const api=window.suira,grid=document.getElementById('theme-presets'),source=document.getElementById('setting-accent-source'),status=document.getElementById('theme-status');
  if(!grid||!api?.settings)return;
  let settings={},state=null,pending=0;
  function render(){
    for(const button of grid.querySelectorAll('[data-preset]')){
      const name=button.dataset.preset;button.setAttribute('aria-pressed',String(name===(settings.themePreset||'mist')));
      const swatch=button.querySelector('.theme-swatch'),mode=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
      const palette=name==='wallpaper'?state?.wallpaperPalette?.[mode]:null;
      for(const scale of ['slate','accent'])for(let i=0;i<12;i++){
        const color=scale==='accent'&&state?.accentSource!=='preset'?state?.palette?.[mode]?.accent?.[i]:palette?.[scale]?.[i];
        if(color)swatch.style.setProperty('--'+scale+'-'+(i+1),color);else swatch.style.removeProperty('--'+scale+'-'+(i+1));
      }
    }
    source.value=settings.accentSource||'preset';
    status.textContent=state?.accentAvailable===false?'暂时无法读取强调色，已使用预设颜色。':settings.themePreset==='wallpaper'&&!state?.wallpaperAvailable?'暂时无法读取壁纸，已使用雾白。':'所有窗口即时生效，明暗模式保持当前选择。';
  }
  async function update(patch){
    const token=++pending;status.textContent='正在应用…';
    try{const result=await api.settings.update(patch);if(token!==pending)return;if(!result?.ok)throw Error(result?.error||'无法保存外观');settings=result.settings;render();}
    catch(error){if(token===pending){render();status.textContent=error.message;}}
  }
  grid.addEventListener('click',event=>{const button=event.target.closest('[data-preset]');if(button)update({themePreset:button.dataset.preset});});
  source.addEventListener('change',()=>update({accentSource:source.value}));
  api.settings.get().then(value=>{settings=value;render();}).catch(()=>{});
  api.settings.onChanged?.(value=>{settings=value;render();});
  api.theme?.state?.().then(value=>{state=value;render();}).catch(()=>{});
  api.theme?.onChanged?.(value=>{state=value;render();});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',render);
})();
