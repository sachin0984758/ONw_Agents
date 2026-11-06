import { VERSION } from '../version.ts'

export const USAGE = `AgentHub Terminal ${VERSION}

Usage:
  agenthub [task] [options]        Start the interactive terminal agent
  agenthub --print <task>          One-shot answer to stdout
  agenthub --json <task>           Newline-delimited JSON events
  agenthub doctor                  Diagnose runtime, providers, tools, skills
  agenthub models                  List reachable models
  agenthub skills <command>        list | inspect | check | install | update | rollback | remove
  agenthub sessions <command>      list | show | search | rename | export | remove | recover
  agenthub memory <command>        list | search | add | extract | update | expire | remove
  agenthub backups <command>       list | prune (--dry-run by default; --yes to apply)
  agenthub config [migrate]         Show configuration, or explicitly migrate with a backup
  agenthub --resume last           Resume the most recent session
  agenthub --version               Print the version

Options:
  -w, --workspace <path>           Workspace root (default: current directory)
  -m, --model <id>                 Model id (provider/model prefix is optional)
      --provider <id>              Provider id (lmstudio, ollama, custom, ...)
      --permission <mode>          read-only | ask | auto | bypass
  -y, --yes                        Auto-approve approval prompts (never hard denies)
  -p, --print                      Non-interactive; final answer on stdout
      --json                       Non-interactive NDJSON event stream
      --session <id>               Continue a specific session
      --resume <id|last>           Load a previous session (no tool replay)
      --max-steps <n>              Agent step budget (default 12)
      --timeout <seconds>          Per-command timeout cap (default 120)
      --app-url <url>              AgentHub app for the skills compatibility adapter
      --skills-dir <path>          Extra skills directory (repeatable)
      --no-memory                  Do not load project/user memory
      --no-backups                 Disable file backups before writes
      --allow-outside-reads        Allow read tools outside the workspace
      --allow-cloud                Explicitly allow sending content to a non-local endpoint
      --no-evidence                Omit the evidence footer in --print mode
      --shell <kind>               auto | cmd | powershell | bash
      --theme <name>               auto | mono
      --no-color                   Disable ANSI colour
      --ascii                      Use ASCII glyphs
      --probe                      Doctor/models: probe tool calling with one small request
      --review                     One-shot read-only code review (overrides --yes)
      --force                      skills install: replace; update: accept an incompatible scan
      --dry-run                    Preview skills updates, config migrations or backup pruning
      --user                       skills/memory/config migrate: use the user-level directory
      --ref <ref>                  skills install/update: git branch, tag or commit
      --dir <path>                 skills install/update: subdirectory inside the source
      --skill <name>               skills install: choose one of several skills
  -q, --quiet                      Only the final answer and errors
  -v, --verbose                    More detail (tool output, provider information)
  -h, --help                       Show this help
  -V, --version                    Show the version

Examples:
  agenthub
  agenthub "Find why the login test fails and fix it"
  agenthub --print "Summarise this repository"
  agenthub --json --yes "Run the test suite and report failures"
  agenthub doctor --probe
  agenthub skills check
  agenthub skills install ./my-skill
  agenthub skills install https://github.com/owner/repo --ref main --skill my-skill
  agenthub skills update my-skill --dry-run
  agenthub skills check --repo https://github.com/owner/repo --ref main
  agenthub --resume last

Exit codes:
  0  completed successfully
  1  run failed, or a check found a problem
  2  usage or configuration error
  3  cancelled
  4  partial result (budget exhausted or blocked)

Notes:
  - Requires Node.js 24 or newer. Source and compiled npm installations are supported.
  - Built-in model runtimes are local: LM Studio (127.0.0.1:1234) and Ollama
    (127.0.0.1:11434). Custom remote endpoints require explicit consent.
  - Shell commands run with your OS user permissions; this is not an OS sandbox.
`
