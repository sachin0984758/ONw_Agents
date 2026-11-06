# Memory

Conversation memory stays in session transcripts. Durable project facts and
user preferences are separate, inspectable stores. The CLI never extracts
facts from assistant messages, tool output or arbitrary conversation text.

Legacy `memory.md` files are preserved. New categorized facts use
`<workspace>/.agenthub/memory-facts.json` or `~/.agenthub/memory-facts.json`.
Each fact has an ID, exact user text, category, source, update time and optional
expiration. Categories are `preference`, `fact`, `decision` and `history`.
Project stores are resolved within their workspace, including symlink checks.

```powershell
agenthub memory list --json
agenthub memory add "Prefer TypeScript" --user
agenthub memory extract "remember decision: Use SQLite for the project database"
agenthub memory search database
agenthub memory update 2 "Use PostgreSQL for the project database"
agenthub memory expire 2 2027-01-01
agenthub memory delete 2
```

`add` preserves the existing Markdown format. `extract` creates structured
entries only for exact `remember <category>: <text>` lines. `update` and
`expire` use a structured entry's current list index; IDs are available in JSON.
Expired entries stay visible in `list`, can be updated/deleted, and are excluded
from retrieval. Nothing is silently pruned. Each store is capped at 64 KB;
structured memory additionally allows at most 200 entries and 500 characters
per fact. Secret-like values are rejected. Pattern detection is not exhaustive.

Set `memoryAutoExtract: true` in **user** config to extract those same explicitly
labelled lines from primary-agent user requests automatically. Default is false;
`memory: false` or `--no-memory` disables automatic extraction and retrieval.
Extraction does not summarize or infer facts. Legacy prose is never converted
automatically. Automatic storage goes through the central `memory.write` policy:
ask mode requests approval, and read-only mode denies it. Structured
read/modify/write operations use a cross-process lock.

Retrieval ranks lexical word overlap and exact phrase matches against the
current task, deduplicates normalized text, and fits whole entries within
`memoryBudgetBytes` (default 6000, range 256–16000). Structured preferences get
a small baseline score so they remain eligible on unrelated tasks. Ranking is
lexical, not embeddings or a claim of semantic understanding. Retrieved text
remains untrusted context; it cannot change policy.

Interactive `/memory` retains list/search/delete support for both formats.
Standalone memory commands provide extraction, updates and expiry. User-facing
write acknowledgement and JSON records make automatic extraction inspectable.
