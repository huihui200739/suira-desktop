// Extract only local icon resources. No launch, shell execution or network fetch.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class AppIconHost {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    private static extern uint ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, uint count);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, EntryPoint="SHDefExtractIconW")]
    private static extern int SHDefExtractIcon(string file, int index, uint flags, out IntPtr large, out IntPtr small, uint size);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    public static int Main() {
        string line;
        while ((line=Console.ReadLine())!=null) {
            IntPtr large=IntPtr.Zero, small=IntPtr.Zero;
            string result="";
            try {
                string[] parts=line.Split('\t');
                string file=Encoding.UTF8.GetString(Convert.FromBase64String(parts[0]));
                int index=int.Parse(parts[1]);
                if (File.Exists(file)) {
                    // 48 DIP 在高 DPI 屏幕上需要更多源像素，不能再把 32px 放大。
                    SHDefExtractIcon(file,index,0,out large,out small,(32u << 16) | 256u);
                    if(large==IntPtr.Zero && small==IntPtr.Zero)ExtractIconEx(file,index,out large,out small,1);
                    IntPtr handle=large!=IntPtr.Zero?large:small;
                    if(handle!=IntPtr.Zero) {
                        using(Icon icon=Icon.FromHandle(handle))
                        using(Bitmap bitmap=icon.ToBitmap())
                        using(MemoryStream stream=new MemoryStream()) {
                            bitmap.Save(stream,ImageFormat.Png);
                            result="data:image/png;base64,"+Convert.ToBase64String(stream.ToArray());
                        }
                    }
                }
            } catch { }
            finally {
                if(large!=IntPtr.Zero)DestroyIcon(large);
                if(small!=IntPtr.Zero && small!=large)DestroyIcon(small);
            }
            Console.WriteLine(result);
        }
        return 0;
    }
}
