'use strict';
// Opt-in native probe for the single SHChangeNotify call used at install finish.
// No installation, registry change, process termination or data migration.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process');
const {ensureNativeHost}=require('../lib/key-watch');
(async()=>{
 if(process.platform!=='win32')throw Error('This probe requires Windows');
 if(process.argv.length>2)throw Error('Usage: node tools/desktop-refresh-check.js');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-')),source=path.join(tmp,'refresh.cs'),output=path.join(tmp,'result.json');
 try {
 fs.writeFileSync(source,`using System;using System.Diagnostics;using System.IO;using System.Threading;using System.Runtime.InteropServices;using System.Globalization;
class Probe {
 [DllImport("shell32.dll")]static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b);
 [DllImport("user32.dll")]static extern IntPtr GetShellWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string c,string n);
 [DllImport("user32.dll",SetLastError=true)]static extern IntPtr SendMessageTimeout(IntPtr w,uint m,IntPtr a,IntPtr b,uint flags,uint timeout,out IntPtr result);
 static string Phase(IntPtr shell,IntPtr tray) {var clock=Stopwatch.StartNew();double gap=0,ping=0,previous=clock.Elapsed.TotalMilliseconds;int timeouts=0,count=0;
 while(clock.ElapsedMilliseconds<2000){double now=clock.Elapsed.TotalMilliseconds;gap=Math.Max(gap,now-previous);previous=now;foreach(IntPtr hwnd in new IntPtr[]{shell,tray}){if(hwnd==IntPtr.Zero)continue;var p=Stopwatch.StartNew();IntPtr r;if(SendMessageTimeout(hwnd,0,IntPtr.Zero,IntPtr.Zero,2,200,out r)==IntPtr.Zero)timeouts++;ping=Math.Max(ping,p.Elapsed.TotalMilliseconds);}count++;Thread.Sleep(50);}
 return String.Format(CultureInfo.InvariantCulture,"{{\\"maxSampleGapMs\\":{0:F2},\\"maxShellPingMs\\":{1:F2},\\"shellPingTimeouts\\":{2},\\"samples\\":{3}}}",gap,ping,timeouts,count);}
 static void Main(string[] args){IntPtr shell=GetShellWindow(),tray=FindWindow("Shell_TrayWnd",null);if(shell==IntPtr.Zero||tray==IntPtr.Zero)throw new InvalidOperationException("Interactive Windows shell unavailable");string before=Phase(shell,tray);var clock=Stopwatch.StartNew();SHChangeNotify(0x08000000,0,IntPtr.Zero,IntPtr.Zero);double notification=clock.Elapsed.TotalMilliseconds;string after=Phase(shell,tray);File.WriteAllText(args[0],"{\\"before\\":"+before+",\\"notificationMs\\":"+notification.ToString("F2",CultureInfo.InvariantCulture)+",\\"after\\":"+after+"}");}
}`.replace(/\\"/g,'\\"'));
 const exe=await ensureNativeHost({sourcePath:source,targetPath:path.join(tmp,'refresh.exe'),onError:message=>{throw Error(message);}});if(!exe)throw Error('Native compiler unavailable');
 await new Promise((resolve,reject)=>execFile(exe,[output],{windowsHide:true,timeout:12000},error=>error?reject(error):resolve()));
 const result=JSON.parse(fs.readFileSync(output,'utf8'));const report={time:new Date().toISOString(),note:'One desktop association-refresh notification; not a full installation reproduction. A negative probe does not rule out an intermittent GPU or I/O stall.',...result};
 // Print only; preserve the historical report unless explicitly redirected by the caller.
 console.log(JSON.stringify(report,null,2));
 } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
