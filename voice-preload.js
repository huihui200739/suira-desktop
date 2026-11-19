'use strict';

const { contextBridge, ipcRenderer } = require('electron');
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  let theme = null;
  let appliedRevision = -1;
  const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
  const paintTheme = () => {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.theme = theme?.preset || 'mist';
    root.dataset.accentSource = theme?.accentSource || 'preset';
    if (!theme) return;
    root.dataset.themeForcedSolid = String(theme.forcedSolid);
    root.dataset.glassMode = theme.forcedSolid ? 'solid' : theme.material;
    const scales = theme.palette?.[darkMode.matches ? 'dark' : 'light'];
    for (const family of ['slate', 'accent']) for (let index = 0; index < 12; index += 1) {
      const name = `--${family}-${index + 1}`;
      const color = scales?.[family]?.[index];
      if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) root.style.setProperty(name, color);
      else root.style.removeProperty(name);
    }
    root.dataset.themeRevision = String(theme.revision);
  };
  const acceptTheme = value => {
    if (!value || !Number.isFinite(value.revision) || value.revision < appliedRevision) return;
    theme = value; appliedRevision = value.revision; paintTheme();
  };
  ipcRenderer.on('theme:changed', (_event, value) => acceptTheme(value));
  try { acceptTheme(ipcRenderer.sendSync('theme:initial')); } catch { paintTheme(); }
  darkMode.addEventListener('change', paintTheme);
}

contextBridge.exposeInMainWorld('suiraVoice', {
  status: () => ipcRenderer.invoke('voice:status'),
  onStatus: callback => ipcRenderer.on('voice:status', (_event, status) => callback(status)),
  transcribe: pcm => ipcRenderer.invoke('voice:transcribe', { pcm }),
  commit: (text, mode) => ipcRenderer.invoke('voice:commit', { text, mode }),
  cancel: () => ipcRenderer.invoke('voice:cancel'),
  close: () => ipcRenderer.invoke('voice:close'),
  openSettings: () => ipcRenderer.invoke('voice:open-settings')
});
