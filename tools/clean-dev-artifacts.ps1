# Remove only known Suira development artifacts. Never clean the live user profile.
param(
  [switch]$Preview,
  [switch]$IncludeLegacyRuntimes,
  [switch]$IncludeLegacyProbes
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$processes = @(Get-CimInstance Win32_Process | Select-Object ExecutablePath, CommandLine)
$targets = [Collections.Generic.List[object]]::new()
$skipped = [Collections.Generic.List[string]]::new()

function Assert-Contained([string]$target, [string]$owner) {
  $absolute = [IO.Path]::GetFullPath($target).TrimEnd('\')
  $allowed = [IO.Path]::GetFullPath($owner).TrimEnd('\') + '\'
  if (-not $absolute.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing a target outside the named cleanup root: $absolute"
  }
  return $absolute
}

function Add-Target([string]$candidate, [string]$owner, [string]$group) {
  $absolute = Assert-Contained $candidate $owner
  if (-not (Test-Path -LiteralPath $absolute)) { return }
  $item = Get-Item -LiteralPath $absolute -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $skipped.Add("Link: $absolute"); return }
  foreach ($process in $processes) {
    if (($process.CommandLine -and $process.CommandLine.IndexOf($absolute, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
        ($process.ExecutablePath -and $process.ExecutablePath.StartsWith($absolute + '\', [StringComparison]::OrdinalIgnoreCase))) {
      $skipped.Add("In use: $absolute"); return
    }
  }
  if ($item.PSIsContainer) {
    $links = @(Get-ChildItem -LiteralPath $absolute -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop)
    if ($links.Count) { $skipped.Add("Contains links: $absolute"); return }
    $bytes = (Get-ChildItem -LiteralPath $absolute -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum
  } else { $bytes = $item.Length }
  $targets.Add([pscustomobject]@{ Path=$absolute; Root=$owner; Group=$group; Bytes=[long]$bytes; Directory=[bool]$item.PSIsContainer })
}

foreach ($name in @('edge-profile','edge-profile2','mem','probe-app','probe-app2','udata-copy','udata-default','udata-test',
                    'launch-suira.cmd','run-app.cmd','run-app2.cmd','run-probe.cmd')) {
  Add-Target (Join-Path $repoRoot ('.workbuddy\' + $name)) $repoRoot 'workspace-test-artifacts'
}
if (Test-Path -LiteralPath (Join-Path $repoRoot '.workbuddy')) {
  Get-ChildItem -LiteralPath (Join-Path $repoRoot '.workbuddy') -File -Filter '*.log' | ForEach-Object {
    Add-Target $_.FullName $repoRoot 'workspace-logs'
  }
}
foreach ($relative in @('tools\.panel-shot','.udata\panel-review','.udata\island-hidden-review','debug.log','.workbuddy\long-frame-0.png','.workbuddy\long-frame-70.png')) {
  Add-Target (Join-Path $repoRoot $relative) $repoRoot 'workspace-test-cache'
}
Get-ChildItem -LiteralPath (Join-Path $repoRoot 'src') -File -Filter '__fx_*' | ForEach-Object {
  Add-Target $_.FullName $repoRoot 'render-test-fixtures'
}

# These names are created only by this repository's regression and benchmark tools.
# In particular, suira-input (the running input helper) is intentionally excluded.
$testDirectoryPattern = '^suira-(?:(?:clipboardbar|island|notes|island-wake|latency|record-writer|recorder-live|capture-bench|doc-shots|bindings|ui-polish|image-editor|long-capture)-[A-Za-z0-9]+|panel-\d+|core-e2e-\d+|ocr-probe-\d+|clipboardbar-shots|island-shots|probe)$'
Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'suira-*' | Where-Object { $_.Name -match $testDirectoryPattern } | ForEach-Object {
  Add-Target $_.FullName $tempRoot 'temporary-test-packages'
}
$testFilePattern = '^suira-(?:foreground-test-[a-f0-9]+\.exe|latency-foreground(?:-v\d+)?\.exe|diag\d*\.log|test\d*\.log|run\d*\.log|start-(?:err|out)\.log|(?:render|sec)-[a-z0-9-]+\.txt|(?:native|corner|real-app)-[a-z0-9-]+\.png|(?:orphan-(?:check|parent)|ps-(?:check|debug)|real-inject)\.js|(?:inject-test|key-inject)\.ps1)$'
Get-ChildItem -LiteralPath $tempRoot -File -Filter 'suira-*' | Where-Object { $_.Name -match $testFilePattern } | ForEach-Object {
  Add-Target $_.FullName $tempRoot 'temporary-test-files'
}

# Superseded icon-only caches/helpers. Preserve all content, keys and current v3 cache.
if ($env:APPDATA) {
  $iconProfileName = ([string][char]0x968f) + ([string][char]0x5e8f) + ' SUIRA'
  $iconProfile = Join-Path $env:APPDATA $iconProfileName
  foreach ($relative in @('cache\app-icons-v1.json','cache\app-icons-v2.json','app-icon-host-v1.exe')) {
    Add-Target (Join-Path $iconProfile $relative) $iconProfile 'obsolete-icon-cache'
  }
}

if ($IncludeLegacyRuntimes) {
  # Old manual-test copies. The active C:\suira-electron runtime is never a target.
  foreach ($name in @('el45','el45copy')) { Add-Target (Join-Path 'C:\temp' $name) 'C:\temp' 'obsolete-electron-copies' }
}
if ($IncludeLegacyProbes) {
  $oldPreviews = Join-Path $repoRoot 'docs\preview'
  if (Test-Path -LiteralPath $oldPreviews) {
    Get-ChildItem -LiteralPath $oldPreviews -File -Filter '*.png' | ForEach-Object { Add-Target $_.FullName $repoRoot 'obsolete-preview-images' }
  }
  foreach ($name in @('.parse-chunks.ps1','.parse-chunks2.ps1','.parse-debug.ps1','.parse-mem-bench.ps1',
                     'app-run.ps1','edge-probe.ps1','probe-run.ps1','ps-run.ps1','sandbox-v1.cmd','sandbox-variants.ps1',
                     'show-main.ps1','task-app.ps1','task-app2.ps1','task-probe.ps1','task-probe2.ps1','task-probe3.ps1','udata-probe.ps1')) {
    Add-Target (Join-Path $PSScriptRoot $name) $repoRoot 'obsolete-local-probe-scripts'
  }
}

$removedBytes = 0L
$removedCount = 0
$failed = [Collections.Generic.List[string]]::new()
if ($Preview) {
  $targets | Group-Object Group | ForEach-Object {
    [pscustomobject]@{ Group=$_.Name; Targets=$_.Count; MB=[math]::Round(($_.Group | Measure-Object Bytes -Sum).Sum / 1MB, 1) }
  } | ConvertTo-Json
} else {
  foreach ($target in $targets) {
    try {
      # Recheck the absolute containment immediately before each recursive delete.
      $checked = Assert-Contained $target.Path $target.Root
      $item = Get-Item -LiteralPath $checked -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Target became a link' }
      if ($target.Directory) { Remove-Item -LiteralPath $checked -Recurse -Force }
      else { Remove-Item -LiteralPath $checked -Force }
      $removedCount++; $removedBytes += $target.Bytes
    } catch { $failed.Add($target.Path + ': ' + $_.Exception.Message) }
  }
  [pscustomobject]@{ RemovedTargets=$removedCount; RemovedMB=[math]::Round($removedBytes/1MB,1); Skipped=@($skipped.ToArray()); Failed=@($failed.ToArray()) } | ConvertTo-Json -Depth 4
  if ($failed.Count) { exit 1 }
}
