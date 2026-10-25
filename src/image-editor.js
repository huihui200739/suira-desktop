'use strict';
// 与截图共用标注引擎；这里仅负责图片工作台的导入、窗口外壳与自适应布局。
(() => {
  if (new URLSearchParams(location.search).get('mode') !== 'image-editor') return;
  const api = window.suira.imageEditor;
  document.body.classList.add('is-image-editor');
  document.querySelector('[data-tool="select"] span').textContent = '裁剪';
  document.querySelector('[data-tool="select"]').title = '裁剪区域';
  document.querySelector('[data-action="copy"]').title = '复制图片';
  const shell = document.createElement('div');
  shell.className = 'editor-shell';
  shell.innerHTML = `<header class="editor-head">
    <div class="editor-brand"><img src="../assets/suira-icon.png" alt=""><b>改图</b><span id="editor-name">图片工作台</span></div>
    <button type="button" id="editor-open" data-hint="打开图片 (Ctrl+O)">打开图片</button>
    <div class="editor-window-controls"><button type="button" data-window="minimize" aria-label="最小化">−</button><button type="button" data-window="maximize" aria-label="最大化或还原">□</button><button type="button" data-window="close" aria-label="关闭">×</button></div>
    </header>
    <main class="editor-empty" id="editor-empty"><svg viewBox="0 0 48 48"><rect x="5" y="7" width="38" height="34" rx="7"/><circle cx="17" cy="18" r="3"/><path d="m6 35 11-11 8 8 8-14 10 17"/></svg><h1>把图片放进来</h1><p>拖入图片，或按 Ctrl+V 粘贴</p><button type="button" id="editor-empty-open">打开本地图片</button><small>PNG · JPG · WebP · BMP</small></main>
    <footer class="editor-foot"><span id="editor-status" role="status" aria-live="polite">原图保留，编辑结果保存为新图片</span><span id="editor-size"></span></footer>`;
  document.body.appendChild(shell);
  const status = document.getElementById('editor-status');
  const report = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  async function open(options) {
    try {
      const result = await api.open(options);
      if (!result?.ok && !result?.canceled) report(result?.error || '图片打开失败', true);
    } catch (error) { report(error.message || '图片打开失败', true); }
  }
  const pick = () => open({ pick: true });
  document.getElementById('editor-open').onclick = pick;
  document.getElementById('editor-empty-open').onclick = pick;
  shell.querySelectorAll('[data-window]').forEach(button => { button.onclick = () => api.window(button.dataset.window); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) pick(); }
  }, true);
  async function importFile(file) {
    if (!file) return;
    const filePath = api.pathForFile(file);
    if (filePath) return open({ filePath });
    if (!['image/png','image/jpeg','image/webp','image/bmp'].includes(file.type)) return report('请选择 PNG、JPG、WebP 或 BMP 图片', true);
    if (file.size > 64 * 1024 * 1024) return report('图片文件超过 64 MB', true);
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 40_000_000 || bitmap.width > 16384 || bitmap.height > 16384) { bitmap.close(); return report('图片尺寸过大，请先缩小图片', true); }
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap,0,0); bitmap.close();
      await open({ dataUrl:canvas.toDataURL('image/png') }); canvas.width=canvas.height=0;
    } catch (error) { report(error.message || '图片载入失败', true); }
  }
  document.addEventListener('dragover', event => { event.preventDefault(); document.body.classList.add('editor-drag-over'); });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('editor-drag-over'); });
  document.addEventListener('drop', event => { event.preventDefault(); document.body.classList.remove('editor-drag-over'); importFile(event.dataTransfer.files[0]); });
  document.addEventListener('paste', event => {
    if (event.target.closest?.('textarea,input,[contenteditable="true"]')) return;
    const file = [...(event.clipboardData?.items || [])].find(item=>item.kind==='file' && item.type.startsWith('image/'))?.getAsFile();
    if (file) { event.preventDefault(); importFile(file); }
  });
  window.SuiraEditorUI = {
    report,
    layout(image) {
      const scale = Math.min(Math.max(1,160/Math.max(image.width,image.height)),(innerWidth-80)/image.width,(innerHeight-210)/image.height);
      const width = Math.max(1,Math.round(image.width*scale)),height = Math.max(1,Math.round(image.height*scale));
      Object.assign(document.getElementById('capture-root').style,{left:`${(innerWidth-width)/2}px`,top:`${78+(innerHeight-210-height)/2}px`,width:`${width}px`,height:`${height}px`});
      document.getElementById('editor-size').textContent = `${image.width} × ${image.height} · 预览 ${Math.round(scale*100)}%`;
    },
    loaded(image,payload) {
      document.body.classList.toggle('editor-has-image',Boolean(image));
      document.getElementById('editor-empty').hidden = Boolean(image);
      document.getElementById('editor-name').textContent = payload?.name || '图片工作台';
      if (image) { this.layout(image); report('原图保留 · A 裁剪选区 · 悬停图标查看快捷键'); }
    }
  };
})();
