'use strict';

/**
 * 钉图窗口专用 preload。
 *
 * 钉图窗口的 HTML 是 data: URL 内联的，没有独立页面文件，
 * 因此需要单独的最小 preload 把窗口操作暴露给内联脚本。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinApi', {
  resize: (width, height) => ipcRenderer.send('pin:resize', { width, height }),
  setOpacity: (value) => ipcRenderer.send('pin:opacity', value),
  collapse: (collapsed) => ipcRenderer.send('pin:collapse', Boolean(collapsed)),
  bounds: () => ipcRenderer.sendSync('pin:bounds'),
  close: () => ipcRenderer.send('pin:close')
});
