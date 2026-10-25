// Original implementation using Windows GDI. Returns physical pixels as lossless PNG.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class CaptureHost {
    [StructLayout(LayoutKind.Sequential)] private struct Rect {public int Left,Top,Right,Bottom;}
    private delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr rect,MonitorCallback callback,IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr destination,int x,int y,int width,int height,IntPtr source,int sourceX,int sourceY,uint operation);
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
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
