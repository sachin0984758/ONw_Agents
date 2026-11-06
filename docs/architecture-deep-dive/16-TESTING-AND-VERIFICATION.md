# 16 — Testing and verification

## Test layers

- **Static/type:** `npm run typecheck` and ESLint.
- **Deterministic regression:** `npm test`, which invokes
  `scripts/check-project.mjs` and serially runs isolated suites.
- **Targeted integration:** model inventory, workspace services, sessions,
  skills, n8n fixtures, chat formatting and Auto transport/permission checks.
- **Live model:** `check:live-local-models`, live chat/teaching and finalization
  scripts. These need a reachable local provider and can use substantial time.
- **Native desktop:** `check:computer-*` live workflows may type, click or change
  app state; review prerequisites and never run while another task controls it.
- **Build/runtime:** `npm run build`, then serve the artifact and verify routes.

## Current-session evidence (2026-10-29)

| Check | Result | Evidence/limit |
|---|---|---|
| Root `npm.cmd run typecheck` | PASS | Completed after briefly stopping the local dev server to free memory. |
| Root `npm.cmd test` | PASS | 30/30 suites; latest run after the provider/fixture cleanup: 1,794 checks passed, 12 skipped; logs under `.verification/modernization/tests/`. |
| Root production build | PASS | Next 16.4.3 Turbopack compiled, generated 24 static pages, listed dynamic API routes. |
| Runtime model deterministic suite | PASS | 24/24 checks, including no fabricated loaded model. |
| Terminal `node --test --test-concurrency=1` | PASS | 55/55 tests; includes remote endpoint cannot self-label local. |
| Terminal typecheck | PASS | `npm.cmd run typecheck` in `AgentHub-CLI/`. |
| Whole-repository ESLint | PARTIAL | `npm.cmd run lint` exhausted available memory in ESLint process; no finding list was produced. |
| Terminal tests first parallel run | INVALID RUN | Node worker processes hit memory; serial rerun passed. |
| Live model inference after provider cleanup | NOT RUN | Deterministic runtime checks ran; no inference pass is claimed in this audit. |
| Browser screenshot review | NOT RUN | Build/test evidence is not a visual browser review. |

The build displayed `/`, Design Studio and API route inventory. API compilation
proves build integrity, not that every configured model or desktop action works.

## Reproducible commands

Run from the repository root:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Run terminal checks separately and serially on a memory-constrained machine:

```powershell
node --test --test-concurrency=1
npm.cmd run typecheck
```

For live checks see `docs/testing.md`; use an isolated DB for tests that mutate
records. A successful output is only a pass if the command exits 0. See
[the independence audit](../../THIRD_PARTY_INDEPENDENCE_AUDIT.md) for provider
and network checks.
