# Auto split app workspace

The desktop layout now keeps conversation/approvals on the left and Windows app
controls on the right. Below 900px, Task/Computer tabs switch between the panes.
The existing hover session navigation is retained.

The app pane launches permitted Notepad, Calculator, File Explorer and VS Code,
focuses the app, and captures its actual window. Preview clicks map through
object-fit letterboxing into Windows coordinates. Each action reacquires focus
and a fresh UI Automation snapshot. If the window geometry changed, the action
is refused and the preview refreshed. App controls are disabled during Auto tasks.
Text entry targets an observed focused editor; Enter, Tab, Backspace and Escape
are available as explicit actions. Screenshots refresh after interaction.

This is a captured-window control surface, not a native Windows window embedded
in the browser or a continuous remote desktop stream. Native application menus,
dialogs, dragging, global keyboard shortcuts, arbitrary installed applications,
and every application workflow have not been validated through this panel.
Existing session app permissions still apply.

Verification: TypeScript and focused lint passed; 69 protocol checks passed;
7 coordinate checks cover letterboxing, negative monitor coordinates, image
edges and invalid capture geometry. The Auto page returns HTTP 200.
Live browser verification and new UI screenshots were unavailable because local
browser control is disabled in Work settings. End-to-end interaction through the
new panel remains unverified.
