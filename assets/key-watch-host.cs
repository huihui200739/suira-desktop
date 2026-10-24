// Suira key-watch host: minimal replacement for the resident PowerShell helper.
//
// Why this exists:
//   The hold-to-show feature needs key-up edges, which Electron's globalShortcut
//   cannot deliver. The original helper is a persistent PowerShell process that
//   polls GetAsyncKeyState: it works, but costs ~73MB private + ~8MB conhost and
//   ~2.5s to become ready. This tiny host speaks the exact same line protocol
//   (READY / DOWN / UP / ERROR xxx, exits on stdin EOF or "quit") while using
//   ~9MB and being ready in ~20ms.
//
// It is compiled on first use by the system C# compiler (csc.exe, .NET
// Framework 4.x) into the user data directory. If compilation is unavailable
// the app falls back to assets/key-watch.ps1 with identical behaviour.
//
// Keep this file ASCII-only.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class KeyWatchHost
{
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);

    private static volatile bool stopped = false;

    public static int Main(string[] args)
    {
        List<int> codes = new List<int>();
        int pollMs = 25;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "-VkCodes" && i + 1 < args.Length)
            {
                foreach (string part in args[i + 1].Split(','))
                {
                    int vk;
                    if (int.TryParse(part.Trim(), out vk) && vk >= 1 && vk <= 254 && !codes.Contains(vk))
                    {
                        codes.Add(vk);
                    }
                }
                i++;
            }
            else if (args[i] == "-PollMs" && i + 1 < args.Length)
            {
                int.TryParse(args[i + 1], out pollMs);
                i++;
            }
        }
        if (codes.Count == 0) { Console.WriteLine("ERROR no-vk-codes"); return 2; }
        if (pollMs < 5) pollMs = 5;
        if (pollMs > 5000) pollMs = 5000;

        // stdin EOF means the parent is gone: exit instead of lingering forever.
        Thread stdinThread = new Thread(delegate()
        {
            try
            {
                while (Console.In.ReadLine() != null) { }
            }
            catch { }
            stopped = true;
        });
        stdinThread.IsBackground = true;
        stdinThread.Start();

        Console.WriteLine("READY");
        Console.Out.Flush();

        bool held = false;
        while (!stopped)
        {
            bool allDown = true;
            for (int i = 0; i < codes.Count; i++)
            {
                if ((GetAsyncKeyState(codes[i]) & 0x8000) == 0) { allDown = false; break; }
            }
            if (allDown)
            {
                if (!held) { Console.WriteLine("DOWN"); Console.Out.Flush(); held = true; }
            }
            else if (held)
            {
                Console.WriteLine("UP");
                Console.Out.Flush();
                held = false;
            }
            Thread.Sleep(pollMs);
        }
        return 0;
    }
}
