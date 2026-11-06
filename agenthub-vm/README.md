# Strict isolation preparation

Status: **prepared, not installed or running**. The current Auto desktop controller still controls the host desktop; it has not been switched into a guest. No blanket host-application permission was granted.

The host is Windows 11 Home Single Language. It has 23.7 GiB total RAM; about 1.2 GiB was free during inspection. Virtualization is enabled and a hypervisor is present, but VirtualBox is not installed. Native Windows Sandbox is unavailable on Home. [Microsoft documentation](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-sandbox/windows-sandbox-overview)

## Prepared boundary

| Item | Plan |
| --- | --- |
| Guest | Separate Windows 11 VM named `AgentHub-Isolated` |
| Host work directory shared with the guest | `C:\Users\SACHIN\AgentHub-Sandbox` only, writable |
| VM disks/configuration | `C:\Users\SACHIN\.agenthub-vms\AgentHub-Isolated`, outside the guest's writable share |
| Network | All 8 adapters disabled |
| Host clipboard, drag/drop, USB and audio | Disabled |
| Symbolic links in shared files | Forbidden in the planned share policy; existing junctions are rejected before creation |
| Initial resources | 2 CPUs, 4 GiB guest RAM, dynamic 64 GiB disk |

The proposed controls use [Oracle's documented VirtualBox commands](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/vboxmanage.html). Shared-folder access requires Guest Additions inside the guest. This runtime configuration has not been executed because VirtualBox and a guest ISO are absent.

## Readiness and preparation commands

From this directory, show the plan without creating or starting a VM:

```powershell
.\Prepare-IsolatedVM.ps1
```

After explicitly approving and installing VirtualBox from its official distribution, providing a Windows ISO licensed for VM use, and freeing at least 6 GiB RAM:

```powershell
.\Prepare-IsolatedVM.ps1 -WindowsIso 'C:\path\to\licensed-windows.iso' -Create
.\Verify-IsolatedVM.ps1
```

The first command refuses an existing VM/folder and leaves a newly created VM powered off. There is no automatic ISO download, license acceptance, guest installation, host-driver installation or boot. The verification script must be exercised against the installed VirtualBox version and reviewed before trusting a running environment. Static checks alone cannot verify a security boundary.

## Work required before broader app control

1. Install VirtualBox with explicit approval and obtain the guest OS installation media/license.
2. Free memory; the currently loaded large LM Studio model leaves too little RAM to start this guest safely. No model was unloaded automatically.
3. Create the powered-off VM, install Windows and Guest Additions, then verify the single shared folder and disabled sharing channels.
4. Install required applications **inside the guest**. The 75 desktop product entries on the host do not automatically become guest applications.
5. Connect an agent controller to guest-only input/capture and route file operations through the shared folder. Test the boundary before enabling app control. This guest-controller integration is not implemented by these setup scripts.
6. Confirm a guest app can write to the work share, cannot read/write another host folder, and cannot reach host services through networking or clipboard. Also verify Stop, snapshots and recovery.

Until those checks pass, `AgentHub-Sandbox` is a tested application workspace folder, not a verified OS sandbox. File-tool containment works; normal host applications and approved shell commands still use host permissions.
