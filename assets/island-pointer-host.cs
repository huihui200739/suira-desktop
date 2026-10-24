// Read-only pointer/button edges. No hooks, clipboard access or input injection.
// DOWN only arms an invisible receiver; HTML dragenter verifies Files before UI opens.
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class IslandPointerHost
{
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int code);
    private static volatile bool stopped;
    public static int Main(string[] args)
    {
        if (Array.IndexOf(args, "-SelfTest") >= 0)
        {
            Console.WriteLine("READY\nPOINTER -1280 4 DOWN\nPOINTER -1270 8 DOWN\nPOINTER -1270 8 UP");
            return 0;
        }
        Thread input = new Thread(delegate() {
            try { while (Console.In.ReadLine() != null) { } } catch { }
            stopped = true;
        });
        input.IsBackground = true;
        input.Start();
        Console.WriteLine("READY");
        Console.Out.Flush();
        bool previous = false;
        bool first = true;
        int lastX = int.MinValue, lastY = int.MinValue;
        while (!stopped)
        {
            Point point;
            if (GetCursorPos(out point))
            {
                bool down = (GetAsyncKeyState(1) & 0x8000) != 0 || (GetAsyncKeyState(2) & 0x8000) != 0;
                if (first || previous != down || (down && (point.X != lastX || point.Y != lastY)))
                {
                    Console.WriteLine("POINTER " + point.X + " " + point.Y + (down ? " DOWN" : " UP"));
                    Console.Out.Flush();
                }
                first = false;
                previous = down;
                lastX = point.X; lastY = point.Y;
            }
            Thread.Sleep(60);
        }
        return 0;
    }
}
