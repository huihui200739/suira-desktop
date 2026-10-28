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
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    hide: () => ipcRenderer.invoke('window:hide'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  },
  quick: {
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
    list: () => ipcRenderer.invoke('apps:list'),
    icons: (filePaths) => ipcRenderer.invoke('apps:icons', filePaths)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
    restart: () => ipcRenderer.invoke('app:restart'),
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
    query: (query) => ipcRenderer.invoke('search:query', query)
  },
  returnTo: {
    target: () => ipcRenderer.invoke('return:target'),
    commit: (payload) => ipcRenderer.invoke('return:commit', payload)
  },
  shortcuts: {
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
  tasks: {
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
