'use strict';

// Invoke in the owning process. DWM's system acrylic backdrop paints outside
// transparent HWND regions; the accent blur keeps the window's alpha surface.
function createWindowMaterial({ platform = process.platform, load = () => require('koffi') } = {}) {
  let native, attempted = false;
  const applied = new WeakMap();
  function initialize() {
    if (attempted) return native;
    attempted = true;
    if (platform !== 'win32') return null;
    try {
      const koffi = load();
      const accent = koffi.struct({ state: 'int', flags: 'int', color: 'uint32', animation: 'int' });
      const data = koffi.struct({ attribute: 'int', policy: koffi.pointer(accent), size: 'size_t' });
      const set = koffi.load('user32.dll').func('__stdcall', 'SetWindowCompositionAttribute', 'int', ['void *', koffi.pointer(data)]);
      native = { set, size: koffi.sizeof(accent) };
    } catch { native = null; }
    return native;
  }
  function apply(win, enabled) {
    if (!win || win.isDestroyed() || platform !== 'win32') return false;
    const api = initialize();
    if (!api) return false;
    try {
      const buffer = win.getNativeWindowHandle();
      const handle = buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
      const state = enabled ? 3 : 0;
      const previous = applied.get(win);
      if (previous?.handle === handle && previous.state === state) return enabled;
      const ok = api.set(handle, { attribute: 19, policy: { state, flags: 0, color: 0, animation: 0 }, size: api.size });
      if (!ok) { applied.delete(win); return false; }
      applied.set(win, { handle, state });
      return enabled;
    } catch { applied.delete(win); return false; }
  }
  return { apply };
}

function shouldEnableBlur({ reducedTransparency = false, highContrast = false, fullscreen = false, material = 'soft' } = {}) {
  return !reducedTransparency && !highContrast && !fullscreen && material !== 'solid';
}

module.exports = { createWindowMaterial, shouldEnableBlur };
