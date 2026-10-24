# Suira foreground window helper (persistent).
# Reads commands on stdin, writes JSON on stdout. ASCII-only on purpose:
# Windows PowerShell 5.1 reads BOM-less files as ANSI, so non-ASCII here would break parsing.
#
# -ParentPid starts a watchdog: if the Electron main process disappears without
# closing stdin (forced kill, crash), this helper exits on its own instead of
# leaking a ~80MB process until reboot.
param(
  [int]$ParentPid = 0
)

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class SuiraWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);

  // Watch the parent process and exit the moment it is gone. Runs on a
  // background thread so the blocking stdin read loop needs no changes.
  public static void WatchParent(int pid) {
    if (pid <= 0) return;
    var thread = new Thread(() => {
      while (true) {
        Thread.Sleep(2000);
        try {
          var parent = Process.GetProcessById(pid);
          if (parent.HasExited) { break; }
        } catch { break; }
      }
      Environment.Exit(0);
    });
    thread.IsBackground = true;
    thread.Start();
  }
}
"@

[SuiraWin32]::WatchParent($ParentPid)

function Get-Snapshot([string]$handle = '') {
  $hwnd = if ($handle) { [IntPtr]::new([long]$handle) } else { [SuiraWin32]::GetForegroundWindow() }
  if (-not [SuiraWin32]::IsWindow($hwnd)) { return '{"ok":false}' }
  if ($hwnd -eq [IntPtr]::Zero) { return '{"ok":false,"error":"no-foreground"}' }

  $procId = 0
  [void][SuiraWin32]::GetWindowThreadProcessId($hwnd, [ref]$procId)

  $len = [SuiraWin32]::GetWindowTextLength($hwnd)
  $sb = New-Object System.Text.StringBuilder ($len + 2)
  [void][SuiraWin32]::GetWindowText($hwnd, $sb, $sb.Capacity)
  $title = $sb.ToString()

  $processName = ''
  $startedAt = 0
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    $processName = $p.ProcessName
    $startedAt = [int64]($p.StartTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds
  } catch {}

  $obj = [ordered]@{
    ok = $true
    hwnd = $hwnd.ToInt64().ToString()
    pid = [int]$procId
    processName = $processName
    processStartedAt = $startedAt
    title = $title
    elevated = $false
  }
  return ($obj | ConvertTo-Json -Compress)
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$stdin = [Console]::In
while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  $cmd = $line.Trim()
  if ($cmd -eq '') { continue }
  if ($cmd -eq 'quit') { break }
  if ($cmd -eq 'get' -or $cmd -match '^get [0-9]+$') {
    try { [Console]::Out.WriteLine((Get-Snapshot ($cmd -replace '^get\s*', ''))) }
    catch { [Console]::Out.WriteLine('{"ok":false,"error":"exception"}') }
    [Console]::Out.Flush()
  } elseif ($cmd -eq 'ping') {
    [Console]::Out.WriteLine('{"ok":true,"pong":true}')
    [Console]::Out.Flush()
  }
}
