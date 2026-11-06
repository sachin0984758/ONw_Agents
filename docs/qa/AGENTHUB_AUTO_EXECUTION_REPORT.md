# AgentHub Auto Execution Report

**Checkpoint:** 2026-10-29  
**Readiness:** Task history now persists with safe interrupted-task recovery; live native execution was not tested in this checkpoint.

## Existing behavior

Auto uses `computer/runtime.ts` for task orchestration, the shared local model responder for inference, and the computer bridge/Python companion for desktop actions. `model-selection.ts` prefers loaded compatible models, excludes embedding models, and separates vision requirements. `protocol.ts` and `access.ts` define action schemas, scopes, and approvals. The runtime has pause, resume, stop, and per-action approval paths. Selecting a model does not itself grant computer permission.

Auto task state is now stored in versioned `db/computer-tasks.json`, separate from the existing opt-in compact summaries. The store retains a bounded history of 30 tasks and at most 100 events per task; request, result, plan, and event fields have size limits. Screenshots and pending approval payloads are omitted. After a server restart, tasks found in an in-progress phase are marked `partial` with a recovery event. No task execution resumes, and desktop grants, active IDs, controllers, and pending approvals are never restored. Invalid or corrupt history is left intact and surfaced as a UI warning rather than overwritten.

## Test results

- Auto model selection/loading policy: 20 checks passed.
- Computer protocol/security contract: 69 checks passed. These cover action schemas, malformed-input rejection, approval requirements, read-only tool classification, cross-origin/LAN refusal, and observe-only versus control-mode tool exposure.
- Workspace preference boundary: 9 checks passed.
- Auto planning/permission integration: 42 checks passed, including durable outcomes for a completed plan and a failed plan-only tool proposal.
- Auto task-store tests: 12 checks passed, including bounds, omission of screenshot/approval data, interrupted-task recovery, completed-task preservation, newest-30 retention, and corrupt-file preservation.
- Computer transport and preference suites passed in the full run.
- Full suite: 30/30 suites; 1,770 checks passed; 14 skipped. The platform suite contributes 42 checks; the task-store suite contributes 12.
- TypeScript, full ESLint, repository audit, and production build passed. ESLint reported zero errors and three warnings confined to example projects. The audit covered 534 source files and found no import cycles, unresolved local imports, or client/server leaks.

## Limits and risk boundaries

LM Studio was available for the isolated Chat/Playground/Session checks, but Auto native-control acceptance was not run. The real desktop was not used for typing, launching, or window placement in this checkpoint. A read-only 1280×720 browser screenshot and accessibility tree confirmed the split Auto view and right-side computer panel; they do not verify native application capture or control. Static contract and fixture tests do not prove a real model will select correct tools, respect visual evidence, or complete a task.

Performance metrics from actual Auto task execution are unavailable for this checkpoint. No CPU, memory, screenshot latency, action latency, or long-running task benchmark was performed.

## Next steps

With a loaded model, verify no Auto task is active before starting the opt-in acceptance. Test a read-only observation, explicit pause/resume, stop, a proposed application launch that is declined, and a permitted task in an isolated workspace. Confirm no native input occurs after a declined approval and permissions are revoked on stop.

## Checkpoint change record

- **Original capability:** local-only model routing, a plan-first Auto interface, separate computer bridge authorization, and an emergency stop.
- **Root cause / decision:** a full-suite run exposed transient Windows `EPERM` failures when atomically replacing a persisted JSON target. Atomic rename now retries transient `EPERM`, `EACCES`, and `EBUSY` errors with bounded backoff; the storage suite covers concurrent replacements. Native-control behavior was not changed and remains unverified live.
- **Root cause addressed:** full Auto task lifecycle existed only in module memory; the prior optional summary stored only a few completion fields and could not recover task state after restart.
- **Files changed in this increment:** `src/lib/agent-hub/computer/task-store.ts`, `src/lib/agent-hub/computer/runtime.ts`, `src/components/agent-hub/auto-computer-view.tsx`, `scripts/check-auto-task-store.ts`, `scripts/check-auto-platform.ts`, `scripts/check-project.mjs`, and `package.json`.
- **Actual outcomes:** 20 routing checks, 69 computer/security checks, 9 workspace preference checks, 42 Auto planning/permission integration checks, and 12 task-store checks pass. Full suite: 30/30 suites, 1,770 checks passed, 14 skipped; typecheck, full lint (0 errors/3 example-project warnings), repository audit, and production build pass. No live Auto latency or performance benchmark was measured.
