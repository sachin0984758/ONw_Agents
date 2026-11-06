# 13 — Security, performance and reliability

## Trust boundaries

Important boundaries are browser versus server; model endpoint versus app;
workspace versus installation/data directories; model-proposed tool action
versus policy; loopback web service versus Windows desktop app; and user-selected
external content versus trusted runtime configuration. The system assumes local
user access and is not a public multi-tenant service.

## Current safeguards (source-backed)

- Zod and explicit route parsing validate request shapes.
- Origin checks exist on mutating HTTP paths; Auto has stricter loopback checks.
- Model API keys are server-side and custom-model responses omit the key.
- Remote inference defaults off; explicit remote preference is separate from
  tool permission. Auto uses local-only routing.
- Workspace services normalize relative paths, validate real paths/symlinks,
  apply capabilities and request approval for mutations/commands.
- Terminal agent has hard denials, permission modes, output/timeout bounds and
  an explicit remote endpoint consent gate. A `local` config label is not a
  security boundary; host parsing determines locality.
- Auto scopes apps/domains, uses consent and per-input approval, supports stop,
  and verifies target snapshots before/after actions.
- Skills and model/tool output are treated as untrusted; skill scripts are not
  automatically executed.

## Gaps and limits

Origin checks are not authentication. The local app is not ready for direct
internet exposure without identity, CSRF/session design and a security review.
Workspace guards do not sandbox arbitrary shell/native apps. JSON stores and
serializers are single-process. User-selected remote custom endpoints are still
possible after explicit permission. A compromised local model or companion has
the user account’s reachable capabilities. DNS/host allowlists cannot prove a
third-party server is benign. Prompt injection requires defense at tool policy,
not solely prompt text.

## Performance and long-running work

Local inference latency/memory is governed by hardware, model size/context and
provider. Chat streaming improves perceived latency but can leave partial
output. Session tool calls are sequential and bounded; terminal has its own
budgets. JSON reads/writes can become expensive as histories grow. UI polls some
status endpoints. Measure large transcripts, image attachments, model response
latency, file operation sizes, memory, and many concurrent requests before
scaling.

## Reliability recommendations

Retain cancellation, idempotency where possible, atomic replacement, exact
observed postconditions, and audit-friendly task events. For multi-instance use,
move to transactional storage and a durable queue. Add telemetry only with an
explicit privacy design; this checkout has local system metrics but no cloud
analytics SDK identified in the dependency/source scan.
