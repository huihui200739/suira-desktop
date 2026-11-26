// Original implementation using Windows GDI. Returns physical pixels as lossless PNG.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class CaptureHost {
    [StructLayout(LayoutKind.Sequential)] private struct Rect {public int Left,Top,Right,Bottom;}
    private struct ChildInfo {public IntPtr Hwnd;public long Id,Parent;public Rect Bounds;}
    private delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data);
    private delegate bool WindowCallback(IntPtr hwnd,IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr rect,MonitorCallback callback,IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback,IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent,WindowCallback callback,IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hwnd,int index);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd,StringBuilder name,int max);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr destination,int x,int y,int width,int height,IntPtr source,int sourceX,int sourceY,uint operation);
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd,int attr,out Rect rect,int size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd,int attr,out int value,int size);
    static bool WindowBounds(IntPtr hwnd,out Rect rect) {
        if(DwmGetWindowAttribute(hwnd,9,out rect,Marshal.SizeOf(typeof(Rect)))==0 && rect.Right>rect.Left && rect.Bottom>rect.Top) return true;
        return GetWindowRect(hwnd,out rect) && rect.Right>rect.Left && rect.Bottom>rect.Top;
    }
    static string EnumerateWindows(uint excludePid) {
        StringBuilder output=new StringBuilder("[");bool firstWin=true;int count=0;
        StringBuilder cls=new StringBuilder(128);
        EnumWindows(delegate(IntPtr hwnd,IntPtr _) {
            if(count>=28)return false;
            if(!IsWindowVisible(hwnd)||IsIconic(hwnd))return true;
            uint pid;GetWindowThreadProcessId(hwnd,out pid);
            if(excludePid!=0&&pid==excludePid)return true;
            int cloaked=0;
            if(DwmGetWindowAttribute(hwnd,14,out cloaked,4)==0&&cloaked!=0)return true;
            int ex=GetWindowLong(hwnd,-20);
            if((ex&0x20)!=0&&(ex&0x80000)!=0)return true; // WS_EX_TRANSPARENT | WS_EX_LAYERED
            cls.Length=0;GetClassName(hwnd,cls,cls.Capacity);
            string className=cls.ToString();
            if(className=="Progman"||className=="WorkerW"||className=="EdgeUiInputTopWndClass")return true;
            Rect r;if(!WindowBounds(hwnd,out r))return true;
            int w=r.Right-r.Left,h=r.Bottom-r.Top;
            if(w<16||h<16)return true;
            count++;
            List<ChildInfo> children=new List<ChildInfo>();
            HashSet<string> seen=new HashSet<string>();
            HashSet<long> keptIds=new HashSet<long>();
            seen.Add(r.Left+","+r.Top+","+w+","+h);
            keptIds.Add(hwnd.ToInt64());
            EnumChildWindows(hwnd,delegate(IntPtr child,IntPtr __) {
                if(children.Count>=48)return false;
                if(!IsWindowVisible(child))return true;
                Rect cr;if(!GetWindowRect(child,out cr))return true;
                int cl=Math.Max(r.Left,cr.Left),ct=Math.Max(r.Top,cr.Top),crr=Math.Min(r.Right,cr.Right),cb=Math.Min(r.Bottom,cr.Bottom);
                IntPtr parent=GetParent(child);
                IntPtr ancestor=parent;
                HashSet<long> visVisited=new HashSet<long>();
                while(ancestor!=IntPtr.Zero&&ancestor!=hwnd&&visVisited.Add(ancestor.ToInt64())){
                    if(!IsWindowVisible(ancestor))return true;
                    Rect ar;
                    if(GetWindowRect(ancestor,out ar)){
                        cl=Math.Max(cl,ar.Left);ct=Math.Max(ct,ar.Top);crr=Math.Min(crr,ar.Right);cb=Math.Min(cb,ar.Bottom);
                    }
                    ancestor=GetParent(ancestor);
                }
                int cw=crr-cl,ch=cb-ct;
                if(cw<16||ch<16)return true;
                string key=cl+","+ct+","+cw+","+ch;
                if(seen.Add(key)){
                    long cid=child.ToInt64();
                    keptIds.Add(cid);
                    children.Add(new ChildInfo{Hwnd=child,Id=cid,Parent=parent.ToInt64(),Bounds=new Rect{Left=cl,Top=ct,Right=crr,Bottom=cb}});
                }
                return true;
            },IntPtr.Zero);
            for(int i=0;i<children.Count;i++){
                ChildInfo ci=children[i];
                IntPtr anc=GetParent(ci.Hwnd);
                HashSet<long> walked=new HashSet<long>();
                while(anc!=IntPtr.Zero&&anc!=hwnd&&!keptIds.Contains(anc.ToInt64())&&walked.Add(anc.ToInt64()))anc=GetParent(anc);
                ci.Parent=(anc!=IntPtr.Zero&&anc!=hwnd&&keptIds.Contains(anc.ToInt64())?anc:hwnd).ToInt64();
                children[i]=ci;
            }
            if(!firstWin)output.Append(',');firstWin=false;
            output.Append("{\"id\":").Append(hwnd.ToInt64()).Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top).Append(",\"width\":").Append(w).Append(",\"height\":").Append(h).Append(",\"children\":[");
            for(int i=0;i<children.Count;i++){
                ChildInfo ci=children[i];
                Rect c=ci.Bounds;
                if(i>0)output.Append(',');
                output.Append("{\"id\":").Append(ci.Id).Append(",\"parent\":").Append(ci.Parent).Append(",\"x\":").Append(c.Left).Append(",\"y\":").Append(c.Top).Append(",\"width\":").Append(c.Right-c.Left).Append(",\"height\":").Append(c.Bottom-c.Top).Append('}');
            }
            output.Append("]}");
            return true;
        },IntPtr.Zero);
        return output.Append(']').ToString();
    }
    static string Region(int x,int y,int width,int height) {
        if(width<1||height<1||width>16384||height>16384||(long)width*height>40000000)throw new Exception("invalid-region");
        try{DwmFlush();}catch{}
        using(Bitmap bitmap=new Bitmap(width,height,PixelFormat.Format32bppRgb)) {
            using(Graphics graphics=Graphics.FromImage(bitmap)) {
                IntPtr source=GetDC(IntPtr.Zero),destination=graphics.GetHdc();
                try{if(!BitBlt(destination,0,0,width,height,source,x,y,0x40CC0020))throw new Exception("capture-failed");}
                finally{graphics.ReleaseHdc(destination);ReleaseDC(IntPtr.Zero,source);}
            }
            using(MemoryStream stream=new MemoryStream()) {
                bitmap.Save(stream,ImageFormat.Png);
                return "{\"width\":"+width+",\"height\":"+height+",\"dataUrl\":\"data:image/png;base64,"+Convert.ToBase64String(stream.ToArray())+"\"}";
            }
        }
    }
    public static int Main(string[] args) {
        try {
            try {SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
            if(args.Length>0&&args[0]=="--windows") {
                uint excludePid=args.Length>1?uint.Parse(args[1]):0;
                Console.WriteLine(EnumerateWindows(excludePid));
                return 0;
            }
            if(args.Length>0&&args[0]=="--region-server") {
                string line;
                while((line=Console.ReadLine())!=null) {
                    if(line=="quit")break;
                    try{string[] p=line.Split(' ');if(p.Length!=4)throw new Exception();Console.WriteLine(Region(int.Parse(p[0]),int.Parse(p[1]),int.Parse(p[2]),int.Parse(p[3])));}
                    catch{Console.WriteLine("{\"error\":\"capture-failed\"}");}
                    Console.Out.Flush();
                }
                return 0;
            }
            StringBuilder output=new StringBuilder("[");bool first=true;
            MonitorCallback callback=delegate(IntPtr monitor,IntPtr dc,ref Rect r,IntPtr data){
                int w=r.Right-r.Left,h=r.Bottom-r.Top;
                using(Bitmap bitmap=new Bitmap(w,h,PixelFormat.Format32bppRgb)) {
                    using(Graphics graphics=Graphics.FromImage(bitmap)) {
                        IntPtr source=GetDC(IntPtr.Zero),destination=graphics.GetHdc();
                        try {if(!BitBlt(destination,0,0,w,h,source,r.Left,r.Top,0x40CC0020))return false;}
                        finally {graphics.ReleaseHdc(destination);ReleaseDC(IntPtr.Zero,source);}
                    }
                    using(MemoryStream stream=new MemoryStream()) {
                        bitmap.Save(stream,ImageFormat.Png);
                        if(!first)output.Append(',');first=false;
                        output.Append("{\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top).Append(",\"width\":").Append(w).Append(",\"height\":").Append(h).Append(",\"dataUrl\":\"data:image/png;base64,").Append(Convert.ToBase64String(stream.ToArray())).Append("\"}");
                    }
                }
                return true;
            };
            if(!EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,callback,IntPtr.Zero)||first)return 2;
            Console.WriteLine(output.Append(']').ToString());return 0;
        }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
