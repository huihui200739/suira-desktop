'use strict';
(() => {
  const api=window.suira.longCapture;
  const image=document.getElementById('preview-image');
  const empty=document.getElementById('preview-empty');
  const sizeEl=document.getElementById('preview-size');
  const framesEl=document.getElementById('preview-frames');
  const titleEl=document.getElementById('preview-title');
  let lastFrames=0;

  function render(payload) {
    if(!payload)return;
    const frames=Number(payload.frames)||0;
    sizeEl.textContent=`${payload.width} × ${payload.height}`;
    framesEl.textContent=frames>0?`${frames} 段`:'';
    titleEl.textContent=frames>1?'长图预览 · 拼接中':'长图预览';
    // 只有新段进来时才换图，避免同一张缩略图重复解码。
    if(payload.dataUrl&&frames!==lastFrames){lastFrames=frames;image.src=payload.dataUrl;}
    if(payload.dataUrl){image.hidden=false;empty.hidden=true;}
  }

  api.onPreview(render);
})();
