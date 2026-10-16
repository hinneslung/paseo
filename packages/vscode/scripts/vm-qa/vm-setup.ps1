# VM side of stage.sh: unpack the cached portable toolchain into the run directory, install the
# daemon packages, and install the VSIX into the run's isolated VS Code profile.
param(
  [Parameter(Mandatory = $true)][string]$RunDir,
  [Parameter(Mandatory = $true)][string]$CacheDir
)
$ErrorActionPreference = 'Stop'

function Expand-Once([string]$Zip, [string]$Destination, [string]$Probe) {
  if (Test-Path $Probe) { return }
  Expand-Archive -Path (Join-Path $CacheDir $Zip) -DestinationPath $Destination -Force
}

Expand-Once 'vscode-win.zip' (Join-Path $RunDir 'vscode') (Join-Path $RunDir 'vscode\Code.exe')
Expand-Once 'mingit.zip' (Join-Path $RunDir 'git') (Join-Path $RunDir 'git\cmd\git.exe')
if (-not (Test-Path (Join-Path $RunDir 'node\node.exe'))) {
  Expand-Archive -Path (Join-Path $CacheDir 'node-win.zip') -DestinationPath $RunDir -Force
  $extracted = Get-ChildItem $RunDir -Directory -Filter 'node-v*' | Select-Object -First 1
  Rename-Item $extracted.FullName 'node'
}
foreach ($dir in 'workspace', 'ud\User', 'ext') {
  New-Item -ItemType Directory -Force (Join-Path $RunDir $dir) | Out-Null
}

$env:PATH = (Join-Path $RunDir 'node') + ';' + $env:PATH
Push-Location (Join-Path $RunDir 'daemon')
try {
  # Run through cmd: PowerShell 5 turns native stderr (npm warnings) into terminating errors.
  & cmd /c "npm install --no-audit --no-fund > npm-install.log 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "npm install failed; see daemon\npm-install.log" }
} finally {
  Pop-Location
}

$code = Join-Path $RunDir 'vscode\bin\code.cmd'
$installArgs = "--extensions-dir `"$RunDir\ext`" --user-data-dir `"$RunDir\ud`" --install-extension `"$RunDir\paseo.vsix`" --force"
& cmd /c "`"$code`" $installArgs 2>&1"
if ($LASTEXITCODE -ne 0) { throw 'VSIX install failed' }
Write-Output "ready: $RunDir"
