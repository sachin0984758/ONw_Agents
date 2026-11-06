# Model providers

## Capability provenance

Provider `capabilities` may explicitly configure boolean streaming, tools, JSON,
vision and reasoning support. `ModelInfo.capabilities` labels each as configured
or observed. Unknown stays absent; a model name is never evidence. Actual SSE
and valid native-tool responses are observed during runs and saved in the
endpoint/model-scoped `~/.agenthub/capabilities.json` registry for seven days.
Configured values take precedence. Explicitly unsupported tool support blocks
child orchestration. Ordinary discovery never infers JSON/vision/reasoning
support, and flags do not add those modalities to the text-only request adapter.

AgentHub Terminal supports the OpenAI-compatible `/chat/completions` wire
protocol so it can talk to local inference servers. The protocol name does not
mean the app connects to a hosted service. Built-in runtimes are local; a
remote custom endpoint is optional and requires explicit user consent.

## Built-in providers

| id | Label | Default base URL | Local | Credential |
|----|-------|------------------|-------|------------|
| `lmstudio` | LM Studio | `http://127.0.0.1:1234/v1` | yes | none |
| `ollama` | Ollama | `http://127.0.0.1:11434/v1` | yes | none |
| `custom` | Custom endpoint | `http://127.0.0.1:8000/v1` | from URL | `AGENTHUB_API_KEY` |

`AGENTHUB_BASE_URL` overrides the custom endpoint's base URL.
`AGENTHUB_API_KEY` supplies its key. Entries are merged by `id`, so a config can
override just the URL or add a provider without repeating the defaults.

A runtime is local only when its URL uses `localhost`, `127.0.0.1`, `::1`, or
`0.0.0.0`. A config `local` label cannot bypass the remote-consent gate.

## Cloud consent

Cloud use requires **both**:

1. `allowCloud: true` in the **user** config, or `--allow-cloud`, or
   `AGENTHUB_ALLOW_CLOUD=1`.
2. A non-local provider that passes the runtime check in `main.ts`.

Workspace config cannot enable cloud access. Without consent:

- cloud providers are **skipped before any network call** during discovery;
- the doctor report says "Skipped: remote endpoints are disabled";
- a resolved non-local target is rejected before the run starts.

This prevents a cloned repository's `.agenthub/config.json` from sending source
code to a remote service.

No hosted model provider is registered by default. Custom remote endpoints are
not probed or used until remote inference is explicitly enabled by the user.

## Discovery

`agenthub models` and `doctor` call `GET <baseUrl>/models` for each provider in
parallel. For LM Studio, the adapter also checks its native metadata endpoints
to learn which models are loaded and their context length when available. That
metadata is advisory; a failed native probe does not hide a working
OpenAI-compatible endpoint.

The output includes:

- provider reachability;
- model ids;
- `loaded` and context length when the server reports them;
- skip/error reasons with a duration;
- whether the final selection is usable.

Discovery never invents models. If a server returns an empty list, the provider
is reachable but unusable.

## Model selection

Resolution order:

1. **Explicit `provider/model`** — if the provider is reachable, use the rest of
   the string as the model id.
2. **Explicit model id** — prefer the configured provider, then a provider that
   lists it (priority: LM Studio, Ollama, custom).
3. **Explicit model on a configured reachable provider** — send it even if the
   server did not list it, with a warning.
4. **`--provider <id>` with no model** — first loaded model, else the first
   listed model.
5. **Auto** — first reachable provider by the same priority, first loaded model,
   else the first listed model.

A requested model that no provider lists can still be attempted on the highest
priority reachable provider, with a warning. This supports servers that serve
models without exposing them in `/models`. It does not guarantee the model
exists.

Tool support is never inferred from a model name. Use:

```powershell
node src/cli/main.ts doctor --probe
```

The probe makes one small tool-calling request, records the exact provider and
model, and reports `supported`, `unsupported`, `inconclusive`, or `error`. It
costs one request and is opt-in.

## Request behavior

The adapter sends:

```json
{
  "model": "...",
  "messages": [...],
  "stream": true,
  "temperature": 0.2,
  "tools": [...],
  "tool_choice": "auto"
}
```

- Temperature defaults to `0.2` for deterministic coding work.
- Tool schemas are included only when tools are enabled.
- `max_tokens` is sent only when a caller sets it.
- The timeout defaults to 180 s per request (provider config can lower it).

## Streaming and tool calls

The SSE parser:

- accepts `data:` lines and multiple data lines per event;
- normalizes CRLF;
- stops at `[DONE]`;
- emits text deltas as they arrive;
- assembles tool calls by `index`, including fragmented names and arguments;
- parses JSON arguments and reports malformed arguments instead of silently
  dropping the call;
- reads usage from the final chunk when present;
- rejects malformed events with a specific error;
- surfaces provider `error` events;
- marks partial output so a response that already emitted text is not retried.

Local servers sometimes ignore `stream: true` and return a single JSON object.
The adapter detects a non-SSE response and parses `choices[0].message`,
including non-streaming `tool_calls`.

## Retries

Up to **3 attempts** for retryable transport failures (connection refused,
timeout, HTTP 408/429/5xx), with exponential backoff and jitter (roughly 350 ms,
700 ms, 1.4 s). Authentication errors (401/403), not-found (404), bad requests
(400), and malformed streams are not retried.

A response that already delivered text and then failed is marked `PARTIAL` and is
not retried, to avoid duplicating output. The agent loop separately refuses to
automatically retry any response that contained tool calls, because side effects
may already have occurred.

## Usage reporting

The provider reports token usage only if the server sends it. Otherwise usage is
`null`, and the CLI/TUI says **"Token usage is estimated"** while showing an
estimate derived from character counts. The estimate is explicitly labelled; it
is never presented as provider-reported billing data.

`--json` includes the usage object on the final event. `sessions show` displays
the stored totals.

## Context length

`contextTokens` (default 16,000) is the prompt budget used by the context
trimmer. It is not a measurement of the model's real window. A 131,072-token
model can still be configured with a smaller budget to control cost and latency.

`trimMessages()` keeps the system prompt and the most recent turns, truncates
large tool results, and inserts a notice when older messages are dropped. The
`/compact` TUI command performs a more explicit compaction of the current
session.

## Commands

```powershell
node src/cli/main.ts models
node src/cli/main.ts models --json
node src/cli/main.ts models --probe
node src/cli/main.ts doctor
node src/cli/main.ts doctor --json
node src/cli/main.ts config
```

`models` lists reachable providers and models. `doctor` adds configuration
paths, posture, app adapter status, skills, Git, and session storage. Both are
read-only. `doctor` exits 1 when no usable model is reachable or the workspace is
not writable; `models` exits 1 only when nothing is reachable.

## LM Studio notes

Recommended on Windows:

```powershell
lms server start
lms load gpt-oss-20b --context-length 131072 --gpu max --ttl 3600
lms ps
```

Verified in this release: LM Studio `gpt-oss-20b`, provider `lmstudio`, model
`gpt-oss-20b`, context loaded at 131072. Live runs completed text, read, write,
resume, and skill-activation tasks.

If LM Studio is running but no model is loaded, `/v1/models` may still list
downloaded models. Load one before running the agent. `doctor` prefers loaded
models but cannot force a server to load one.

## Ollama notes

Ollama's OpenAI-compatible endpoint is used; no Ollama-specific client is
required:

```powershell
ollama serve
ollama pull qwen2.5-coder:7b
node src/cli/main.ts models
```

Some Ollama models do not support tools or do so inconsistently. Run
`doctor --probe` and a small read-only task before trusting a model for edits.
Model naming can include a tag (`qwen2.5-coder:7b`); the CLI accepts it.

## Custom and cloud endpoints

A local OpenAI-compatible server:

```json
{
  "providers": [
    {
      "id": "custom",
      "kind": "openai-compatible",
      "baseUrl": "http://127.0.0.1:8000/v1",
      "local": true
    }
  ]
}
```

A cloud endpoint requires the user config and an explicit run:

```json
{
  "providers": [
    {
      "id": "work",
      "label": "Work gateway",
      "kind": "openai-compatible",
      "baseUrl": "https://llm.example.com/v1",
      "apiKeyEnv": "WORK_API_KEY",
      "local": false
    }
  ],
  "allowCloud": true
}
```

```powershell
$env:WORK_API_KEY = "..."
node src/cli/main.ts --provider work --model my-model --print "Summarise the README"
```

Keys come from environment variables. The program does not write keys to disk.
Redaction is applied to error details and displayed output, but a key that a
permitted command prints can still leak; see `TOOLS_AND_PERMISSIONS.md`.

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `cannot reach .../v1/models` | server down or wrong port | start LM Studio/Ollama; check `baseUrl` |
| provider reachable, 0 models | no model installed/loaded | install or load a model |
| `model was not listed ... using it anyway` | server hides models | verify the id with a short request |
| 401/403 | missing/invalid key | set the env var; cloud must be enabled |
| timeout | model loading or large prompt | load the model; reduce prompt/context |
| tools never called | model/server lacks tool support | run `doctor --probe`; choose a tool-capable model |
| usage shows "estimated" | server omitted usage | expected; not a failure |
| 400 on tools | server rejects tool schemas | use a compatible server/model; report the exact error |

Provider errors include the HTTP status and a redacted detail. The doctor report
never prints API keys.
