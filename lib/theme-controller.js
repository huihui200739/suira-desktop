'use strict';
const fs=require('node:fs'),path=require('node:path');
const {presetPalette,generatePalette,dominantColor,rgb,PRESET_NAMES}=require('./palette');
function createThemeController({getSettings,nativeTheme,systemPreferences,readWallpaper,publish,env=process.env,watch=fs.watch,pollMs=30000}){
  let revision=0,request=0,current,last='',disposed=false,timer,poll,watcher,windowsColor;
  const settings=()=>{const s=getSettings();return {preset:PRESET_NAMES.includes(s.themePreset)?s.themePreset:'mist',accentSource:['preset','windows','wallpaper'].includes(s.accentSource)?s.accentSource:'preset',material:s.panelMaterial||'liquid'};};
  const usesWallpaper=s=>s.preset==='wallpaper'||s.accentSource==='wallpaper';
  async function refresh(){
    if(disposed)return current;
    const token=++request,s=settings(),base=presetPalette(s.preset);let wallpaperPalette=null,wallpaperAvailable=false,accentAvailable=true;
    if(usesWallpaper(s)){
      try{const image=await readWallpaper();if(image?.data?.length){wallpaperPalette=generatePalette(dominantColor(image.data,{order:image.order}));wallpaperAvailable=true;}}catch{}
      if(token!==request||disposed)return current;
      if(s.preset==='wallpaper'&&wallpaperPalette)for(const mode of ['light','dark'])base[mode]=wallpaperPalette[mode];
    }
    let external;
    if(s.accentSource==='windows'){
      try{const color=rgb(windowsColor||systemPreferences.getAccentColor());if(color)external=generatePalette(color,{normalize:false});else accentAvailable=false;}catch{accentAvailable=false;}
    }else if(s.accentSource==='wallpaper'){external=wallpaperPalette;accentAvailable=wallpaperAvailable;}
    if(external)for(const mode of ['light','dark'])base[mode]={...base[mode],accent:external[mode].accent};
    const next={...s,dark:Boolean(nativeTheme.shouldUseDarkColors),forcedSolid:Boolean(nativeTheme.prefersReducedTransparency||nativeTheme.shouldUseHighContrastColors),palette:base,wallpaperPalette,wallpaperAvailable,accentAvailable,dominant:external?.dominant||wallpaperPalette?.dominant||null};
    if(token!==request||disposed)return current;
    const signature=JSON.stringify(next);if(signature!==last){last=signature;current={...next,revision:++revision};publish(current);}
    syncWatch(s);return current;
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>refresh().catch(()=>{}),180);timer.unref?.();}
  function syncWatch(s){
    if(!usesWallpaper(s)){clearInterval(poll);poll=null;watcher?.close();watcher=null;return;}
    if(!poll){poll=setInterval(()=>refresh().catch(()=>{}),pollMs);poll.unref?.();}
    if(!watcher&&env.APPDATA)try{watcher=watch(path.join(env.APPDATA,'Microsoft','Windows','Themes'),{persistent:false},schedule);watcher.on('error',()=>{watcher?.close();watcher=null;});}catch{}
  }
  function accentChanged(_event,color){windowsColor=color;if(settings().accentSource==='windows')schedule();}
  function nativeChanged(){schedule();}
  systemPreferences?.on?.('accent-color-changed',accentChanged);nativeTheme?.on?.('updated',nativeChanged);
  return {refresh,snapshot:()=>current,dispose(){disposed=true;++request;clearTimeout(timer);clearInterval(poll);watcher?.close();systemPreferences?.removeListener?.('accent-color-changed',accentChanged);nativeTheme?.removeListener?.('updated',nativeChanged);}};
}
module.exports={createThemeController};
