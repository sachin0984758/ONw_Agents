# Source review: remaining master-prompt requirements

Historical source snapshot. The 2026-11-01 continuation implements bounded
versions of these eight feature groups. See
`REMAINING_FEATURES_2026-11-01.md` for exact implemented scope, tests and the
remaining boundaries; the table below is preserved as the earlier audit.

This is a targeted review of the existing CLI modules against the requirements
that were still open. A working local model can verify implemented behavior;
it cannot supply features that have no implementation.

## Implementation gaps confirmed in source

| Requirement | Current implementation | Still missing | Source evidence |
|---|---|---|---|
| Intelligent layered memory | Project/user Markdown, add/list/search/remove, exact deduplication, secret rejection and a 64 KB cap | Automatic extraction, semantic/lexical relevance scoring, categorized fact updates, expiration and configurable memory budgets | `src/cli/commands/memory.ts`, `src/context/repo.ts`, `src/config/types.ts` |
| Dependency-aware planning | Ordered titles with pending/active/completed/blocked/skipped statuses, saved across resume | Dependency graph validation/enforcement, failed/cancelled step states, dependency-aware replanning | `src/core/plan.ts`, `src/tools/plan.ts`, `src/core/events.ts` |
| Controlled parallel execution | Tool calls execute sequentially; bounded child agents use the parent's permissions | Configurable concurrency, specialized agent pools and controlled parallel scheduling | `src/core/run.ts`, `src/tools/subagent.ts`, `src/tools/types.ts` |
| Durable execution recovery | Session checkpoints after tool batches and at run end; interrupted tool messages are repaired; no automatic replay | An action journal, crash-safe transaction/checkpoint recovery, reconciliation of interrupted side effects | `src/core/run.ts`, `src/sessions/store.ts` |
| Independent task verification | Tool failures, denials, unfinished plans, token-limited answers and a narrow tool-shaped-text response downgrade completion | General verification that the user's task was semantically fulfilled; an automatic post-edit test/review pipeline | `src/core/run.ts`, `src/core/ledger.ts`, `src/context/repo.ts` |
| Provider capability registry | Discovered model ID, loaded status, effective context length; explicit native tool probe | Persisted/configured JSON-output, vision and reasoning capability records and a broader live provider matrix | `src/providers/types.ts`, `src/providers/registry.ts` |
| Backup retention | Fingerprinted originals, guarded undo, at most 200 index entries | Configurable on-disk pruning, retention/space controls and orphan-backup recovery | `src/core/backups.ts` |
| Versioned configuration migration | Validated defaults, environment/user/workspace/CLI precedence and existing compatibility | Versioned schema migrations with explicit migration backups | `src/config/load.ts`, `src/config/types.ts` |

No missing feature above is marked implemented by a successful model test.
Existing data and backups were preserved.

## Validation gaps

- Linux has not been executed locally: no installed WSL distribution or
  container runtime was available. The user requested no edits outside the CLI
  folder, so a root-discoverable GitHub workflow was not installed.
- Native physical-terminal signal delivery, long-session/large-repository
  stress tests, an independent adversarial security review, and a broader cloud
  and Ollama provider matrix remain unverified.
- Automated tests exercise all 18 slash commands through the real TUI with
  deterministic providers. This is not a claim of a fresh physical-terminal
  live-model exercise of every slash command in this checkpoint.

The current live-model results are recorded separately in
`LIVE_RECHECK_2026-10-31.md`, including failures and focused reruns. Application
controls still do not provide an OS sandbox; filesystem race and redaction
limitations remain documented in `KNOWN_LIMITATIONS.md`.
