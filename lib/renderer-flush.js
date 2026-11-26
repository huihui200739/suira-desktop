'use strict';

async function runRendererScript(win, script, timeoutMs = 2500) {
  let timer;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error('Renderer did not respond in time'), { code: 'ERR_RENDERER_TIMEOUT' }));
      }, timeoutMs);
    });
    return await Promise.race([win.webContents.executeJavaScript(script), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function flushRendererDrafts(win, timeoutMs) {
  return runRendererScript(win, 'Promise.resolve(window.WorkspaceUI?.flush()).then(() => window.NoteUI?.flush())', timeoutMs);
}

module.exports = { flushRendererDrafts, runRendererScript };
