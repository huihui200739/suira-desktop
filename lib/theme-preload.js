'use strict';
// Shared by the regular and pin preloads. Only foundation scales cross IPC;
// each window applies its own media-query mode, including newly created tools.
function installThemeBridge({ipcRenderer,document,window}){
  if(!document||!window)return;
  let state,applied=-1;const media=window.matchMedia('(prefers-color-scheme: dark)');
  function paint(){
    const root=document.documentElement;if(!root)return;
    root.dataset.theme=state?.preset||'mist';root.dataset.accentSource=state?.accentSource||'preset';
    if(!state)return;
    root.dataset.themeForcedSolid=String(state.forcedSolid);
    root.dataset.glassMode=state.forcedSolid?'solid':state.material;
    const scales=state.palette?.[media.matches?'dark':'light'];
    for(const name of ['slate','accent'])for(let i=0;i<12;i++){
      const property='--'+name+'-'+(i+1),color=scales?.[name]?.[i];
      if(typeof color==='string'&&/^#[\da-f]{6}$/i.test(color))root.style.setProperty(property,color);else root.style.removeProperty(property);
    }
    root.dataset.themeRevision=String(state.revision);
  }
  function accept(value){if(!value||!Number.isFinite(value.revision)||value.revision<applied)return;state=value;applied=value.revision;paint();}
  ipcRenderer.on('theme:changed',(_event,value)=>accept(value));
  try{accept(ipcRenderer.sendSync('theme:initial'));}catch{paint();}
  if(document.documentElement)paint();else{
    const observer=new window.MutationObserver(()=>{if(document.documentElement){paint();observer.disconnect();}});
    observer.observe(document,{childList:true,subtree:true});
  }
  media.addEventListener('change',paint);document.addEventListener('DOMContentLoaded',paint,{once:true});
}
if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.top === window) {
  installThemeBridge({ ipcRenderer: require('electron').ipcRenderer, document, window });
} else if (typeof module !== 'undefined') {
  module.exports = { installThemeBridge };
}
