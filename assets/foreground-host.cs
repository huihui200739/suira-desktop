// Small persistent Win32 bridge. One command and one JSON response per line.
using System;
using System.Diagnostics;
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
    static int OwnerPid;
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int mode);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk,scan; public uint flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union u; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static long Started(Process process) { return (long)(process.StartTime.ToUniversalTime()-new DateTime(1970,1,1)).TotalMilliseconds; }
    static object Snapshot(IntPtr h) {
        if (!IsWindow(h)) return new {ok=false};
        uint pid; GetWindowThreadProcessId(h,out pid);
        using (Process p=Process.GetProcessById((int)pid)) {
            StringBuilder title=new StringBuilder(4096); GetWindowText(h,title,title.Capacity);
            Rect rect;GetWindowRect(h,out rect);
            Placement placement=new Placement();placement.length=Marshal.SizeOf(typeof(Placement));GetWindowPlacement(h,ref placement);
            return new {ok=true,hwnd=h.ToInt64().ToString(),pid=pid,processName=p.ProcessName,processStartedAt=Started(p),title=title.ToString(),elevated=false,bounds=new{x=rect.Left,y=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top},normalSize=new{width=placement.normal.Right-placement.normal.Left,height=placement.normal.Bottom-placement.normal.Top}};
        }
    }
    static bool Matches(IntPtr h, int pid, long started) {
        if (!IsWindow(h)) return false;
        uint actual; GetWindowThreadProcessId(h,out actual);
        if (actual!=pid) return false;
        using (Process p=Process.GetProcessById(pid)) return started>0 && Started(p)==started;
    }
    static Input Key(ushort vk, bool up) { Input i=new Input(); i.type=1; i.u.keyboard.vk=vk; i.u.keyboard.flags=up?2u:0u; return i; }
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
            Thread watchdog=new Thread(delegate(){while(true){Thread.Sleep(2000);try{using(Process p=Process.GetProcessById(parent)){if(p.HasExited)break;}}catch{break;}}Environment.Exit(0);});
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
