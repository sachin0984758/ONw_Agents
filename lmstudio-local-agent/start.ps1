param()
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) { throw 'Run setup.ps1 first.' }
$env:LOCAL_AGENT_HOME = $ProjectRoot
if (-not $env:AGENT_WORKSPACE) { $env:AGENT_WORKSPACE = Join-Path $ProjectRoot 'workspace' }
Set-Location -LiteralPath $ProjectRoot
& $Python -m agent_env.server
