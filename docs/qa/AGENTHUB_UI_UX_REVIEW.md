# AgentHub UI/UX Review

**Review date:** 2026-10-28  
**Primary browser:** `http://127.0.0.1:3000`  
**Visual verification:** Live rendered view and accessibility tree; screenshot images were reviewed inline, not saved as files.

## Starting observations

- The Sessions slash-agent picker could dominate the composer and did not group the broader tools by capability.
- Selected-folder copy needed a sharper distinction between choosing a folder and granting access.
- Portal controls can render outside the local conversation theme subtree, which made the action menu colors inconsistent with the Day appearance.
- Existing historical session content includes a timeout result.
- Several broader views contain explicit sample data (Changes), and capabilities vary by local model/provider and permissions.

## Changes reviewed

- Added a compact Sessions `+` popover with searchable categories for Goals & Planning, Web & Research, Files & Workspace, Apps & Plugins, Agents & Skills, and Computer & Dev.
- Reused existing Tasks, Skills Library, model-provider, UI Components, and Auto surfaces. Actions that do not have a real integration are disabled with a reason; drafts and navigation do not pretend to create persistent goals or connect external services.
- Added keyboard navigation across action results, Escape/outside dismissal, and accessible names. A visual inspection at the available 928×720 browser viewport showed the menu bounded, scrollable, and visually aligned with Day theme.
- Applied the selected conversation theme to popover and select portal content.
- Shortened the folder notice to “Selecting a folder does not grant access.” The menu footer says “Project access: off” and has a Review access action.
- Corrected the mode indicator so it reflects effective access: an inaccessible workspace cannot appear to be in Edit mode.
- Sessions composer now advertises `Ctrl+Enter sends`, `Shift+Enter new line`, and `/ searches agents`. Chat view's separate Ctrl+Enter action starts a new chat; pressing it cleared the draft and switched to a blank conversation without sending the draft.

## Visual/system decisions

- Kept the existing AgentHub component stack and restrained palette. The capability menu uses the existing Radix popover and shared HubSelect rather than introducing a dependency.
- Kept the existing profile appearance choices: Day, Night, Warm Sand, Ocean Panels, and Bold Outline.
- Permission explanations remain visible, but unavailable services do not appear as active buttons.
- No external design-system research was performed during this run; decisions follow the repository's current components and common menu/accessibility patterns.

## Accessibility and responsive review

- Accessibility snapshots expose named tabs, controls, disabled states, workspace permission, and action descriptions.
- Keyboard checks included action-menu navigation and Chat Ctrl+Enter. Not every control was traversed with a keyboard or screen reader.
- Contrast was visually reviewed only. No automated WCAG contrast audit, touch-target measurement, reduced-motion audit, or viewport sweep was run.
- Small-screen behavior is therefore **NOT TESTED**. The single inline screenshot viewport was 928×720.

## Remaining UX issues

- `check-ui-interactions.mjs` still fails because native selects remain in `shell.tsx`, `ui-components-view.tsx`, and `marketplace/component-details.tsx`. They are functional controls, but the current regression test expects every view to use the shared portal select.
- The Skills Library panel's completed loading state and its install workflow were not verified.
- Changes is an illustrative, Git-disconnected surface; it communicates this clearly, but it should not be counted as a connected source-control workflow.
- Baseline and after screenshots are not present in the repository; see the screenshots README for the capture limitation.
