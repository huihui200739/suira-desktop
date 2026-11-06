'use strict';

/**
 * 输入注入（SendInput）。
 *
 * 对应开发方案 §7「放回原处的实现约束」：
 * - 唤起前记录目标 HWND / PID / 进程启动时间，提交前再次校验
 * - SendInput 受 UIPI 限制，普通权限不能可靠注入更高完整性级别窗口
 * - 不默认让整个产品以管理员身份常驻
 *
 * 实现方式：Node 无法直接调 Win32 SendInput，这里用 PowerShell 的 Add-Type
 * 内联编译一小段 C# 完成调用。相比 node-gyp 原生模块，这条路不需要编译工具链，
 * 且与已有的 foreground-helper 一致（同样是 PowerShell 桥接）。
 *
 * 安全性：注入内容通过 stdin 传入，不拼接进命令行，避免转义与注入问题。
 */

const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const INJECT_TIMEOUT = 4000;

/**
 * 内联 C# 脚本：调用 SendInput 发送 Ctrl+V。
 *
 * 关键点：
 * - 用 KEYEVENTF_SCANCODE 走扫描码，兼容性比虚拟键更好
 * - 按下与抬起之间留极短间隔，避免某些应用漏读
 * - 返回是否成功发送（不代表目标一定消费）
 */
const PS_SCRIPT = `
param([string]$mode = 'paste', [string]$payload = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SuiraInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION u;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_SCANCODE = 0x0008;
    const uint VK_CONTROL = 0x11;
    const uint VK_V = 0x56;
    const uint VK_C = 0x43;
    const uint VK_RETURN = 0x0D;
    const uint VK_S = 0x53;

    static INPUT Key(ushort vk, bool up) {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.u.ki.wVk = vk;
        input.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        input.u.ki.dwFlags = KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0);
        input.u.ki.time = 0;
        input.u.ki.dwExtraInfo = IntPtr.Zero;
        return input;
    }

    public static bool SendPaste() {
        INPUT[] inputs = new INPUT[4];
        inputs[0] = Key((ushort)VK_CONTROL, false);
        inputs[1] = Key((ushort)VK_V, false);
        inputs[2] = Key((ushort)VK_V, true);
        inputs[3] = Key((ushort)VK_CONTROL, true);
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return sent == inputs.Length;
    }

    public static bool SendEnter() {
        INPUT[] inputs = new INPUT[2];
        inputs[0] = Key((ushort)VK_RETURN, false);
        inputs[1] = Key((ushort)VK_RETURN, true);
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return sent == inputs.Length;
    }

    public static bool SendCopy() {
        INPUT[] inputs = { Key((ushort)VK_CONTROL,false), Key((ushort)VK_C,false), Key((ushort)VK_C,true), Key((ushort)VK_CONTROL,true) };
        return SendInput(4, inputs, Marshal.SizeOf(typeof(INPUT))) == 4;
    }

    public static bool SendSave() {
        INPUT[] inputs = new INPUT[4];
        inputs[0] = Key((ushort)VK_CONTROL, false);
        inputs[1] = Key((ushort)VK_S, false);
        inputs[2] = Key((ushort)VK_S, true);
        inputs[3] = Key((ushort)VK_CONTROL, true);
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        return sent == inputs.Length;
    }
}
'@

if ($mode -eq 'paste') {
  $ok = [SuiraInput]::SendPaste()
  [Console]::Out.Write((ConvertTo-Json @{ ok = $ok } -Compress))
} elseif ($mode -eq 'copy') {
  $ok = [SuiraInput]::SendCopy()
  [Console]::Out.Write((ConvertTo-Json @{ ok = $ok } -Compress))
} elseif ($mode -eq 'enter') {
  $ok = [SuiraInput]::SendEnter()
  [Console]::Out.Write((ConvertTo-Json @{ ok = $ok } -Compress))
} elseif ($mode -eq 'save') {
  $ok = [SuiraInput]::SendSave()
  [Console]::Out.Write((ConvertTo-Json @{ ok = $ok } -Compress))
} else {
  [Console]::Out.Write((ConvertTo-Json @{ ok = $false; error = 'unknown mode' } -Compress))
}
`;

/**
 * 输入注入器。
 *
 * 粘贴使用短命进程；划词复制通过进程内 SendInput 完成，避免延迟注入。
 * 粘贴是低频操作（用户显式提交时），
 * 且 Add-Type 编译结果在同一次调用内复用，不需要跨调用保持。
 * 常驻会多占一个 PowerShell 进程，收益不足以抵消成本。
 */
class InputInjector {
  constructor(options = {}) {
    this.spawnImpl = options.spawn || spawn;
    this.scriptPath = options.scriptPath || this.writeScript();
    this.disposed = false;
    this.copyInput = options.copyInput || null;
  }

  /** 把脚本写到临时文件（避免命令行转义问题）。 */
  writeScript() {
    const dir = path.join(require('node:os').tmpdir(), 'suira-input');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const file = path.join(dir, 'inject.ps1');
    try {
      fs.writeFileSync(file, PS_SCRIPT, 'utf8');
      return file;
    } catch {
      return null;
    }
  }

  isAvailable() {
    return process.platform === 'win32' && Boolean(this.scriptPath) && fs.existsSync(this.scriptPath);
  }

  /**
   * 发送 Ctrl+V。
   * @returns {Promise<{ok:boolean, error:string}>}
   */
  paste() {
    return this.run('paste');
  }

  copyNative() {
    if(this.copyInput)return this.copyInput;
    if(process.platform!=='win32'||this.disposed)return null;
    try{
      const koffi=require('koffi'),user=koffi.load('user32.dll');
      this.copyInput={foreground:user.func('__stdcall','GetForegroundWindow','uintptr_t',[]),pid:user.func('__stdcall','GetWindowThreadProcessId','uint32',['uintptr_t','uint32 *']),sequence:user.func('__stdcall','GetClipboardSequenceNumber','uint32',[]),held:user.func('__stdcall','GetAsyncKeyState','short',['int']),scan:user.func('__stdcall','MapVirtualKeyW','uint32',['uint32','uint32']),send:user.func('__stdcall','SendInput','uint32',['uint32','void *','int'])};
      return this.copyInput;
    }catch{return null;}
  }
  clipboardSequence(){try{return this.copyNative()?.sequence()??null;}catch{return null;}}
  /** Fast copy never starts a deferred helper that could inject after timeout. */
  async sendCopy(target){
    const native=this.copyNative();if(!native||this.disposed||!target?.hwnd)return {ok:false};
    try{
      for(let i=0;i<25;i++){
        if(String(native.foreground())!==String(target.hwnd))return {ok:false};
        if(![0x10,0x11,0x12,0x5b,0x5c].some(key=>(native.held(key)&0x8000)!==0))break;
        if(i===24)return {ok:false};await new Promise(resolve=>setTimeout(resolve,8));
      }
      const pid=Buffer.alloc(4);native.pid(native.foreground(),pid);if(pid.readUInt32LE()!==Number(target.pid))return {ok:false};
      const stride=process.arch==='ia32'?28:40,union=process.arch==='ia32'?4:8,keys=Buffer.alloc(stride*4);
      [0x11,0x43,0x43,0x11].forEach((key,i)=>{const at=i*stride;keys.writeUInt32LE(1,at);keys.writeUInt16LE(key,at+union);keys.writeUInt16LE(native.scan(key,0),at+union+2);keys.writeUInt32LE(8|(i>=2?2:0),at+union+4);});
      return {ok:native.send(4,keys,stride)===4};
    }catch{return {ok:false};}
  }

  /** 发送回车。 */
  enter() {
    return this.run('enter');
  }

  run(mode) {
    return new Promise((resolve) => {
      if (this.disposed) { resolve({ ok: false, error: '注入器已释放' }); return; }
      if (!this.isAvailable()) { resolve({ ok: false, error: '当前平台不支持输入注入' }); return; }

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => finish({ ok: false, error: '注入超时' }), INJECT_TIMEOUT);

      let child;
      try {
        child = this.spawnImpl('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', this.scriptPath, '-mode', mode
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        finish({ ok: false, error: error.message });
        return;
      }

      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('error', (error) => finish({ ok: false, error: error.message }));
      child.on('close', () => {
        const text = out.trim();
        if (!text) { finish({ ok: false, error: '注入无返回' }); return; }
        try {
          const parsed = JSON.parse(text.split('\n').pop());
          finish({ ok: parsed.ok === true, error: parsed.error || '' });
        } catch {
          finish({ ok: false, error: '注入返回无法解析' });
        }
      });
    });
  }

  dispose() {
    this.disposed = true;
  }
}

module.exports = { InputInjector, PS_SCRIPT, INJECT_TIMEOUT };
