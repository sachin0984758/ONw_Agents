# Obsidian file access and local-model verification — 2026-11-06

This extends the existing AgentHub Obsidian integration. Earlier QA reports remain historical evidence; this report supersedes their statement that a fresh local-model test was unavailable. Existing vault notes, downloaded templates, MCQs, explanation interfaces and model preferences were preserved. No commit or push was made.

## Implemented

- A bounded file catalog covers notes, source code, text/data and supported documents in the explicitly connected vault, with exact counts, filename filtering and pagination. Hidden configuration, secret/key paths, symbolic links and unsupported binaries are excluded from reading.
- Ranked section retrieval now searches throughout eligible files rather than using only the opening note text. Results include real paths, line ranges, character offsets and source hashes. It uses lexical/BM25-style ranking, not embeddings or model training.
- Agent Sessions have `list_memory_files`, ranked `search_memory`, and paged `read_memory`. Page offsets/limits are characters, with explicit next offsets and extraction warnings. These tools use the separate authorized vault connection; they do not grant general PC or workspace access.
- Chat, teaching/explanations and Auto receive relevant excerpts through the existing shared adapter, only for local endpoints and enabled pack assignments. Their prompts distinguish automatic retrieval from the Session-only file tools.
- Read-only XLSX extraction includes worksheet names, cell addresses, cached values and formula text. It never evaluates formulas, macros, or external data.
- Capability Packs → My Second Brain → **Model file access** exposes verification, filename/content searches, cited matches, paged previews and visible extraction limits. Selecting a content match opens its actual character offset.
- The real-model test exposed a Session completion bug: “Do not run code or write anything” was incorrectly treated as an implementation request. A regression test failed before the fix; the fixed runner no longer asks for writes or marks this successful read as partial. Positive implementation requests still require change evidence.
- Auto and GitHub library dropdowns use the existing shared accessible selector. Their values, handlers, approval boundaries, installer and preview behavior were retained.

## Actual connected-vault coverage

My Second Brain contained **2,649 eligible files**, all successfully indexed into **18,479 searchable sections**, with **0 extraction failures** and no reported coverage limit reached:

| Extension | Files |
| --- | ---: |
| Markdown | 1,476 |
| Python | 567 |
| C | 400 |
| SQL | 201 |
| CSV, H, LOG, TXT, XLSX | 1 each |

Evidence: `output/obsidian-access/coverage.json`. These are extraction/index coverage counts; a model does not receive or independently understand every file in a single prompt.

## Real local-model evidence

Used the already installed LM Studio CLI and **spark-x2.6-4b**, loaded with a 16,384-token context. The server runs on loopback port 1234; AgentHub runs on loopback port 3000. No model was downloaded and global model preferences were not changed.

1. **Chat, actual note retrieval:** a stateless `/api/chat` request asked for the final practice answer in `002_whole_numbers.md`. The model answered **46**, cited `LEARN/Aptitude/01_Number_System_and_Arithmetic/002_whole_numbers.md`, lines 49–95, and supplied the counting rule. This did not alter an existing Chat transcript. Evidence: `output/obsidian-access/live-chat.json`.
2. **Session, actual tools and two file formats:** session `02623eb5-f671-45e3-a94d-59f65b60713a` called `list_memory_files` twice and `read_memory` on both `LEARN/ECE/_Assets/audit_batch6.py` and `LEARN/Excel/_Assets/Level_01_Excel_Fundamentals.xlsx`. It read 7,071 and 6,182 characters respectively, returned the complete first Python comment, worksheet `Q01_Overview`, and A1 `Excel Fundamentals: Data Types & Categories (Q01-Q04)`. Status completed; read-only mode, no workspace grant, zero changes. Evidence: `live-session.json`, `live-check.log` in the output folder.
3. **Session, actual search and deep paged access:** session `e5ee430e-fcd9-4de5-a299-12dec81ae854` called `search_memory`, then read `LEARN/ECE/CURRICULUM_ARCHITECTURE.md` at character **100,327** of **100,927**, limit 1,000. The model correctly listed **IEEE, IPC, IEC, ISO** from the final passage and cited lines **1159–1166**, `nextOffset: null`. Completed, zero changes. Evidence: `live-paged-session.json`, `live-paged-check.log`.

The initial Session attempt is retained in session `d1ab4db9-b431-4c10-98e5-9ad0bbb13e07`. It read only 50 characters of the workbook and returned a cut-off cell; the completion bug also produced partial status. The final successful verification above used stronger character-paging guidance and the repaired completion logic. Initial failures are not counted as passes.

Repeat the opt-in real-vault tests with `OBSIDIAN_LIVE=1` and `node scripts/check-obsidian-live.mjs` / `node scripts/check-obsidian-paged-live.mjs`. They create verification sessions and read the named real files; they do not write vault notes. Source data and full model logs stay in ignored local output, not a published artifact.

## Automated and visual validation

- Full runner: **38/38 suites passed; 1,903 checks passed; 14 skipped**. Evidence: `.verification/modernization/tests/results.json`, `output/obsidian-access/regression-final.log`.
- Skips are explicit: 12 legacy live endpoint checks default to localhost:3001 where no server was running; 2 Playground provider-fixture checks could not claim port 1234 because the actual LM Studio server was using it. They are not counted as live passes. The separate real-model checks above test the new integration on port 3000.
- Included checks cover Chat MCQ and teaching rendering, attachment payloads, Chat isolation, Session controls/completion, capabilities, Obsidian memory, math, presentation and graph behavior.
- New isolated-vault file checks: **25/25**. They exercise full long-file reconstruction, tail retrieval beyond 20,000 characters, UTF-16, XLSX/DOCX/ZIP fixtures, source preservation, traversal/junction/secret rejection, modified-file refresh and disconnect. Document fixtures are not proof of model understanding of arbitrary user documents.
- Memory proposal/review, hash mismatch, decline, persistence, cloud exclusion and pack assignment checks: **19/19**, using a temporary vault. No test memory note was written into the user's vault.
- Session completion checks: **15**. Obsidian math **18**, library presentation **7**, network/galaxy **26**.
- Typechecking and strict repository lint passed. Production webpack build succeeded in an isolated `.next-obsidian-access` output directory; final follow-up build evidence is `output/obsidian-access/build-final.log`. Generated TypeScript include entries for that output are removed after validation.
- Visual check in Chrome: opened the existing Capability Packs page, ran **Verify all file access**, saw the exact zero-failure coverage, searched the actual workbook and opened its sheet/cell preview with the extraction warning. Screenshot: `output/obsidian-access/file-access.jpg`.
- The Chat isolation/multimodal test compilers were repaired to include real dynamic Obsidian dependencies, preserving store/control module identities. These remain mocked-provider contract tests; they are distinct from the real-model tests above.

## Limits and honest assessment

- File access is scoped to the connected vault and existing independently authorized workspaces, not unrestricted computer access. Pack disable/disconnect stops future memory retrieval, not previously generated transcript text.
- Files are limited to 16 MB each. Catalog: 10,000 files / 30,000 directory entries / depth 32. Retrieval: 64 MB source, 30,000 chunks, up to 1,000 chunks per file. Any reached extraction/index limit is exposed. The current vault fits within them.
- PDF text extraction is best-effort; scanned PDFs need OCR. DOCX and ZIP use existing bounded text/source extraction; large documents can be truncated and report that explicitly. No actual PDFs/DOCX/ZIP/images existed in this vault for a user-file live-model test.
- XLSX values may be stale or absent if the workbook did not save calculation results; dates can appear as serial numbers and formulas are not recalculated. Charts, formatting and macros are not interpreted.
- Images need attachment to a vision-capable model in Chat/Sessions; text-only Spark cannot see them. Unsupported binaries cannot be semantically read by this text adapter. No OCR, audio transcription or video understanding is claimed.
- A full forced vault verification took about 35.5 seconds locally. Subsequent retrieval uses the in-memory index; after restart the first retrieval rebuilds it. This is not a vector database or persistent content copy.
- Live model answers were verified with Spark only. Other local chat models can use the same file/context adapter, but their tool adherence and answer quality are not guaranteed by these tests. Auto desktop input and each teaching mode were not re-exercised live for this change.

For the **verified local Obsidian file workflow**, a subjective **9/10** is reasonable. This is not a whole-application score, a claim that every model was tested, or production certification. OCR, richer binary/media support, semantic retrieval and broader model evaluation remain outside that assessment.

## Exact source/test changes for this work

New:

- `src/lib/agent-hub/obsidian/files.ts`
- `src/lib/agent-hub/obsidian/retrieval.ts`
- `src/lib/agent-hub/obsidian/spreadsheet.ts`
- `src/components/agent-hub/obsidian-file-access.tsx`
- `scripts/check-obsidian-access.ts`
- `scripts/check-obsidian-live.mjs`
- `scripts/check-obsidian-paged-live.mjs`
- `scripts/compile-chat-fixture.mjs`
- This QA report.

Updated:

- `src/lib/agent-hub/obsidian/context.ts`
- `src/lib/agent-hub/session/tools.ts`
- `src/lib/agent-hub/session/permissions.ts`
- `src/lib/agent-hub/session/runner.ts`
- `src/lib/agent-hub/capabilities/registry.ts`
- `src/app/api/obsidian/route.ts`
- `src/components/agent-hub/obsidian-memory-panel.tsx`
- `src/components/agent-hub/auto-computer-view.tsx`
- `src/components/agent-hub/marketplace/github-templates-panel.tsx`
- `scripts/check-session-completion.ts`
- `scripts/check-chat-isolation.mjs`
- `scripts/check-chat-multimodal.mjs`
- `scripts/check-project.mjs`

Local verification also updates ignored runtime session/usage/activity records and output logs. No existing user note, historical QA report, downloaded template or unrelated working-tree change was discarded.
