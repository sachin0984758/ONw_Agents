param([switch]$ApproveDependencyInstall)
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
$McpConfigPath = Join-Path $ProjectRoot 'config\lmstudio.mcp.json'
if (Test-Path -LiteralPath $McpConfigPath) {
  throw "Refusing to overwrite $McpConfigPath. Back it up or remove it yourself, then rerun setup."
}
$PythonCommand = Get-Command python -ErrorAction Stop
& $PythonCommand.Source -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or newer is required.' }

$VenvPython = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $VenvPython)) {
  & $PythonCommand.Source -m venv (Join-Path $ProjectRoot '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the project virtual environment.' }
}

$Approved = $ApproveDependencyInstall
if (-not $Approved) {
  $Approval = Read-Host 'Install the pinned Python MCP SDK into this project .venv? Type YES to approve'
  $Approved = $Approval -ceq 'YES'
}
if (-not $Approved) { throw 'Dependency installation was not approved; no packages were installed.' }
$UvCommand = Get-Command uv -ErrorAction SilentlyContinue
if ($UvCommand) {
  & $UvCommand.Source pip install --python $VenvPython --requirement (Join-Path $ProjectRoot 'requirements.txt')
} else {
  & $VenvPython -m pip install --timeout 60 --retries 5 --requirement (Join-Path $ProjectRoot 'requirements.txt')
}
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }

foreach ($Name in @('skills', 'workspace', 'config', 'logs', 'temp', 'downloads')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot $Name) | Out-Null
}

$SettingsPath = Join-Path $ProjectRoot 'config\settings.json'
if (-not (Test-Path -LiteralPath $SettingsPath)) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'config\settings.example.json') -Destination $SettingsPath
}

$Workspace = Join-Path $ProjectRoot 'workspace'
$Entry = @{
  mcpServers = @{
    'lmstudio-local-agent' = @{
      command = $VenvPython
      args = @('-m', 'agent_env.server')
      cwd = $ProjectRoot
      env = @{ LOCAL_AGENT_HOME = $ProjectRoot; AGENT_WORKSPACE = $Workspace }
    }
  }
}
$Json = $Entry | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($McpConfigPath, $Json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

Write-Host ''
Write-Host 'Setup complete.'
Write-Host "Project: $ProjectRoot"
Write-Host "LM Studio MCP entry: $McpConfigPath"
Write-Host 'Merge the mcpServers entry into your existing %USERPROFILE%\.lmstudio\mcp.json; do not overwrite other servers.'
