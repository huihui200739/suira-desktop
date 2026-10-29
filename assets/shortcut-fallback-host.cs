// Exact configured shortcuts only. No typed text is collected or emitted.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
public static class ShortcutFallbackHost {
  public class Binding { public string name; public int key; public int modifiers; }
  delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct Keyboard { public uint key, scan, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; }
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type,Hook callback,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr hwnd,uint min,uint max);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr wParam,IntPtr lParam);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll",CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
  static readonly object gate=new object();
  static Binding[] bindings=new Binding[0];
  static readonly HashSet<int> held=new HashSet<int>();
  static readonly JavaScriptSerializer json=new JavaScriptSerializer();
  static readonly Hook callback=OnKey;
  static IntPtr hook;
  static bool Down(int key){return (GetAsyncKeyState(key)&0x8000)!=0;}
  static IntPtr OnKey(int code,IntPtr message,IntPtr data){
    if(code>=0){
      int kind=message.ToInt32();Keyboard key=(Keyboard)Marshal.PtrToStructure(data,typeof(Keyboard));
      if(kind==0x101||kind==0x105){if(held.Remove((int)key.key))return (IntPtr)1;}
      if(kind==0x100||kind==0x104){
        int modifiers=(Down(0x12)?1:0)|(Down(0x11)?2:0)|(Down(0x10)?4:0)|((Down(0x5b)||Down(0x5c))?8:0);
        Binding[] current;lock(gate)current=bindings;
        foreach(Binding binding in current)if(binding.key==key.key&&binding.modifiers==modifiers){
          if(held.Add((int)key.key)){Console.WriteLine(json.Serialize(new { name=binding.name }));Console.Out.Flush();}
          return (IntPtr)1;
        }
      }
    }
    return CallNextHookEx(hook,code,message,data);
  }
  public static int Main(){
    uint thread=GetCurrentThreadId();
    hook=SetWindowsHookEx(13,callback,GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName),0);
    if(hook==IntPtr.Zero){Console.WriteLine("ERROR "+Marshal.GetLastWin32Error());return 2;}
    Thread input=new Thread(delegate(){
      try{string line;while((line=Console.In.ReadLine())!=null){Binding[] next=json.Deserialize<Binding[]>(line);lock(gate)bindings=next??new Binding[0];}}
      catch{}finally{PostThreadMessage(thread,0x12,UIntPtr.Zero,IntPtr.Zero);}
    });input.IsBackground=true;input.Start();
    Console.WriteLine("READY");Console.Out.Flush();
    try{Message message;while(GetMessage(out message,IntPtr.Zero,0,0)>0){}}
    finally{UnhookWindowsHookEx(hook);}
    return 0;
  }
}
