; A low-integrity launcher cannot modify a normal per-user installation.
; Detect it before touching files/registration, without elevating or changing ACLs.
!macro suiraCheckInstallerContext
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  StrCpy $7 8192
  System::Call 'kernel32::GetCurrentProcess() p.r0'
  System::Call 'advapi32::OpenProcessToken(p r0, i 8, *p.r1) i.r4'
  ${If} $4 != 0
    System::Call 'advapi32::GetTokenInformation(p r1, i 25, p 0, i 0, *i.r2) i.r4'
    System::Alloc $2
    Pop $3
    ${If} $3 != 0
      System::Call 'advapi32::GetTokenInformation(p r1, i 25, p r3, i r2, *i.r2) i.r4'
      ${If} $4 != 0
        System::Call '*$3(p.r5)'
        System::Call 'advapi32::GetSidSubAuthority(p r5, i 0) p.r6'
        System::Call '*$6(i.r7)'
      ${EndIf}
      System::Free $3
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r1)'
  ${EndIf}
  ${If} $7 < 8192
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "安装程序正由低完整性受限进程运行，Windows 不允许它修改当前程序文件。请关闭此窗口，从资源管理器直接运行安装包；当前用户安装无需管理员权限。"
    ${EndIf}
    DetailPrint "SU_SYSTEM_CONTEXT: low integrity; launch from the normal Windows desktop. No files or settings changed."
    SetErrorLevel 740
    Quit
  ${EndIf}
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
