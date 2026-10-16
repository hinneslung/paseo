@echo off
rem Launch VS Code with the run's isolated profile. Start this through explorer.exe so VS Code runs
rem non-elevated; an elevated window rejects drag and drop from Explorer. explorer.exe passes no
rem arguments, so write ud\User\settings.json (paseo.endpoint) over SSH before launching.
set "ROOT=%~dp0"
start "" "%ROOT%vscode\Code.exe" "%ROOT%workspace" --user-data-dir="%ROOT%ud" --extensions-dir="%ROOT%ext" --skip-welcome --skip-release-notes --disable-updates --disable-workspace-trust
