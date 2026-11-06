# Skills

AgentHub Terminal uses the open Agent Skills format and is compatible with the
existing AgentHub Skills Library. Skills are **instructions and resources**, not
plugins. Loading a skill never adds a tool, changes a permission, or executes a
script.

## Layout

Every skill is a directory containing `SKILL.md`:

```
my-skill/
  SKILL.md          required
  references/       optional
  assets/           optional
  scripts/          optional; never run automatically
```

`SKILL.md` must start with YAML frontmatter:

```markdown
---
name: pdf
description: Use this skill for PDF extraction, merging, splitting and form filling.
license: MIT
version: 1.0.0
allowed-tools: Read Bash
---

# PDF workflow

1. Inspect the document.
2. Choose the right tool.
```

| Field | Required | Rules |
|-------|----------|-------|
| `name` | yes | lowercase letters, digits, hyphens; 1–64 chars; must match `^[a-z0-9][a-z0-9-]{0,63}$` |
| `description` | yes | short, trigger-oriented text used for discovery |
| `license` | no | shown by `skills inspect` |
| `version` | no | informational |
| `allowed-tools` | no | **informational only**; it cannot grant tools |
| `compatibility` | no | informational |

Other flat string keys are preserved as extra metadata. Nested YAML objects,
anchors, tags, and multi-document YAML are not evaluated. The parser supports
plain scalars, quoted scalars, simple arrays, and block scalars.

Limits: `SKILL.md` ≤ 512 KB; skill tree ≤ 1,000 files and ≤ 50 MB.

## Where skills live

| Source | Path | Precedence |
|--------|------|------------|
| user | `~/.agenthub/skills` | base |
| workspace | `<workspace>/.agenthub/skills` | shadows a same-named user skill |
| extra | `--skills-dir <path>` / `AGENTHUB_SKILLS_DIRS` | additional roots |

`agenthub skills list` prints every root, including missing ones, so it is clear
where the agent looked. A shadowed skill is marked and is not selectable by
name; the workspace copy wins.

## Progressive disclosure

1. **Discovery** reads the directory name, frontmatter, file inventory, and
   scripts. It does not put the full body in the prompt.
2. **Activation** happens when the model calls `read_skill` (or the user runs
   `/skill <name>` in the TUI). The body is returned as **untrusted
   instructions**, capped at 64 KB, with a policy reminder and the list of
   resources that were *not* loaded.
3. **Execution** of a referenced script is a separate action. There is no
   automatic script runner. A model may propose `run_command` for a script, and
   that command goes through the normal policy engine and approval flow.

The model sees the skill name and description in `list_skills`. The system
prompt also lists available skills. Nothing from a skill can grant a permission:
`skill.load` is always evaluated as untrusted text, and a skill's
`allowed-tools` field is labelled informational.

## Validating a skill

`skills check` performs a local static check:

```powershell
node src/cli/main.ts skills check
node src/cli/main.ts skills check pdf
node src/cli/main.ts skills check --json
```

Verdicts:

| Verdict | Meaning |
|---------|---------|
| `compatible` | valid format, no blocking issues found statically |
| `needs-review` | valid but has scripts, undeclared tools, or security warnings |
| `incompatible` | invalid frontmatter, missing metadata, or unsupported layout |
| `not-verified` | static checks cannot establish functional compatibility |

Checks include:

- frontmatter presence and closure;
- required fields and name rules;
- declared tools mapped to this agent's tool set (informational);
- missing capabilities;
- dependency hints (Python/Node requirements);
- script inventory (reported, never executed);
- prompt-injection and dangerous-instruction warnings;
- empty or oversized content.

The static check does **not** prove the skill works. A functional test through
the real model and tool path is required. The command says so explicitly.

## Repository compatibility scan

Repository-wide checks are delegated to the existing AgentHub web app scanner
instead of a second implementation:

```powershell
node src/cli/main.ts skills check --repo https://github.com/anthropics/skills
node src/cli/main.ts skills check --repo https://github.com/anthropics/skills --dir skills/docx
node src/cli/main.ts skills check --repo https://github.com/owner/repo --ref main --json
```

- The app must be reachable at `http://127.0.0.1:3000` or the URL passed with
  `--app-url` / `AGENTHUB_APP_URL`.
- The terminal calls `GET /api/skills?op=compat...`. The scanner remains in
  `agent-session-project/src/lib/agent-hub/skills-compat.ts`; it is not copied.
- With multiple skills, the command lists candidates and asks for `--dir` or
  `--skill`. This is not a failure; exit code 0.
- A completed scan with an `incompatible` overall verdict exits 1, so CI can
  detect it.
- If the app is unreachable, the command explains how to start it and exits 1.

Report fields include origin, source commit, revision key, environment
fingerprint, format/metadata/tools/dependencies/security/model/functional
statuses, and per-category details. `--json` prints the full report.

## Installing

```powershell
# local directory
node src/cli/main.ts skills install ./my-skill

# a GitHub repository with several skills
node src/cli/main.ts skills install https://github.com/anthropics/skills --skill pdf

# a subdirectory
node src/cli/main.ts skills install https://github.com/anthropics/skills --dir skills/pdf

# branch/tag/commit
node src/cli/main.ts skills install https://github.com/owner/repo --ref v1.2.0 --skill demo

# user-level install
node src/cli/main.ts skills install ./my-skill --user

# replace an existing install (old copy is backed up)
node src/cli/main.ts skills install ./my-skill --force
```

Behavior:

- Git sources are shallow-cloned with submodules disabled and terminal prompts
  disabled; the resolved commit is recorded.
- `--dir` limits candidate discovery to that subtree (a bug fix verified in this
  release).
- The source must contain exactly one skill unless `--skill` selects one.
- The name is re-validated after parsing. The target must resolve inside the
  skills root.
- Symlinks are skipped with a warning. `.git` and `node_modules` are not copied.
- No script is executed and no package manager is invoked during install.
- Install metadata is written to `.agenthub-installed.json` in the skills root:
  source, ref, commit (or a content hash for a local non-Git source), install
  time, and directory.
- Local source paths are recorded as absolute paths so a later update does not
  depend on the current working directory.

## Listing, inspecting, removing

```powershell
node src/cli/main.ts skills list
node src/cli/main.ts skills list --json
node src/cli/main.ts skills inspect pdf
node src/cli/main.ts skills inspect pdf --json
node src/cli/main.ts skills remove pdf --yes
```

`inspect` shows metadata, source, file count/size, license, static verdict,
scripts, the file inventory, and a preview of the instructions.

`remove` requires `--yes` (or `--force`) and moves the skill directory to
`~/.agenthub/backups/skills/<name>-<timestamp>` before deleting it. Removal is
recoverable until the backup is deleted.

## Updating and rolling back

`skills update` re-reads the source recorded at install time, stages the new
copy, shows a reviewable change summary, re-runs the AgentHub compatibility
scanner when the app is reachable, and replaces the skill only after those steps.

```powershell
# preview only; nothing is replaced
node src/cli/main.ts skills update pdf --dry-run

# apply the update
node src/cli/main.ts skills update pdf

# override a recorded ref
node src/cli/main.ts skills update pdf --ref v1.3.0

# accept an incompatible scanner verdict (explicit risk)
node src/cli/main.ts skills update pdf --force

# restore the most recent update backup
node src/cli/main.ts skills rollback pdf --yes
```

The result includes:

- current revision (recorded commit or content hash);
- proposed revision (new commit or content hash);
- added, modified, and removed files (removals are applied safely by replacing
  the whole directory, not by merging);
- compatibility result: checked / overall verdict / why it was not checked;
- backup location and the rollback command.

Behavior and safety:

- The updated source must still contain exactly one skill with the same name. A
  removed or renamed skill is an error; renaming is never automatic.
- The whole current directory is moved to
  `~/.agenthub/backups/skills/<name>-<timestamp>-update`, then the staged tree
  is moved into place. A failure restores the old tree and metadata.
- Existing files removed in the new version disappear; stale files cannot
  survive an update.
- A sidecar `.json` file records the previous metadata for `rollback`.
- **Permissions are not part of skill metadata.** Update never edits the user or
  workspace config, permission mode, allow/deny rules, or tool registry. A skill
  declaring new `allowed-tools` gains nothing.
- No script is executed during staging, validation, replacement, or rollback.
- If the AgentHub app is unreachable, the update proceeds and reports that the
  scanner recheck was not possible. It never claims a scan happened.
- An `incompatible` scanner verdict aborts before replacing anything unless
  `--force` is supplied.
- `rollback` keeps the replaced version as
  `<name>-<timestamp>-pre-rollback`, so a rollback is itself recoverable.

## Security model

| Threat | Mitigation |
|--------|------------|
| Malicious frontmatter | strict flat parser; no YAML tags, anchors, or code |
| Path traversal in a skill name | name regex + `resolveInside` |
| Symlink escape during discovery | symlinks are not followed; install skips them |
| Huge skill or file bomb | 512 KB `SKILL.md`, 1,000 files, 50 MB tree |
| Prompt injection in instructions | body is labelled untrusted and cannot grant permissions |
| Silent script execution | no automatic runner; scripts are listed only |
| Unreviewed replacement | update shows a file-level change summary, rechecks compatibility, and backs up the old copy |
| Privilege escalation through update | update never edits config, permissions, allow/deny rules, or tools |
| Stale files after update | the full directory is replaced; removed files do not survive |
| Scanner drift | repository scan uses the existing app implementation, not a copy |

Skills from untrusted repositories should still be reviewed before activation.
A valid `SKILL.md` can contain persuasive text; the policy engine protects tools,
not the model's judgment.

## Agent-proposed skills

Not implemented. A future version may let the agent draft a skill, but the draft
must be written to a staging area, shown to the user, validated, and installed
only after explicit review. The agent must never be able to modify its own
permissions or silently install instructions.

## Creating a compatible skill

1. Create a directory with a lowercase hyphenated name.
2. Add `SKILL.md` with `name` and `description` frontmatter.
3. Write instructions that are specific and verifiable.
4. Put large references in separate files; name them in the instructions.
5. Keep scripts optional and document how to run them manually.
6. Run `skills check <name>`.
7. Run a real task with the skill installed and confirm activation appears in the
   tool evidence. Static validity is not functional verification.

## Verified example

During this release, `slack-gif-creator` was installed from
`https://github.com/anthropics/skills` at commit
`dbd4588f9e1033efb41dad4bef2f7947c8993d44`, listed, inspected, statically
checked (`needs-review` because it ships four Python scripts), activated through
a real LM Studio model run (`list_skills` → `read_skill`), and removed with a
backup. No script was executed.
