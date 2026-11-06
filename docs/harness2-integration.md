# Harness² integration status

The official Google Research source is installed locally at
`.agenthub/vendor/harness2`, pinned to
`6868817518876de8fd170c6a8354daca273b6191`.
Its Apache-2.0 license remains with the source. The package is installed in
`.agenthub/vendor/harness2-venv`. Both locations are local ignored data.

The official demo CLI imports and its help command succeeds on Python 3.13.
The official credential-free experiment has **not** been executed. The
research project documents Linux and Python 3.12 for its experiment setup.

AgentHub Settings contains an Agent Optimization section. The server adapter
can launch the unchanged official deterministic demo through a trusted,
digest-pinned Python container image configured with
`AGENTHUB_HARNESS2_IMAGE`. It uses no networking, no host project mount,
no inherited model credentials, a non-root user, dropped capabilities,
CPU/memory/process limits and an execution deadline.

The current computer has no Docker executable/engine or installed WSL
distribution. The container image is also unconfigured. These block the
official demo and any safe optimization experiments.

This is a custom AgentHub **demo runner and status adapter**, not an agent
executor adapter. No production agent receives optimized prompts. Enabling
optimization and approving improvements remain unavailable.

The official benchmark executors use their own OpenCode/Codex execution
paths. A custom AgentHub executor/proposer adapter, local model transport,
task capture, isolated tool replay, probe evidence, candidate validation,
adoption and persistent improvement/rollback are still required.

MCQ rendering, answer checking, explanation rendering and model/tool
configuration are unchanged by this adapter.

## Checks

`tsx scripts/check-agent-optimization.ts` checks the integration boundary,
disabled default, provenance, origin restrictions and rejected enablement.
The existing rendering tests require the repository CSS-module registration
when invoked directly under Node.
