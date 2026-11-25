const themePaint = name => getComputedStyle(document.documentElement).getPropertyValue('--'+name).trim();
const { $, $$ } = (() => ({
  $: (selector, root = document) => root.querySelector(selector),
  $$: (selector, root = document) => Array.from(root.querySelectorAll(selector))
}))();

const root = $('#capture-root');
const editorMode = new URLSearchParams(location.search).get('mode') === 'image-editor';
const captureApi = editorMode ? window.suira.imageEditor : window.suira.capture;
const screenCanvas = $('#screen-canvas');
// 主画布只做 drawImage（放大镜、马赛克取样都走独立的小 canvas），
// 不要开「读写频繁」模式：那会把 canvas 钉死在软件渲染上，
// 4K / 高 DPI 下每帧整屏重绘会明显掉帧。
const screenCtx = screenCanvas.getContext('2d');
const annotationCanvas = $('#annotation-canvas');
const annotationCtx = annotationCanvas.getContext('2d');
const selectionEl = $('#selection');
// 选区外压暗的 4 块矩形（代替 100vmax box-shadow，见 overlay.css）
const dimEls = {
  top: $('#dim-top'),
  right: $('#dim-right'),
  bottom: $('#dim-bottom'),
  left: $('#dim-left')
};
const sizeBadge = $('#size-badge');
const toolDock = $('#tool-dock');
const hint = $('#capture-hint');
const hintBrand = $('.hint-brand span');
const magnifier = $('#magnifier');
const magnifierCanvas = $('#magnifier-canvas');
const magnifierCtx = magnifierCanvas.getContext('2d');
const magnifierCoords = $('#magnifier-coords');
const colorSampleCanvas=document.createElement('canvas');colorSampleCanvas.width=colorSampleCanvas.height=1;
const colorSampleCtx=colorSampleCanvas.getContext('2d',{willReadFrequently:true});let colorPoint=null;
function sampleColor(p){if(!state.image||!p)return null;const x=clamp(Math.round(p.x/metrics.width*state.image.width),0,state.image.width-1),y=clamp(Math.round(p.y/metrics.height*state.image.height),0,state.image.height-1);colorSampleCtx.clearRect(0,0,1,1);colorSampleCtx.drawImage(state.image,x,y,1,1,0,0,1,1);const rgb=[...colorSampleCtx.getImageData(0,0,1,1).data].slice(0,3),hex='#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();return {hex,rgb};}
const actionToast = $('#action-toast');
const textEditor = $('#text-editor');
const textInput = $('#text-input');
const colorDot = $('#color-dot');
const colorPopover = $('#color-popover');
const loadingState = $('#loading-state');
const originalViewer = $('#original-viewer');

const ANNOTATION_TYPES = ['pen', 'rect', 'arrow', 'mosaic'];

const state = {
  payload: null,
  image: null,
  scaleX: 1,
  scaleY: 1,
  selection: null,
  mode: 'select',
  tool: 'pen',
  color: themePaint('drawing-red'),
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
  intentAutoDone: false,
  // 选区状态机：拖动中（selecting=true）只显示提示条，松开形成有效选区后才显示工具栏
  selecting: false,
  selectionReady: false
};

/**
 * 视口 / 指针坐标系缓存。
 * 拖动时每帧重读覆盖层根节点的 getBoundingClientRect() / clientWidth 会强制同步布局，
 * 这里只在启动、窗口 resize 时刷新一次。
 */
const metrics = { left: 0, top: 0, width: 0, height: 0, dpr: 1 };

function refreshMetrics() {
  const rect = root.getBoundingClientRect();
  metrics.left = rect.left;
  metrics.top = rect.top;
  metrics.width = rect.width;
  metrics.height = rect.height;
  metrics.dpr = window.devicePixelRatio || 1;
}

/* 轻量计时埋点：供真机 E2E 读取，不输出到界面 */
let perf = { shownAt: 0, imageReadyAt: 0, firstPointerMs: 0, pointerMoves: 0, framesApplied: 0 };
window.__lastCapturePerf = perf;
// 每次唤起递增；旧的异步加载靠它判断自己是否已经过期
let showSeq = 0;
// 屏幕画面代数（马赛克取色调色板的失效依据）
let imageSerial = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function point(event) {
  return {
    x: clamp(event.clientX - metrics.left, 0, metrics.width),
    y: clamp(event.clientY - metrics.top, 0, metrics.height)
  };
}

function normSelection(a, b) {
  const left = clamp(Math.min(a.x, b.x), 0, metrics.width);
  const top = clamp(Math.min(a.y, b.y), 0, metrics.height);
  const right = clamp(Math.max(a.x, b.x), 0, metrics.width);
  const bottom = clamp(Math.max(a.y, b.y), 0, metrics.height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function normalizeSelection(selection) {
  if (!selection) return null;
  const x1 = clamp(Math.min(selection.x, selection.x + selection.w), 0, metrics.width);
  const y1 = clamp(Math.min(selection.y, selection.y + selection.h), 0, metrics.height);
  const x2 = clamp(Math.max(selection.x, selection.x + selection.w), 0, metrics.width);
  const y2 = clamp(Math.max(selection.y, selection.y + selection.h), 0, metrics.height);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/* ---------- 只在值变化时写 DOM，避免拖动期无意义的样式失效 ---------- */

function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setRootClass(name, enabled) {
  if (root.classList.contains(name) !== enabled) root.classList.toggle(name, enabled);
}

function setHintHidden(hidden) {
  if (hint.classList.contains('is-hidden') !== hidden) hint.classList.toggle('is-hidden', hidden);
}

function hasSelection() {
  const minimum = editorMode ? 1 : 2;
  return Boolean(state.selection && state.selection.w >= minimum && state.selection.h >= minimum);
}

/* 上一次真正写进 DOM 的值：值没变就不碰 DOM */
const lastSelectionBox = { x: NaN, y: NaN, w: NaN, h: NaN };
let lastSizeText = '';

/** 4 块压暗矩形的位置缓存：只在几何变化时写 style。 */
const lastDimBoxes = { top: {}, right: {}, bottom: {}, left: {} };

function setDimBox(name, x, y, w, h) {
  const el = dimEls[name];
  if (!el) return;
  const last = lastDimBoxes[name];
  if (last.x !== x) { el.style.left = `${x}px`; last.x = x; }
  if (last.y !== y) { el.style.top = `${y}px`; last.y = y; }
  if (last.w !== w) { el.style.width = `${w}px`; last.w = w; }
  if (last.h !== h) { el.style.height = `${h}px`; last.h = h; }
}

/**
 * 用 4 块矩形把选区外部压暗。
 * 每帧只改边缘条带的几何，比给选区元素 100vmax spread 的 box-shadow
 * （等于每帧重绘整个覆盖层）便宜得多。
 */
function renderDimming(s) {
  const width = metrics.width;
  const height = metrics.height;
  if (!width || !height) return;
  const left = clamp(s.x, 0, width);
  const top = clamp(s.y, 0, height);
  const right = clamp(s.x + s.w, 0, width);
  const bottom = clamp(s.y + s.h, 0, height);
  setDimBox('top', 0, 0, width, top);
  setDimBox('bottom', 0, bottom, width, height - bottom);
  setDimBox('left', 0, top, left, bottom - top);
  setDimBox('right', right, top, width - right, bottom - top);
}

function renderSelection() {
  if (!hasSelection()) {
    setHidden(selectionEl, true);
    setHidden(toolDock, true);
    setRootClass('has-selection', false);
    // 回到「拖动中 / 还没框选」：只留顶部提示条
    setHintHidden(false);
    return;
  }
  const s = state.selection;
  setHidden(selectionEl, false);
  // 只在几何变化时写 style：拖动合帧后每帧最多 4 次写法，值没变就跳过
  if (lastSelectionBox.x !== s.x) { selectionEl.style.left = `${s.x}px`; lastSelectionBox.x = s.x; }
  if (lastSelectionBox.y !== s.y) { selectionEl.style.top = `${s.y}px`; lastSelectionBox.y = s.y; }
  if (lastSelectionBox.w !== s.w) { selectionEl.style.width = `${s.w}px`; lastSelectionBox.w = s.w; }
  if (lastSelectionBox.h !== s.h) { selectionEl.style.height = `${s.h}px`; lastSelectionBox.h = s.h; }
  renderDimming(s);
  const physicalW = Math.max(1, Math.round(s.w * state.scaleX));
  const physicalH = Math.max(1, Math.round(s.h * state.scaleY));
  const sizeText = `${physicalW} × ${physicalH}`;
  if (lastSizeText !== sizeText) { sizeBadge.textContent = sizeText; lastSizeText = sizeText; }
  setRootClass('has-selection', true);
  // 任务 A：只有「松开鼠标形成有效选区」后（selectionReady）才出现编辑工具栏
  const showDock = state.selectionReady && !state.selecting;
  setHintHidden(showDock);
  if (!showDock) {
    setHidden(toolDock, true);
    return;
  }
  setHidden(toolDock, false);
  positionDock();
}

/* 工具栏尺寸惰性测量：首次显示时量一次，窗口 resize 时失效。
 * 拖动 / 移动过程中位置计算只用缓存值，不再读 offsetWidth 触发同步布局。 */
const dockMetrics = { width: 0, height: 0 };
const lastDock = { left: NaN, top: NaN };

function measureDock() {
  if (dockMetrics.width > 0 && dockMetrics.height > 0) return dockMetrics;
  const width = toolDock.offsetWidth;
  const height = toolDock.offsetHeight;
  if (width > 0 && height > 0) {
    dockMetrics.width = width;
    dockMetrics.height = height;
  }
  return dockMetrics;
}

function positionDock() {
  if (!hasSelection() || toolDock.hidden) return;
  if (editorMode) {
    measureDock();
    const left = clamp((metrics.width-dockMetrics.width)/2, 12-metrics.left, innerWidth-metrics.left-dockMetrics.width-12);
    toolDock.style.left = `${left}px`;
    toolDock.style.top = `${metrics.height+(document.body.classList.contains('editor-compact') ? 8 : 16)}px`;
    return;
  }
  const s = state.selection;
  const measured = measureDock();
  const dockWidth = Math.min(measured.width || 720, metrics.width - 24);
  const dockHeight = measured.height || 50;
  const gap = 12;
  let left = s.x + s.w - dockWidth;
  left = clamp(left, 12, metrics.width - dockWidth - 12);
  let top;
  if (s.y + s.h + gap + dockHeight < metrics.height - 10) {
    top = s.y + s.h + gap;
    state.dockSide = 'bottom';
  } else if (s.y - gap - dockHeight > 10) {
    top = s.y - gap - dockHeight;
    state.dockSide = 'top';
  } else {
    top = clamp(s.y + s.h - dockHeight - 8, 10, metrics.height - dockHeight - 10);
    state.dockSide = 'inside';
  }
  if (lastDock.left !== left) { toolDock.style.left = `${left}px`; lastDock.left = left; }
  if (lastDock.top !== top) { toolDock.style.top = `${top}px`; lastDock.top = top; }
}

function setSelection(selection, render = true) {
  state.selection = selection ? normalizeSelection(selection) : null;
  if (!hasSelection()) state.selection = null;
  if (render) renderSelection();
}

function clearSelection() {
  if (editorMode || !hasSelection() || state.drawing) return;
  dropPendingPointer();
  closeOcrResult();
  colorPopover.hidden = true;
  state.intentAutoDone = false;
  state.selection = null;
  state.selecting = false;
  state.selectionReady = false;
  state.annotations = [];
  state.redoStack = [];
  state.steps = 0;
  state.textAnchor = null;
  textEditor.hidden = true;
  textInput.value = '';
  document.activeElement?.blur();
  setTool('select');
  renderSelection();
  renderAnnotations();
  setMagnifierVisible(false);
}

/** Ctrl+A：把整个屏幕作为「已经完成的选区」，工具栏随之出现 */
function selectWholeScreen() {
  state.selecting = false;
  state.selectionReady = true;
  state.selection = { x: 0, y: 0, w: metrics.width, h: metrics.height };
  if (!editorMode) { state.annotations = [];state.redoStack = []; }
  renderSelection();
  renderAnnotations();
}

function showAction(message, type = '') {
  actionToast.textContent = message;
  if (type === 'copied') window.SuiraUI?.copyFeedback(actionToast);
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
  // 工具栏按钮的高亮 / 提示切换后重新贴合选区（尺寸用的是缓存值，不会触发布局）
  if (!toolDock.hidden) positionDock();
}

function setColor(color) {
  if(color.startsWith('drawing-')) color=themePaint(color);
  state.color = color;
  colorDot.style.background = color;
  colorPopover.hidden = true;
  renderAnnotations();
}

function resizeCanvases(force = false) {
  const width = metrics.width;
  const height = metrics.height;
  const dpr = metrics.dpr || 1;
  const pixelW = Math.max(1, Math.round(width * dpr));
  const pixelH = Math.max(1, Math.round(height * dpr));
  let resized = false;
  for (const canvas of [screenCanvas, annotationCanvas]) {
    // 尺寸没变就不动后备缓冲：避免无谓的清屏 + 重新分配
    if (canvas.width === pixelW && canvas.height === pixelH) continue;
    canvas.width = pixelW;
    canvas.height = pixelH;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    resized = true;
  }
  // 后备缓冲没重建时 transform 也保持不变；尺寸与画面都没变就不做整屏重绘，
  // 4K 下每次 drawImage 高质量缩放都是几十毫秒级的浪费。
  if (resized) {
    screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    annotationCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if (!resized && !force) return;
  if (state.image) drawScreen();
  renderAnnotations();
}

function drawScreen() {
  if (!state.image) return;
  const width = metrics.width;
  const height = metrics.height;
  screenCtx.clearRect(0, 0, width, height);
  screenCtx.imageSmoothingEnabled = true;
  screenCtx.imageSmoothingQuality = 'high';
  screenCtx.drawImage(state.image, 0, 0, width, height);
}

/* 放大镜显隐 / 位置 / 坐标文本都只在值变化时写 DOM */
const lastMagnifierPos = { left: NaN, top: NaN };
const lastMagnifierPx = { x: NaN, y: NaN };
let magnifierBox = null;

function setMagnifierVisible(visible) {
  if (magnifier.hidden !== !visible) magnifier.hidden = !visible;
  // 放大镜不可见时不要再留着旧采样点：否则在工具栏或窗口外按取色键，
  // 会悄悄复制上一次画面位置的颜色，用户完全看不出取的是哪里。
  if (!visible) colorPoint = null;
}

/* 放大镜每帧都要用 3 个主题色。getComputedStyle 会强制刷新挂起的样式计算，
   放在指针热路径上很贵；主题只在每次唤起覆盖层时可能变化，缓存一次即可。 */
let magnifierPaints = null;
function magnifierTheme() {
  if (!magnifierPaints) magnifierPaints = {
    surface: themePaint('magnifier-surface'),
    crosshair: themePaint('magnifier-crosshair'),
    outline: themePaint('magnifier-center-outline')
  };
  return magnifierPaints;
}

/* 贴边避让用真实盒子尺寸：信息框行数、主题字号变化后也不会溢出屏幕。
   隐藏时读不到尺寸，所以只在显示之后量一次，resize / 重置时让缓存失效。 */
function measureMagnifier() {
  if (magnifierBox) return magnifierBox;
  const rect = magnifier.getBoundingClientRect();
  magnifierBox = { width: rect.width || 194, height: rect.height || 292 };
  return magnifierBox;
}

function drawMagnifier(p) {
  if (!state.image || !state.payload) return;
  setMagnifierVisible(true);
  // 21 源像素放大到 176px（约 8 倍）：既看得清目标像素，也能认出周围画面，和微信取色一致。
  const sampleSize = 21;
  const half = Math.floor(sampleSize / 2);
  // 量化到源图像素：源像素没变就不重绘放大镜，坐标文本也一起跳过
  const srcX = clamp(Math.round((p.x / metrics.width) * state.image.width), 0, state.image.width - 1);
  const srcY = clamp(Math.round((p.y / metrics.height) * state.image.height), 0, state.image.height - 1);
  if (srcX !== lastMagnifierPx.x || srcY !== lastMagnifierPx.y) {
    lastMagnifierPx.x = srcX;
    lastMagnifierPx.y = srcY;
    magnifierCtx.imageSmoothingEnabled = false;
    magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
    const paints = magnifierTheme();
    magnifierCtx.fillStyle = paints.surface;
    magnifierCtx.fillRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
    // 只绘制图像内的取样窗，并让中心像素始终落在画布中心。
    // 直接给 drawImage 传越界的源矩形，浏览器会按比例裁剪目标矩形，
    // 屏幕边缘时放大画面会整体偏移，十字线就指错像素了。
    const scale = magnifierCanvas.width / sampleSize;
    const srcLeft = srcX - half, srcTop = srcY - half;
    const sx = Math.max(0, srcLeft), sy = Math.max(0, srcTop);
    const ex = Math.min(state.image.width, srcLeft + sampleSize);
    const ey = Math.min(state.image.height, srcTop + sampleSize);
    if (ex > sx && ey > sy) {
      magnifierCtx.drawImage(
        state.image, sx, sy, ex - sx, ey - sy,
        (sx - srcLeft) * scale, (sy - srcTop) * scale,
        (ex - sx) * scale, (ey - sy) * scale
      );
    }
    // 微信式绿色十字线贯穿画面，中心小框标出正在取的那一像素；深色描边保证浅色画面上也看得见。
    const crosshair = paints.crosshair;
    const center = magnifierCanvas.width / 2, pixel = magnifierCanvas.width / sampleSize;
    magnifierCtx.strokeStyle = crosshair;
    magnifierCtx.lineWidth = 1;
    magnifierCtx.beginPath();
    magnifierCtx.moveTo(center + .5, 0); magnifierCtx.lineTo(center + .5, magnifierCanvas.height);
    magnifierCtx.moveTo(0, center + .5); magnifierCtx.lineTo(magnifierCanvas.width, center + .5);
    magnifierCtx.stroke();
    magnifierCtx.strokeStyle = paints.outline;
    magnifierCtx.strokeRect(center - pixel / 2 - 1, center - pixel / 2 - 1, pixel + 2, pixel + 2);
    magnifierCtx.strokeStyle = crosshair;
    magnifierCtx.strokeRect(center - pixel / 2, center - pixel / 2, pixel, pixel);
    const coords = `${srcX}, ${srcY}`;
    if (magnifierCoords.textContent !== coords) magnifierCoords.textContent = coords;
    const sampled=sampleColor(p);
    if(sampled){
      $('#magnifier-color').textContent=sampled.hex;
      $('#magnifier-rgb').textContent=sampled.rgb.join(', ');
    }
  }

  const box = measureMagnifier();
  const offset = 20, edge = 8;
  let left = p.x + offset;
  let top = p.y + offset;
  if (left + box.width > metrics.width - edge) left = p.x - box.width - offset;
  if (top + box.height > metrics.height - edge) top = p.y - box.height - offset;
  left = clamp(left, edge, Math.max(edge, metrics.width - box.width - edge));
  top = clamp(top, edge, Math.max(edge, metrics.height - box.height - edge));
  if (lastMagnifierPos.left !== left) { magnifier.style.left = `${left}px`; lastMagnifierPos.left = left; }
  if (lastMagnifierPos.top !== top) { magnifier.style.top = `${top}px`; lastMagnifierPos.top = top; }
}

/* 拖拽时每帧重画全部历史标注（画笔所有点、马赛克几万格）是最重的热路径。
   已提交的标注缓存进一张离屏画布，拖拽帧只 blit 一次 + 画进行中的那一个对象。
   离屏画布按需分配，拖拽结束立刻归零，不增加常驻内存。 */
const historyCanvas = document.createElement('canvas');
const historyCtx = historyCanvas.getContext('2d');
let historyItems = [];
let historyKey = '';

function releaseHistoryLayer() {
  if (historyCanvas.width || historyCanvas.height) historyCanvas.width = historyCanvas.height = 0;
  historyItems = [];
  historyKey = '';
}

function drawHistoryLayer() {
  const dpr = metrics.dpr || 1;
  const pixelW = Math.max(1, Math.round(metrics.width * dpr));
  const pixelH = Math.max(1, Math.round(metrics.height * dpr));
  const key = `${pixelW}x${pixelH}:${imageSerial}`;
  const resized = historyCanvas.width !== pixelW || historyCanvas.height !== pixelH;
  if (resized) { historyCanvas.width = pixelW; historyCanvas.height = pixelH; }
  // 只比较对象引用：状态变化（增/删/撤销/换画面）都能被发现，成本远低于重绘
  let same = !resized && key === historyKey && historyItems.length === state.annotations.length;
  if (same) for (let i = 0; i < historyItems.length; i += 1) {
    if (historyItems[i] !== state.annotations[i]) { same = false; break; }
  }
  if (!same) {
    historyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    historyCtx.clearRect(0, 0, metrics.width, metrics.height);
    historyCtx.lineCap = 'round';
    historyCtx.lineJoin = 'round';
    for (const item of state.annotations) drawAnnotation(item, historyCtx);
    historyItems = state.annotations.slice();
    historyKey = key;
  }
  annotationCtx.clearRect(0, 0, metrics.width, metrics.height);
  annotationCtx.lineCap = 'round';
  annotationCtx.lineJoin = 'round';
  annotationCtx.drawImage(historyCanvas, 0, 0, metrics.width, metrics.height);
}

function renderAnnotations() {
  const width = metrics.width;
  const height = metrics.height;
  const annotating = state.drawing && ANNOTATION_TYPES.includes(state.drawing.type);
  if (!annotating) {
    releaseHistoryLayer();
    annotationCtx.clearRect(0, 0, width, height);
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';
    for (const item of state.annotations) drawAnnotation(item);
    if (state.drawing) drawAnnotation(state.drawing);
    return;
  }
  drawHistoryLayer();
  drawAnnotation(state.drawing);
}

function drawAnnotation(item, ctx = annotationCtx) {
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
    if (item.from && item.to) drawArrow(ctx, item.from, item.to, item.width, item.unit || 1);
  } else if (item.type === 'mosaic') {
    drawMosaic(item, ctx);
  } else if (item.type === 'steps') {
    const radius = 14 * (item.unit || 1);
    ctx.beginPath();
    ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = themePaint('drawing-white');
    ctx.font = `600 ${14 * (item.unit || 1)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(item.number), item.x, item.y + 0.5);
  } else if (item.type === 'text') {
    ctx.font = `600 ${Math.max(14 * (item.unit || 1), item.width * 4)}px "Microsoft YaHei UI", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.restore();
}

function drawArrow(ctx, from, to, width, unit = 1) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(12 * unit, width * 4);
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

/**
 * 马赛克取色。
 *
 * 旧实现每个 8px 色块都从主 canvas 读回一次像素（大选区时几百次读回/帧），
 * 既拖慢马赛克拖动，也逼着主 canvas 必须开「读写频繁」软件模式。
 * 现在把整幅屏幕画面缩成 8px 网格的小调色板，只在画面 / 视口变化时读一次，
 * 拖动过程中纯查表，主 canvas 保持 GPU 加速。
 */
const MOSAIC_CELL = 8;
const mosaicPalette = document.createElement('canvas');
const mosaicPaletteCtx = mosaicPalette.getContext('2d');
let mosaicPaletteKey = '';
let mosaicPaletteData = null;
let mosaicPaletteColors = null;

function ensureMosaicPalette() {
  if (!state.image) return false;
  const key = `${imageSerial}:${Math.round(metrics.width)}x${Math.round(metrics.height)}`;
  if (key === mosaicPaletteKey && mosaicPaletteData) return true;
  const cols = Math.max(1, Math.ceil(metrics.width / MOSAIC_CELL));
  const rows = Math.max(1, Math.ceil(metrics.height / MOSAIC_CELL));
  mosaicPalette.width = cols;
  mosaicPalette.height = rows;
  mosaicPaletteCtx.imageSmoothingEnabled = true;
  mosaicPaletteCtx.clearRect(0, 0, cols, rows);
  mosaicPaletteCtx.drawImage(state.image, 0, 0, cols, rows);
  mosaicPaletteData = mosaicPaletteCtx.getImageData(0, 0, cols, rows).data;
  mosaicPaletteColors = null; // 颜色字符串按首次需要时懒生成一次
  mosaicPaletteKey = key;
  return true;
}

function mosaicColorAt(cssX, cssY) {
  const cols = mosaicPalette.width;
  const rows = mosaicPalette.height;
  const px = clamp(Math.floor(cssX / MOSAIC_CELL), 0, cols - 1);
  const py = clamp(Math.floor(cssY / MOSAIC_CELL), 0, rows - 1);
  const cell = py * cols + px;
  if (!mosaicPaletteColors) {
    // 全屏马赛克一帧要铺几万格：颜色字符串与 CSS 颜色解析不能每格重做一遍。
    const data = mosaicPaletteData;
    mosaicPaletteColors = new Array(cols * rows);
    for (let index = 0; index < cols * rows; index += 1) {
      const at = index * 4;
      mosaicPaletteColors[index] = `rgb(${data[at]},${data[at + 1]},${data[at + 2]})`;
    }
  }
  return mosaicPaletteColors[cell];
}

function drawMosaicCells(target, item) {
  if (!ensureMosaicPalette()) return;
  const cell = MOSAIC_CELL;
  const startX = Math.floor(Math.min(item.x, item.x + item.w) / cell) * cell;
  const startY = Math.floor(Math.min(item.y, item.y + item.h) / cell) * cell;
  const endX = Math.ceil(Math.max(item.x, item.x + item.w) / cell) * cell;
  const endY = Math.ceil(Math.max(item.y, item.y + item.h) / cell) * cell;
  for (let y = startY; y < endY; y += cell) {
    for (let x = startX; x < endX; x += cell) {
      target.fillStyle = mosaicColorAt(x, y);
      target.fillRect(x, y, cell, cell);
    }
  }
}

function drawMosaic(item, target = annotationCtx) {
  drawMosaicCells(target, item);
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
  const tile=state.rawTiles?.find(t=>s.x>=t.x&&s.y>=t.y&&s.x+s.w<=t.x+t.width+.01&&s.y+s.h<=t.y+t.height+.01);
  const image=tile?.image||state.image, x=tile?s.x-tile.x:s.x,y=tile?s.y-tile.y:s.y;
  const width=tile?.width||metrics.width,height=tile?.height||metrics.height;
  // 对齐源图像素边界；drawImage 的源、目标尺寸相同，避免分数坐标插值模糊文字。
  const sx=Math.max(0,Math.round(x/width*image.width)),sy=Math.max(0,Math.round(y/height*image.height));
  const right=Math.min(image.width,Math.round((x+s.w)/width*image.width)),bottom=Math.min(image.height,Math.round((y+s.h)/height*image.height));
  const sw=Math.max(1,right-sx),sh=Math.max(1,bottom-sy);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(sw));
  output.height = Math.max(1, Math.round(sh));
  const ctx = output.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, output.width, output.height);
  if (options.withoutAnnotations) return output;

  for (const item of state.annotations) {
    if (!annotationIntersectsSelection(item)) continue;
    ctx.save();
    ctx.scale(output.width / s.w, output.height / s.h);
    ctx.translate(-s.x, -s.y);
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
    const r = 16 * (item.unit || 1);
    box = { x: item.x - r, y: item.y - r, w: r * 2, h: r * 2 };
  } else if (item.type === 'text') {
    box = { x: item.x, y: item.y, w: item.text.length * 16 * (item.unit || 1), h: 28 * (item.unit || 1) };
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
    drawArrow(ctx, item.from, item.to, item.width, item.unit || 1);
  } else if (item.type === 'mosaic') {
    drawMosaicToContext(ctx, item);
  } else if (item.type === 'steps') {
    ctx.beginPath();
    ctx.arc(item.x, item.y, 14 * (item.unit || 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = themePaint('drawing-white');
    ctx.font = `600 ${14 * (item.unit || 1)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(item.number), item.x, item.y + 0.5);
  } else if (item.type === 'text') {
    ctx.font = `600 ${Math.max(14 * (item.unit || 1), item.width * 4)}px "Microsoft YaHei UI", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.restore();
}

function drawMosaicToContext(ctx, item) {
  drawMosaicCells(ctx, item);
}

/** 关闭「查看原图」时同时丢掉整张 PNG data URI 与解码位图（近全屏约 33MB）。 */
function closeOriginalViewer() {
  $('#original-viewer').hidden = true;
  $('#original-image').removeAttribute('src');
}

/** 临时合成画布一旦编码成 dataUrl 就立刻归还后备存储，不要跨 IPC 常驻。 */
function dataUrlOfSelection(options) {
  const output = compositeSelection(options);
  if (!output) return null;
  const dataUrl = output.toDataURL('image/png');
  output.width = output.height = 0;
  return dataUrl;
}

async function finish(action = 'copy') {
  let dataUrl = dataUrlOfSelection();
  if (!dataUrl) {
    showAction('请先拖拽选择一个区域', 'error');
    return;
  }
  const seq = showSeq;
  try {
    const result = await captureApi.finish({ dataUrl, action });
    dataUrl = null;
    // 等待期间窗口可能已被收起并释放：迟到的结果不能再往旧 DOM 上弹提示
    if (seq !== showSeq) return;
    if (result?.canceled) showAction('已取消保存，可继续编辑或按 Esc 退出');
    else if (result && !result.ok) showAction(result.error || '截图处理失败', 'error');
    if (editorMode && result?.ok) window.SuiraEditorUI.report(result.message || '图片已处理');
  } catch (error) {
    if (seq === showSeq) showAction(error.message || '截图处理失败', 'error');
  }
}

function cancel() {
  captureApi.cancel();
}

let longStarting=false;
async function startLongSelection() {
  if(editorMode||longStarting)return;
  if(!hasSelection()){showAction('请先框选滚动区域','error');return;}
  longStarting=true;
  const seq=showSeq;
  try {
    const s=state.selection;
    const result=await window.suira.longCapture.start({x:s.x,y:s.y,width:s.w,height:s.h});
    if(seq===showSeq&&!result?.ok)showAction(result?.error||'无法开始长截图','error');
  }catch(error){if(seq===showSeq)showAction(error.message||'无法开始长截图','error');}
  finally{longStarting=false;}
}

/* ---------- OCR ---------- */

const ocrResult = $('#ocr-result');
const ocrText = $('#ocr-result-text');
const translationText = $('#ocr-translation-text');
let ocrRevision = 0, ocrBusy = false, translationCurrent = false;

function updateOcrButtons() {
  const hasText = Boolean(ocrText.value.trim());
  $('#ocr-result-copy').disabled = $('#ocr-result-shelf').disabled = !hasText;
  $('#ocr-result-translate').disabled = ocrBusy || !hasText;
  $('#ocr-translation-copy').disabled = $('#ocr-translation-paste').disabled = !translationCurrent || !translationText.value.trim();
}
function resetTranslation() {
  ++ocrRevision;
  ocrBusy = false;
  translationCurrent = false;
  translationText.value = '';
  $('#ocr-configure').hidden = true;
  $('#ocr-status').textContent = '';
  $('#ocr-languages').textContent = '自动 → ' + (SuiraTranslateLanguage.defaultTarget(ocrText.value) === 'en' ? '英文' : '中文');
  updateOcrButtons();
}
function closeOcrResult() {
  resetTranslation();
  ocrResult.hidden = true;
  state.ocrItemId = '';
}
function layoutOcrResult() {
  const width = Math.min(880, Math.max(320, state.selection?.w || 320), window.innerWidth - 48);
  ocrResult.style.width = width + 'px';
  ocrResult.classList.toggle('is-stacked', width < 600);
}
async function startOcr() {
  const dataUrl = dataUrlOfSelection();
  if (!dataUrl) { showAction('请先拖拽选择一个区域', 'error'); return null; }
  ocrText.value = '';ocrResult.dataset.qrUrl='';
  resetTranslation();
  const token = ocrRevision;
  ocrBusy = true;
  updateOcrButtons();
  ocrResult.hidden = false;
  layoutOcrResult();
  ocrText.placeholder = '正在准备本地识别…';
  $('#ocr-status').textContent = '正在识别…';
  try {
    const result = await captureApi.finish({ dataUrl, action: 'ocr' });
    if (token !== ocrRevision) return null;
    if (!result?.ok) throw new Error(result?.error || '识别失败');
    state.ocrItemId = result.item?.id || result.output?.id || '';
    ocrResult.dataset.qrUrl=result.qr?.url||result.output?.meta?.qrUrl||'';
    const text = SuiraTextSpacing.compactCapture(result.output?.text || '');
    ocrText.value = text;
    ocrText.placeholder = text ? '' : '没有识别到文字，可以重新框选或换一张更清晰的图片';
    $('#ocr-languages').textContent = '自动 → ' + (SuiraTranslateLanguage.defaultTarget(text) === 'en' ? '英文' : '中文');
    $('#ocr-status').textContent = text ? '识别完成' : '没有识别到文字';
    ocrText.focus();
    ocrText.select();
    return text;
  } catch (error) {
    if (token === ocrRevision) {
      ocrText.placeholder = error.message || '识别失败';
      $('#ocr-status').textContent = error.message || '识别失败';
      showAction(error.message || '识别失败', 'error');
    }
    return null;
  } finally {
    if (token === ocrRevision) { ocrBusy = false; updateOcrButtons(); }
  }
}
async function startTranslate() {
  if (ocrResult.hidden || !ocrText.value.trim()) {
    const text = await startOcr();
    if (!text?.trim()) return;
  }
  const text = ocrText.value, target = SuiraTranslateLanguage.defaultTarget(text);
  resetTranslation();
  const token = ocrRevision;
  ocrBusy = true;
  updateOcrButtons();
  $('#ocr-status').textContent = '正在翻译…';
  try {
    const status = await window.suira.translate.status();
    if (token !== ocrRevision) return;
    if (!status.configured) {
      $('#ocr-status').textContent = '还没有设置翻译服务';
      $('#ocr-configure').hidden = false;
      return;
    }
    const result = await window.suira.translate.run({ text, source: 'auto', target });
    if (token !== ocrRevision) return;
    if (!result?.ok) throw new Error(result?.error || '翻译失败');
    translationText.value = result.text || '';
    translationCurrent = true;
    $('#ocr-status').textContent = '翻译完成';
  } catch (error) {
    if (token === ocrRevision) $('#ocr-status').textContent = error.message || '翻译失败';
  } finally {
    if (token === ocrRevision) { ocrBusy = false; updateOcrButtons(); }
  }
}
async function copyOcrText(translated = false, paste = false) {
  const text = translated ? translationText.value : ocrText.value;
  if (!text.trim() || (translated && !translationCurrent)) return;
  try {
    const saved = await window.suira.content.addText({ text, title: translated ? '译文' : '识别文字', source: translated ? 'translate' : 'ocr' });
    if (!saved?.ok) throw new Error(saved?.error || '保存失败');
    const result = paste
      ? await window.suira.returnTo.commit({ itemId: saved.item.id, intent: 'return-and-paste' })
      : await window.suira.actions.run(saved.item.id, 'output.copy');
    if (!result?.ok) throw new Error(result?.error || '复制失败');
    showAction(result.message || (translated ? '译文已复制' : '原文已复制'), 'copied');
  } catch (error) { showAction(error.message || '复制失败', 'error'); }
}

function beginDrag(event) {
  if (event.button !== 0) return;
  // 查看原图/加载态是全屏浮层：在上面按下不能再触发「重新开始框选」，
  // 否则会静默清空已有选区与全部标注。
  if (event.target.closest('.tool-dock, .capture-hint, .text-editor, .color-popover, .ocr-result, .original-viewer, .loading-state')) return;
  if (event.target.closest('.handle')) return;
  const p = point(event);
  if (hasSelection() && state.mode === 'annotate') {
    startAnnotation(event, p);
    return;
  }
  if (!editorMode && hasSelection() && event.target.closest('.selection')) {
    startMove(event);
    return;
  }
  // 重新开始一次框选：旧选区和工具栏立刻消失，回到「拖动中」
  state.mode = 'select';
  state.selecting = true;
  state.selectionReady = false;
  state.selection = null;
  if (!editorMode) { state.annotations = [];state.redoStack = []; }
  renderSelection();
  renderAnnotations();
  state.drawing = { type: 'select', start: p, current: p };
}

function updateSelectionPreview(p) {
  if (!state.drawing || state.drawing.type !== 'select') return;
  state.drawing.current = p;
  const selection = normSelection(state.drawing.start, p);
  state.selection = selection.w >= 2 && selection.h >= 2 ? selection : null;
  renderSelection();
  drawMagnifier(p);
}

function startMove(event) {
  const p = point(event);
  // 已有选区上的移动 / 缩放：工具栏保持可见并跟随
  state.selecting = false;
  state.drawing = {
    type: 'move',
    start: p,
    origin: { ...state.selection },
    handle: event.target.dataset.handle || ''
  };
  root.style.cursor = event.target.dataset.handle ? `${event.target.dataset.handle}-resize` : 'move';
  setMagnifierVisible(false);
}

function startAnnotation(event, p) {
  if (!state.selection) return;
  const s = state.selection;
  if (state.tool === 'text') {
    if (p.x < s.x || p.x > s.x + s.w || p.y < s.y || p.y > s.y + s.h) return;
    state.textAnchor = p;
    textEditor.hidden = false;
    textEditor.style.left = `${clamp(p.x, 8, metrics.width - 270)}px`;
    textEditor.style.top = `${clamp(p.y, 8, metrics.height - 120)}px`;
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
    state.drawing = { type: 'mosaic', start: p, current: p, x: p.x, y: p.y, w: 0, h: 0, color: state.color, width: state.lineWidth };
  } else if (state.tool === 'pen') {
    state.drawing = { type: 'pen', points: [p], color: state.color, width: state.lineWidth };
  } else if (state.tool === 'rect') {
    state.drawing = { type: 'rect', start: p, current: p, x: p.x, y: p.y, w: 0, h: 0, color: state.color, width: state.lineWidth };
  } else if (state.tool === 'arrow') {
    // from/to 与 start/current 并行维护：进行中的绘制随时可能被整屏重绘
    //（提交、撤销、改色都会触发），缺字段会在 drawArrow 里抛错并留下幽灵绘制
    state.drawing = { type: 'arrow', start: p, current: p, from: p, to: p, color: state.color, width: state.lineWidth };
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
    if (d.handle.includes('e')) right = clamp(right + dx, left + 2, metrics.width);
    if (d.handle.includes('n')) top = clamp(top + dy, 0, bottom - 2);
    if (d.handle.includes('s')) bottom = clamp(bottom + dy, top + 2, metrics.height);
    state.selection = { x: left, y: top, w: right - left, h: bottom - top };
  } else {
    state.selection = {
      x: clamp(o.x + dx, 0, metrics.width - o.w),
      y: clamp(o.y + dy, 0, metrics.height - o.h),
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
    const d = state.drawing;
    d.current = p;
    // 绘制对象自身保持可绘制：整屏重绘画的是它，不是这里的临时预览
    if (d.type === 'arrow') {
      d.from = d.start;
      d.to = p;
    } else {
      d.x = d.start.x;
      d.y = d.start.y;
      d.w = p.x - d.start.x;
      d.h = p.y - d.start.y;
    }
    renderAnnotationsWithPreview({ ...d });
  }
}

function renderAnnotationsWithPreview(preview) {
  // 预览只用于标注拖拽：复用历史层，不再把已提交标注整批重画一遍
  drawHistoryLayer();
  drawAnnotation(preview);
}

/* ---------- pointermove 合帧 ----------
 * 同一帧里可能来好几个 pointermove；这里只记点，用一次 rAF 统一应用，
 * 保证每帧最多一次 DOM 写入 + 一次 canvas 绘制。
 */
const pendingPoints = [];
let frameHandle = 0;

function queuePointer(p) {
  pendingPoints.push(p);
  if (pendingPoints.length > 64) pendingPoints.splice(0, pendingPoints.length - 64);
  if (perf) perf.pointerMoves += 1;
  if (!frameHandle) frameHandle = requestAnimationFrame(flushPointerFrame);
}

function flushPointerFrame() {
  frameHandle = 0;
  applyPendingPointer();
}

function applyPendingPointer() {
  if (!pendingPoints.length) return;
  const points = pendingPoints.splice(0, pendingPoints.length);
  const last = points[points.length - 1];
  const type = state.drawing && state.drawing.type;
  if (perf) perf.framesApplied += 1;
  if (type === 'pen') {
    // 画笔保留帧内所有点，线条不会因为合帧变粗
    for (const p of points) state.drawing.points.push(p);
    renderAnnotations();
    return;
  }
  if (type === 'select') { updateSelectionPreview(last); return; }
  if (type === 'move') { updateMove(last); drawMagnifier(last); return; }
  if (type && ANNOTATION_TYPES.includes(type)) { updateAnnotation(last); return; }
  drawMagnifier(last);
}

/** 立即消化未成帧的点（松开鼠标前必须调用，否则最后一小段会丢） */
function flushPointerNow() {
  if (frameHandle) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  applyPendingPointer();
}

/** 丢弃未成帧的点（松开 / 离开时用最后一帧的精确坐标重新计算） */
function dropPendingPointer() {
  pendingPoints.length = 0;
  if (frameHandle) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
}

function endAnnotation() {
  if (!state.drawing) return;
  const d = state.drawing;
  // 先收起再入列：addAnnotation 内部的整屏重绘绝不能再画进行中的形状，
  // 否则这里中途抛错会让 state.drawing 残留，之后移动鼠标就会拖出
  // 一条从旧起点跟随光标的幽灵箭头（松手后被误提交进截图）。
  state.drawing = null;
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
    if (perf && !perf.firstPointerMs && perf.shownAt) {
      perf.firstPointerMs = performance.now() - perf.shownAt;
    }
    if (event.target.closest('button, textarea, .text-editor, .color-popover, .original-viewer, .loading-state')) return;
    if (event.target.closest('.handle')) {
      startMove(event);
      return;
    }
    beginDrag(event);
    if (state.drawing && ANNOTATION_TYPES.includes(state.drawing.type)) {
      // 捕获失败（指针已失效等）只影响窗口外收点，不能让按下流程中断
      try { annotationCanvas.setPointerCapture?.(event.pointerId); } catch { }
    }
  });

  // pointermove 只记点：一帧里来多少次都合并成一次应用。
  // 标注拖拽必须继续入队（画笔靠这些点连线，矩形/箭头靠它们实时预览），
  // 只是这期间不显示取色放大镜；只有指针压在面板控件上才整帧丢弃。
  root.addEventListener('pointermove', (event) => {
    if (editorMode || event.target.closest('button, textarea, .tool-dock, .ocr-result, .original-viewer, .text-editor, .color-popover, .capture-hint, .loading-state')) {
      dropPendingPointer(); setMagnifierVisible(false); return;
    }
    const p = point(event);
    const annotating = !!(state.drawing && ANNOTATION_TYPES.includes(state.drawing.type));
    if (!annotating) colorPoint = p;
    queuePointer(p);
    if (annotating) setMagnifierVisible(false);
  });

  root.addEventListener('pointerup', (event) => {
    const p = point(event);
    const type = state.drawing?.type;
    if (type === 'select') {
      dropPendingPointer();
      // 用松开点作为最终落点，避免最后一小段没成帧而少算几像素
      updateSelectionPreview(p);
      state.drawing = null;
      state.selecting = false;
      if (state.selection && state.selection.w >= 4 && state.selection.h >= 4) {
        // 先框选、松开后才出现编辑工具栏
        state.selectionReady = true;
        setTool('pen');
        renderSelection();
        // 从面板带意图进来的（O 提字 / P 钉图）在这里自动推进，
        // 用户框完就出结果，不必再点工具栏
        autoAdvanceForIntent();
      } else {
        state.selection = null;
        state.selectionReady = false;
        renderSelection();
      }
      setMagnifierVisible(false);
    } else if (type === 'move') {
      dropPendingPointer();
      updateMove(p);
      state.drawing = null;
      state.selecting = false;
      root.style.cursor = '';
      renderSelection();
    } else if (type && ANNOTATION_TYPES.includes(type)) {
      // 画笔要把帧内剩余点补上；矩形 / 箭头 / 马赛克用松开点当最后终点，
      // 中间的帧点可以直接丢，省一次整屏重绘
      if (type === 'pen') {
        flushPointerNow();
        // 松开点可能比最后一个 pointermove 更远，补进去才不会少画最后一段
        if (state.drawing) state.drawing.points.push(p);
      } else {
        dropPendingPointer();
        updateAnnotation(p);
      }
      endAnnotation();
    }
  });

  root.addEventListener('pointerleave', () => {
    if (!state.drawing) {
      dropPendingPointer();
      setMagnifierVisible(false);
    }
  });

  // 系统手势 / 失焦 / 触摸笔取消时不会有 pointerup：必须收掉进行中的绘制，
  // 否则 state.drawing 残留，之后移动鼠标会拖出幽灵选区或幽灵箭头。
  const cancelPointer = () => {
    dropPendingPointer();
    if (state.drawing) {
      state.drawing = null;
      state.selecting = false;
      root.style.cursor = '';
      renderSelection();
      renderAnnotations();
    }
    setMagnifierVisible(false);
  };
  root.addEventListener('pointercancel', cancelPointer);
  root.addEventListener('lostpointercapture', () => { if (state.drawing) cancelPointer(); });

  $$('[data-shortcut]', toolDock).forEach(button => {
    const shortcut = { escape: 'Esc', enter: 'Enter', delete: 'Delete' }[button.dataset.shortcut] || button.dataset.shortcut.toUpperCase();
    const label = button.getAttribute('title') || (button.dataset.action === 'copy' ? '完成' : button.textContent.trim());
    button.dataset.hint = `${label} (${shortcut})`;
    button.setAttribute('aria-label', `${label} (${shortcut})`);
    button.setAttribute('aria-keyshortcuts', shortcut === 'Esc' ? 'Escape' : shortcut);
    button.removeAttribute('title');
  });
  $$('[data-color]', colorPopover).forEach((button, index) => {
    button.dataset.colorKey = String(index + 1);
    button.textContent = String(index + 1);
    button.setAttribute('aria-label', `${button.getAttribute('aria-label')} (${index + 1})`);
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
      else if (action === 'reselect') clearSelection();
      else if (action === 'cancel') cancel();
      else if (action === 'save') finish('save');
      else if (action === 'pin') finish('pin');
      else if (action === 'copy') finish('copy');
      else if (action === 'ocr') startOcr();
      else if (action === 'translate') startTranslate();
      else if (action === 'long') startLongSelection();
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
    const dataUrl = dataUrlOfSelection({ withoutAnnotations: true });
    if (!dataUrl) { showAction('请先拖拽选择一个区域', 'error'); return; }
    $('#original-image').src = dataUrl;
    $('#original-viewer').hidden = false;
  });
  $('#original-close').addEventListener('click', closeOriginalViewer);
  $('#original-viewer').addEventListener('click', (event) => {
    if (event.target === $('#original-viewer')) closeOriginalViewer();
  });
  ocrText.addEventListener('input', resetTranslation);
  translationText.addEventListener('input', () => { ++ocrRevision; ocrBusy = false; translationCurrent = true; updateOcrButtons(); });
  $('#ocr-result-translate').addEventListener('click', startTranslate);
  $('#ocr-configure').addEventListener('click', async () => { await window.suira.capture.cancel(); window.suira.textTools.configure(); });
  $('#ocr-result-copy').addEventListener('click', () => copyOcrText());
  $('#ocr-translation-copy').addEventListener('click', () => copyOcrText(true));
  $('#ocr-translation-paste').addEventListener('click', () => copyOcrText(true, true));
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
    if (event.isComposing || event.keyCode === 229) return;
    if (!textEditor.hidden) return;
    if (!originalViewer.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); originalViewer.hidden = true; }
      return;
    }
    if (!ocrResult.hidden) {
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
    // 取色复制跟微信一致用 Ctrl+C；Shift+C 保留给旧习惯。Ctrl+C 只在放大镜可见时取色，
    // 指针停在工具栏或结果框上时，仍按原来的「完成并复制截图」处理（Ctrl+Shift+C 不拦截）。
    const colorCopy = key === 'c' && !event.altKey && !event.metaKey && !magnifier.hidden
      && (event.shiftKey !== event.ctrlKey);
    if (colorCopy) {
      event.preventDefault();
      if (event.repeat) return;
      const sampled = sampleColor(colorPoint);
      if (!sampled) { showAction('请先把指针移到要取色的位置', 'error'); return; }
      window.suira.colors.pick(sampled.hex)
        .then(result=>{if(!result?.ok)throw Error(result?.error||'取色失败');showAction(sampled.hex+' 已复制 · Enter 完成截图','copied');})
        .catch(error=>showAction(error.message,'error'));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!colorPopover.hidden) colorPopover.hidden = true;
      else cancel();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) toolDock.querySelector('[data-action="copy"]').click();
      return;
    }
    if (event.ctrlKey && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (event.ctrlKey && key === 'a') {
      event.preventDefault();
      selectWholeScreen();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 's' || key === 'c')) {
      event.preventDefault();
      if (!event.repeat) toolDock.querySelector(`[data-action="${key === 's' ? 'save' : 'copy'}"]`).click();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); redo(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (event.repeat) return;
      if (editorMode || event.key === 'Backspace') undo();
      else clearSelection();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (!colorPopover.hidden) {
      const color = $$('[data-color]', colorPopover).find(button => button.dataset.colorKey === key);
      if (color) { event.preventDefault(); color.click(); return; }
    }
    const shortcutButton = $$('[data-shortcut]', toolDock).find(button => button.dataset.shortcut === key);
    if (shortcutButton && (!toolDock.hidden || key === 'a')) {
      event.preventDefault();
      if (event.repeat && shortcutButton.dataset.action) return;
      shortcutButton.click();
    }
  });

  window.addEventListener('resize', () => {
    const previous = { width:metrics.width, height:metrics.height };
    if (editorMode && state.image) window.SuiraEditorUI.layout(state.image);
    refreshMetrics();
    if (editorMode && state.image && previous.width && previous.height) {
      const sx=metrics.width/previous.width,sy=metrics.height/previous.height;
      const scalePoint=p=>{if(p){p.x*=sx;p.y*=sy;}};
      for(const item of [...state.annotations,...state.redoStack]) {
        if(item.points)item.points.forEach(scalePoint);
        scalePoint(item.from);scalePoint(item.to);
        if(Number.isFinite(item.x))item.x*=sx;if(Number.isFinite(item.y))item.y*=sy;
        if(Number.isFinite(item.w))item.w*=sx;if(Number.isFinite(item.h))item.h*=sy;
        item.width*=sx;item.unit=(item.unit||1)*sx;
      }
      if(state.selection){state.selection.x*=sx;state.selection.y*=sy;state.selection.w*=sx;state.selection.h*=sy;}
      state.scaleX=state.image.width/metrics.width;state.scaleY=state.image.height/metrics.height;
      state.drawing=null;state.selecting=false;
    }
    // 尺寸可能变了：下次定位时重新量一次工具栏和取色放大镜
    dockMetrics.width = 0;
    dockMetrics.height = 0;
    magnifierBox = null;
    mosaicPaletteKey = '';
    mosaicPaletteData = null;
    resizeCanvases();
    if (state.selection) {
      const minimum=editorMode?1:2;
      state.selection = {
        x: clamp(state.selection.x, 0, metrics.width - minimum),
        y: clamp(state.selection.y, 0, metrics.height - minimum),
        w: clamp(state.selection.w, minimum, metrics.width),
        h: clamp(state.selection.h, minimum, metrics.height)
      };
      renderSelection();
    }
  });
}

/**
 * 把多屏分块合成为一整幅画面。
 * 各屏 DPI 不同，主进程已按统一缩放比缩放到目标像素，这里只负责按偏移绘制。
 */
async function composeTiles(tiles, width, height, loadImage) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const images = await Promise.all(tiles.map(tile => loadImage(tile.dataUrl)));
  tiles.forEach((tile, index) => ctx.drawImage(images[index], tile.x, tile.y, tile.width, tile.height));
  // 直接绘制合成画布，避免整张多屏桌面再 PNG 编码、传输、解码一次。
  return canvas;
}

/* ---------- 预热覆盖层：每次 capture:shown 都要先重置再加载 ---------- */const DEFAULT_HINT_BRAND = '区域截图';

function clearCanvas(canvas) {
  // 直接清空后备缓冲，不改尺寸（避免重新分配）
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/** 释放上一张图的后备存储；图片工作台的 ImageBitmap 必须显式 close。 */
function releaseImage() {
  if (state.image instanceof HTMLCanvasElement) state.image.width = state.image.height = 0;
  else if (typeof ImageBitmap !== 'undefined' && state.image instanceof ImageBitmap) {
    try { state.image.close(); } catch { }
  }
}

/**
 * 把覆盖层恢复到「刚唤起的空白状态」。
 * 覆盖层窗口现在是启动时预创建、之后只 show/hide，所以每一次唤起都必须
 * 清掉上一轮的选区、标注、面板与画面，否则会带着旧内容出现。
 */
function resetOverlay() {
  delete root.dataset.intent;
  dockMetrics.width = dockMetrics.height = 0;
  showSeq += 1;
  releaseImage();
  state.payload = null;
  state.rawTiles = null;
  state.image = null;
  state.selection = null;
  state.annotations = [];
  state.redoStack = [];
  state.steps = 0;
  state.drawing = null;
  state.selecting = false;
  state.selectionReady = false;
  state.intent = '';
  state.intentAutoDone = false;
  state.mode = 'select';
  state.tool = 'pen';
  state.textAnchor = null;
  state.dockSide = 'bottom';
  state.ocrItemId = '';
  state.scaleX = 1;
  state.scaleY = 1;
  clearTimeout(state.toastTimer);
  state.toastTimer = null;
  imageSerial += 1;
  mosaicPaletteKey = '';
  mosaicPaletteData = null;

  // 缓存的「上次写入值」一并失效，确保重置后一定会真正写一遍 DOM
  lastSelectionBox.x = NaN;
  lastSelectionBox.y = NaN;
  lastSelectionBox.w = NaN;
  lastSelectionBox.h = NaN;
  lastSizeText = '';
  lastMagnifierPx.x = NaN;
  colorPoint=null;ocrResult.dataset.qrUrl='';
  lastMagnifierPx.y = NaN;
  magnifierBox = null;
  magnifierPaints = null;
  releaseHistoryLayer();
  lastMagnifierPos.left = NaN;
  lastMagnifierPos.top = NaN;
  lastDock.left = NaN;
  lastDock.top = NaN;
  dropPendingPointer();

  setHidden(selectionEl, true);
  setHidden(toolDock, true);
  setHidden(magnifier, true);
  setHidden(ocrResult, true);
  closeOriginalViewer();
  setHidden(textEditor, true);
  setHidden(colorPopover, true);
  setHidden(loadingState, false);
  setRootClass('has-selection', false);
  hint.classList.remove('is-hidden');
  if (hintBrand) hintBrand.textContent = DEFAULT_HINT_BRAND;
  sizeBadge.textContent = '0 × 0';
  actionToast.className = 'action-toast';
  textInput.value = '';
  ocrText.value = '';
  ocrText.placeholder = '正在识别…';
  resetTranslation();
  root.dataset.tool = 'select';
  root.style.cursor = '';
  $$('.tool-button[data-tool]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tool === 'select');
  });

  refreshMetrics();
  clearCanvas(screenCanvas);
  clearCanvas(annotationCanvas);
  resizeCanvases();

  perf = { shownAt: performance.now(), imageReadyAt: 0, firstPointerMs: 0, pointerMoves: 0, framesApplied: 0 };
  window.__lastCapturePerf = perf;
}

/**
 * 覆盖层隐藏后的「真释放」。
 *
 * resetOverlay 只是允许下一次覆盖；隐藏状态下这两块全屏 canvas 的后备存储
 * （4K 屏约 33MB × 2）和截图 Image 仍然挂在渲染进程里。这里把引用与后备缓冲
 * 真正丢掉，窗口本身保留，下一次 capture:shown 会重新分配。
 * 放大镜画布很小，保持不动，避免下次显示时没有恢复尺寸的路径。
 */
function releaseOverlay() {
  closeOcrResult();
  releaseHistoryLayer();
  releaseImage();
  dropPendingPointer();
  clearTimeout(state.toastTimer);
  state.toastTimer = null;
  setMagnifierVisible(false);
  magnifierBox = null;
  showSeq += 1; // 作废还在进行中的 loadCapture
  state.payload = null;
  state.rawTiles = null;
  state.image = null;
  state.selection = null;
  state.annotations = [];
  state.redoStack = [];
  state.drawing = null;
  state.selectionReady = false;
  state.textAnchor = null;
  mosaicPaletteKey = '';
  mosaicPaletteData = null;
  imageSerial += 1;
  // OCR「查看原图」里挂的是整张选区 PNG 的 data URL，隐藏时也要还回去
  const originalImage = $('#original-image');
  if (originalImage) originalImage.src = '';
  if (originalViewer) originalViewer.hidden = true;
  for (const canvas of [screenCanvas, annotationCanvas]) {
    try {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // 上下文丢失时忽略：窗口可能正在销毁
    }
  }
  window.__overlayReleased = true;
}

async function loadCapture(seq) {
  const payload = await captureApi.getData();
  // 加载过程中又被唤起一次：这一轮的旧数据直接作废
  if (seq !== showSeq) return;
  if (!payload && editorMode) { window.SuiraEditorUI.loaded(null,null);setHidden(loadingState,true);return; }
  if (!payload) throw new Error('未获取到截图数据');
  state.payload = payload;
  state.scaleX = payload.scaleFactor || 1;
  state.scaleY = payload.scaleFactor || 1;
  const images = new Map();
  const loadImage = url => {
    if (!images.has(url)) images.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('屏幕画面载入失败'));
      image.src = url;
    }));
    return images.get(url);
  };
  const rawTiles=await Promise.all((payload.rawTiles||[]).map(async tile=>{
    const image=await loadImage(tile.dataUrl||payload.tiles?.[tile.tileIndex]?.dataUrl||payload.dataUrl);
    return {...tile,image};
  }));
  if(seq!==showSeq)return;
  state.rawTiles=rawTiles;

  // 多屏时需要先把分块拼成一整幅，再交给后续的选区与标注逻辑
  let image;
  if (Array.isArray(payload.tiles) && payload.tiles.length > 0) {
    image = await composeTiles(payload.tiles, payload.tileSize.width, payload.tileSize.height, loadImage);
  } else image = await loadImage(payload.dataUrl);
  if (seq !== showSeq) return;
  if(editorMode) {
    if(!image.width||!image.height||image.width>16384||image.height>16384||image.width*image.height>40_000_000)throw new Error('图片尺寸过大，请先缩小图片');
    // 固定载入时的位图，避免动画图片在预览和导出时变成不同帧。
    image = await createImageBitmap(image);
    if(seq!==showSeq){image.close();return;}
  }
  state.image = image;
  imageSerial += 1;
  mosaicPaletteKey = '';
  mosaicPaletteData = null;
  state.scaleX = image.width / Math.max(1, payload.size?.width || metrics.width);
  state.scaleY = image.height / Math.max(1, payload.size?.height || metrics.height);
  if(editorMode) {
    window.SuiraEditorUI.loaded(image,payload);refreshMetrics();
    state.scaleX=image.width/metrics.width;state.scaleY=image.height/metrics.height;
    state.selection={x:0,y:0,w:metrics.width,h:metrics.height};state.selectionReady=true;
  }
  resizeCanvases(true); // 新画面已就位，即使视口尺寸没变也要重绘一次
  if (editorMode) { setTool(payload.tool === 'select' ? 'select' : 'pen'); renderSelection(); }
  setHidden(loadingState, true);
  applyIntent(payload.intent);
  if (perf) perf.imageReadyAt = performance.now();
}

/**
 * 主进程每次唤起截图都会发 capture:shown；收到后先重置，再取新的屏幕画面。
 * 失败时保持可取消（Esc 在任何时候都走 cancel()）。
 */
async function handleShown() {
  resetOverlay();
  const seq = showSeq;
  try {
    await loadCapture(seq);
  } catch (error) {
    if (seq !== showSeq) return;
    setHidden(loadingState, true);
    showAction(error.message || '截图初始化失败', 'error');
    if(editorMode)window.SuiraEditorUI.report(error.message||'图片载入失败',true);
  }
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
  if (intent === 'ocr' || intent === 'ocr-return' || intent === 'document-text') {
    // 提示用户这一趟是要提字的，不必再找工具栏
    if (hintBrand) hintBrand.textContent = '截图提字';
    showAction('框选要识别的区域，完成后自动识别');
  } else if (intent === 'document-image') {
    if(hintBrand)hintBrand.textContent='插入截图';showAction('框选后插入 Markdown 光标位置');
  } else if (intent === 'translate') {
    if (hintBrand) hintBrand.textContent = '截图翻译';
    showAction('框选要翻译的区域，完成后自动识别并翻译');
  } else if (intent === 'pin') {
    if (hintBrand) hintBrand.textContent = '截图钉图';
    showAction('框选要钉住的区域，完成后直接钉在桌面');
  } else if (intent === 'long') {
    if(hintBrand)hintBrand.textContent='滚动长截图';
    showAction('框选滚动内容，松开后向下滚动即可拼接');
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
  if (intent === 'ocr' || intent === 'ocr-return' || intent === 'document-text') startOcr();
  else if(intent==='document-image')finish('insert');
  else if (intent === 'translate') startTranslate();
  else if (intent === 'pin') finish('pin');
  else if (intent === 'long') startLongSelection();
}

setupEvents();
refreshMetrics();
resizeCanvases();
if (captureApi && typeof captureApi.onShown === 'function') {
  // 预热模式：页面加载完成后不主动取画面，等主进程每次唤起时通知
  captureApi.onShown(() => { handleShown(); });
  if(editorMode)handleShown();
} else {
  // 兼容尚未接入 capture:shown 的旧主进程：页面就绪后直接加载
  handleShown();
}
// 隐藏即释放：主进程在 hide 时通知，窗口保留但画面/画布后备缓冲还回去
if (captureApi && typeof captureApi.onRelease === 'function') {
  captureApi.onRelease(() => { releaseOverlay(); });
}

