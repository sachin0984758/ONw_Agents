# 15 — Rebuild a similar application from scratch

This is an educational dependency order, not an instruction to duplicate every
current implementation.

| Stage | Objective and prerequisites | Sequence and tests | Frequent mistake |
|---|---|---|---|
| 1. Requirements | Define users, local-first policy, data, tools, and threat model. | Write capability matrix and explicit non-goals. Review with users. | Starting with a dashboard before deciding who can mutate files. |
| 2. Architecture | Choose process boundaries and storage. | Diagram browser/API/runtime/tool/store; label trust boundaries. | Treating every feature as the same agent. |
| 3. Project skeleton | Pin language/runtime/framework. | Add lint/typecheck/test/build and an empty page. | Letting generated config drift unnoticed. |
| 4. Frontend shell | Create navigation and page composition. | Build accessible buttons, forms, loading/error/empty states; test keyboard focus. | Wiring controls to fake status. |
| 5. API boundary | Add route schemas and same-origin policy. | Validate body, output shape, errors and cancellation; test malformed requests. | Passing arbitrary JSON into domain functions. |
| 6. Storage | Define IDs, formats, migrations and atomic writes. | Isolate test DB; test concurrent writes, corrupt files, backups and deletion. | Using one mutable JSON blob for all features. |
| 7. Local model adapter | Define provider discovery and compatible transport. | Test offline, loaded/unloaded, streaming, tool schema and abort. | Inventing availability or silently falling back to cloud. |
| 8. Chat | Build stable conversations and streaming. | Test SSE partial/final/error, attachments, stop and history. | Losing partial output or duplicating optimistic/final messages. |
| 9. Agent loop | Define turn budget and tool contract. | Plan -> model -> schema validation -> authorization -> tool -> observation. | Letting the model authorize itself. |
| 10. Workspace tools | Add realpath-aware operations and capabilities. | Test traversal, symlink escape, protected files, size and approval. | Treating lexical normalization as sufficient. |
| 11. Command execution | Add safe process lifecycle. | Limit cwd, time, output; classify commands; terminate descendants. | Claiming an application policy is a sandbox. |
| 12. OS automation | Add companion protocol with app scope and user consent. | Mock bridge then live test one app, one action and verified result. | Sending clicks based on stale screen coordinates. |
| 13. Skills and slash commands | Add instruction sources and safe command UX. | Treat imports as untrusted; ensure scripts never run implicitly. | Giving prompt text permission to expand tools. |
| 14. Learning features | Add content banks, progression and grading. | Keep deterministic answer keys separate from open model responses. | Claiming model-generated correctness without evidence. |
| 15. Optional integrations | Define disabled defaults and user-driven connection flows. | Inventory domains, credentials, consent and retention; mock the network. | Hidden fallback to a hosted provider. |
| 16. Observability | Measure latency, tokens and task states locally. | Distinguish reported from estimated usage and errors. | Adding analytics before privacy decisions. |
| 17. Verification | Build layered suites and truthful evidence. | Unit -> API -> route/render -> live model -> native app checks. | Treating a compile or screenshot as full acceptance. |
| 18. Packaging | Define host, data directories and upgrades. | Test clean setup and migration in isolated storage. | Deleting a user's data to reset a broken install. |

## Recommended small vertical slice

First deliver one page, one API route, one local model request, one conversation
store and one read-only tool. Verify the user can stop it and inspect failures.
Then add a mutation with an explicit approval and postcondition. This sequence
keeps the most dangerous capability—acting on files or desktop apps—out of the
system until its model, storage and policy boundaries are already tested.
