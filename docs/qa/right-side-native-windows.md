# Actual Windows apps on the right

Auto now positions permitted desktop app windows in the right half of the work
area of the monitor where session access was granted. Existing and newly
launched app windows use this placement. Focusing an app reapplies it before
returning a fresh UI Automation snapshot. Auto restore/maximize requests fill
that right workspace instead of covering the conversation. Manual movement by
the user is still possible; this does not restrict Windows globally.

The separate controlled Chromium browser is configured with the same window
position and size, then applies those bounds to each newly created browser
window through its browser control session. That browser path was compiled but
was not exercised live in this verification.

Live Notepad verification: handle 1769948, process notepad.exe, actual bounds
`[960, 0, 1920, 1080]`. Existing text remained `online`. Launch and focus both
passed through the running AgentHub HTTP/native bridge. The screenshot was
captured and inspected; exact coordinates are saved in
`output/computer-control/right-window-placement.json`. No text was edited by
this placement test. Permissions were revoked afterward and the controller
reloaded with the final code.

Python compilation and all 16 native permission checks passed. Other desktop
apps and additional monitor configurations were not live-tested this turn.
