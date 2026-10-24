# Create a Desktop shortcut for Suira that launches through the ASCII-path
# Electron mirror. Keep this file ASCII-only: Windows PowerShell 5.1 decodes
# BOM-less UTF-8 scripts as ANSI, so CJK literals here would be corrupted.
$appDir = Split-Path -Parent $PSScriptRoot
$exe = 'C:\suira-electron\electron.exe'
$icon = Join-Path $appDir 'assets\icon.ico'
if (-not (Test-Path $exe)) { Write-Host "missing exe: $exe"; exit 1 }
$desktop = [Environment]::GetFolderPath('Desktop')
# U+968F U+5E8F = Suira's Chinese name, built from code points to stay ASCII-safe
$cnName = [string][char]0x968F + [char]0x5E8F
$lnkPath = Join-Path $desktop ($cnName + ' SUIRA.lnk')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $exe
$lnk.Arguments = '"' + $appDir + '"'
$lnk.WorkingDirectory = $appDir
$lnk.IconLocation = $icon + ',0'
$lnk.Description = 'Suira SUIRA'
$lnk.Save()
Write-Host ("shortcut created: " + $lnkPath + " exists=" + (Test-Path $lnkPath))
