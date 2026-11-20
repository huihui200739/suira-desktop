'use strict';

// CF_HDROP uses a DROPFILES header and a double-NUL-terminated list of UTF-16 paths.
function encodeFileDrop(paths) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(header.length, 0);
  header.writeUInt32LE(1, 16); // fWide
  return Buffer.concat([header, Buffer.from(`${paths.join('\0')}\0\0`, 'utf16le')]);
}

let bindings;
function clipboardBindings() {
  if (bindings) return bindings;
  const ffi = require('koffi');
  const user = ffi.load('user32.dll');
  const kernel = ffi.load('kernel32.dll');
  bindings = {
    view: ffi.view,
    open: user.func('int __stdcall OpenClipboard(uintptr_t window)'),
    close: user.func('int __stdcall CloseClipboard()'),
    empty: user.func('int __stdcall EmptyClipboard()'),
    set: user.func('uintptr_t __stdcall SetClipboardData(uint32_t format, uintptr_t memory)'),
    alloc: kernel.func('uintptr_t __stdcall GlobalAlloc(uint32_t flags, size_t bytes)'),
    lock: kernel.func('void * __stdcall GlobalLock(uintptr_t memory)'),
    unlock: kernel.func('int __stdcall GlobalUnlock(uintptr_t memory)'),
    free: kernel.func('uintptr_t __stdcall GlobalFree(uintptr_t memory)')
  };
  return bindings;
}

function copyFileList(windowHandle, paths) {
  if (process.platform !== 'win32') throw new Error('批量复制图片文件需要 Windows');
  const handle = windowHandle.length === 8 ? windowHandle.readBigUInt64LE() : windowHandle.readUInt32LE();
  const data = encodeFileDrop(paths);
  const api = clipboardBindings();
  const CF_HDROP = 15;
  const GMEM_MOVEABLE = 2;
  const memory = api.alloc(GMEM_MOVEABLE, data.length);
  if (!memory) throw new Error('无法为剪贴板分配空间');
  let transferred = false;
  try {
    const pointer = api.lock(memory);
    if (!pointer) throw new Error('无法准备剪贴板数据');
    try {
      new Uint8Array(api.view(pointer, data.length)).set(data);
    } finally {
      api.unlock(memory);
    }
    if (!api.open(handle)) throw new Error('剪贴板正被占用，请重试');
    try {
      if (!api.empty() || !api.set(CF_HDROP, memory)) throw new Error('无法写入剪贴板');
      transferred = true;
    } finally {
      api.close();
    }
  } finally {
    // On success Windows owns the allocation until the clipboard changes.
    if (!transferred) api.free(memory);
  }
}

module.exports = { copyFileList };
