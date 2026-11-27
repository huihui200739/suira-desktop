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
    const isQuickPanel=/\/quickpanel\.html(?:$|[?#])/i.test(String(window.location?.pathname||window.location?.href||''));
    root.dataset.glassMode=(!isQuickPanel||state.forcedSolid)?'solid':state.material;
    const scales=state.palette?.[media.matches?'dark':'light'];
    for(const name of ['slate','accent'])for(let i=0;i<12;i++){
      const property='--'+name+'-'+(i+1),color=scales?.[name]?.[i];
      if(typeof color==='string'&&/^#[\da-f]{6}$/i.test(color))root.style.setProperty(property,color);else root.style.removeProperty(property);
    }
    const accent9=scales?.accent?.[8];
    if(typeof accent9==='string'&&/^#[\da-f]{6}$/i.test(accent9)){
      const lum=[0,2,4].map(i=>{const c=parseInt(accent9.slice(1+i,3+i),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      root.style.setProperty('--on-accent',(1.05/(lum+.05))>=((lum+.05)/.05)?'#ffffff':'#000000');
    }else root.style.removeProperty('--on-accent');
    root.dataset.themeRevision=String(state.revision);
  }
  function accept(value){if(!value||!Number.isFinite(value.revision)||value.revision<applied)return;state=value;applied=value.revision;paint();}
  ipcRenderer.on('theme:changed',(_event,value)=>accept(value));
  try{accept(ipcRenderer.sendSync('theme:initial'));}catch{paint();}
  if(document.documentElement)paint();else{
    const observer=new window.MutationObserver(()=>{if(document.documentElement){paint();observer.disconnect();}});
    observer.observe(document,{childList:true,subtree:true});
  }
  media.addEventListener('change',paint);document.addEventListener('readystatechange',paint,{once:true});document.addEventListener('DOMContentLoaded',paint,{once:true});
}
if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.top === window) {
  installThemeBridge({ ipcRenderer: require('electron').ipcRenderer, document, window });
} else if (typeof module !== 'undefined') {
  module.exports = { installThemeBridge };
}
