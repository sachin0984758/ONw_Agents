# Sessions and recovery

Existing `sessions list/show/search/rename/export/remove` commands and
`/sessions`, `/resume`, `--session` and `--resume` remain available. Session
transcripts are validated, bounded and redacted; tools are never replayed on
resume. Plans include dependency numbers and failed/cancelled states.

Before executing a proposed tool batch, the runtime must save its transcript
checkpoint. If the save fails, no action from that batch starts. Every tool
then has a synced write-ahead record in
`<sessionsDir>/journals/<workspace-and-session-hash>.jsonl`, followed by a synced
outcome. Journals record run/call IDs, tool, time and state, with an optional
workspace-relative write target and intended hash. Arguments, file contents,
commands and outputs are excluded.

```powershell
agenthub sessions recover last --json
agenthub --resume last --print "Inspect the current state before continuing"
```

Recovery hashes interrupted `write_file` outputs when safe. Matching bytes are
recorded as **observed applied**; this does not prove which process wrote them.
Other interrupted actions remain **unknown outcome**, emit a warning and
prevent a completed result. Shell, MCP, Git writes and edits are never retried
automatically. Inspect their external/workspace state manually. There is no
general transactional rollback or automatic resolution of ambiguous effects.

Journal corruption, an incomplete final record, a stale lock, or a journal over
4 MB fails closed. Archive/reconcile such data after reviewing it; do not delete
it merely to suppress warnings. A leftover `.lock` file requires checking that
its owning process has exited before manual removal. The runtime never steals
locks. Session audit and recovery journal serve different purposes: the audit
is a capped user-readable policy history; the journal tracks action boundaries.

Portable filesystem replacement still has a small race with non-cooperating
editors. Write-ahead records and file fingerprints do not provide an OS sandbox,
tamper evidence, universal crash recovery, or an exactly-once guarantee for
external services.
