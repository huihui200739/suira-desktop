'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/**
 * 从渲染进程的 File 对象取真实磁盘路径。
 * Electron 32 起 File.path 被移除，必须走 webUtils.getPathForFile；
 * 老版本回落到 file.path，取不到就返回空串（调用方负责过滤）。
 */
function pathForFile(file) {
  try {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file) || '';
    }
    return (file && file.path) || '';
  } catch {
    return '';
  }
}

contextBridge.exposeInMainWorld('suira', {
  window: {
    reset: () => ipcRenderer.invoke('window:reset'),
    pin: () => ipcRenderer.invoke('window:pin'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    hide: () => ipcRenderer.invoke('window:hide'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  },
  quick: {
    background: () => ipcRenderer.invoke('quick:background'),
    presentation: () => ipcRenderer.invoke('quick:presentation'),
    setPresentation: mode => ipcRenderer.invoke('quick:presentation:set', mode),
    onPresentation: callback => subscribe('quick:presentation-changed', callback),
    hide: () => ipcRenderer.invoke('quick:hide'),
    show: () => ipcRenderer.invoke('quick:show'),
    toggle: () => ipcRenderer.invoke('quick:toggle'),
    capture: () => ipcRenderer.invoke('quick:capture'),
    openMain: (page) => ipcRenderer.invoke('quick:open-main', page),
    showMain: (page) => ipcRenderer.invoke('quick:show-main', page),
    openApp: (filePath) => ipcRenderer.invoke('quick:open-app', filePath),
    onShown: (callback) => subscribe('quick:shown', callback),
    // 主进程轮换面板布局时下发目标模式（动作 / 应用 / 工具箱）
    onMode: (callback) => subscribe('quick:mode', callback)
  },
  // 浮引岛：文件中转浮层。只传路径与元数据，文件本体不进渲染进程。
  island: {
    getState: () => ipcRenderer.invoke('island:get-state'),
    addPaths: (paths) => ipcRenderer.invoke('island:add-paths', paths),
    pathForFile,
    removeItem: (id) => ipcRenderer.invoke('island:remove-item', id),
    clear: () => ipcRenderer.invoke('island:clear'),
    undo: () => ipcRenderer.invoke('island:undo'),
    setPolicy: (policy) => ipcRenderer.invoke('island:set-policy', policy),
    setExpanded: (expanded) => ipcRenderer.invoke('island:set-expanded', expanded),
    // 三态：sleep（隐形热区）/ rail（胶囊）/ sheet（暂存卡片）
    setMode: (mode) => ipcRenderer.invoke('island:set-mode', mode),
    // 交互心跳：渲染层还有动作时，把主进程「回休眠」的计时往后推
    ping: () => ipcRenderer.send('island:ping'),
    openItem: (id) => ipcRenderer.invoke('island:open-item', id),
    revealItem: (id) => ipcRenderer.invoke('island:reveal-item', id),
    startDrag: (id) => ipcRenderer.invoke('island:start-drag', id),
    toggle: () => ipcRenderer.invoke('island:toggle'),
    onState: (callback) => subscribe('island:state', callback),
    onExpanded: (callback) => subscribe('island:expanded', callback),
    onMode: (callback) => subscribe('island:mode', callback)
  },
  // 速记（Quick Note）：纯文本笔记，一条一个窗口，可钉在桌面
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    open: (id) => ipcRenderer.invoke('notes:open', id),
    openLatest: () => ipcRenderer.invoke('notes:open-latest'),
    create: () => ipcRenderer.invoke('notes:create'),
    update: (payload) => ipcRenderer.invoke('notes:update', payload),
    togglePin: (id) => ipcRenderer.invoke('notes:toggle-pin', id),
    remove: (id) => ipcRenderer.invoke('notes:delete', id),
    minimizeWindow: () => ipcRenderer.invoke('notes:minimize-window'),
    hideWindow: () => ipcRenderer.invoke('notes:hide-window'),
    onOpened: (callback) => subscribe('notes:opened', callback),
    onChanged: (callback) => subscribe('notes:changed', callback)
  },
  // 38 键动作面板：键位表与执行通道
  panel: {
    state: () => ipcRenderer.invoke('panel:state'),
    onChanged: (callback) => subscribe('panel:changed', callback),
    onResult: (callback) => subscribe('panel:result', callback),
    run: (actionId) => ipcRenderer.invoke('panel:run', actionId),
    // 自定义键位绑定：设置/清除（binding 传 null 表示清除）与选择本机目标
    setBinding: (payload) => ipcRenderer.invoke('panel:binding:set', payload),
    moveBinding: (payload) => ipcRenderer.invoke('panel:binding:move', payload),
    pickPath: (options) => ipcRenderer.invoke('panel:binding:pick', options)
  },
  // 应用面板：开始菜单应用目录（图标按需取，保证首帧快）
  apps: {
    search: (query, refresh = false) => ipcRenderer.invoke('apps:search', query, refresh),
    list: () => ipcRenderer.invoke('apps:list'),
    icons: (filePaths) => ipcRenderer.invoke('apps:icons', filePaths)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
    restart: () => ipcRenderer.invoke('app:restart'),
    quit: () => ipcRenderer.invoke('app:quit'),
    releases: () => ipcRenderer.invoke('app:releases'),
    onNavigate: (callback) => subscribe('app:navigate', callback),
    onToast: (callback) => subscribe('app:toast', callback)
  },
  capture: {
    start: (options) => ipcRenderer.invoke('capture:start', options),
    getData: () => ipcRenderer.invoke('capture:get-data'),
    finish: (payload) => ipcRenderer.invoke('capture:finish', payload),
    cancel: () => ipcRenderer.invoke('capture:cancel'),
    // 覆盖层是预热常驻窗口：每次唤起主进程发这个事件，渲染层 reset 后重新拉画面
    onShown: (callback) => subscribe('capture:shown', callback),
    // 覆盖层隐藏时主进程发这个事件：渲染层立刻丢掉整屏画面与 canvas 后备缓冲，
    // 别让一张 4K 截图在后台白占几十 MB
    onRelease: (callback) => subscribe('capture:release', callback)
  },
  imageEditor: {
    open: options => ipcRenderer.invoke('image-editor:open', options),
    pathForFile,
    getData: () => ipcRenderer.invoke('image-editor:data'),
    finish: payload => ipcRenderer.invoke('image-editor:finish', payload),
    cancel: () => ipcRenderer.invoke('image-editor:window', 'close'),
    window: command => ipcRenderer.invoke('image-editor:window', command),
    onShown: callback => subscribe('image-editor:changed', callback)
  },
  longCapture: {
    onPickerShown: callback => subscribe('long-picker:shown',callback),
    pickerReady: revision => ipcRenderer.invoke('long-picker:ready',revision),
    cancelPicker: () => ipcRenderer.invoke('long-picker:cancel'),
    start: selection => ipcRenderer.invoke('capture:start-long',selection),
    state: () => ipcRenderer.invoke('long-capture:state'),
    command: command => ipcRenderer.invoke('long-capture:command',command),
    onState: callback => subscribe('long-capture:state',callback),
    // 右下角预览窗：主进程只推缩略图与尺寸，渲染层不碰原始像素
    onPreview: callback => subscribe('long-capture:preview',callback)
  },
  // 剪贴板历史条（屏幕底部浮层）
  clipboardBar: {
    show: () => ipcRenderer.invoke('clipboard-bar:show'),
    hide: () => ipcRenderer.invoke('clipboard-bar:hide'),
    toggle: () => ipcRenderer.invoke('clipboard-bar:toggle'),
    onShown: (callback) => subscribe('clipboard-bar:shown', callback)
  },
  content: {
    list: (options) => ipcRenderer.invoke('content:list', options),
    get: (id) => ipcRenderer.invoke('content:get', id),
    addText: (payload) => ipcRenderer.invoke('content:add-text', payload),
    remove: (id) => ipcRenderer.invoke('content:remove', id),
    togglePin: (id) => ipcRenderer.invoke('content:toggle-pin', id),
    clearClipboard: () => ipcRenderer.invoke('content:clear-clipboard'),
    openOriginal: (id) => ipcRenderer.invoke('content:open-original', id),
    onChanged: (callback) => subscribe('content:changed', callback)
  },
  actions: {
    list: (itemId) => ipcRenderer.invoke('actions:list', itemId),
    run: (itemId, actionId) => ipcRenderer.invoke('actions:run', { itemId, actionId })
  },
  recipes: {
    list: (kind) => ipcRenderer.invoke('recipes:list', kind),
    run: (payload) => ipcRenderer.invoke('recipes:run', payload)
  },
  search: {
    query: (query, options) => ipcRenderer.invoke('search:query', query, options)
  },
  returnTo: {
    target: () => ipcRenderer.invoke('return:target'),
    commit: (payload) => ipcRenderer.invoke('return:commit', payload)
  },
  shortcuts: {
    retry: () => ipcRenderer.invoke('shortcuts:retry'),
    check: () => ipcRenderer.invoke('shortcuts:check'),
    get: () => ipcRenderer.invoke('shortcuts:get'),
    set: (payload) => ipcRenderer.invoke('shortcuts:set', payload),
    restoreDefault: (payload) => ipcRenderer.invoke('shortcuts:restore-default', payload),
    clear: (payload) => ipcRenderer.invoke('shortcuts:clear', payload),
    onChanged: (callback) => subscribe('shortcuts:changed', callback)
  },
  // 翻译（图片取词翻译）：密钥只在主进程解密，渲染层只看到「是否已配置」
  translate: {
    status: () => ipcRenderer.invoke('translate:status'),
    run: (payload) => ipcRenderer.invoke('translate:run', payload),
    test: () => ipcRenderer.invoke('translate:test'),
    onStatus: (callback) => subscribe('translate:status', callback)
  },
  ocr: {
    recognizeItem: (itemId) => ipcRenderer.invoke('ocr:recognize-item', itemId),
    onProgress: (callback) => subscribe('ocr:progress', callback)
  },
  workspace: {
    confirmClose: id => ipcRenderer.invoke('workspace:confirm-close',id),
    openedFile: () => ipcRenderer.invoke('workspace:opened-file'),
    saveFile: id => ipcRenderer.invoke('workspace:save-file',id),
    onFileOpened: callback => subscribe('workspace:file-opened',callback),
    clipboard: () => ipcRenderer.invoke('workspace:clipboard'),
    open: type => ipcRenderer.invoke('workspace:open',type),
    onClosing: callback => subscribe('workspace:closing',callback),
    closeReady: () => ipcRenderer.invoke('workspace:close-ready'),
    calendarExport: () => ipcRenderer.invoke('workspace:calendar-export'),
    openLink: url => ipcRenderer.invoke('workspace:open-link',url),
    list: type => ipcRenderer.invoke('workspace:list',type),
    save: (type,payload) => ipcRenderer.invoke('workspace:save',type,payload),
    remove: (type,id) => ipcRenderer.invoke('workspace:remove',type,id),
    import: () => ipcRenderer.invoke('workspace:import'),
    export: (id,format) => ipcRenderer.invoke('workspace:export',id,format)
  },
  tasks: {
    status: payload => ipcRenderer.invoke('tasks:status',payload),
    list: (options) => ipcRenderer.invoke('tasks:list', options),
    create: (title) => ipcRenderer.invoke('tasks:create', title),
    rename: (payload) => ipcRenderer.invoke('tasks:rename', payload),
    remove: (id) => ipcRenderer.invoke('tasks:delete', id),
    addItem: (payload) => ipcRenderer.invoke('tasks:add-item', payload),
    removeItem: (payload) => ipcRenderer.invoke('tasks:remove-item', payload),
    copyText: (taskId) => ipcRenderer.invoke('tasks:copy-text', taskId),
    export: (taskId) => ipcRenderer.invoke('tasks:export', taskId),
    onChanged: (callback) => subscribe('tasks:changed', callback)
  },
  executions: {
    list: (limit) => ipcRenderer.invoke('executions:list', limit),
    // 处理轨迹里失败记录的重试：用同一条输入再执行一次原动作
    retry: (executionId) => ipcRenderer.invoke('executions:retry', executionId),
    onChanged: (callback) => subscribe('executions:changed', callback)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    onChanged: (callback) => subscribe('settings:changed', callback)
  }
});

// Frameless Windows surfaces use page-owned resize hit areas. Keeping the system
// thick frame would reintroduce its rectangular gray backdrop outside CSS corners.
window.addEventListener('DOMContentLoaded', () => {
  if(location.pathname.endsWith('/index.html')){
    const update=state=>{document.documentElement.dataset.windowActive=String(Boolean(state.focused));document.documentElement.dataset.windowMaximized=String(Boolean(state.maximized));};
    ipcRenderer.on('window:state',(_event,state)=>update(state));
    ipcRenderer.invoke('window:state').then(update).catch(()=>{});
  }
  if (process.platform !== 'win32') return;
  const page = location.pathname.split('/').pop();
  if (!['index.html', 'notes.html'].includes(page) && !(page === 'overlay.html' && new URLSearchParams(location.search).get('mode') === 'image-editor')) return;
  const style = document.createElement('style');
  style.textContent = `.suira-resize{position:fixed;z-index:2147483647;-webkit-app-region:no-drag;touch-action:none}
  .suira-resize[data-edge=n],.suira-resize[data-edge=s]{left:24px;right:24px;height:6px;cursor:ns-resize}
  .suira-resize[data-edge=n]{top:0}.suira-resize[data-edge=s]{bottom:0}
  .suira-resize[data-edge=e],.suira-resize[data-edge=w]{top:24px;bottom:24px;width:6px;cursor:ew-resize}
  .suira-resize[data-edge=e]{right:0}.suira-resize[data-edge=w]{left:0}
  .suira-resize[data-edge=ne],.suira-resize[data-edge=nw],.suira-resize[data-edge=se],.suira-resize[data-edge=sw]{width:24px;height:24px}
  .suira-resize[data-edge=ne]{right:0;top:0;cursor:nesw-resize}.suira-resize[data-edge=nw]{left:0;top:0;cursor:nwse-resize}
  .suira-resize[data-edge=se]{right:0;bottom:0;cursor:nwse-resize}.suira-resize[data-edge=sw]{left:0;bottom:0;cursor:nesw-resize}`;
  document.head.appendChild(style);
  for (const edge of ['n','s','e','w','ne','nw','se','sw']) {
    const handle = document.createElement('div');
    handle.className = 'suira-resize'; handle.dataset.edge = edge; handle.setAttribute('aria-hidden', 'true');
    let dragging = false, frame = 0;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); dragging = true; handle.setPointerCapture(event.pointerId);
      ipcRenderer.send('window:resize-start', edge);
    });
    handle.addEventListener('pointermove', () => {
      if (!dragging || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (dragging) ipcRenderer.send('window:resize-step'); });
    });
    const finish = () => {
      if (!dragging) return;
      dragging = false; cancelAnimationFrame(frame); frame = 0;
      ipcRenderer.send('window:resize-step'); ipcRenderer.send('window:resize-end');
    };
    handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish); handle.addEventListener('lostpointercapture', finish);
    document.body.appendChild(handle);
  }
});
