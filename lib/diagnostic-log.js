'use strict';

const fs = require('node:fs');
const path = require('node:path');

function recordDiagnostic(root, level, event, error) {
  if (!root || !['warn', 'error', 'fatal'].includes(level) || !/^[a-z][a-z0-9-]{1,63}$/.test(event)) return;
  const code = typeof error?.code === 'string' && /^(?:ERR_[A-Z0-9_]+|E[A-Z0-9]{2,24})$/.test(error.code) ? error.code : undefined;
  const type = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError'].includes(error?.name) ? error.name : undefined;
  // Do not persist exception text, clipboard content, paths, URLs or arguments.
  const file = path.join(root, 'diagnostics.log');
  try {
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size || 0) >= 256 * 1024) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), level, event, type, code }) + '\n', { mode: 0o600 });
  } catch (failure) {
    console.warn('本地诊断日志无法写入:', failure.code || failure.name);
  }
}

module.exports = { recordDiagnostic };
