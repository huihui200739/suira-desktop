// Small persistent Win32 bridge. One command and one JSON response per line.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class ForegroundHost {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [StructLayout(LayoutKind.Sequential)] struct Point {public int X,Y;public Point(int x,int y){X=x;Y=y;}}
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] struct Placement {public int length,flags,show;public Point min,max;public Rect normal;}
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h,ref Placement placement);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect rect);
    [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref int size);
    static int OwnerPid;
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int mode);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk,scan; public uint flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union u; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    // Query the process handle directly: .NET's process enumeration can omit live
    // processes, which loses the return target and also stops the parent watchdog.
    static bool ProcessIdentity(int pid, out long started, out string name) {
        started=0; name="";
        IntPtr handle=OpenProcess(0x1000,false,pid); // QUERY_LIMITED_INFORMATION
        if(handle==IntPtr.Zero)return false;
        try {
            long created,exited,kernel,user;
            if(!GetProcessTimes(handle,out created,out exited,out kernel,out user))return false;
            StringBuilder path=new StringBuilder(32768);int size=path.Capacity;
            if(!QueryFullProcessImageName(handle,0,path,ref size))return false;
            started=created/10000-11644473600000L;
            name=Path.GetFileNameWithoutExtension(path.ToString());
            return started>0;
        } finally { CloseHandle(handle); }
    }
    static object Snapshot(IntPtr h) {
        if (!IsWindow(h)) return new {ok=false};
        uint pid; GetWindowThreadProcessId(h,out pid);
        long started;string name;
        if(!ProcessIdentity((int)pid,out started,out name))return new {ok=false};
        StringBuilder title=new StringBuilder(4096); GetWindowText(h,title,title.Capacity);
        Rect rect;GetWindowRect(h,out rect);
        Placement placement=new Placement();placement.length=Marshal.SizeOf(typeof(Placement));GetWindowPlacement(h,ref placement);
        return new {ok=true,hwnd=h.ToInt64().ToString(),pid=pid,processName=name,processStartedAt=started,title=title.ToString(),elevated=false,bounds=new{x=rect.Left,y=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top},normalSize=new{width=placement.normal.Right-placement.normal.Left,height=placement.normal.Bottom-placement.normal.Top}};
    }
    static bool Matches(IntPtr h, int pid, long started) {
        if (!IsWindow(h)) return false;
        uint actual; GetWindowThreadProcessId(h,out actual);
        if (actual!=pid) return false;
        long currentStarted;string name;
        return started>0 && ProcessIdentity(pid,out currentStarted,out name) && currentStarted==started;
    }
    static Input Key(ushort vk, bool up) { Input i=new Input(); i.type=1; i.u.keyboard.scan=(ushort)MapVirtualKey(vk,0); i.u.keyboard.flags=8u|(up?2u:0u); return i; }
    static object PlaceOwn(string[] args) {
        IntPtr hwnd=new IntPtr(long.Parse(args[1]));uint pid;GetWindowThreadProcessId(hwnd,out pid);
        if(OwnerPid<=0||pid!=OwnerPid||!IsWindow(hwnd))return new{ok=false,error="not-owned"};
        int x=int.Parse(args[2]),y=int.Parse(args[3]),width=int.Parse(args[4]),height=int.Parse(args[5]);
        uint flags=0x14; // NOZORDER | NOACTIVATE; preserve physical size on moves.
        if(width<0||height<0)flags|=1;
        return new{ok=SetWindowPos(hwnd,IntPtr.Zero,x,y,width,height,flags)};
    }
    static object Focus(string[] args) {
        IntPtr target=new IntPtr(long.Parse(args[1]));int pid=int.Parse(args[2]);long started=long.Parse(args[3]);
        if(!Matches(target,pid,started))return new{ok=false,error="target-changed"};
        if(IsIconic(target))ShowWindow(target,9);
        SetForegroundWindow(target);
        for(int n=0;n<50&&GetForegroundWindow()!=target;n++)Thread.Sleep(4);
        return new{ok=GetForegroundWindow()==target};
    }
    static object Paste(string[] args) {
        IntPtr target=new IntPtr(long.Parse(args[1])); int pid=int.Parse(args[2]); long started=long.Parse(args[3]); int owner=int.Parse(args[4]);
        if (!Matches(target,pid,started)) return new {ok=false,error="target-changed"};
        IntPtr foreground=GetForegroundWindow(); uint foregroundPid; GetWindowThreadProcessId(foreground,out foregroundPid);
        if (foreground!=target && foregroundPid!=owner) return new {ok=false,error="foreground-changed"};
        if (IsIconic(target)) ShowWindow(target,9);
        if (foreground!=target) SetForegroundWindow(target);
        // Wait only as needed, and never paste into a window that stole focus.
        for (int n=0;n<25 && GetForegroundWindow()!=target;n++) Thread.Sleep(4);
        if (GetForegroundWindow()!=target) return new {ok=false,error="focus-failed"};
        // Foreground ownership changes before the other UI thread finishes
        // restoring its focused editor. WM_NULL waits for that activation to run.
        UIntPtr ignored;
        if(SendMessageTimeout(target,0,UIntPtr.Zero,IntPtr.Zero,2,250,out ignored)==IntPtr.Zero)return new {ok=false,error="target-unresponsive"};
        for (int n=0;n<75;n++) {
            bool held=false; foreach (int key in new int[]{0x10,0x11,0x12,0x5B,0x5C}) if ((GetAsyncKeyState(key)&0x8000)!=0) held=true;
            if (!held) break;
            if (n==74) return new {ok=false,error="modifiers-held"};
            Thread.Sleep(4);
        }
        if (GetForegroundWindow()!=target || !Matches(target,pid,started)) return new {ok=false,error="target-changed"};
        Input[] keys={Key(0x11,false),Key(0x56,false),Key(0x56,true),Key(0x11,true)};
        return new {ok=SendInput(4,keys,Marshal.SizeOf(typeof(Input)))==4};
    }
    public static void Main(string[] args) {
        try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{}
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});
        if (args.Length>0) {
            int parent=int.Parse(args[0]);
            OwnerPid=parent;
            IntPtr parentHandle=OpenProcess(0x100000,false,parent); // SYNCHRONIZE: retains this exact process instance.
            if(parentHandle==IntPtr.Zero)return;
            Thread watchdog=new Thread(delegate(){try{while(WaitForSingleObject(parentHandle,2000)==258){}}finally{CloseHandle(parentHandle);}Environment.Exit(0);});
            watchdog.IsBackground=true; watchdog.Start();
        }
        string line;
        while ((line=Console.ReadLine())!=null) {
            string[] parts=line.Split(' '); if(parts[0]=="quit")break;
            object result;
            try {
                if(parts[0]=="ping")result=new {ok=true};
                else if(parts[0]=="get")result=Snapshot(parts.Length>1?new IntPtr(long.Parse(parts[1])):GetForegroundWindow());
                else if(parts[0]=="at")result=Snapshot(GetAncestor(WindowFromPoint(new Point(int.Parse(parts[1]),int.Parse(parts[2]))),2));
                else if(parts[0]=="focus")result=Focus(parts);
                else if(parts[0]=="paste")result=Paste(parts);
                else if(parts[0]=="place")result=PlaceOwn(parts);
                else result=new {ok=false,error="unknown-command"};
            } catch {result=new {ok=false,error="window-unavailable"};}
            Console.WriteLine(Json.Serialize(result)); Console.Out.Flush();
        }
    }
}
