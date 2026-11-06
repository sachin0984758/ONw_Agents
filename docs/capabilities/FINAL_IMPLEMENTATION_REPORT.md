# Capability platform implementation report

Status as of 2026-10-29. This report separates the completed capability-registry
slice from the larger 21-phase platform request.

## Completed in this slice

- Added a versioned, validated declarative manifest and local JSON state.
- Added six built-in pack definitions that reuse existing tools, Skills Library,
  UI Components marketplace, templates and Teaching resources.
- Added `/api/capabilities` lifecycle API and a Capabilities view.
- Connected enabled, assigned, task-relevant pack metadata to explicit Session
  slash-agent prompts.
- Added focused lifecycle and rejection tests; wired them into `npm test`.
- Researched the named open-source foundations and recorded reuse decisions.

## Acceptance matrix

| # | Acceptance criterion | Status | Reason |
|---:|---|---|---|
| 1 | Agents share local-model foundation | PARTIAL | Existing local runtime reused; live inference was not part of this run. |
| 2 | Every agent uses real registered capabilities | PARTIAL | Session packs route existing resources; pack declarations do not register executors. |
| 3 | Capabilities are not permanently hard-coded to agents | PARTIAL | User can assign compatible packs, but compatibility lists remain code-defined defaults. |
| 4 | Skills/tools load on demand | PARTIAL | Existing skills activate on demand; relevant pack context is keyword-routed. |
| 5 | Website Builder reuses real 21st.dev source | FAIL | Current marketplace supports reviewed registry-item imports, not direct 21st.dev search. |
| 6 | Game Developer reuses working engine templates | PARTIAL | Game skill routing exists; engine scaffolds and gameplay benchmarks are pending. |
| 7 | Research Analyst uses real external research tools | FAIL | Workspace search exists; external browser/search is not integrated in Sessions. |
| 8 | General Task Agent uses authorized apps and files | PARTIAL | Workspace tools and Auto exist; full Office connector workflows are not implemented. |
| 9 | Coding supports verified edits/tests | PASS | Existing file tools, approved commands and verification were preserved. |
| 10 | Teaching retains progress | PARTIAL | Existing teaching/roadmap features are reused; this slice adds no new progress tests. |
| 11 | Install/enable/disable/assign/remove lifecycle | PASS | Built-in and local metadata lifecycle is implemented and deterministically tested. |
| 12 | Shared dependencies are protected | PARTIAL | Required pack dependencies are protected; resource ownership across Skills/Components remains with their existing registries. |
| 13 | Offline resources remain usable offline | PARTIAL | Local pack state works offline; external sources still need explicit network workflows. |
| 14 | Slash commands resolve correct agents | PASS | Existing `/website`, `/game`, `/research`, `/other` routing remains in use. |
| 15 | Model/workspace failures are clear | PARTIAL | Existing checks remain; full failure scenario matrix is pending. |
| 16 | No unauthorized permission escalation | PASS | Pack assignment does not grant tools; existing approvals remain authoritative. |
| 17 | Chat, Sessions, Auto and Roadmap remain operational | PARTIAL | The full default regression suite and production build pass; no live desktop action or visual browser session was run. |
| 18 | Automated and real integrations are recorded | PARTIAL | 31 automated suites pass; live model tasks and external service integrations remain pending. |
| 19 | Final documentation complete | PARTIAL | Capability architecture/research/spec/security/tests are documented; remaining phases need their own evidence. |

## Next implementation priorities

1. Run and record the full default test suite.
2. Add lifecycle UI/API integration tests and resolve custom-pack update/removal behavior.
3. Build a reviewed optional 21st.dev registry connector with provenance and
   per-component license visibility; do not install the 21st.dev CLI by default.
4. Add engine-specific game templates and verify a playable project in a real
   browser before claiming a game pack works.
5. Choose an approved real browser/search transport for research; keep citations
   and external network access explicit.
6. Connect the pack metadata to the existing agent-team capability selection
   only after stable IDs and tool semantics are aligned across the two runtimes.

No external library was installed, no cloud fallback was enabled, and no
workspace/package files were changed by capability-pack operations.

