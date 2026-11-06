# Installation

AgentHub Terminal uses Node.js 24 and has no runtime dependencies. Development
runs TypeScript directly. npm archives contain compiled JavaScript, produced by
`npm run build` or automatically by `npm pack`.

## Requirements

| Requirement | Version / notes |
|---|---|
| Node.js | **24.0 or newer** (verified with v24.18.0). Node 22.18+ can strip types, but this project targets 24. |
| npm | Used only for dev dependencies (`typescript`, `@types/node`). |
| Git | Optional. Needed for repository context, git tools, and `skills install <url>`. |
| A model server | LM Studio (default `http://127.0.0.1:1234/v1`) or Ollama (`http://127.0.0.1:11434/v1`). |
| Windows | Windows 10/11 with Windows Terminal or PowerShell 7 recommended. |

No Python, Rust, Docker, or database is required.

## Install from the local project

```powershell
cd C:\path\to\AgentHub\AgentHub-CLI
npm install
```

`npm install` downloads only the two dev dependencies. It does **not** install
runtime packages. Verify:

```powershell
node --version          # v24.x
npx tsc --noEmit -p tsconfig.json
npm test
```

For a reproducible clean install, use `npm ci` from a copy of the project without
`node_modules` or `.agenthub`, then run `npm run check`. The package is MIT
licensed; see `LICENSE` and `docs/terminal-agent/LICENSING.md`.

## Run

From the project directory:

```powershell
npm start
```

or directly:

```powershell
node src/cli/main.ts
```

Both start the interactive TUI in the current directory.

One-shot examples:

```powershell
node src/cli/main.ts --print "Summarise this repository"
node src/cli/main.ts --json "List the top-level files"
node src/cli/main.ts --workspace C:\path\to\project
```

The thin launcher is also executable:

```powershell
node bin/agenthub.mjs --version
```

To verify an installable archive without changing the normal global command:

```powershell
npm run check:package
```

This builds the source, checks the archive contents, installs into a temporary
prefix containing spaces, and invokes the generated `agenthub` command there.
Version, help, JSON configuration, and approved/denied file writes are checked.
It uses a local deterministic provider fixture, not a real model. On Windows
this passed with Node 24.18.0; Linux remains unverified.

## Optional global command

The package declares `bin.agenthub`, so a local global link gives you the
`agenthub` command:

```powershell
cd C:\path\to\AgentHub\AgentHub-CLI
npm link
agenthub --version
cd C:\path\to\your\project
agenthub
```

To remove it:

```powershell
npm uninstall -g AgentHub-CLI
```

`npm link` makes the command use this checkout's source, so subsequent edits
take effect on the next launch. Run it again from the intended checkout if an
older copy owns the command. The current folder becomes the agent's workspace;
use `agenthub --workspace C:\path\to\project` to choose another folder.

The project is `"private": true` and has not been published to npm. Global
installation is a local convenience. To install a portable local archive, run
`npm pack` and then `npm install -g <archive.tgz>`. The prepack hook builds the
JavaScript entry. Do not pack with `--ignore-scripts` unless `npm run build` has
already succeeded.

## Prepare LM Studio (recommended on Windows)

1. Install LM Studio.
2. Download a tool-capable model. The verified model for this project is
   `gpt-oss-20b` (loaded with a 131,072-token context).
3. Start the local server and load the model. The LM Studio CLI ships with the
   app:

```powershell
lms server start
lms load gpt-oss-20b --context-length 131072 --gpu max --ttl 3600
lms ps
```

4. Confirm the OpenAI-compatible endpoint:

```powershell
node -e "fetch('http://127.0.0.1:1234/v1/models').then(r=>r.text()).then(console.log)"
```

5. Diagnose:

```powershell
node src/cli/main.ts doctor
node src/cli/main.ts models
```

`doctor` exits 0 only when the workspace is writable and a usable model is
reachable. It is read-only.

If the model is downloaded but not loaded, LM Studio may still list it. The
registry prefers a model marked `loaded`, then the first listed model. Load the
model for predictable behavior.

## Prepare Ollama

```powershell
ollama serve
ollama pull qwen2.5-coder:7b
node src/cli/main.ts doctor
```

Ollama must expose its OpenAI-compatible API at `http://127.0.0.1:11434/v1`.
Tool calling depends on the model and the Ollama version; verify with:

```powershell
node src/cli/main.ts doctor --probe
```

The probe makes one small request and reports the exact model tested.

## Optional: AgentHub app adapter

`skills check --repo` uses the existing AgentHub web application's compatibility
scanner instead of a second implementation. The app must be running and expose
`/api/skills`:

```powershell
cd C:\Users\SACHIN\Desktop\agent-session-project
npm run dev
```

Then:

```powershell
node src/cli/main.ts doctor
# AgentHub app ... reachable

node src/cli/main.ts skills check --repo https://github.com/anthropics/skills --dir skills/docx
```

If the app is not running, pass another URL with `--app-url` or set
`AGENTHUB_APP_URL`. Local skill install/list/inspect/check still work; only the
repository-wide scan requires the app.

## Workspace selection

The default workspace is the current directory. Select another:

```powershell
node src/cli/main.ts --workspace "C:\Users\SACHIN\Desktop\my-project"
```

or set `AGENTHUB_WORKSPACE`. A path containing spaces must be quoted.

The agent writes only inside the selected workspace (plus its own state under
`~/.agenthub`). Reads outside the workspace are denied unless
`--allow-outside-reads` is set.

## First-run checklist

1. `node --version` is 24+.
2. `npm install` completed.
3. LM Studio/Ollama is running and a model is loaded.
4. `node src/cli/main.ts doctor` shows a selected model.
5. `node src/cli/main.ts --print "Reply with exactly READY"` returns a real
   model response.
6. `node src/cli/main.ts skills list` shows the skill directories.
7. Start the TUI and run `/status`.

## Troubleshooting

**`ERR_UNKNOWN_FILE_EXTENSION` or TypeScript syntax errors.** Use Node 24. The
project relies on built-in type stripping and explicit `.ts` imports.

**`No local or configured model provider is reachable.`** The model server is not
running, the port is wrong, or no model is loaded. Run `doctor`; check the base
URL in `~/.agenthub/config.json`.

**LM Studio lists a model but requests fail.** Confirm the model is loaded, not
just downloaded. Try `lms load <model>` and a short `--print` request.

**`doctor` says cloud is blocked.** That is the secure default. Cloud endpoints
require `--allow-cloud` or `allowCloud: true` in the **user** config. Workspace
config cannot enable cloud access.

**`skills check --repo` says the AgentHub app is unreachable.** Start the web app
on port 3000 or pass `--app-url`. This check is the only feature that needs the
app.

**PowerShell blocks npm scripts.** Use `npm.cmd` or adjust the execution policy
for the current user. This project does not need lifecycle scripts at runtime.

**A command is denied in `--print`/`--json` mode.** Non-interactive approvals
deny by default. Re-run with `--yes` if the action is acceptable. Hard denials
(`git push`, root deletion, secret files, workspace escape) cannot be approved.

**Terminal looks garbled.** Use Windows Terminal. Add `--ascii` for ASCII
glyphs or `--no-color` when ANSI is unwanted.

## Uninstall

There is no installer. Remove the project directory and, if desired, the state
directory:

```powershell
Remove-Item -Recurse -Force C:\Users\SACHIN\Desktop\AgentHub-CLI
Remove-Item -Recurse -Force $HOME\.agenthub
```

Deleting `~/.agenthub` removes sessions, backups, skills, history, and memory.
Back up anything you want to keep first.
