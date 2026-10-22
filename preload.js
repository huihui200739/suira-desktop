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
    setPolicy: (policy) => ipcRenderer.invoke('island:set-policy', policy),
    setExpanded: (expanded) => ipcRenderer.invoke('island:set-expanded', expanded),
    openItem: (id) => ipcRenderer.invoke('island:open-item', id),
    revealItem: (id) => ipcRenderer.invoke('island:reveal-item', id),
    startDrag: (id) => ipcRenderer.invoke('island:start-drag', id),
    toggle: () => ipcRenderer.invoke('island:toggle'),
    onState: (callback) => subscribe('island:state', callback),
    onExpanded: (callback) => subscribe('island:expanded', callback)
  },
  // 38 键动作面板：键位表与执行通道
  panel: {
    state: () => ipcRenderer.invoke('panel:state'),
    run: (actionId) => ipcRenderer.invoke('panel:run', actionId)
  },
  // 应用面板：开始菜单应用目录（图标按需取，保证首帧快）
  apps: {
    list: () => ipcRenderer.invoke('apps:list'),
    icons: (filePaths) => ipcRenderer.invoke('apps:icons', filePaths)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
    onNavigate: (callback) => subscribe('app:navigate', callback),
    onToast: (callback) => subscribe('app:toast', callback)
  },
  capture: {
    start: (options) => ipcRenderer.invoke('capture:start', options),
    getData: () => ipcRenderer.invoke('capture:get-data'),
    finish: (payload) => ipcRenderer.invoke('capture:finish', payload),
    cancel: () => ipcRenderer.invoke('capture:cancel')
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