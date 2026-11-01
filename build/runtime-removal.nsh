; Transactionally stage only files owned by our Electron distribution.
; Never recurse through arbitrary folders such as legacy udata or user documents.
!macro suiraStageRuntimeFile NAME
  ${If} ${FileExists} "$INSTDIR\${NAME}"
    ClearErrors
    Rename "$INSTDIR\${NAME}" "$PLUGINSDIR\old-install\${NAME}"
    ${If} ${Errors}
      StrCpy $R0 "$INSTDIR\${NAME}"
      Goto suira_runtime_failed
    ${EndIf}
  ${EndIf}
!macroend

!macro customRemoveFiles
  CreateDirectory "$PLUGINSDIR\old-install"
  ${If} ${FileExists} "$INSTDIR\resources\*.*"
    CreateDirectory "$PLUGINSDIR\old-install\resources"
    Push "\resources"
    Call un.atomicRMDir
    Pop $R0
    ${If} $R0 != 0
      Goto suira_runtime_failed
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\locales\*.*"
    CreateDirectory "$PLUGINSDIR\old-install\locales"
    Push "\locales"
    Call un.atomicRMDir
    Pop $R0
    ${If} $R0 != 0
      Goto suira_runtime_failed
    ${EndIf}
  ${EndIf}
  !insertmacro suiraStageRuntimeFile "${APP_EXECUTABLE_FILENAME}"
  !insertmacro suiraStageRuntimeFile "chrome_100_percent.pak"
  !insertmacro suiraStageRuntimeFile "chrome_200_percent.pak"
  !insertmacro suiraStageRuntimeFile "d3dcompiler_47.dll"
  !insertmacro suiraStageRuntimeFile "dxcompiler.dll"
  !insertmacro suiraStageRuntimeFile "dxil.dll"
  !insertmacro suiraStageRuntimeFile "electron_wer.dll"
  !insertmacro suiraStageRuntimeFile "ffmpeg.dll"
  !insertmacro suiraStageRuntimeFile "icudtl.dat"
  !insertmacro suiraStageRuntimeFile "LICENSE.electron.txt"
  !insertmacro suiraStageRuntimeFile "LICENSES.chromium.html"
  !insertmacro suiraStageRuntimeFile "resources.pak"
  !insertmacro suiraStageRuntimeFile "snapshot_blob.bin"
  !insertmacro suiraStageRuntimeFile "v8_context_snapshot.bin"
  !insertmacro suiraStageRuntimeFile "version"
  !insertmacro suiraStageRuntimeFile "vk_swiftshader_icd.json"
  !insertmacro suiraStageRuntimeFile "vk_swiftshader.dll"
  !insertmacro suiraStageRuntimeFile "vulkan-1.dll"
  ; Direct /_?= invocations may execute this file in place; do not stage ourselves.
  ${If} $EXEPATH != "$INSTDIR\${UNINSTALL_FILENAME}"
    !insertmacro suiraStageRuntimeFile "${UNINSTALL_FILENAME}"
  ${EndIf}
  SetOutPath $TEMP
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  RMDir "$INSTDIR"
  Goto suira_runtime_done
  suira_runtime_failed:
    DetailPrint "Runtime file is unavailable: $R0"
    Push ""
    Call un.restoreFiles
    Pop $R0
    Abort "无法更新正在使用或没有权限修改的程序文件，原程序已恢复。请正常退出随序后重试。"
  suira_runtime_done:
!macroend
