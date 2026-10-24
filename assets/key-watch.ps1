# Suira key watch helper (persistent).
#
# Polls user32!GetAsyncKeyState for a set of virtual-key codes and reports edges
# on stdout, one token per line, so the parent can implement "hold to show,
# release to hide" on top of Electron's press-only globalShortcut:
#
#   READY           printed once, after the P/Invoke type has compiled and the
#                   poll loop is about to start; the parent may consider the
#                   helper usable from this point on
#   DOWN            rising edge: every watched key is now held down. Only
#                   printed on the transition, never repeated while held
#   UP              falling edge: at least one watched key is no longer held.
#                   Only printed on the transition, never repeated
#   ERROR <reason>  fatal problem (bad arguments, P/Invoke failure, broken
#                   stdout); printed as a single line, then the process exits
#   DONE            -SelfTest only, after READY DOWN UP DOWN UP
#
# Protocol details the parent relies on:
# - stdout is line buffered and flushed after every token;
# - the script stays silent otherwise (no banner, no progress output);
# - only ASCII ever leaves this process. Windows PowerShell 5.1 reads BOM-less
#   files as ANSI, and the parent decodes stdout as UTF-8, so non-ASCII output
#   or source text would be a parsing hazard.
#
# -SelfTest does not read the real keyboard: it replays the protocol with
# -PollMs spacing, which lets a test harness verify script syntax, edge
# de-duplication, error-free startup and process lifecycle on a machine where
# nobody can physically hold a key.
#
# Parent death: stdin is watched on a real background thread (inside the
# compiled helper); EOF (or a "quit"/"stop" line) ends the poll loop, so an
# orphaned helper never outlives its parent. Windows PowerShell 5.1's
# [Console]::In.ReadLineAsync() must NOT be used here: it blocks synchronously
# on a redirected pipe and would deadlock before READY is ever printed.

param(
  [string]$VkCodes = '',
  [int]$PollMs = 25,
  [int]$ParentPid = 0,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

# One line on stdout, flushed immediately. The parent parses per line, so a
# token must never sit in a buffer until process exit.
function Write-Line([string]$Text) {
  [Console]::Out.WriteLine($Text)
  [Console]::Out.Flush()
}

# Collapse an exception into one short ASCII token so "ERROR <reason>" stays
# parsable even when the message contains newlines or CJK paths.
function Format-Reason($ErrorRecord) {
  $message = ''
  try { $message = [string]$ErrorRecord.Exception.Message } catch { $message = '' }
  if (-not $message) { $message = 'unknown-error' }
  $message = ($message -replace '\s+', ' ').Trim()
  $message = $message -replace '[^\x20-\x7E]', '?'
  if ($message.Length -gt 200) { $message = $message.Substring(0, 200) }
  return $message
}

# ASCII output encoding keeps the byte stream identical to what the parent
# decodes, regardless of the machine's console code page.
try { [Console]::OutputEncoding = [System.Text.Encoding]::ASCII } catch {}

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class SuiraKeyWatch {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);

  // Second safety net next to the stdin EOF watcher: if the parent is
  // force-killed the pipe can survive long enough for this helper to keep
  // polling, and a leaked helper costs ~90MB until the machine reboots.
  public static void WatchParent(int pid) {
    if (pid <= 0) return;
    var thread = new Thread(() => {
      while (true) {
        Thread.Sleep(2000);
        try {
          var parent = System.Diagnostics.Process.GetProcessById(pid);
          if (parent.HasExited) { parentGone = true; return; }
        } catch { parentGone = true; return; }
      }
    });
    thread.IsBackground = true;
    thread.Start();
  }

  private static volatile bool parentGone = false;
  private static Thread stdinThread = null;

  public static bool ParentGone {
    get { return parentGone; }
  }

  // Background thread: blocks on stdin, flips parentGone on EOF or on an
  // explicit quit/stop command. Kept in C# because the PowerShell layer has
  // no non-blocking stdin read on Windows PowerShell 5.1.
  public static void StartStdinWatch() {
    stdinThread = new Thread(delegate() {
      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
          string command = line.Trim().ToLowerInvariant();
          if (command == "quit" || command == "stop") { parentGone = true; return; }
        }
        parentGone = true;
      } catch {
        parentGone = true;
      }
    });
    stdinThread.IsBackground = true;
    stdinThread.Start();
  }
}
"@
} catch {
  try { Write-Line ('ERROR add-type ' + (Format-Reason $_)) } catch {}
  exit 1
}

# Start the stdin watcher before the first token is printed: if the parent is
# already gone, the loop must not advertise READY.
$stdinWatched = $false
try {
  if ([Console]::IsInputRedirected) {
    [SuiraKeyWatch]::StartStdinWatch()
    $stdinWatched = $true
  }
} catch {
  $stdinWatched = $false
}

# True when the parent side is gone. Checked once per poll tick; a volatile
# flag set by the background thread, so this never blocks.
function Test-ParentGone {
  try { return [SuiraKeyWatch]::ParentGone } catch { return $false }
}

try {
  try { [SuiraKeyWatch]::WatchParent($ParentPid) } catch {}

  # Clamp the poll interval: below 5ms wastes a core, above 5s makes the
  # helper useless for a hold interaction.
  if ($PollMs -lt 5) { $PollMs = 5 }
  if ($PollMs -gt 5000) { $PollMs = 5000 }

  if ($SelfTest) {
    # The replay must always be complete, even when stdin is already at EOF
    # (e.g. run from a non-interactive shell): a harness verifying the
    # protocol must never see READY truncated to a bare "READY".
    Write-Line 'READY'
    foreach ($state in @('DOWN', 'UP', 'DOWN', 'UP')) {
      Start-Sleep -Milliseconds $PollMs
      Write-Line $state
    }
    Write-Line 'DONE'
    # With a parent attached, stay alive briefly after DONE so the harness can
    # observe the whole sequence and then close stdin on its own schedule.
    # Under a console (stdin not redirected) just exit after DONE.
    if ($stdinWatched) {
      $deadline = (Get-Date).AddSeconds(30)
      while (-not (Test-ParentGone)) {
        if ((Get-Date) -gt $deadline) { break }
        Start-Sleep -Milliseconds 25
      }
    }
    exit 0
  }

  $codes = New-Object System.Collections.Generic.List[int]
  if ($VkCodes.Trim().Length -gt 0) {
    foreach ($part in $VkCodes.Split(',')) {
      $text = $part.Trim()
      if ($text.Length -eq 0) { continue }
      $value = 0
      if (-not [int]::TryParse($text, [ref]$value)) {
        Write-Line ('ERROR invalid-vk ' + $text)
        exit 2
      }
      if ($value -lt 1 -or $value -gt 254) {
        Write-Line ('ERROR vk-out-of-range ' + $text)
        exit 2
      }
      if (-not $codes.Contains($value)) { $codes.Add($value) }
    }
  }
  if ($codes.Count -eq 0) {
    Write-Line 'ERROR no-vk-codes'
    exit 2
  }

  Write-Line 'READY'

  # Rising edge of "all watched keys down" -> DOWN; falling edge -> UP.
  # GetAsyncKeyState's low byte is unreliable, only the 0x8000 bit is used.
  $held = $false
  while ($true) {
    if (Test-ParentGone) { break }
    $allDown = $true
    foreach ($vk in $codes) {
      if (([SuiraKeyWatch]::GetAsyncKeyState($vk) -band 0x8000) -eq 0) {
        $allDown = $false
        break
      }
    }
    if ($allDown) {
      if (-not $held) {
        Write-Line 'DOWN'
        $held = $true
      }
    } elseif ($held) {
      Write-Line 'UP'
      $held = $false
    }
    Start-Sleep -Milliseconds $PollMs
  }
  exit 0
} catch {
  try { Write-Line ('ERROR ' + (Format-Reason $_)) } catch {}
  exit 1
}
