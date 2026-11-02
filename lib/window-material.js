'use strict';

// Invoke in the owning process. Native glass must use DWM corners, never a
// custom HWND region: accent blur does not honor hand-cut corner masks.
function supportsSystemGlass(platform=process.platform,release=require('node:os').release()){
  return platform==='win32'&&Number(release.split('.')[2])>=22000;
}
function createWindowMaterial({ platform = process.platform, load = () => require('koffi') } = {}) {
  let native, attempted = false;
  const applied = new WeakMap();
  const frames = new WeakMap();
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
      try{
        const margins=koffi.struct({left:'int',right:'int',top:'int',bottom:'int'}),dwm=koffi.load('dwmapi.dll');
        native.extend=dwm.func('__stdcall','DwmExtendFrameIntoClientArea','long',['void *',koffi.pointer(margins)]);
        native.attribute=dwm.func('__stdcall','DwmSetWindowAttribute','long',['void *','uint32','int *','uint32']);
      }catch{/* Older systems retain the alpha surface fallback. */}
    } catch { native = null; }
    return native;
  }
  function prepareSystemGlass(win,{square=false}={}){
    if(!win||win.isDestroyed()||platform!=='win32')return false;
    const api=initialize();if(!api?.extend||!api?.attribute)return false;
    try{
      const buffer=win.getNativeWindowHandle(),handle=buffer.length===8?buffer.readBigUInt64LE():BigInt(buffer.readUInt32LE()),corner=square?1:2;
      const previous=frames.get(win);if(previous?.handle===handle&&previous.corner===corner)return true;
      if(api.extend(handle,{left:-1,right:-1,top:-1,bottom:-1})!==0||api.attribute(handle,33,[corner],4)!==0)return false;
      frames.set(win,{handle,corner});return true;
    }catch{frames.delete(win);return false;}
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
  return { apply,prepareSystemGlass,invalidate(win){applied.delete(win);frames.delete(win);} };
}

function shouldEnableBlur({ reducedTransparency = false, highContrast = false, fullscreen = false, material = 'soft', radius = 24,systemGlass=false } = {}) {
  return (systemGlass||radius===0)&&!reducedTransparency&&!highContrast&&(!fullscreen||systemGlass)&&material!=='solid';
}

module.exports = { createWindowMaterial, shouldEnableBlur,supportsSystemGlass };
