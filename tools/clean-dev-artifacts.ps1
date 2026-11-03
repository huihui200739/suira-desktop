# Remove only known Suira development artifacts. Never clean the live user profile.
param(
  [switch]$Preview,
  [switch]$IncludeObsoletePackages,
  [switch]$InstalledOnly,
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
  if ($targets.Path -contains $absolute) { return }
  if (-not (Test-Path -LiteralPath $absolute)) { return }
  $item = Get-Item -LiteralPath $absolute -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $skipped.Add("Link: $absolute"); return }
  foreach ($process in $processes) {
    if (($process.CommandLine -and $process.CommandLine.IndexOf($absolute, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
        ($process.ExecutablePath -and ($process.ExecutablePath.Equals($absolute, [StringComparison]::OrdinalIgnoreCase) -or
          $process.ExecutablePath.StartsWith($absolute + '\', [StringComparison]::OrdinalIgnoreCase)))) {
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
                    'launch-suira.cmd','run-app.cmd','run-app2.cmd','run-probe.cmd','release-edit.py','release-ui-edit.py','update-repo.py','repo-info.json','latest-release.json',
                    'cleanup-protected.json','installer-lifecycle-result.json','release-audit.json','coco-probe.js','coco-electron-probe.js',
                    'process-probe.exe','process-probe.nsi','process-probe.txt','context-guard-probe.exe','context-guard-probe.nsi',
                    'verified-18-uninstaller','build-runtime-path.txt','art-base.json',
                    'keycaps-production-light.png','keycaps-production-dark.png','keycaps-production-tools.png',
                    'native-frost-probe.js','native-frost-probe-app.js','native-frost-probe.png','native-frost-ready.json','native-frost-probe-profile',
                    'native-live-probe.js','native-live-probe-app.js','native-live-probe.png','native-live-probe-profile',
                    'native-glass-failure.png','native-minimal.png','replace-unpublished-24.js',
                    'video-review-27','inspect-panel-video.py','inspect-reveal27.js','refactor-document-menu27.py','replace-draft27.js',
                    'verify-installed-profile27.js')) {
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
$testDirectoryPattern = '^suira-(?:(?:clipboardbar|island|notes|island-wake|latency|record-writer|recorder-live|capture-bench|doc-shots|bindings|workspace|ui-polish|image-editor|long-capture)-[A-Za-z0-9]+|panel-\d+|core-e2e-\d+|ocr-probe-\d+|clipboardbar-shots|island-shots|probe)$'
Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'suira-*' | Where-Object { $_.Name -match $testDirectoryPattern } | ForEach-Object {
  Add-Target $_.FullName $tempRoot 'temporary-test-packages'
}
# Installer probes create only synthetic files here. Match their exact namespace,
# retaining the real installation, application profile and reusable Electron runtime.
foreach ($name in @('suira-installer-probe-561cfcfa6a95','suira-installer-probe-be53b72981f3')) {
  Add-Target (Join-Path $tempRoot ('Low\' + $name)) $tempRoot 'installer-test-fixtures'
}
Add-Target (Join-Path $tempRoot 'suira-workspace-buildruntime-a7658f29af61474aa39e9d67a8bc0fee') $tempRoot 'obsolete-build-runtime-copy'
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
if ($IncludeObsoletePackages -or $InstalledOnly) {
  # Explicit opt-in only. Verify the retained installer or installed application
  # before removing redundant build output; never touch the installed application.
  $package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = [string]$package.version
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected package version' }
  $desktop = [Environment]::GetFolderPath('Desktop')
  $latest = Join-Path $desktop ('Suira-' + $version + '-Setup.exe')
  if ($InstalledOnly) {
    # Explicit request to keep only the installed application, with no installer.
    $exeName = ([string][char]0x968f) + ([string][char]0x5e8f) + '.exe'
    $installedExe = Join-Path $env:LOCALAPPDATA ('Programs\suira-desktop\' + $exeName)
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw 'Installed application not found' }
    $installedVersion = (Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
    if ($installedVersion -notin @($version, ($version + '.0'))) { throw 'Installed application version mismatch' }
    Add-Target $latest $desktop 'redundant-desktop-installer'
  } else {
    $manifest = Get-Content -LiteralPath (Join-Path $repoRoot ('docs\release-' + $version + '.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $latest -PathType Leaf)) { throw 'Keep the latest desktop installer before cleaning builds' }
    $hashStream = [IO.File]::OpenRead($latest)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $latestHash = ([BitConverter]::ToString($sha256.ComputeHash($hashStream))).Replace('-', '') }
    finally { $hashStream.Dispose(); $sha256.Dispose() }
    if ($latestHash -ne $manifest.sha256) { throw 'Latest desktop installer hash mismatch' }
    if ((Get-Item -LiteralPath $latest).Length -ne $manifest.bytes) { throw 'Latest desktop installer size mismatch' }
  }
  # These exact superseded files were inventoried and approved for removal.
  foreach ($name in @('Suira-0.2.0-portable.exe','Suira-0.2.1-Setup.exe')) {
    if ($name -ne (Split-Path -Leaf $latest)) { Add-Target (Join-Path $desktop $name) $desktop 'obsolete-desktop-packages' }
  }
  # User requested retirement of old installers. Only exact repository-produced
  # files with a matching historical checksum are eligible; changed files stay.
  foreach ($installerRoot in @($desktop,(Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'))) {
    if (-not (Test-Path -LiteralPath $installerRoot)) { continue }
    Get-ChildItem -LiteralPath $installerRoot -File -Filter 'Suira-*-Setup.exe' | ForEach-Object {
      if ($_.Name -notmatch '^Suira-(\d+\.\d+\.\d+)-Setup\.exe$') { return }
      $oldVersion = $Matches[1]
      if ([version]$oldVersion -ge [version]$version) { return }
      $obsolete = $_.FullName
      $obsoleteManifest = Join-Path $repoRoot ('docs\release-' + $oldVersion + '.json')
      if (-not (Test-Path -LiteralPath $obsoleteManifest)) { $skipped.Add("Unverified installer, preserved: $obsolete"); return }
      $old = Get-Content -LiteralPath $obsoleteManifest -Raw -Encoding UTF8 | ConvertFrom-Json
      $oldStream = [IO.File]::OpenRead($obsolete)
      $oldSha256 = [Security.Cryptography.SHA256]::Create()
      try { $oldHash = ([BitConverter]::ToString($oldSha256.ComputeHash($oldStream))).Replace('-', '') }
      finally { $oldStream.Dispose(); $oldSha256.Dispose() }
      if ((Get-Item -LiteralPath $obsolete).Length -eq $old.bytes -and $oldHash -eq $old.sha256) {
        Add-Target $obsolete $installerRoot 'obsolete-desktop-installers'
      } else { $skipped.Add("Changed installer, preserved: $obsolete") }
    }
  }
  Add-Target (Join-Path $repoRoot 'dist') $repoRoot 'redundant-build-output'
  # Inventoried 2026-10-30 upgrade investigation copies: remove only runtime
  # binaries and extracted installer files. Keep every udata/profile and key.
  $backupRoot = Join-Path $env:LOCALAPPDATA 'Programs\suira-desktop.backup-20261030'
  if (Test-Path -LiteralPath $backupRoot) {
    foreach ($name in @('locales','resources')) { Add-Target (Join-Path $backupRoot $name) $backupRoot 'obsolete-upgrade-runtime' }
    $oldExeName = ([string][char]0x968f) + ([string][char]0x5e8f) + '.exe'
    Get-ChildItem -LiteralPath $backupRoot -File | Where-Object {
      $_.Name -eq $oldExeName -or $_.Name -match '^(?:Uninstall .+\.exe|.+\.dll|.+\.pak|icudtl\.dat|LICENSE.*|snapshot_blob\.bin|v8_context_snapshot\.bin|vk_swiftshader_icd\.json|version|debug\.log)$'
    } | ForEach-Object { Add-Target $_.FullName $backupRoot 'obsolete-upgrade-runtime' }
  }
  $investigation = Join-Path $repoRoot '.workbuddy\upgrade-backup-20261030'
  Add-Target (Join-Path $investigation 'installer-extracted') $investigation 'obsolete-installer-extraction'
  foreach ($name in @('locales','resources')) { Add-Target (Join-Path $investigation ('rename-probe\' + $name)) $investigation 'obsolete-upgrade-runtime' }
  foreach ($name in @('old-uninstaller.exe','install-write-probe.tmp')) { Add-Target (Join-Path $investigation $name) $investigation 'obsolete-upgrade-probes' }
}
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
