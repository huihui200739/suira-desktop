'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('suiraVoice', {
  status: () => ipcRenderer.invoke('voice:status'),
  onStop: callback => ipcRenderer.on('voice:stop', () => callback()),
  transcribe: pcm => ipcRenderer.invoke('voice:transcribe', { pcm }),
  close: () => ipcRenderer.invoke('voice:close'),
  openSettings: () => ipcRenderer.invoke('voice:open-settings')
});
