<#
.SYNOPSIS
  Suira background-memory benchmark: launch a real app instance, sample the
  process tree working set / private bytes, optionally close the main window
  to tray and sample the background steady state.

.DESCRIPTION
  Observation only; does not modify app data. Writes JSON + human-readable
  tables to .workbuddy/mem/.

  NOTE: this file is intentionally ASCII-only. Windows PowerShell 5.1 reads
  UTF-8 files without a BOM as ANSI; CJK bytes then swallow newlines and the
  script fails to parse. Keep comments/strings English here.

  The app is launched with --no-sandbox because the agent shell runs inside a
  DSH Job Object where Chromium's sandbox broker cannot get job-breakaway and
  exits with STATUS_BREAKPOINT (0x80000003). Process composition (browser,
  GPU, renderer) is the same; the sandbox token is just removed for measuring.
  The product itself keeps its sandbox when launched normally.

.EXAMPLE
  powershell -NoProfile -File tools/mem-bench.ps1 -Label baseline -CloseMain
#>
[CmdletBinding()]
param(
  [string]$Label = 'run',
  [switch]$CloseMain,
  [int]$StartupSettleSec = 12,
  [int]$BackgroundWaitSec = 200,
  [switch]$KillAtEnd,
  [string[]]$ExtraArgs = @(),
  [string]$UserDataDir = '',
  [string]$ExePath = '',
  [string]$AppDir = '',
  [switch]$Sandbox,
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root '.workbuddy\mem' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Chromium cannot create its profile lock in non-ASCII paths from this shell
# (process_singleton_win.cc "access denied"), so measurements use an isolated
# ASCII workspace profile by default.
if (-not $UserDataDir) { $UserDataDir = Join-Path $root '.workbuddy\mem-bench-udata' }
New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null

if (-not $ExePath) { $ExePath = Join-Path $root 'node_modules\electron\dist\electron.exe' }
if (-not $AppDir) { $AppDir = $root }
$electronExe = $ExePath
if (-not (Test-Path $electronExe)) { throw "electron.exe not found: $electronExe" }

# ELECTRON_RUN_AS_NODE turns Electron into plain Node.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# Single-instance lock: make sure nothing is already running.
$stale = Get-Process electron -ErrorAction SilentlyContinue
if ($stale) { throw "electron already running (PIDs: $($stale.Id -join ',')), close it first" }

$sandboxArgs = @()
if (-not $Sandbox) { $sandboxArgs += '--no-sandbox' }
$electronArgs = $sandboxArgs + @(('--user-data-dir=' + $UserDataDir)) + @($ExtraArgs) + @($AppDir)
$appCwd = $AppDir

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MemWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static List<IntPtr> WindowsOfPid(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string Describe(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, sb.Capacity);
    RECT r; GetWindowRect(h, out r);
    return string.Format("{0}x{1}@{2},{3} title={4}", r.Right - r.Left, r.Bottom - r.Top, r.Left, r.Top, sb.ToString());
  }
}
'@

function Get-Tree([int]$RootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
  $byParent = @{}
  foreach ($p in $all) {
    $parentId = [int]$p.ParentProcessId
    if (-not $byParent.ContainsKey($parentId)) { $byParent[$parentId] = @() }
    $byParent[$parentId] += $p
  }
  $result = @()
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue([int]$RootPid)
  $seen = @{}
  while ($queue.Count -gt 0) {
    $current = [int]$queue.Dequeue()
    if ($seen.ContainsKey($current)) { continue }
    $seen[$current] = $true
    $proc = $all | Where-Object { [int]$_.ProcessId -eq $current } | Select-Object -First 1
    if ($proc) {
      $result += $proc
      if ($byParent.ContainsKey($current)) {
        foreach ($child in $byParent[$current]) { $queue.Enqueue([int]$child.ProcessId) }
      }
    }
  }
  return $result
}

function Get-ProcKind([string]$name, [string]$cmd) {
  if ($name -match 'electron') {
    if ($cmd -match '--type=([a-z-]+)') {
      $t = $Matches[1]
      if ($t -eq 'renderer') { return 'renderer' }
      if ($t -eq 'gpu-process') { return 'gpu' }
      if ($t -eq 'utility') { return 'utility' }
      if ($t -eq 'crashpad-handler') { return 'crashpad' }
      return $t
    }
    return 'browser(main)'
  }
  if ($name -match 'powershell|pwsh') { return 'powershell-helper' }
  if ($name -match 'conhost') { return 'conhost' }
  return $name
}

function Sample-Once([int]$RootPid, [string]$Stage) {
  $tree = Get-Tree -RootPid $RootPid
  $rows = @()
  foreach ($p in $tree) {
    $proc = Get-Process -Id ([int]$p.ProcessId) -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    $ws = 0L; $pm = 0L; $cpu = 0.0
    try { $ws = [int64]$proc.WorkingSet64 } catch {}
    try { $pm = [int64]$proc.PrivateMemorySize64 } catch {}
    try { $cpu = [double]$proc.CPU } catch {}
    $kind = Get-ProcKind $p.Name $p.CommandLine
    $cmdText = ''
    if ($p.CommandLine) { $cmdText = $p.CommandLine.Substring(0, [Math]::Min(200, $p.CommandLine.Length)) }
    $rows += [pscustomobject]@{
      pid = [int]$p.ProcessId
      name = $p.Name
      kind = $kind
      workingSetMB = [math]::Round($ws / 1MB, 1)
      privateMB = [math]::Round($pm / 1MB, 1)
      cpuSec = [math]::Round($cpu, 1)
      cmd = $cmdText
    }
  }
  return [pscustomobject]@{
    stage = $Stage
    at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    processCount = $rows.Count
    totalWorkingSetMB = [math]::Round((($rows | Measure-Object workingSetMB -Sum).Sum), 1)
    totalPrivateMB = [math]::Round((($rows | Measure-Object privateMB -Sum).Sum), 1)
    processes = $rows | Sort-Object workingSetMB -Descending
  }
}

function Show-Sample($s) {
  Write-Host ""
  Write-Host ("==== {0} @ {1} ====" -f $s.stage, $s.at) -ForegroundColor Cyan
  Write-Host ("processes {0} | total working set {1} MB | total private {2} MB" -f $s.processCount, $s.totalWorkingSetMB, $s.totalPrivateMB) -ForegroundColor Yellow
  $s.processes | Format-Table kind, pid, workingSetMB, privateMB, cpuSec, cmd -AutoSize | Out-String -Width 400 | Write-Host
}

$startedAt = Get-Date
Write-Host ("launch: {0} {1} (cwd={2})" -f $electronExe, ($electronArgs -join ' '), $appCwd)
# Use CreateProcess (UseShellExecute=false) instead of Start-Process/ShellExecute:
# ShellExecute can block on an "Open File - Security Warning" dialog, which is
# impossible to dismiss while the workstation is locked.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $electronExe
$psi.Arguments = ($electronArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
$psi.WorkingDirectory = $appCwd
$psi.UseShellExecute = $false
$appProc = [System.Diagnostics.Process]::Start($psi)
$rootPid = $appProc.Id
Write-Host ("browser pid = {0}, waiting {1}s for startup settlement..." -f $rootPid, $StartupSettleSec)

# Startup stage: wait until a visible window appears (max 40s).
$visible = $false
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  $wins = [MemWin]::WindowsOfPid([uint32]$rootPid)
  foreach ($h in $wins) {
    if ([MemWin]::IsWindowVisible($h)) { $visible = $true; break }
  }
  if ($visible -and ((Get-Date) - $startedAt).TotalSeconds -ge $StartupSettleSec) { break }
  $alive = Get-Process -Id $rootPid -ErrorAction SilentlyContinue
  if (-not $alive) { break }
}
if (-not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) {
  throw "app process exited during startup (skip: sandbox flags?)"
}
if (-not $visible) { Write-Warning "no visible window within 40s, sampling anyway" }
Start-Sleep -Seconds 2

$startup = Sample-Once -RootPid $rootPid -Stage 'startup-idle'
Show-Sample $startup

$samples = @($startup)
$mainWindowClosed = $false

if ($CloseMain) {
  $wins = [MemWin]::WindowsOfPid([uint32]$rootPid)
  $visibleWins = @()
  $mainHandle = [IntPtr]::Zero
  $mainArea = 0
  foreach ($h in $wins) {
    if (-not [MemWin]::IsWindowVisible($h)) { continue }
    $desc = [MemWin]::Describe($h)
    Write-Host ("visible window: {0}" -f $desc)
    $visibleWins += $h
    $rect = New-Object MemWin+RECT
    [void][MemWin]::GetWindowRect($h, [ref]$rect)
    $area = ([int64]($rect.Right - $rect.Left)) * ([int64]($rect.Bottom - $rect.Top))
    if ($area -gt $mainArea) { $mainArea = $area; $mainHandle = $h }
  }
  # Only close the main window: the island is a resident drop target and must
  # stay alive in the background. It is visible too (transparent sleep hotzone).
  if ($mainHandle -ne [IntPtr]::Zero) {
    [void][MemWin]::PostMessage($mainHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_CLOSE
  }
  $mainWindowClosed = $mainHandle -ne [IntPtr]::Zero
  Write-Host ("sent WM_CLOSE to the largest visible window only (should go to tray, not quit)")
  Start-Sleep -Seconds 4
  if (-not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) {
    throw "main process exited: WM_CLOSE was not intercepted as tray-close"
  }

  # Staged sampling to see the idle-teardown curve.
  $elapsed = 0
  $marks = @(30, 65, 125, 185, 205)
  foreach ($mark in $marks) {
    if ($mark -ge $BackgroundWaitSec) { break }
    $wait = [Math]::Max(1, $mark - $elapsed)
    Start-Sleep -Seconds $wait
    $elapsed = $mark
    $s = Sample-Once -RootPid $rootPid -Stage ("background-{0}s" -f $mark)
    Show-Sample $s
    $samples += $s
  }
  if ($BackgroundWaitSec -gt $elapsed) {
    Start-Sleep -Seconds ($BackgroundWaitSec - $elapsed)
    $s = Sample-Once -RootPid $rootPid -Stage ("background-{0}s" -f $BackgroundWaitSec)
    Show-Sample $s
    $samples += $s
  }
}

$final = $samples[-1]
$report = [pscustomobject]@{
  label = $Label
  generatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  electron = (Get-Content (Join-Path $root 'node_modules\electron\dist\version') -ErrorAction SilentlyContinue) -join ''
  gitHead = (git -C $root rev-parse --short HEAD 2>$null) -join ''
  workingTreeDirty = [bool](git -C $root status --porcelain 2>$null)
  noSandbox = (-not $Sandbox)
  sandbox = [bool]$Sandbox
  exePath = $electronExe
  appDir = $AppDir
  userDataDir = $UserDataDir
  extraArgs = @($ExtraArgs)
  mainWindowClosed = $mainWindowClosed
  samples = $samples
}

$jsonPath = Join-Path $OutDir ("{0}-{1}.json" -f $Label, (Get-Date).ToString('yyyyMMdd-HHmmss'))
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $jsonPath -Encoding utf8
Write-Host ""
Write-Host ("report: {0}" -f $jsonPath) -ForegroundColor Green
Write-Host ("final sample: {0} processes / {1} MB working set / {2} MB private" -f $final.processCount, $final.totalWorkingSetMB, $final.totalPrivateMB) -ForegroundColor Yellow

if ($KillAtEnd) {
  Write-Host "killing process tree..."
  $tree = Get-Tree -RootPid $rootPid
  foreach ($p in ($tree | Sort-Object ProcessId -Descending)) {
    Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue
  Write-Host "done."
} else {
  Write-Host ("instance still running (browser pid={0}). Stop it with: Stop-Process -Id {0} -Force" -f $rootPid)
}
