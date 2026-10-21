# Suira foreground window helper (persistent).
# Reads commands on stdin, writes JSON on stdout. ASCII-only on purpose:
# Windows PowerShell 5.1 reads BOM-less files as ANSI, so non-ASCII here would break parsing.
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class SuiraWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@

function Get-Snapshot {
  $hwnd = [SuiraWin32]::GetForegroundWindow()
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
  if ($cmd -eq 'get') {
    try { [Console]::Out.WriteLine((Get-Snapshot)) }
    catch { [Console]::Out.WriteLine('{"ok":false,"error":"exception"}') }
    [Console]::Out.Flush()
  } elseif ($cmd -eq 'ping') {
    [Console]::Out.WriteLine('{"ok":true,"pong":true}')
    [Console]::Out.Flush()
  }
}
