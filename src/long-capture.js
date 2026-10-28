'use strict';
(() => {
  const api=window.suira.longCapture;
  const sizeEl=document.getElementById('long-size');
  const messageEl=document.getElementById('long-message');
  const pauseEl=document.getElementById('long-pause');
  const finishEl=document.getElementById('long-finish');
  const cancelEl=document.querySelector('[data-command="cancel"]');
  const buttons=[...document.querySelectorAll('[data-command]')];
  let current={frames:0,width:0,height:0,paused:false,stopped:false,stage:'preparing',message:''};
  let busy=false;

  function render(next) {
    if(!next)return;
    current={...current,...next};
    const frames=Number(current.frames)||0;
    sizeEl.textContent=frames>0?`${frames} 段 · ${current.width} × ${current.height}`:'正在准备';
    if(current.message)messageEl.textContent=current.message;
    // 准备阶段/暂停/对不上分别用不同颜色提示，但都不锁按钮：
    // 之前只要有命令在跑就禁用全部按钮，取消和继续一起失效，用户只能干等。
    document.body.classList.toggle('is-paused',Boolean(current.paused));
    document.body.classList.toggle('is-preparing',current.stage==='preparing');
    document.body.classList.toggle('is-misaligned',current.stage==='misaligned');
    pauseEl.hidden=frames<1||Boolean(current.stopped);
    pauseEl.textContent=current.paused?'继续':'暂停';
    pauseEl.dataset.command=current.paused?'resume':'pause';
    finishEl.disabled=busy||frames<1;
    cancelEl.disabled=false;
  }

  async function run(command,button) {
    if(busy&&command!=='cancel')return;
    const heavy=command==='finish';
    if(heavy)busy=true;
    if(heavy&&button)button.disabled=true;
    try {
      const result=await api.command(command);
      if(result&&result.ok===false&&result.error)messageEl.textContent=result.error;
    } catch(error) {
      messageEl.textContent=error.message||'操作未完成，请重试';
    } finally {
      if(heavy){busy=false;if(button)button.disabled=false;}
    }
  }

  for(const button of buttons)button.addEventListener('click',event=>{
    event.preventDefault();
    run(button.dataset.command,button);
  });

  // 工具条现在可以拿到焦点（旧版 focusable:false + 每帧隐藏导致按钮点不动），
  // 键盘同样能操作：Esc 取消，空格暂停/继续，回车完成。
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();run('cancel',cancelEl);}
    else if(event.key===' '){event.preventDefault();run(current.paused?'resume':'pause',pauseEl);}
    else if(event.key==='Enter'){event.preventDefault();run('finish',finishEl);}
  });

  api.onState(render);
  api.state().then(state=>{if(state)render(state);}).catch(()=>{});
})();
