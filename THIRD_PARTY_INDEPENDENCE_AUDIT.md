# AgentHub third-party independence and network audit

Audit date: 2026-10-29  
Scope: the current checkout at `C:\Users\SACHIN\OneDrive\Desktop\Test`.

## Findings

AgentHub's chat and agent runtime do not need a hosted AI vendor. The built-in
model choices are local runtimes; compatible remote endpoints remain available
only when a user explicitly configures one. OpenAI-compatible describes the
request protocol, not an OpenAI service dependency. No provider-specific SDK for
the investigated hosted AI vendors is installed in the root application or
`AgentHub-CLI` package.

The active-source search found no outbound inference endpoint for Z.AI/Zhipu,
OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Together, Fireworks,
Hugging Face Inference, DeepSeek, Cohere, or Mistral. The prior GLM-specific
selector/preset material and named cloud-provider examples were removed from
model configuration and UI. Generic custom-compatible endpoints and the local
Ollama helper remain. User-configured endpoint records and conversation data
were preserved; no database migration or user-data deletion was performed.

## Provider and dependency changes

- `src/lib/agent-hub/custom-models.ts` now exposes generic compatible endpoint
  configuration instead of vendor-specific preset choices.
- `src/components/agent-hub/models-view.tsx` and `chat-view.tsx` use generic
  endpoint labels; the hosted-inference preset and named cloud examples were
  removed.
- `src/components/agent-hub/agent-api-view.tsx` uses a generic local model ID
  in its example. `chat-settings.ts` no longer suggests namespaced hosted model
  IDs.
- First-run model and session fixtures now start empty. Model inventory comes
  from the configured local runtime, and sessions appear when created, so
  placeholder Claude, DeepSeek, and Mistral sessions/models are not presented
  as active AgentHub integrations.
- The first-run workflow fixture starts unconfigured instead of showing a
  fabricated Gmail/Slack/Odoo automation as though those services were already
  connected.
- The separate Wizard Chess sample had an unused `@google/genai` dependency;
  it is removed from its manifest, lockfile, and installed sample dependencies.
  Both copied sample READMEs no longer show AI Studio/Gemini branding or ask
  users for a Gemini key, and Desk Racer's unused Gemini `.env.example` was
  removed. Desk Racer's Google-hosted model assets remain explicitly documented
  as a non-AI asset dependency.
- The active Sessions view file uses AgentHub-neutral
  `session-chat-view.tsx` naming. User-facing examples and code comments no
  longer attribute the app's identity to outside assistant products.
- `AgentHub-CLI` no longer selects a hosted provider by default. Its
  remote endpoint gate derives locality from the parsed URL, rather than
  trusting a provider's `local: true` label. Remote compatible endpoints need
  explicit opt-in (`allowCloud` / `--allow-cloud`).
- No vendor SDK dependency needed removal, so package lockfiles were not
  regenerated for a nonexistent SDK removal. The compatible HTTP protocol is
  retained for local inference and explicit custom endpoints.

## Network inventory

| Path | Destination and purpose | Default / user control |
| --- | --- | --- |
| Model inference | Configured local model server, normally LM Studio or Ollama on loopback | Local by default. A remote compatible URL is an explicit configuration choice; terminal remotes require opt-in. |
| Skill repository inspection/install | GitHub API and raw content host, from `src/lib/agent-hub/skills-github.ts` | Triggered by a user providing a GitHub repository to inspect/install a skill. No background poll. |
| Roadmap refresh | `roadmap.sh`, from `scripts/sync-roadmaps.mjs` | Separate manual `npm run roadmaps:sync`; fetched diagrams are stored in the local ignored data directory. |
| Component registry | User-selected registry URL via the UI-components feature | Explicit user action. Locally selected registry JSON and source folders stay offline; imported source is saved, not automatically executed. |
| n8n workflows | User-configured n8n host, via `/api/n8n` | No host is configured by default. The connection UI lets the user set/clear the host and credential; this is an optional integration, not an AI inference fallback. Imported workflow definitions can themselves refer to external services and must be reviewed/configured by the user before activation. |
| Fonts | Google Fonts through `next/font/google` in `src/app/layout.tsx` | Next.js obtains font assets during build; deployed app assets are served locally by Next.js. A network-restricted build may need a cached font or a locally hosted font configuration. |
| Package installation | npm registry | Occurs when a developer explicitly installs dependencies, not as application runtime telemetry. |

No analytics or telemetry SDK was found in the application package manifests or
active application source examined for this audit. Local usage events and
metrics are stored by the app; they are not sent to an analytics service.
`public/n8n-templates/` contains importable workflow examples, some of which
include vendor HTTP nodes; these are inert JSON until a user imports, configures,
and activates them in their own n8n instance. They are not initialized by
AgentHub startup. Separate copied demo projects under
`lmstudio-local-agent/workspace/projects/` have their own manifests and some
have external-asset references; they are independent files in the optional
workspace, not integrations imported or started by the AgentHub dashboard.
The n8n template catalog is an optional feature and can display third-party
service names when a user browses templates. Those names identify the contents
of a selected workflow; they do not brand AgentHub or connect until the user
imports/configures/runs that workflow.

## Security notes

- The terminal remote-provider guard now validates the URL and only accepts
  loopback as local; a false provider metadata flag cannot bypass remote
  consent. This behavior has a regression test in
  `AgentHub-CLI/tests/config.test.ts`.
- Root application custom model endpoints intentionally support compatible
  HTTP APIs. Therefore this is not an offline-only guarantee: users can
  deliberately configure non-local services. No silent cloud fallback is
  configured by the application.
- n8n is a powerful optional integration. Its service validates configured
  HTTP(S) URLs, supports an explicit host allowlist, keeps the API key server
  side, and removes credentials from public status/results. Treat imported
  workflows as untrusted until their nodes and destinations are reviewed.
- Browser UI assets, test fixtures, generated output, historical docs, and
  importable workflows may contain vendor names or example URLs without being
  live integrations. A brand-name text match alone is not evidence of runtime
  connectivity.

## Verification

- Root application typecheck passed.
- Root test command passed: 30 suites, 1,794 checks passed, 12 skipped.
- Root production build passed and generated 24 static pages plus dynamic API
  routes.
- Runtime-model check passed: 24/24 checks.
- Terminal tests passed serially: 55/55; terminal typecheck passed.
- Focused ESLint on the five changed root TS/TSX files passed.
- Full root ESLint was attempted twice but exceeded available memory. It is not
  reported as passing.
- The local-model integration script was not run during this audit; successful
  live inference is therefore unverified here.
- Wizard Chess sample TypeScript check and production build passed after
  removing its unused Google AI SDK. Desk Racer was not built because its Vite
  build fetches vehicle models from a Google static-assets host.
- Mermaid source blocks and links are being checked as text. No Mermaid parser
  is installed in the project, so diagram rendering is not claimed as verified.

## Limits and conclusion

This audit traces the active provider configuration and application network
paths relevant to hosted AI, analytics, and optional integrations. It does not
claim that every arbitrary user-imported n8n workflow, locally supplied plugin,
or developer-authored script is incapable of contacting the network. The
network paths that are present are identified above with their trigger and
configuration boundary. No prohibited hosted AI provider fallback or
background analytics integration was found in the inspected active source.
Model-name capability heuristics and OpenAI-compatible protocol terminology
remain so local model IDs and local inference continue to work; these strings
are not vendor SDKs or service connections. Legacy internal preference and
agent-plan identifiers are also retained for compatibility and are not shown
as another provider's product in the current Sessions UI.
