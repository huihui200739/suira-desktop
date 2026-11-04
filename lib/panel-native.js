'use strict';
// A local, synchronous HWND snapshot keeps UI invocation independent of the
// foreground helper's startup/FIFO queue. No hooks or clipboard access.
function createPanelNative({platform=process.platform,load=()=>require('koffi')}={}){
 let api,attempted=false;
 const initialize=()=>{if(attempted)return api;attempted=true;if(platform!=='win32')return null;try{
  const ffi=load(),user=ffi.load('user32.dll'),kernel=ffi.load('kernel32.dll'),dwm=ffi.load('dwmapi.dll');
  api={allowForeground:user.func('__stdcall','AllowSetForegroundWindow','int',['uint32']),foreground:user.func('__stdcall','GetForegroundWindow','uintptr_t',[]),pid:user.func('__stdcall','GetWindowThreadProcessId','uint32',['uintptr_t','uint32 *']),open:kernel.func('__stdcall','OpenProcess','uintptr_t',['uint32','int','uint32']),times:kernel.func('__stdcall','GetProcessTimes','int',['uintptr_t','uint64 *','uint64 *','uint64 *','uint64 *']),close:kernel.func('__stdcall','CloseHandle','int',['uintptr_t']),attribute:dwm.func('__stdcall','DwmSetWindowAttribute','long',['uintptr_t','uint32','int *','uint32'])};
 }catch{api=null;}return api;};
 return {
  allowForeground(pid){if(!Number.isSafeInteger(pid)||pid<=0||pid>=0xffffffff)return false;try{const native=initialize();return Boolean(native&&native.allowForeground(pid));}catch{return false;}},
  foreground(){const native=initialize();if(!native)return null;let handle;try{const hwnd=native.foreground(),pid=Buffer.alloc(4);if(!hwnd)return null;native.pid(hwnd,pid);handle=native.open(0x1000,0,pid.readUInt32LE());if(!handle)return null;const created=Buffer.alloc(8);if(!native.times(handle,created,Buffer.alloc(8),Buffer.alloc(8),Buffer.alloc(8)))return null;const started=Number((created.readBigUInt64LE()-116444736000000000n)/10000n);return {hwnd:String(hwnd),pid:pid.readUInt32LE(),processStartedAt:started,processName:'',title:''};}catch{return null;}finally{if(handle)api.close(handle);}},
  disableTransitions(win){try{const native=initialize(),buffer=win.getNativeWindowHandle(),hwnd=buffer.length===8?buffer.readBigUInt64LE():buffer.readUInt32LE();return Boolean(native&&native.attribute(hwnd,3,[1],4)===0);}catch{return false;}},
 };
}
module.exports={createPanelNative};
