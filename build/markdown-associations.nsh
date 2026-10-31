; Register candidates only. Never replace .md defaults or Windows UserChoice.
!ifmacrodef APP_ASSOCIATE
  !macroundef APP_ASSOCIATE
!endif
!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${APP_ID}.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${APP_ID}.Markdown" "" "Markdown document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${APP_ID}.Markdown" "FriendlyAppName" "${PRODUCT_NAME} Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${APP_ID}.Markdown\DefaultIcon" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${APP_ID}.Markdown\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "${PRODUCT_NAME} Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\${APP_ID}\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\${APP_ID}\Capabilities" "ApplicationDescription" "Markdown editor"
  WriteRegStr SHELL_CONTEXT "Software\${APP_ID}\Capabilities\FileAssociations" ".${EXT}" "${APP_ID}.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${APP_ID}" "Software\${APP_ID}\Capabilities"
!macroend

!ifmacrodef APP_UNASSOCIATE
  !macroundef APP_UNASSOCIATE
!endif
!macro APP_UNASSOCIATE EXT FILECLASS
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${APP_ID}.Markdown"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${APP_ID}.Markdown"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHELL_CONTEXT "Software\${APP_ID}\Capabilities"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${APP_ID}"
!macroend
