!macro customInit
  ; R9 = "1" if updating, "0" if fresh install
  StrCpy $R9 "0"

  ; Detect existing installation and offer update instead of fresh install
  ReadRegStr $R0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  ${If} $R0 != ""
    ReadRegStr $R1 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
    ReadRegStr $INSTDIR SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Whisperio $R1 is already installed.$\r$\n$\r$\nClick OK to update to the latest version." IDOK doUpdate
    Abort
    doUpdate:
      StrCpy $R9 "1"
  ${EndIf}
!macroend

!macro customInstall
  ; After update, relaunch the app automatically
  ${If} $R9 == "1"
    Exec '"$INSTDIR\Whisperio.exe"'
  ${EndIf}
!macroend

!macro customUnInstall
  ; Clean up autostart registry entry that Electron may have created
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Whisperio"
  ; Also clean up legacy entry from older installs
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WhisperIO"
!macroend
