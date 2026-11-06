'use strict';
(() => {
  const RECENT_MS=60000;
  function recentItem(items,now=Date.now()){
    return (items||[]).filter(item=>item&&!item.meta?.workspace&&now-Number(item.createdAt)>=0&&now-Number(item.createdAt)<RECENT_MS&&(['clipboard','screenshot'].includes(item.source?.type)||/clipboard|screen-capture|long-capture/.test(item.source?.acquisitionMethod||''))).sort((a,b)=>b.createdAt-a.createdAt)[0]||null;
  }
  const api={RECENT_MS,recentItem};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else globalThis.SuiraPanelContext=api;
})();
