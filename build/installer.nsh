; Avoid synchronous PowerShell/CIM launches in the installer UI thread.
; Prompt for a normal tray exit so document close/save handlers can finish.
!include "${BUILD_RESOURCES_DIR}\installer-context.nsh"
!include "${BUILD_RESOURCES_DIR}\runtime-removal.nsh"

!macro customInit
  !insertmacro suiraCheckInstallerContext
!macroend

!macro customUnInit
  !insertmacro suiraCheckInstallerContext
!macroend

!macro customCheckAppRunning
  Push $R0
  Push $R1
  StrCpy $R1 0
  suira_check_running:
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 == 0
      ${If} ${isUpdated}
        ${If} $R1 < 100
          Sleep 100
          IntOp $R1 $R1 + 1
          Goto suira_check_running
        ${EndIf}
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "随序仍在运行。请保存文档，从托盘右键退出随序，然后点击重试。" /SD IDCANCEL IDRETRY suira_check_running
      Quit
    ${EndIf}
    nsProcess::_Unload
  Pop $R1
  Pop $R0
  ClearErrors
!macroend

!macro customHeader
  !include "${BUILD_RESOURCES_DIR}\markdown-associations.nsh"
!macroend
