'use strict';

const WM_CLIPBOARDUPDATE = 0x031d;

function watchWindowsClipboard(win, onChange) {
  const ffi = require('koffi');
  const user32 = ffi.load('user32.dll');
  const add = user32.func('__stdcall', 'AddClipboardFormatListener', 'int', ['uintptr_t']);
  const remove = user32.func('__stdcall', 'RemoveClipboardFormatListener', 'int', ['uintptr_t']);
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE();
  win.hookWindowMessage(WM_CLIPBOARDUPDATE, onChange);
  if (!add(hwnd)) {
    win.unhookWindowMessage(WM_CLIPBOARDUPDATE);
    throw new Error('Windows 未能注册剪贴板通知');
  }
  return () => {
    if (win.isDestroyed()) return;
    remove(hwnd);
    win.unhookWindowMessage(WM_CLIPBOARDUPDATE);
  };
}

module.exports = { watchWindowsClipboard };
