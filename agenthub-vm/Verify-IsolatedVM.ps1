[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$vbox = Join-Path $env:ProgramFiles 'Oracle\VirtualBox\VBoxManage.exe'
if (-not (Test-Path -LiteralPath $vbox -PathType Leaf)) { throw 'VirtualBox is not installed; no running isolation is verified.' }
$lines = & $vbox showvminfo 'AgentHub-Isolated' --machinereadable
if ($LASTEXITCODE -ne 0) { throw 'The isolated VM does not exist or cannot be inspected.' }
$values = @{}
foreach ($line in $lines) {
    if ($line -match '^([^=]+)="(.*)"$') { $values[$Matches[1]] = $Matches[2] }
}
$expected = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'AgentHub-Sandbox'))
foreach ($adapter in 1..8) { if ($values["nic$adapter"] -ne 'none') { throw "Network adapter $adapter is not disabled." } }
if ($values['clipboard'] -ne 'disabled' -or $values['draganddrop'] -ne 'disabled') { throw 'Clipboard or drag-and-drop sharing is enabled.' }
$shares = @($values.Keys | Where-Object { $_ -match '^SharedFolderPath(?:Machine|Global)Mapping\d+$' })
if ($shares.Count -ne 1) { throw 'Exactly one host folder may be shared with the VM.' }
$hostPath = [IO.Path]::GetFullPath(($values[$shares[0]] -replace '\\\\', '\'))
if (-not $hostPath.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'The VM shares an unexpected host directory.' }
$vboxFile = Join-Path $env:USERPROFILE '.agenthub-vms\AgentHub-Isolated\AgentHub-Isolated.vbox'
if (-not (Test-Path -LiteralPath $vboxFile -PathType Leaf)) { throw 'The VM configuration is not in the expected isolated storage location.' }
[xml]$config = Get-Content -LiteralPath $vboxFile -Raw
$mapped = @($config.SelectNodes("//*[local-name()='SharedFolder']"))
if ($mapped.Count -ne 1 -or $mapped[0].GetAttribute('symlinkPolicy') -ne 'forbidden') { throw 'Shared-folder symlink policy is not verified as forbidden.' }
Write-Output 'Configuration checks passed: one selected host share, network off, clipboard off and drag-and-drop off. Guest execution/escape tests are still required; this is not proof that the agent runs inside the VM.'
