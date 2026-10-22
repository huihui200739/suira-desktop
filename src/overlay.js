const { $, $$ } = (() => ({
  $: (selector, root = document) => root.querySelector(selector),
  $$: (selector, root = document) => Array.from(root.querySelectorAll(selector))
}))();

const root = $('#capture-root');
const screenCanvas = $('#screen-canvas');
const screenCtx = screenCanvas.getContext('2d', { willReadFrequently: true });
const annotationCanvas = $('#annotation-canvas');
const annotationCtx = annotationCanvas.getContext('2d', { willReadFrequently: true });
const selectionEl = $('#selection');
const sizeBadge = $('#size-badge');
const toolDock = $('#tool-dock');
const hint = $('#capture-hint');
const magnifier = $('#magnifier');
const magnifierCanvas = $('#magnifier-canvas');
const magnifierCtx = magnifierCanvas.getContext('2d', { willReadFrequently: true });
const actionToast = $('#action-toast');
const textEditor = $('#text-editor');
const textInput = $('#text-input');
const colorDot = $('#color-dot');
const colorPopover = $('#color-popover');

const state = {
  payload: null,
  image: null,
  scaleX: 1,
  scaleY: 1,
  selection: null,
  mode: 'select',
  tool: 'pen',
  color: '#ff646f',
  lineWidth: 4,
  drawing: null,
  annotations: [],
  redoStack: [],
  textAnchor: null,
  steps: 0,
  toastTimer: null,
  dockSide: 'bottom',
  ocrItemId: '',
  // 从 38 键面板进入时的意图（ocr / pin / copy），以及是否已自动推进过
  intent: '',
  intentAutoDone: false
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function point(event) {
  const rect = root.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height)
  };
}

function normSelection(a, b) {
  const left = clamp(Math.min(a.x, b.x), 0, root.clientWidth);
  const top = clamp(Math.min(a.y, b.y), 0, root.clientHeight);
  const right = clamp(Math.max(a.x, b.x), 0, root.clientWidth);
  const bottom = clamp(Math.max(a.y, b.y), 0, root.clientHeight);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function normalizeSelection(selection) {
  if (!selection) return null;
  const x1 = clamp(Math.min(selection.x, selection.x + selection.w), 0, root.clientWidth);
  const y1 = clamp(Math.min(selection.y, selection.y + selection.h), 0, root.clientHeight);
  const x2 = clamp(Math.max(selection.x, selection.x + selection.w), 0, root.clientWidth);
  const y2 = clamp(Math.max(selection.y, selection.y + selection.h), 0, root.clientHeight);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function hasSelection() {
  return Boolean(state.selection && state.selection.w >= 2 && state.selection.h >= 2);
}

function renderSelection() {
  if (!hasSelection()) {
    selectionEl.hidden = true;
    toolDock.hidden = true;
    root.classList.remove('has-selection');
    return;
  }
  const s = state.selection;
  selectionEl.hidden = false;
  toolDock.hidden = false;
  root.classList.add('has-selection');
  Object.assign(selectionEl.style, {
    left: `${s.x}px`,
    top: `${s.y}px`,
    width: `${s.w}px`,
    height: `${s.h}px`
  });
  const physicalW = Math.max(1, Math.round(s.w * state.scaleX));
  const physicalH = Math.max(1, Math.round(s.h * state.scaleY));
  sizeBadge.textContent = `${physicalW} × ${physicalH}`;
  hint.classList.add('is-hidden');
  positionDock();
}

function positionDock() {
  if (!hasSelection()) return;
  const s = state.selection;
  const dockWidth = Math.min(toolDock.offsetWidth || 720, root.clientWidth - 24);
  const dockHeight = toolDock.offsetHeight || 50;
  const gap = 12;
  let left = s.x + s.w - dockWidth;
  left = clamp(left, 12, root.clientWidth - dockWidth - 12);
  let top;
  if (s.y + s.h + gap + dockHeight < root.clientHeight - 10) {
    top = s.y + s.h + gap;
    state.dockSide = 'bottom';
  } else if (s.y - gap - dockHeight > 10) {
    top = s.y - gap - dockHeight;
    state.dockSide = 'top';
  } else {
    top = clamp(s.y + s.h - dockHeight - 8, 10, root.clientHeight - dockHeight - 10);
    state.dockSide = 'inside';
  }
  toolDock.style.left = `${left}px`;
  toolDock.style.top = `${top}px`;
}

function setSelection(selection, render = true) {
  state.selection = selection ? normalizeSelection(selection) : null;
  if (!hasSelection()) state.selection = null;
  if (render) renderSelection();
}

function clearSelection() {
  state.selection = null;
  state.annotations = [];
  state.redoStack = [];
  state.steps = 0;
  renderSelection();
  renderAnnotations();
  hint.classList.remove('is-hidden');
  magnifier.hidden = true;
}

function showAction(message, type = '') {
  actionToast.textContent = message;
  actionToast.className = `action-toast is-visible${type === 'error' ? ' is-error' : ''}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    actionToast.className = 'action-toast';
  }, 1600);
}

function setTool(tool) {
  if (tool === 'select') {
    state.mode = 'select';
    state.tool = 'pen';
  } else {
    state.mode = 'annotate';
    state.tool = tool;
  }
  root.dataset.tool = tool;
  $$('.tool-button[data-tool]').forEach((button) => button.classList.toggle('is-active', button.dataset.tool === tool));
  toolDock.querySelector('[data-tool="select"]').classList.toggle('is-active', tool === 'select');
  colorPopover.hidden = true;
  if (tool === 'text') {
    showAction('在选区中点击以放置文字');
  }
}

function setColor(color) {
  state.color = color;
  colorDot.style.background = color;
  colorPopover.hidden = true;
  renderAnnotations();
}

function resizeCanvases() {
  const width = root.clientWidth;
  const height = root.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of [screenCanvas, annotationCanvas]) {
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  annotationCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.image) drawScreen();
  renderAnnotations();
}

function drawScreen() {
  if (!state.image) return;
  const width = root.clientWidth;
  const height = root.clientHeight;
  screenCtx.clearRect(0, 0, width, height);
  screenCtx.imageSmoothingEnabled = true;
  screenCtx.imageSmoothingQuality = 'high';
  screenCtx.drawImage(state.image, 0, 0, width, height);
}

function drawMagnifier(p) {
  if (!state.image || !state.payload) return;
  magnifier.hidden = false;
  const sampleSize = 22;
  const srcX = (p.x / root.clientWidth) * state.image.width;
  const srcY = (p.y / root.clientHeight) * state.image.height;
  const half = sampleSize / 2;
  magnifierCtx.imageSmoothingEnabled = false;
  magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
  magnifierCtx.fillStyle = '#080b13';
  magnifierCtx.fillRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
  magnifierCtx.drawImage(
    state.image,
    srcX - half,
    srcY - half,
    sampleSize,
    sampleSize,
    0,
    0,
    magnifierCanvas.width,
    magnifierCanvas.height
  );
  magnifierCtx.strokeStyle = 'rgba(119,173,255,0.9)';
  magnifierCtx.lineWidth = 1;
  magnifierCtx.strokeRect(magnifierCanvas.width / 2 - 11, magnifierCanvas.height / 2 - 11, 22, 22);
  $('#magnifier-coords').textContent = `${Math.round(srcX)}, ${Math.round(srcY)}`;

  const offset = 20;
  let left = p.x + offset;
  let top = p.y + offset;
  if (left + 154 > root.clientWidth) left = p.x - 154 - offset;
  if (top + 140 > root.clientHeight) top = p.y - 140 - offset;
  magnifier.style.left = `${clamp(left, 8, root.clientWidth - 152)}px`;
  magnifier.style.top = `${clamp(top, 8, root.clientHeight - 138)}px`;
}

function renderAnnotations() {
  const width = root.clientWidth;
  const height = root.clientHeight;
  annotationCtx.clearRect(0, 0, width, height);
  annotationCtx.lineCap = 'round';
  annotationCtx.lineJoin = 'round';
  for (const item of state.annotations) drawAnnotation(item);
  if (state.drawing) drawAnnotation(state.drawing);
}

function drawAnnotation(item) {
  const ctx = annotationCtx;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.width;
  if (item.type === 'pen') {
    if (!item.points.length) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (let i = 1; i < item.points.length; i++) ctx.lineTo(item.points[i].x, item.points[i].y);
    ctx.stroke();
  } else if (item.type === 'rect') {
    ctx.strokeRect(item.x, item.y, item.w, item.h);
  } else if (item.type === 'arrow') {
    drawArrow(ctx, item.from, item.to, item.width);
  } else if (item.type === 'mosaic') {
    drawMosaic(item);
  } else if (item.type === 'steps') {
    const radius = 14;
    ctx.beginPath();
    ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(item.number), item.x, item.y + 0.5);
  } else if (item.type === 'text') {
    ctx.font = `600 ${Math.max(14, item.width * 4)}px "Microsoft YaHei UI", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.restore();
}

function drawArrow(ctx, from, to, width) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(12, width * 4);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawMosaic(item) {
  const cell = 8;
  const startX = Math.floor(Math.min(item.x, item.x + item.w) / cell) * cell;
  const startY = Math.floor(Math.min(item.y, item.y + item.h) / cell) * cell;
  const endX = Math.ceil(Math.max(item.x, item.x + item.w) / cell) * cell;
  const endY = Math.ceil(Math.max(item.y, item.y + item.h) / cell) * cell;
  const dpr = window.devicePixelRatio || 1;
  for (let y = startY; y < endY; y += cell) {
    for (let x = startX; x < endX; x += cell) {
      const sx = clamp(Math.round((x / root.clientWidth) * state.image.width), 0, state.image.width - 1);
      const sy = clamp(Math.round((y / root.clientHeight) * state.image.height), 0, state.image.height - 1);
      const pixel = screenCtx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      annotationCtx.fillStyle = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;
      annotationCtx.fillRect(x, y, cell, cell);
    }
  }
}

function addAnnotation(item) {
  state.annotations.push(item);
  state.redoStack = [];
  renderAnnotations();
}

function undo() {
  const item = state.annotations.pop();
  if (!item) return;
  state.redoStack.push(item);
  if (item.type === 'steps') state.steps = Math.max(0, state.steps - 1);
  renderAnnotations();
  showAction('已撤销一步');
}

function redo() {
  const item = state.redoStack.pop();
  if (!item) return;
  state.annotations.push(item);
  renderAnnotations();
  showAction('已恢复一步');
}

/**
 * 把选区合成成一张图。
 * options.withoutAnnotations=true 时只截原始画面，用于「查看原图」。
 */
function compositeSelection(options = {}) {
  if (!hasSelection() || !state.image) return null;
  const s = state.selection;
  const sx = s.x / root.clientWidth * state.image.width;
  const sy = s.y / root.clientHeight * state.image.height;
  const sw = s.w / root.clientWidth * state.image.width;
  const sh = s.h / root.clientHeight * state.image.height;
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(sw));
  output.height = Math.max(1, Math.round(sh));
  const ctx = output.getContext('2d');
  ctx.drawImage(state.image, sx, sy, sw, sh, 0, 0, output.width, output.height);
  if (options.withoutAnnotations) return output;

  const dpr = window.devicePixelRatio || 1;
  for (const item of state.annotations) {
    if (!annotationIntersectsSelection(item)) continue;
    ctx.save();
    ctx.translate(-s.x, -s.y);
    ctx.scale(output.width / s.w, output.height / s.h);
    const original = annotationCtx;
    drawAnnotationToContext(ctx, item);
    ctx.restore();
  }
  return output;
}

function annotationIntersectsSelection(item) {
  const s = state.selection;
  let box;
  if (item.type === 'pen') {
    const xs = item.points.map((p) => p.x);
    const ys = item.points.map((p) => p.y);
    box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  } else if (item.type === 'arrow') {
    box = { x: Math.min(item.from.x, item.to.x), y: Math.min(item.from.y, item.to.y), w: Math.abs(item.to.x - item.from.x), h: Math.abs(item.to.y - item.from.y) };
  } else if (item.type === 'steps') {
    box = { x: item.x - 16, y: item.y - 16, w: 32, h: 32 };
  } else if (item.type === 'text') {
    box = { x: item.x, y: item.y, w: item.text.length * 16, h: 28 };
  } else {
    box = { x: Math.min(item.x, item.x + item.w), y: Math.min(item.y, item.y + item.h), w: Math.abs(item.w), h: Math.abs(item.h) };
  }
  return box.x + box.w >= s.x && box.y + box.h >= s.y && box.x <= s.x + s.w && box.y <= s.y + s.h;
}

function drawAnnotationToContext(ctx, item) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.width;
  if (item.type === 'pen') {
    ctx.beginPath();
    item.points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  } else if (item.type === 'rect') {
    ctx.strokeRect(item.x, item.y, item.w, item.h);
  } else if (item.type === 'arrow') {
    drawArrow(ctx, item.from, item.to, item.width);
  } else if (item.type === 'mosaic') {
    drawMosaicToContext(ctx, item);
  } else if (item.type === 'steps') {
    ctx.beginPath();
    ctx.arc(item.x, item.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(item.number), item.x, item.y + 0.5);
  } else if (item.type === 'text') {
    ctx.font = `600 ${Math.max(14, item.width * 4)}px "Microsoft YaHei UI", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.restore();
}

function drawMosaicToContext(ctx, item) {
  const cell = 8;
  const startX = Math.floor(Math.min(item.x, item.x + item.w) / cell) * cell;
  const startY = Math.floor(Math.min(item.y, item.y + item.h) / cell) * cell;
  const endX = Math.ceil(Math.max(item.x, item.x + item.w) / cell) * cell;
  const endY = Math.ceil(Math.max(item.y, item.y + item.h) / cell) * cell;
  const dpr = window.devicePixelRatio || 1;
  for (let y = startY; y < endY; y += cell) {
    for (let x = startX; x < endX; x += cell) {
      const pixel = screenCtx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      ctx.fillStyle = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

async function finish(action = 'copy') {
  const output = compositeSelection();
  if (!output) {
    showAction('请先拖拽选择一个区域', 'error');
    return;
  }
  const dataUrl = output.toDataURL('image/png');
  try {
    const result = await window.suira.capture.finish({ dataUrl, action });
    if (result && !result.ok && !result.canceled) showAction(result.error || '截图处理失败', 'error');
  } catch (error) {
    showAction(error.message || '截图处理失败', 'error');
  }
}

function cancel() {
  window.suira.capture.cancel();
}

/* ---------- OCR ---------- */

const ocrResult = $('#ocr-result');
const ocrText = $('#ocr-result-text');

function closeOcrResult() {
  ocrResult.hidden = true;
  state.ocrItemId = '';
}

async function startOcr() {
  const output = compositeSelection();
  if (!output) {
    showAction('请先拖拽选择一个区域', 'error');
    return;
  }
  ocrResult.hidden = false;
  ocrText.value = '';
  ocrText.placeholder = '正在准备本地识别…';
  try {
    const dataUrl = output.toDataURL('image/png');
    const result = await window.suira.capture.finish({ dataUrl, action: 'ocr' });
    if (!result?.ok) throw new Error(result?.error || '识别失败');
    state.ocrItemId = result.item?.id || result.output?.id || '';
    const text = result.output?.text || '';
    ocrText.value = text;
    ocrText.placeholder = text ? '' : '没有识别到文字，可以重新框选或换一张更清晰的图片';
    showAction(text ? '识别完成' : '没有识别到文字');
    ocrText.focus();
    ocrText.select();
  } catch (error) {
    ocrText.placeholder = error.message || '识别失败';
    showAction(error.message || '识别失败', 'error');
  }
}

function beginDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest('.tool-dock, .capture-hint, .text-editor, .color-popover, .ocr-result')) return;
  if (event.target.closest('.handle')) return;
  const p = point(event);
  if (hasSelection() && state.mode === 'annotate') {
    startAnnotation(event, p);
    return;
  }
  if (hasSelection() && event.target.closest('.selection')) {
    startMove(event);
    return;
  }
  state.mode = 'select';
  state.selection = null;
  state.annotations = [];
  state.redoStack = [];
  renderSelection();
  renderAnnotations();
  state.drawing = { type: 'select', start: p, current: p };
  updateSelectionPreview(p);
}

function updateSelectionPreview(p) {
  if (!state.drawing || state.drawing.type !== 'select') return;
  const selection = normSelection(state.drawing.start, p);
  state.selection = selection.w >= 2 && selection.h >= 2 ? selection : null;
  if (state.selection) renderSelection();
  drawMagnifier(p);
}

function startMove(event) {
  const p = point(event);
  state.drawing = {
    type: 'move',
    start: p,
    origin: { ...state.selection },
    handle: event.target.dataset.handle || ''
  };
  root.style.cursor = event.target.dataset.handle ? `${event.target.dataset.handle}-resize` : 'move';
  magnifier.hidden = true;
}

function startAnnotation(event, p) {
  if (!state.selection) return;
  const s = state.selection;
  if (state.tool === 'text') {
    if (p.x < s.x || p.x > s.x + s.w || p.y < s.y || p.y > s.y + s.h) return;
    state.textAnchor = p;
    textEditor.hidden = false;
    textEditor.style.left = `${clamp(p.x, 8, root.clientWidth - 270)}px`;
    textEditor.style.top = `${clamp(p.y, 8, root.clientHeight - 120)}px`;
    textInput.value = '';
    textInput.focus();
    return;
  }
  if (p.x < s.x || p.x > s.x + s.w || p.y < s.y || p.y > s.y + s.h) return;
  if (state.tool === 'steps') {
    state.steps += 1;
    addAnnotation({ type: 'steps', x: p.x, y: p.y, number: state.steps, color: state.color, width: 2 });
    return;
  }
  if (state.tool === 'mosaic') {
    state.drawing = { type: 'mosaic', start: p, current: p, color: state.color, width: state.lineWidth };
  } else if (state.tool === 'pen') {
    state.drawing = { type: 'pen', points: [p], color: state.color, width: state.lineWidth };
  } else if (state.tool === 'rect') {
    state.drawing = { type: 'rect', start: p, current: p, color: state.color, width: state.lineWidth };
  } else if (state.tool === 'arrow') {
    state.drawing = { type: 'arrow', start: p, current: p, color: state.color, width: state.lineWidth };
  }
}

function updateMove(p) {
  if (!state.drawing || state.drawing.type !== 'move') return;
  const d = state.drawing;
  const dx = p.x - d.start.x;
  const dy = p.y - d.start.y;
  const o = d.origin;
  if (d.handle) {
    let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
    if (d.handle.includes('w')) left = clamp(left + dx, 0, right - 2);
    if (d.handle.includes('e')) right = clamp(right + dx, left + 2, root.clientWidth);
    if (d.handle.includes('n')) top = clamp(top + dy, 0, bottom - 2);
    if (d.handle.includes('s')) bottom = clamp(bottom + dy, top + 2, root.clientHeight);
    state.selection = { x: left, y: top, w: right - left, h: bottom - top };
  } else {
    state.selection = {
      x: clamp(o.x + dx, 0, root.clientWidth - o.w),
      y: clamp(o.y + dy, 0, root.clientHeight - o.h),
      w: o.w,
      h: o.h
    };
  }
  renderSelection();
}

function updateAnnotation(p) {
  if (!state.drawing) return;
  if (state.drawing.type === 'pen') {
    state.drawing.points.push(p);
    renderAnnotations();
  } else if (['rect', 'arrow', 'mosaic'].includes(state.drawing.type)) {
    state.drawing.current = p;
    const preview = { ...state.drawing, x: state.drawing.start.x, y: state.drawing.start.y, w: p.x - state.drawing.start.x, h: p.y - state.drawing.start.y };
    if (state.drawing.type === 'arrow') preview.from = state.drawing.start, preview.to = p;
    renderAnnotationsWithPreview(preview);
  }
}

function renderAnnotationsWithPreview(preview) {
  const width = root.clientWidth;
  const height = root.clientHeight;
  annotationCtx.clearRect(0, 0, width, height);
  for (const item of state.annotations) drawAnnotation(item);
  drawAnnotation(preview);
}

function endAnnotation() {
  if (!state.drawing) return;
  const d = state.drawing;
  if (d.type === 'pen') {
    if (d.points.length > 1) addAnnotation(d);
  } else if (d.type === 'rect') {
    const rect = { ...d, x: d.start.x, y: d.start.y, w: d.current.x - d.start.x, h: d.current.y - d.start.y };
    if (Math.abs(rect.w) > 2 && Math.abs(rect.h) > 2) addAnnotation(rect);
  } else if (d.type === 'arrow') {
    if (Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y) > 4) {
      addAnnotation({ type: 'arrow', from: d.start, to: d.current, color: d.color, width: d.width });
    }
  } else if (d.type === 'mosaic') {
    const rect = { type: 'mosaic', x: d.start.x, y: d.start.y, w: d.current.x - d.start.x, h: d.current.y - d.start.y, color: d.color, width: d.width };
    if (Math.abs(rect.w) > 4 && Math.abs(rect.h) > 4) addAnnotation(rect);
  }
  state.drawing = null;
  renderAnnotations();
}

function confirmText() {
  const text = textInput.value.trim();
  if (text && state.textAnchor) {
    addAnnotation({ type: 'text', x: state.textAnchor.x, y: state.textAnchor.y, text, color: state.color, width: 4 });
  }
  textEditor.hidden = true;
  state.textAnchor = null;
  textInput.blur();
}

function setupEvents() {
  root.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, textarea, .text-editor, .color-popover')) return;
    if (event.target.closest('.handle')) {
      startMove(event);
      return;
    }
    beginDrag(event);
    if (state.drawing && ['pen', 'rect', 'arrow', 'mosaic'].includes(state.drawing.type)) {
      annotationCanvas.setPointerCapture?.(event.pointerId);
    }
  });

  root.addEventListener('pointermove', (event) => {
    const p = point(event);
    if (state.drawing?.type === 'select') {
      updateSelectionPreview(p);
    } else if (state.drawing?.type === 'move') {
      updateMove(p);
    } else if (state.drawing?.type && ['pen', 'rect', 'arrow', 'mosaic'].includes(state.drawing.type)) {
      updateAnnotation(p);
    } else if (!hasSelection()) {
      drawMagnifier(p);
    }
  });

  root.addEventListener('pointerup', (event) => {
    if (state.drawing?.type === 'select') {
      if (state.selection && state.selection.w >= 4 && state.selection.h >= 4) {
        setTool('pen');
        renderSelection();
        // 从面板带意图进来的（O 提字 / P 钉图）在这里自动推进，
        // 用户框完就出结果，不必再点工具栏
        autoAdvanceForIntent();
      } else {
        state.selection = null;
        renderSelection();
      }
      state.drawing = null;
      magnifier.hidden = true;
    } else if (state.drawing?.type === 'move') {
      state.drawing = null;
      root.style.cursor = '';
      renderSelection();
    } else {
      endAnnotation();
    }
  });

  root.addEventListener('pointerleave', () => {
    if (!state.drawing) magnifier.hidden = true;
  });

  $$('.tool-button[data-tool]').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });

  // 工具栏里所有带 data-action 的按钮都要绑定。
  // 之前选择器写成 .tool-button[data-action]，而「识」（.token-button）和
  // 「完成」（.complete-button）不是这个类，两个最关键的按钮点了没反应。
  $$('[data-action]', toolDock).forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'undo') undo();
      else if (action === 'cancel') cancel();
      else if (action === 'save') finish('save');
      else if (action === 'pin') finish('pin');
      else if (action === 'copy') finish('copy');
      else if (action === 'ocr') startOcr();
    });
  });

  $('#color-popover').addEventListener('click', (event) => {
    const button = event.target.closest('[data-color]');
    if (button) setColor(button.dataset.color);
  });

  $('#ocr-result-close').addEventListener('click', closeOcrResult);
  $('#ocr-result-retry').addEventListener('click', () => { ocrResult.hidden = true; state.intentAutoDone = false; startOcr(); });
  $('#ocr-result-original').addEventListener('click', () => {
    // 「查看原图」看的是框选区域未加标注的原始画面。
    // 之前这里没有按钮、也没有渲染目标，点了只会报错。
    const output = compositeSelection({ withoutAnnotations: true });
    if (!output) { showAction('请先拖拽选择一个区域', 'error'); return; }
    const viewer = $('#original-viewer');
    $('#original-image').src = output.toDataURL('image/png');
    viewer.hidden = false;
  });
  $('#original-close').addEventListener('click', () => { $('#original-viewer').hidden = true; });
  $('#original-viewer').addEventListener('click', (event) => {
    if (event.target === $('#original-viewer')) $('#original-viewer').hidden = true;
  });
  $('#ocr-result-copy').addEventListener('click', async () => {
    const text = ocrText.value.trim();
    if (!text) { showAction('没有可复制的文字', 'error'); return; }
    try {
      const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
      if (!saved?.ok) throw new Error(saved?.error || '保存失败');
      const result = await window.suira.actions.run(saved.item.id, 'output.copy');
      if (!result?.ok) throw new Error(result?.error || '复制失败');
      showAction('识别文字已复制');
      closeOcrResult();
      window.suira.capture.cancel();
    } catch (error) {
      showAction(error.message || '复制失败', 'error');
    }
  });
  $('#ocr-result-shelf').addEventListener('click', async () => {
    const text = ocrText.value.trim();
    if (!text) { showAction('没有可加入的文字', 'error'); return; }
    try {
      const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
      if (!saved?.ok) throw new Error(saved?.error || '保存失败');
      const result = await window.suira.actions.run(saved.item.id, 'output.shelf');
      if (!result?.ok) throw new Error(result?.error || '加入失败');
      showAction('已加入任务匣');
      closeOcrResult();
    } catch (error) {
      showAction(error.message || '加入失败', 'error');
    }
  });

  $('.color-trigger').addEventListener('click', (event) => {
    event.stopPropagation();
    colorPopover.hidden = !colorPopover.hidden;
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.color-control')) colorPopover.hidden = true;
  });

  $('#text-confirm').addEventListener('click', confirmText);
  $('#text-cancel').addEventListener('click', () => {
    textEditor.hidden = true;
    state.textAnchor = null;
  });
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      textEditor.hidden = true;
      state.textAnchor = null;
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      confirmText();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!textEditor.hidden) return;
    if (!ocrResult.hidden && event.target === ocrText) {
      if (event.key === 'Escape') { event.preventDefault(); closeOcrResult(); }
      return;
    }
    // 焦点在文本框里时，键盘属于文本输入：Ctrl+A 必须是「全选文字」，
    // 不能变成「选中整个屏幕区域」。之前这里没判断焦点，导致在文字
    // 编辑器里按 Ctrl+A 会把选区重置为全屏，输入内容也一起丢失。
    const target = event.target;
    const isTextInput = target instanceof HTMLElement
      && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
    if (isTextInput) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!ocrResult.hidden) {
        closeOcrResult();
      } else if (hasSelection() && state.mode === 'annotate') {
        setTool('select');
      } else {
        cancel();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      finish('copy');
      return;
    }
    if (event.ctrlKey && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (event.ctrlKey && key === 'a') {
      event.preventDefault();
      state.selection = { x: 0, y: 0, w: root.clientWidth, h: root.clientHeight };
      state.annotations = [];
      state.redoStack = [];
      renderSelection();
      renderAnnotations();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      undo();
      return;
    }
    const shortcuts = { a: 'select', p: 'pen', r: 'rect', l: 'arrow', t: 'text', m: 'mosaic', n: 'steps' };
    if (shortcuts[key] && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setTool(shortcuts[key]);
    }
  });

  window.addEventListener('resize', () => {
    resizeCanvases();
    if (state.selection) {
      state.selection = {
        x: clamp(state.selection.x, 0, root.clientWidth - 2),
        y: clamp(state.selection.y, 0, root.clientHeight - 2),
        w: clamp(state.selection.w, 2, root.clientWidth),
        h: clamp(state.selection.h, 2, root.clientHeight)
      };
      renderSelection();
    }
  });
}

/**
 * 把多屏分块合成为一整幅画面。
 * 各屏 DPI 不同，主进程已按统一缩放比缩放到目标像素，这里只负责按偏移绘制。
 */
function composeTiles(tiles, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return Promise.all(tiles.map((tile) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, tile.x, tile.y, tile.width, tile.height); resolve(); };
    img.onerror = reject;
    img.src = tile.dataUrl;
  }))).then(() => canvas.toDataURL('image/png'));
}

async function loadCapture() {
  const payload = await window.suira.capture.getData();
  if (!payload) throw new Error('未获取到截图数据');
  state.payload = payload;
  state.scaleX = payload.scaleFactor || 1;
  state.scaleY = payload.scaleFactor || 1;

  // 多屏时需要先把分块拼成一整幅，再交给后续的选区与标注逻辑
  let sourceUrl = payload.dataUrl;
  if (Array.isArray(payload.tiles) && payload.tiles.length > 0) {
    sourceUrl = await composeTiles(payload.tiles, payload.tileSize.width, payload.tileSize.height);
  }

  const image = new Image();
  image.onload = () => {
    state.image = image;
    state.scaleX = image.width / Math.max(1, payload.size?.width || root.clientWidth);
    state.scaleY = image.height / Math.max(1, payload.size?.height || root.clientHeight);
    resizeCanvases();
    $('#loading-state').hidden = true;
    applyIntent(payload.intent);
  };
  image.onerror = () => {
    $('#loading-state').hidden = true;
    showAction('屏幕画面载入失败', 'error');
  };
  image.src = sourceUrl;
}

/**
 * 应用入口意图。
 *
 * 从 38 键面板按 O 进来（intent=ocr）时，框选完成后直接开始识别；
 * 按 P（intent=pin）时，框选完成后直接钉图。这样「面板 → 工具 → 完成」
 * 少一次重复点击，也保证按键语义与最终动作一致。
 */
function applyIntent(intent) {
  if (!intent || intent === 'copy' || intent === 'save' || intent === 'shelf') return;
  state.intent = intent;
  if (intent === 'ocr') {
    // 提示用户这一趟是要提字的，不必再找工具栏
    const brand = $('.hint-brand span');
    if (brand) brand.textContent = '截图提字';
    showAction('框选要识别的区域，完成后自动识别');
  } else if (intent === 'pin') {
    const brand = $('.hint-brand span');
    if (brand) brand.textContent = '截图钉图';
    showAction('框选要钉住的区域，完成后直接钉在桌面');
  }
}

/**
 * 框选结束（松开鼠标）后，按入口意图自动推进。
 * 只在第一次形成有效选区时触发，避免调整选区时反复执行。
 */
function autoAdvanceForIntent() {
  if (state.intentAutoDone || !state.intent) return;
  if (!hasSelection()) return;
  state.intentAutoDone = true;
  const intent = state.intent;
  if (intent === 'ocr') startOcr();
  else if (intent === 'pin') finish('pin');
}

setupEvents();
loadCapture().catch((error) => {
  $('#loading-state').hidden = true;
  showAction(error.message || '截图初始化失败', 'error');
});

