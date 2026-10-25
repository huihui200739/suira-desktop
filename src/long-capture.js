'use strict';
(() => {
  const api=window.suira.longCapture;let state={paused:false},busy=false;
  function render(next){state=next;document.body.classList.toggle('is-paused',Boolean(next.paused));document.getElementById('long-size').textContent=`${next.frames} 段 · ${next.width} × ${next.height}`;document.getElementById('long-message').textContent=next.message;const button=document.getElementById('long-pause');button.hidden=Boolean(next.stopped);button.textContent=next.paused?'继续':'暂停';button.dataset.command=next.paused?'resume':'pause';}
  document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',async()=>{
    if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>{b.disabled=true;});
    try{const result=await api.command(button.dataset.command);if(!result?.ok)document.getElementById('long-message').textContent=result?.error||'操作未完成，请重试';}
    catch(error){document.getElementById('long-message').textContent=error.message||'操作未完成';}
    finally{busy=false;document.querySelectorAll('button').forEach(b=>{b.disabled=false;});}
  }));
  api.onState(render);api.state().then(result=>{if(result)render(result);});
})();
