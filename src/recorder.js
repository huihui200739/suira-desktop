'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const api = window.suira.recording;
  let config, phase = 'ready', source, output, video, canvas, recorder, frame = 0, sessionId = '';
  let writes = Promise.resolve(), writeError = null, pendingBytes = 0, timer = 0, startedAt = 0, elapsed = 0, canceled = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('is-error', error); }
  function setPhase(value) {
    phase = value; $('recorder').dataset.phase = value;
    $('setup').hidden = !['ready', 'error'].includes(value);
    $('live').hidden = !['preparing', 'countdown', 'recording', 'paused', 'saving'].includes(value);
    $('done').hidden = value !== 'saved';
    $('pause').disabled = !['recording', 'paused'].includes(value);
    $('stop').disabled = !['recording', 'paused'].includes(value);
    $('pause').textContent = value === 'paused' ? '继续' : '暂停';
    $('heading').textContent = value === 'saved' ? '录制已保存' : '区域录屏';
    $('status').textContent = ({preparing:'准备录制…',countdown:'即将开始',recording:'正在录制',paused:'已暂停',saving:'正在保存…'})[value] || '';
  }
  function updateClock() {
    const seconds = Math.floor((elapsed + (phase === 'recording' ? performance.now() - startedAt : 0)) / 1000);
    $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function release() {
    clearInterval(timer); timer = 0;
    if (video && frame) { if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frame); else cancelAnimationFrame(frame); }
    frame = 0;
    for (const stream of [source, output]) stream?.getTracks().forEach(track => track.stop());
    source = output = null;
    if (video) { video.pause(); video.srcObject = null; video = null; }
    if (canvas) { canvas.width = canvas.height = 0; canvas = null; }
  }
  async function finalize() {
    setPhase('saving'); updateClock();
    try {
      await writes;
      if (writeError) throw writeError;
      const result = await api.finish(sessionId);
      if (!result.ok) throw Error(result.error);
      $('file-name').textContent = result.filePath.split(/[\\/]/).pop();
      setPhase('saved'); notice(`已保存 ${Math.max(1,Math.round(elapsed / 1000))} 秒 · ${result.bytes < 1024 * 1024 ? Math.max(1,Math.round(result.bytes / 1024)) + ' KB' : (result.bytes / (1024 * 1024)).toFixed(1) + ' MB'}`);
    } catch (error) {
      await api.abandon().catch(() => {});
      setPhase('error'); notice(`保存失败：${error.message}`, true);
    } finally { sessionId = ''; release(); }
  }
  async function start() {
    if (!config || !['ready', 'error'].includes(phase)) return;
    canceled = false; elapsed = 0; pendingBytes = 0; writes = Promise.resolve(); writeError = null;
    setPhase('preparing'); notice('正在连接屏幕…');
    try {
      const requested = await api.prepare({systemAudio: $('system-audio').checked});
      if (!requested.ok) throw Error(requested.error);
      source = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: $('system-audio').checked });
      if (canceled) { release(); return; }
      if ($('system-audio').checked && !source.getAudioTracks().length) throw Error('未能获取系统声音，可关闭此选项后重试');
      video = document.createElement('video'); video.muted = true; video.srcObject = source;
      await video.play();
      if (canceled) { release(); return; }
      const { area, displayBounds } = config;
      const scaleX = video.videoWidth / displayBounds.width, scaleY = video.videoHeight / displayBounds.height;
      const sx = Math.round(area.x * scaleX), sy = Math.round(area.y * scaleY);
      const width = Math.max(2, Math.min(video.videoWidth - sx, Math.round(area.width * scaleX)));
      const height = Math.max(2, Math.min(video.videoHeight - sy, Math.round(area.height * scaleY)));
      canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      $('region-size').textContent = `${width} × ${height}`;
      const ctx = canvas.getContext('2d', { alpha: false });
      const draw = () => {
        if (!video || !canvas) return;
        if (phase !== 'paused') ctx.drawImage(video, sx, sy, width, height, 0, 0, width, height);
        frame = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
      };
      draw();
      output = canvas.captureStream(30);
      source.getAudioTracks().forEach(track => output.addTrack(track));
      const mimeType = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw Error('当前系统不支持 WebM 录制');
      recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 8000000 });
      if ($('countdown').checked) {
        setPhase('countdown');
        for (let count = 3; count > 0; count--) {
          if (canceled) { release(); return; }
          $('elapsed').textContent = String(count); notice('倒计时结束后开始录制'); await sleep(1000);
        }
      }
      if (canceled) { release(); return; }
      if (source.getVideoTracks()[0]?.readyState !== 'live') throw Error('屏幕连接已断开，请重新选择区域');
      const result = await api.begin();
      if (!result.ok) throw Error(result.error);
      sessionId = result.id;
      if(canceled){await api.abandon();sessionId='';release();return;}
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        pendingBytes += event.data.size;
        if (pendingBytes > 32 * 1024 * 1024) writeError ||= Error('磁盘写入过慢');
        writes = writes.then(async () => {
          if (writeError) throw writeError;
          const result = await api.append({ id: sessionId, data: await event.data.arrayBuffer() });
          if (!result.ok) throw Error(result.error);
        }).catch(error => { writeError ||= error; if (recorder.state !== 'inactive') recorder.stop(); })
          .finally(() => { pendingBytes -= event.data.size; });
      };
      recorder.onstop = finalize;
      recorder.onerror = event => { writeError ||= Error(event.error?.message || '录屏编码失败'); stop(); };
      source.getVideoTracks()[0].addEventListener('ended', stop, { once: true });
      recorder.start(1000); startedAt = performance.now(); setPhase('recording');
      timer = setInterval(updateClock, 250); updateClock(); notice('仅录制所选区域 · 控制条可拖动');
    } catch (error) {
      if (sessionId) await api.abandon().catch(() => {});
      sessionId = ''; release(); setPhase('error'); notice(error.message || '暂时无法开始录制', true);
    }
  }
  function pause() {
    if (phase === 'recording') { recorder.pause(); elapsed += performance.now() - startedAt; setPhase('paused'); notice('已暂停，暂停时间不会计入视频'); }
    else if (phase === 'paused') { recorder.resume(); startedAt = performance.now(); setPhase('recording'); notice('正在继续录制'); }
    updateClock();
  }
  function stop() {
    if (!['recording', 'paused'].includes(phase)) return;
    if (phase === 'recording') elapsed += performance.now() - startedAt;
    setPhase('saving'); updateClock(); clearInterval(timer);
    if (recorder?.state !== 'inactive') recorder.stop();
  }
  async function close() {
    if (['recording', 'paused'].includes(phase)) { stop(); return; }
    if (phase === 'saving') return;
    canceled = true; release(); await api.close();
  }
  $('start').addEventListener('click', start); $('pause').addEventListener('click', pause);
  $('stop').addEventListener('click', stop); $('close').addEventListener('click', close);
  for (const name of ['open','reveal','export']) $(name).addEventListener('click', async () => {
    const result = await api[name](); if (!result.ok && !result.canceled) notice(result.error || '操作失败', true);
  });
  api.onStopRequested(()=>{
    if(['preparing','countdown'].includes(phase)){canceled=true;return;}
    stop();
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Enter' && !event.target.closest('button,input')) { event.preventDefault(); start(); }
    else if (event.key === ' ' && !event.target.closest('button,input')) { event.preventDefault(); pause(); }
  });
  window.addEventListener('beforeunload', release);
  api.config().then(result => {
    if (!result.ok) throw Error(result.error);
    config = result.config;
    $('region-size').textContent = `${Math.round(config.area.width * (config.scaleFactor || 1))} × ${Math.round(config.area.height * (config.scaleFactor || 1))}`;
  }).catch(error => { notice(error.message, true); $('start').disabled = true; });
})();
