# Known limitations

This document lists what the current release does **not** do, where it can fail,
and which claims are unverified. It is intentionally conservative.

## Security

1. **No OS sandbox.** Once a command is approved, it runs with your OS user
   permissions. A permitted command can read other files, start services, or
   reach the network. Directory checks and the policy engine are application
   controls, not kernel isolation. Use a container, VM, or restricted account for
   untrusted work.
2. **Command classification is pattern-based.** The hard-deny and risky lists
   catch common destructive commands, but obfuscation, aliases, scripts, and
   living-off-the-land binaries can evade them. `ask` is the default for this
   reason. `auto` and `bypass` reduce or remove that safety net.
3. **Redaction is pattern-based.** `sk-...`, GitHub tokens, AWS keys, private
   keys, bearer tokens, and `api_key=`/`token=`/`password=` shapes are masked.
   Novel or split secret formats can pass through. Redaction is defence in depth,
   not a guarantee.
4. **Read output is redacted.** `read_file` and `search_files` return redacted
   text. This can prevent an exact edit of a file that legitimately contains a
   secret-like string, and the model may write `***REDACTED***` back if it edits
   what it saw. Secret files are hard-denied, which makes this rarer but not
   impossible for ordinary files.
5. **Backups are raw copies.** A backup contains the original file bytes,
   including anything secret-like that was allowed to be written. Backups live in
   `~/.agenthub/backups` with normal OS permissions and are not encrypted. Built-in
   file backup count/bytes/age limits and explicit pruning apply; skill update
   backups have separate retention and are not pruned by the file-backup command.
6. **Session redaction is deep but pattern-based.** Message content, tool-call
   arguments (re-serialized as valid JSON), titles, ledger commands, and plan
   notes are redacted before storage. Recognizable token shapes are still the
   limit; a novel secret format can survive. Transcripts are also truncated at
   240 messages / 8,000 characters per content field.
7. **TUI history is not encrypted.** `~/.agenthub/history` stores what you
   typed. Recognizable credential patterns are redacted before history is
   saved, but novel or split secret formats may remain in the file.
8. **No encryption at rest.** Sessions, memory, backups, config (including MCP
   `env` values), and history rely on filesystem permissions. Session writes
   request mode `0600`; Windows still applies ACLs rather than POSIX mode.
9. **No secret store.** API keys are read from environment variables. The program
   does not write keys to config, but environment variables can appear in process
   listings, crash dumps, or shell history.
10. **Approval "always" is per process.** Choosing "always" remembers an
    approval only for the current run. There is no persisted per-directory rule
    editor.
11. **`--yes` is broad.** It approves every `ask` decision in a headless run.
    Hard denies still apply, but risky commands can run. Use it only with a
    trusted task and a reviewable workspace.
12. **Skill text is untrusted but persuasive.** Policy prevents permission
    escalation and automatic script execution, not bad advice. Review skills from
    third parties.
13. **No signature or provenance verification for skills.** Install records the
    Git commit when available, but does not verify a signature or a publisher.
14. **MCP is outside the workspace sandbox.** A configured MCP server is an
    arbitrary local program running with your OS user permissions. It can reach
    paths and networks that the built-in file tools deny. The `readOnlyHint` used
    by read-only mode is self-declared by the server, not verified.
15. **MCP `env` values are plaintext config.** They are not printed by
    `agenthub config` (only key names are), but they are stored in
    `~/.agenthub/config.json` and are not encrypted.
16. **MCP stderr redaction is best-effort.** Connection errors show a bounded,
    pattern-redacted stderr tail; a server can print an unrecognized secret.
17. **Subagents share authority and workspace.** A child cannot gain broader
    permissions, but it can perform any action the parent could and its writes
    are not rolled back if the parent later fails.

## Capabilities not implemented

1. **MCP is stdio tools-only.** `mcp_list` and `mcp_call` cover tools. Resources,
   prompts, sampling, roots, logging, progress notifications, HTTP/SSE transport,
   OAuth, persistent connections, and server discovery are not implemented.
2. **MCP schema support is bounded.** `$ref`, `oneOf`/`anyOf`/`allOf`,
   conditionals, `patternProperties`, and `propertyNames` are rejected rather
   than guessed.
3. **Subagents are bounded but not isolated.** Two child levels and configurable
   global concurrency/count bounds; specialized pools are read-only. Mutable
   child tasks are sequential, with no worktree, model selection or rollback.
4. **No agent-proposed skill workflow.** The agent cannot draft, stage, review, or
   install a skill for itself. Installs and updates are user commands.
5. **Skill update compatibility depends on the app.** Without a reachable
   AgentHub app, update reports that the scanner recheck was skipped. It never
   claims a scan happened.
6. **No archive installs.** Skills install from a local directory or a Git URL.
   Zip/tar packages are not accepted.
7. **No plugin or custom-tool loading.** Tools are compiled into the project.
8. **No LSP or IDE integration.** No diagnostics from a language server, no
   VS Code/JetBrains bridge. MCP is a separate tools-only integration.
9. **No image, audio, or PDF input.** Providers receive text and tool schemas
   only. A skill can describe how to process a PDF with external tools, but the
   agent cannot view one directly.
10. **No embeddings or semantic code search.** Context uses a bounded repository
    map, text search, and explicit file reads.
11. **No browser automation.** The agent cannot open or inspect a web page except
    through a command it is allowed to run.
12. **No automatic commits.** Explicit staging/commit tools require the central
    approval policy. No dedicated push, reset, clean, branch-creation or
    worktree tool is provided.
13. **No `delete_file` or move/rename tool.** File removal is possible only
    through an approved shell command (and destructive patterns are restricted).
14. **No background jobs or scheduling.** A run is foreground and cancellable.
15. **Concurrency is restricted.** Only listed independent read tools overlap in
    read-only mode. Specialized pools are bounded and read-only. Mutations,
    approval-bearing tool batches and MCP calls remain sequential/per-call.
16. **No update checker, telemetry, or remote diagnostics.** This is deliberate;
    all diagnostics are local.

## Model and provider behavior

1. **OpenAI-compatible only.** The adapter targets `/chat/completions` and
   `/models`. Native Anthropic, Gemini, Bedrock, and Responses APIs are not
   implemented. A compatible gateway can be used.
2. **Tool support varies by model and server.** Tool calling is not inferred from
   the model name. `doctor --probe` tests it explicitly. Some models emit
   malformed arguments or never call tools.
3. **Live support is model/configuration-specific.** Spark x2.6 4B passed the
   documented live workflow, including owned MCP and subagent fixtures.
   GPT-OSS has historical passing evidence; Qwen's tested setup failed native
   tool calls. Ollama/cloud and other combinations remain unverified.
4. **Cloud is untested in this release.** No cloud key or consent was configured.
   The gate is implemented and unit-described, but a real cloud run is not
   evidence.
5. **Usage is often estimated.** Local servers frequently omit token usage. The
   UI labels the estimate; stored totals can include estimated counts. These
   totals are not billing data.
6. **The context budget is a character estimate.** `contextTokens` uses
   `chars / 4`, not the model's tokenizer. Trimming can still exceed the real
   window or evict useful content. Loaded model context, tool definitions and a
   response reserve now bound the message budget. If protected messages cannot
   fit, the run stops partial before sending; this is still an estimate.
7. **Context trimming is lossy.** Old tool output and assistant text are replaced
   with placeholders, and old groups are dropped. A resumed or long session may
   lose details the model needs.
8. **No prompt caching, reasoning controls, or provider-specific sampling.** Only
   temperature (default 0.2) and optional `max_tokens` are sent.
9. **Streaming quirks.** The SSE parser expects one JSON object per event. Servers
   that send unusual framing or multiple JSON objects in one event can fail. A
   non-SSE JSON response is supported as a fallback.
10. **Automatic retries stop at 3 attempts for transport errors.** Authentication
    and bad-request errors are not retried. A stream that emitted text before
    failing is not retried. A response with tool calls is never auto-retried by
    the loop.

## Agent loop

1. **Default budgets are modest.** 12 steps, 15 minutes wall clock, 120 s per
   command, 16,000 context tokens, 200 KB command output. Large tasks need
   explicit increases.
2. **No full independent semantic completion check.** An explicit plan with any
   non-completed step downgrades a normal final response to `partial`. A
   tool-shaped JSON response for a registered tool also becomes `partial` when
   the request begins with one of the runtime's recognized action phrases and
   the model returns the exact `{name, arguments}` envelope as its whole
   response; explanatory examples remain ordinary answers. Other phrasings and
   ordinary prose are not semantically checked and can still be marked
   `completed` without proof that the requested task succeeded. Plan status is
   also model-reported. Review the execution evidence.
3. **No automatic test discovery.** The model decides what to run. If it runs
   nothing, the evidence says "no test or check command was run after the file
   changes".
4. **Denials can leave work partial.** A denied action is reported honestly as
   `partial` with a limitation. The model may continue with a different approach.
5. **Loop detection is limited.** Repeated identical failing tool calls are
   stopped; other unproductive loops rely on the step/wall-clock budget.
6. **Plan restore is display/context only.** The plan persists and is restored
   on resume, but completed steps are not re-verified; a restored plan is not
   proof that the work is still present.
7. **No session branching or forking.** You can resume a session, not create
   variants or rewind to a message.
8. **Stored transcripts are capped.** 240 messages and 8,000 characters per
   content field. Older detail is removed from the stored session, though it may
   still exist in the live run.
9. **Session workspace mismatch is advisory.** Resuming in another workspace
   warns and uses the current workspace; it does not prevent the resume.
10. **No global transaction.** Memory, backup indexes and journal operations
    have cooperative cross-process locks. Other session/workspace writes can
    still race; non-cooperating editors do not observe these locks.

## Tools

1. **Reads are capped** at 512 KB / 2,000 lines per call; larger files are
   partially read and marked truncated.
2. **Writes are capped** at 1 MB, output at 160 KB, command output at the
   configured cap. Truncation can hide the relevant error.
3. **Searches skip files over 1 MB and binary files.** No index is built, so
   large repositories can be slow.
4. **No fuzzy editing.** `edit_file` requires exact text and fails on ambiguity.
   CRLF is normalized, but other whitespace differences are not.
5. **Verification tooling is bounded.** Automatic post-edit verification detects
   root npm/pnpm/yarn/bun test/lint/typecheck scripts and uses normal command
   permissions. No automatic formatter runs. Unsupported project ecosystems,
   missing checks and semantic correctness require manual verification.
6. **Git mutation tools are deliberately narrow.** `git_stage` stages explicit
   workspace paths after approval, and `git_commit` commits only already staged
   changes after approval. They do not provide reset, clean, push, fetch, or
   pull. Shell commands remain available according to the broader shell policy.
7. **Shell semantics are platform-specific.** `cmd.exe` is the Windows default;
   PowerShell and Git Bash require `--shell`. Quoting rules differ, and a command
   written for one shell may fail in another.
8. **Process-tree kill is best effort.** `taskkill /T /F` or a process-group kill
   handles common cases; detached grandchildren or services may survive.
9. **No PTY for commands.** Interactive commands that require a terminal can
   hang or fail; they are killed at the timeout.
10. **Environment filtering is name-based, not isolation.** Shell and MCP child
    processes omit inherited variables whose names look like common credentials.
    Explicit variables configured for an MCP server are still passed to it.
    Unknown secret names can pass through, and a child process still runs as the
    current OS user.
11. **File writes and undo use optimistic checks, with a narrow race.** A write
    re-reads the file after approval and aborts if it differs from the prepared
    snapshot. Undo checks the recorded post-write file and saved original. Old
    backup entries without fingerprints cannot be undone automatically. A
    separate process can still edit between the final check and replacement;
    this is not an atomic compare-and-swap on every supported filesystem.

## Skills

1. **Static checks are heuristics.** A `compatible` verdict does not prove the
   skill works, and `needs-review` does not prove it is malicious. Only a real
   task exercises behavior.
2. **Repository scanning depends on the AgentHub web app.** If the app is not
   running at the configured URL, `skills check --repo` fails with instructions.
   The report format is owned by the app and can change.
3. **The frontmatter parser is intentionally small.** It does not support full
   YAML (nested objects, anchors, tags, multi-document files). A skill using those
   features is rejected rather than guessed.
4. **Install copies the tree.** It skips symlinks, `.git`, and `node_modules`,
   and enforces 1,000 files / 50 MB. A legitimate larger skill is rejected.
5. **No dependency installation.** A skill's `requirements.txt` or
   `package.json` is not installed. Running its scripts requires a separate,
   approved command and a prepared environment.
6. **Scripts are inert but not harmless.** They cannot run automatically, but the
   model may propose running one; the normal policy and approval flow applies.
7. **Update backups accumulate.** `skills update` and `rollback` keep timestamped
   directories under `~/.agenthub/backups/skills`; file-backup retention does
   not prune skill backups.

## Memory

1. **Conservative extraction only.** Automatic storage is an opt-in for exact
   user-labelled `remember category: text` requests and follows memory policy;
   the runtime does not infer facts or learn from tool/assistant output.
2. **Bounded local memory.** Legacy Markdown plus categorized JSON records,
   64 KB per store, lexical retrieval, configurable retrieval budget and expiry.
   No embeddings, inferred updates or automatic deletion of expired records.
3. **Secret rejection is pattern-based.** A secret in an unrecognized format can
   be stored.
4. **Plaintext at rest.** Not encrypted.

## Interface

1. **The TUI uses a scrolling transcript and a compact composer.** The input
   follows short conversations and stays at the bottom once the window fills. No
   mouse, panes, or alternate-screen dashboard. Resizing replays up to roughly
   256,000 characters of recent transcript; older content remains in session storage subject
   to its existing limits. Markdown is rendered line-by-line (headings, lists,
   quotes, fences, inline spans), not as a full document. Very short windows
   (under seven rows) are not supported by this layout. The slash picker shows
   up to five matches at once and scrolls with the selection. It suggests command
   names, not model IDs, skill names, paths, or other arguments.
2. **No rich diff viewer.** Diffs are plain text with simple colour and a
   truncated preview; there is no side-by-side or foldable view.
3. **Multiline input** uses a trailing backslash, not a full editor.
4. **Unicode depends on the terminal and font.** Use `--ascii` if glyphs render
   poorly; `--no-color` disables text color. Interactive mode still needs ANSI
   cursor controls; use `--print` or `--json` for non-interactive output.
5. **No Windows Terminal-specific integration.** No tabs, panes, notifications,
   or shell integration.
6. **History is a flat file**, shared across sessions in the same home.

## Packaging and project state

1. **Node 24 is required.** There is no bundled binary or single-file executable.
   Development uses built-in TypeScript stripping; installed archives use
   compiled JavaScript and still declare Node 24 as the supported runtime.
2. **No published package.** The package is private. A current-source clean-copy
   check and an isolated archive/global-command check passed on Windows on
   2026-10-31. npm archives now ship compiled JavaScript because Node refuses
   TypeScript stripping under node_modules. Linux remains unverified because
   this host has no usable WSL distribution.
3. **Hosted CI has not run.** The Node 24 Windows/Ubuntu workflow is at
   `.github/workflows/ci.yml` inside `AgentHub-CLI`, but the CLI folder has no
   independent Git root. GitHub will not discover that nested workflow from
   the containing `Test` repository. It needs a standalone CLI repository or a
   workflow configured at the containing repository's root before a hosted
   run can verify Linux. A parent-root workflow is prepared at
   `docs/terminal-agent/ci-parent-workflow.yml`; the user declined edits outside
   the CLI folder, so it has not been installed at the root.
4. **MIT was chosen for this project.** See `LICENSING.md` and `LICENSE`; this is
   a project decision, not legal advice.
5. **Research is a snapshot.** Repository metadata and licenses were checked on
   2026-10-21. Star counts and project status drift.
6. **No off-machine backup.** The existing app's `origin` points to a local bare
   repository on the same machine. This is not a disaster-recovery backup.
7. **The existing app's `npm run build` script is not Windows-safe** because of
   trailing Unix `cp` commands. `npx next build` succeeds. The script was left
   unchanged.
8. **The new project is not a Git repository and has no commits.** All work is
   uncommitted, as required.
9. **Git history is not established.** The delivery checklist asked for a Git
   history, but the overriding instruction was to make no commits and no pushes.
   Initializing and committing would violate that instruction, so history
   remains intentionally absent. This conflict is recorded rather than hidden.

## Verification still missing

The bounded remaining-feature implementations and their specific limitations
are recorded in `REMAINING_FEATURES_2026-11-01.md`. Lexical memory ranking is not
semantic retrieval. Journal recovery preserves unknown outcomes rather than
replaying them. Automatic project checks do not prove semantic task completion.
Backup pruning is explicit, preserves the newest undo point, and leaves orphan,
legacy-unverifiable or tampered files untouched. A stale storage lock requires
manual review; journals are capped at 4 MB without automatic archival.

- A real cloud-provider run with consent.
- Ollama with a tool-capable model.
- Broader live MCP/subagent coverage. Spark passed real model calls to an owned
  stdio fixture and a child agent; arbitrary external servers, specialized
  pools and long-running orchestration remain unverified.
- Interactive approval for every tool type (write was verified; command approval
  used a fake).
- Native OS signal delivery across supported terminals. A headless SIGINT event
  delivered through a child-process harness to the real launcher now verifies
  exit code 3, session persistence, and no wrapper child; physical terminal and
  Linux signal delivery remain unverified.
- Very large repositories, long sessions, and low-memory conditions.
- Adversarial shell-injection and obfuscation testing beyond the pattern tests.
- The long-running tool progress line and cancellation cleanup through a live
  PTY. Markdown rendering, multiline input, resize flush, and normal `/quit`
  cleanup were verified in a Windows PTY on 2026-10-21.
