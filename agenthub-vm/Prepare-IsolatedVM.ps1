[CmdletBinding()]
param(
    [string]$WindowsIso = '',
    [switch]$Create
)

$ErrorActionPreference = 'Stop'
$vmName = 'AgentHub-Isolated'
$sharedFolder = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'AgentHub-Sandbox'))
$vmBase = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.agenthub-vms'))
$vmFolder = Join-Path $vmBase $vmName
$vbox = Join-Path $env:ProgramFiles 'Oracle\VirtualBox\VBoxManage.exe'
$disk = Join-Path $vmFolder 'system.vdi'
if ($vmBase.StartsWith($sharedFolder.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $vmBase -eq $sharedFolder) {
    throw 'VM configuration and disks must be outside the shared folder.'
}
if (-not (Test-Path -LiteralPath $sharedFolder -PathType Container)) { throw 'Create the AgentHub-Sandbox folder first.' }
$reparsePoints = @(Get-ChildItem -LiteralPath $sharedFolder -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
if ($reparsePoints.Count) { throw 'Remove junctions/symlinks from the shared folder before enabling a VM share.' }
$freeMemoryMB = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
$blockers = @()
if (-not (Test-Path -LiteralPath $vbox -PathType Leaf)) { $blockers += 'Oracle VirtualBox is not installed.' }
if (-not $WindowsIso -or -not (Test-Path -LiteralPath $WindowsIso -PathType Leaf)) { $blockers += 'A local, legitimately licensed Windows ISO is required.' }
if ($freeMemoryMB -lt 6144) { $blockers += 'At least 6 GB free host RAM is required before creating/starting this 4 GB guest.' }

# Commands are argument arrays. No shell interpolation, installer execution,
# existing-VM deletion, broad host share or automatic guest boot is performed.
$commands = [Collections.Generic.List[object]]::new()
$commands.Add(@('createvm', '--name', $vmName, '--platform-architecture', 'x86', '--ostype', 'Windows11_64', '--basefolder', $vmBase, '--register'))
$modify = @('modifyvm', $vmName, '--memory', '4096', '--cpus', '2', '--firmware', 'efi', '--tpm-type', '2.0', '--graphicscontroller', 'vboxsvga', '--vram', '128', '--accelerate-3d', 'off', '--clipboard-mode', 'disabled', '--clipboard-file-transfers', 'disabled', '--drag-and-drop', 'disabled', '--usb-ohci', 'off', '--usb-ehci', 'off', '--usb-xhci', 'off', '--audio-enabled', 'off', '--vrde', 'off', '--boot1', 'dvd', '--boot2', 'disk')
foreach ($adapter in 1..8) { $modify += @("--nic$adapter", 'none') }
$commands.Add($modify)
$commands.Add(@('createmedium', 'disk', '--filename', $disk, '--size', '65536', '--format', 'VDI', '--variant', 'Standard'))
$commands.Add(@('storagectl', $vmName, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci', '--portcount', '2'))
$commands.Add(@('storageattach', $vmName, '--storagectl', 'SATA', '--port', '0', '--device', '0', '--type', 'hdd', '--medium', $disk))
if ($WindowsIso) { $commands.Add(@('storageattach', $vmName, '--storagectl', 'SATA', '--port', '1', '--device', '0', '--type', 'dvddrive', '--medium', [IO.Path]::GetFullPath($WindowsIso))) }
$commands.Add(@('sharedfolder', 'add', $vmName, '--name', 'AgentHubWork', '--hostpath', $sharedFolder, '--automount', '--auto-mount-point', 'W:'))
$commands.Add(@('sharedfolder', 'modify', $vmName, '--name', 'AgentHubWork', '--symlink-policy', 'forbidden'))
$plan = [ordered]@{ VMName = $vmName; SharedFolder = $sharedFolder; VMFolder = $vmFolder; MemoryMB = 4096; FreeHostMemoryMB = $freeMemoryMB; Network = 'disabled'; Clipboard = 'disabled'; DragAndDrop = 'disabled'; HostUSB = 'disabled'; HostShares = @($sharedFolder); Blockers = $blockers; Commands = $commands.ToArray(); Mode = $(if ($Create) { 'Create powered-off VM' } else { 'Plan only; no VM changes' }) }
if (-not $Create) { $plan | ConvertTo-Json -Depth 7; return }
if ($blockers.Count) { throw ($blockers -join ' ') }
if ([IO.Path]::GetExtension($WindowsIso) -ne '.iso') { throw 'Use an ISO image, not an executable.' }
if (Test-Path -LiteralPath $vmFolder) { throw 'The VM folder already exists. Existing VM data will not be overwritten.' }
$existing = & $vbox list vms
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox inventory failed.' }
if ($existing -match ('^"' + [regex]::Escape($vmName) + '"')) { throw 'A VM with this name already exists; no changes made.' }
foreach ($arguments in $commands) {
    & $vbox @arguments
    if ($LASTEXITCODE -ne 0) { throw 'VM configuration failed. The VM was not started; inspect the partial configuration before retrying.' }
}
& (Join-Path $PSScriptRoot 'Verify-IsolatedVM.ps1')
Write-Output 'The VM is created and powered off. Install the guest manually, install Guest Additions, then run verification again before using it.'
