# Browser security header remediation — 2026-11-06

Follow-up to `local-security-scan-2026-11-06.md`. Existing reports and pre-fix evidence remain preserved. No commit/push or user data cleanup was performed.

## Changes

Added eight enforced response headers through the supported Next.js `headers()` configuration, covering pages, APIs and public assets:

- Content-Security-Policy: same-origin scripts, base URI, forms and frame ancestors; no plug-in objects; only same-origin/local preview frames and connections; existing attachment/media/image sources retained.
- X-Frame-Options: SAMEORIGIN.
- X-Content-Type-Options: nosniff.
- Referrer-Policy: no-referrer.
- X-Permitted-Cross-Domain-Policies: none.
- Permissions-Policy: camera/microphone/clipboard limited to self; geolocation/payment/USB/serial disabled. This does not grant browser permission to these features.
- Cross-Origin-Opener-Policy: same-origin-allow-popups.
- Cross-Origin-Resource-Policy: same-origin.

Disabled `X-Powered-By`. API access/origin guards, tool approvals and preview sandbox attributes remain unchanged.

## Compatibility and remaining limitations

The application and sandboxed `srcdoc` previews currently require inline scripts/styles. The baseline CSP explicitly retains `unsafe-inline`; this is **not a nonce-based strict CSP and does not eliminate inline-script XSS risk**. Development additionally permits `unsafe-eval` for Next/React tooling. Verified production responses omit `unsafe-eval`. A strict nonce migration would require dynamic rendering and preview-specific design/testing; no such migration is claimed here.

External JavaScript sources are not whitelisted. External HTTP/HTTPS images remain allowed for existing GitHub/library imagery. Model requests continue through AgentHub server APIs; same-origin streaming and local development WebSockets remain allowed.

Two scanner suggestions deliberately remain absent:

- HSTS / upgrade-insecure-requests: not enabled on plain HTTP localhost, where HTTPS enforcement would be inappropriate.
- Cross-Origin-Embedder-Policy: `require-corp` would require a separate audit/migration for cross-origin images and isolated previews. No false `unsafe-none` header was added merely to silence the scanner.

## Verification

- Real Nuclei rescan: six signed templates, 93 forwarded local HTTP requests, successful exit, **10 → 2 informational matches**. Only HSTS and COEP remain. **24/24 live boundary checks pass.** Evidence: `.verification/security-2026-11-06/after-headers-runner.log`, `nuclei.log`, `nuclei-findings.jsonl`, `scan-manifest.json`, `boundary-checks.json`. Pre-fix findings/manifests copied to `before-headers-*`.
- 28 policy regression checks cover framing, MIME sniffing, external forms/base URI, inline preview compatibility, production eval exclusion, local connections and HTTP behavior.
- Final TypeScript check and repository-wide strict ESLint completed successfully with zero lint warnings (`header-lint.log` is empty on success).
- Successful isolated webpack production build in `.next-security-headers`; log `header-build.log`. Generated build-directory includes removed from `tsconfig.json` afterward.
- Production server smoke test on loopback port 3012: Chat page, UI library page and runtime-model API all returned HTTP 200, CSP without unsafe-eval, nosniff and SAMEORIGIN, with no X-Powered-By. Evidence: `production-headers.json`.
- Real LM Studio Spark streaming test on localhost:3000 returned **“Hello — 2 + 2 equals 4.”** with provider token usage, SSE completion, and the enforced CSP header. Existing Chat history was preserved using `stateless:true`. Local evidence: `header-chat-stream.txt`.
- Browser on updated localhost UI: application hydrated; original Connection Status sandbox preview changed to **Selected: Working** on click; downloaded cruip CTA rendered **Join the content-first platform** with both buttons/links. Preview sandbox remained `allow-scripts`; observed browser error/warning log empty at these checks. No package installation or template build was required.
- Browser controls were subsequently disabled in Work settings, so the attempted additional mobile-preview click did not run. No screenshot or further production-browser test is claimed.
- First regression run: 38/39 suites passed; Auto persistence timed out while the production build was running. Its standalone rerun passed **42/42**. The serial full rerun passed **39/39 suites, 1,931 checks, 14 documented skips** (`header-regression-final.log`). Skips retain the previous scan report's legacy port-3001/provider-fixture limitations. Do not treat the initial timeout as a passing run.

## Files

- New `src/lib/agent-hub/security-headers.ts` — shared policy definition.
- Updated `next.config.ts` — global response headers and framework banner removal.
- New `scripts/check-security-headers.ts` — policy regression coverage.
- Updated `scripts/check-project.mjs` — includes the new suite.
- This report. Runtime data and local evidence remain ignored.

This resolves the eight applicable missing-header findings with compatibility-conscious browser protections. It does not certify the whole application as secure, assess every dependency/CVE, or remove the need for a strict CSP and production HTTPS review before deployment.
