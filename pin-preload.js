'use strict';

/**
 * 钉图窗口专用 preload。
 *
 * 只暴露钉图操作，主题桥接与其他窗口保持一致。
 */

const { contextBridge, ipcRenderer } = require('electron');
if (typeof document !== 'undefined' && typeof window !== 'undefined') require('./lib/theme-preload').installThemeBridge({ipcRenderer,document,window});

contextBridge.exposeInMainWorld('pinApi', {
  getData: () => ipcRenderer.invoke('pin:data'),
  copy: () => ipcRenderer.invoke('pin:copy'),
  save: () => ipcRenderer.invoke('pin:save'),
  toggleTop: () => ipcRenderer.invoke('pin:top'),
  move: point => ipcRenderer.send('pin:move', point),
  resize: (width, height) => ipcRenderer.send('pin:resize', { width, height }),
  setOpacity: (value) => ipcRenderer.send('pin:opacity', value),
  collapse: (collapsed) => ipcRenderer.send('pin:collapse', Boolean(collapsed)),
  bounds: () => ipcRenderer.sendSync('pin:bounds'),
  close: () => ipcRenderer.send('pin:close')
});
