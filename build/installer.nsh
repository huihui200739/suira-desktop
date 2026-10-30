; Avoid synchronous PowerShell/CIM launches in the installer UI thread.
; Prompt for a normal tray exit so document close/save handlers can finish.
!macro customCheckAppRunning
  suira_check_running:
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "随序仍在运行。请保存文档，从托盘右键退出随序，然后点击重试。" /SD IDCANCEL IDRETRY suira_check_running
      Quit
    ${EndIf}
    nsProcess::_Unload
!macroend
