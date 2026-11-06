> Historical evidence. This file describes an earlier implementation; use [current architecture](../architecture.md), [development](../development.md) and [testing](../testing.md) for the current project.

# Teaching Agent — Evidence-Based Audit (inside AgentHub Sessions)

Audit date: 2026-10-17
Scope: the Teaching Agent that runs inside **Sessions** (`src/lib/agent-hub/teaching-*`, the
`teaching` capability in `agent-session.ts`, and the in-Sessions teaching UI).
Method: read the real implementation, run the deterministic suites, run the app, and verify
behavior in a live browser. PASS is only claimed where implementation evidence **and** a check
exist. Prior reports were not trusted.

---

## 1. Status

**Overall: PASS with one deliberate, documented limitation.** The Teaching Agent is a real,
registered, Sessions-only pipeline with an app-owned lesson framework, deterministic offline
content, interactive assessment, honest topic/coverage reporting, deterministic grading where an
answer is unambiguous, and persisted progress. Six gaps found during the audit were remediated
in-scope (R1, R2, R3, R4, R6); a later hardening pass resolved the three remaining issues
(sub-topic substitution, offline follow-ups, dead `SubjectSpec.visual`) and narrowed the exercise
grading PARTIAL (R5) to open-ended items only, which stay self-marked by design.

- Deterministic suite: **388 passed / 0 failed** (365 before this pass + 23 new cases T57–T61).
- Static checks: **0 errors** in changed files (2 pre-existing `examples/websocket` TS errors;
  1 pre-existing eslint warning at `agent-session.ts:1315`).
- Live: verified a known-topic lesson (Python OOP) with hidden exercise solutions and a
  deterministic MCQ, an unknown sub-topic (Python list) with an honest non-bank note and **no**
  substitution of the default, and offline follow-ups (answered from lesson material when it can,
  honest refusal otherwise).

---

## 2. Requirement matrix (A–J)

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| A | Registration, architecture, delegation, AUTO/MANUAL, disabled | **PASS** | 7 built-ins incl. `teaching-agent` (T22a `roster.length===7`); `Capability` includes `teach` (`CAPABILITY_TOOL.teach='call_llm'`, `NATURAL_OWNER.teach='teaching-agent'`); `createPlan('Explain Python OOPs')` → ≥5 `teach` steps (T51c); AUTO runs it, MANUAL blocks it (T53); agent has read-only tools only. Single runtime — no second engine. |
| B | Genuine GeeksforGeeks research evidence; no scraping; respect robots | **PASS** | `docs/history/teaching-agent-research.md` records four hand-inspected pages, the observed pedagogy, an adaptation table, and explicit limits (robots.txt disallows the named agent → no crawl, no verbatim content/assets, no runtime dependency). Qualitative inspiration only; no runtime coupling. |
| C | Structured lesson framework incl. subject + **scope** adaptation | **PASS** | `LESSON_SECTIONS` (intro→revision) + `buildLessonPlan` + `validateLesson`; `detectScope`/`QUICK_SECTIONS` (R4) → quick vs full. T56c/d/e + live: "what is a python list" rendered exactly 4 sections (no Prerequisites/Visual/Mistakes/Mini-project). |
| D | Subject-specific teaching (Python, SQL, Excel, C, Linux, electronics, AI/ML, math/aptitude) | **PASS** | `SUBJECTS` registry with per-subject `pattern`/`sections`/`defaultTopicId`; deterministic bank covers python, sql, c, excel, linux, electronics, ml, aptitude. Live-verified Python + SQL; Excel/C/electronic/ML/Linux/aptitude verified by code review + deterministic tests. |
| E | Code correctness & rendering; **distinct** syntax-highlight token colors | **PASS** | `highlightCode` per-family tokenizers; SQL and C families added (R1, T56a/b); `CODE_CLASS` maps `kw/str/com/num/fn` to distinct colors. Live: SQL lesson rendered keyword/string/comment tokens with distinct classes. |
| F | Interactive components — every visible control acts; quiz/retry/scoring/progress; mobile | **PASS** | `QuizCard` (check → explanation → Retry, Hint toggle), `ExerciseCard` (Hint, Show/Hide solution, "I've solved it"), Learning-progress Refresh/Clear, Suggest-next. Live: wrong option → "Not quite." + correct answer + Retry; solutions absent from the DOM until "Show solution"; mobile (390px iframe) verified earlier — form stacks, no horizontal overflow. |
| G | Progressive exercises/assessment incl. **honest grading** | **PASS (one deliberate limit)** | Quiz is auto-graded. Exercises with an unambiguous key are now **deterministically auto-graded** (`gradeExercise`: multiple-choice, exact expected output; T60a–g). Open-ended code/scenario/explain items stay **self-marked** and are labelled "Self-marked: … the app does not fake a grade". Learner code is never executed (R5 narrowed by the hardening pass). |
| H | Learning resources & progress; no invented file contents; continuity; next-topic | **PASS** | `findLearningMaterials` read-only/bounded; returns `[]` (never invents) when none; progress persisted in the existing browser store; follow-up continuity (R3, T56i); prerequisite/next graph resolves to real topics (R2, T56f/g/h). An unknown sub-topic no longer falls back to the subject default — it becomes a general explanation in the learner's own topic with an honest note, or a clarifying question (see §5.1, T57). |
| I | Local-model compatibility; bounded context; safe error handling | **PASS** | No mandatory cloud; per-section prompts with `MAX_SECTION_CHARS`/small focused calls; deterministic bank fallback per section; section timeout (`TEACH_SECTION_TIMEOUT_MS=90_000`). Live with LM Studio **off**: full lesson rendered from app content (badge "app content"); a follow-up the lesson's own material can answer is answered locally with an honest "model offline" note, otherwise the app says so and offers a next step — the provider error is logged, never thrown (T59; live-verified). |
| J | Safety/scope — allow-lists, file scope, read-only, approval gates, cancellation, no unrelated changes | **PASS (with note)** | Read-only tools; no destructive ops; bounded file scope; existing gates/prefs preserved; MANUAL mode; cancellation via the running flag / AbortController on the streaming path. No unrelated changes — only teaching files, the regression script, and docs were touched. Note: workspace is **not a git repo**, so VCS-level diff attribution could not be inspected. |

---

## 3. Files inspected

- `src/lib/agent-hub/agent-session.ts` — runtime, plan/run pipeline, `teachTopic`, `askWithinLesson`, `highlightCode`, progress persistence, capability maps.
- `src/lib/agent-hub/teaching-framework.ts` — subjects, sections, `buildLessonPlan`, `detectScope`, prompts, `validateLesson`, `scoreQuiz`, progress.
- `src/lib/agent-hub/teaching-bank.ts` — deterministic topic content.
- `src/lib/agent-hub/teaching-intent.ts` — `isTeachingRequest`, `parseModelQuestions`, `buildFollowUpPrompt`.
- `src/components/agent-hub/teaching/teaching-panel.tsx`, `.../lesson-renderer.tsx` — in-Sessions UI.
- `src/components/agent-hub/sessions-view.tsx`, `tasks-view.tsx` — panel wiring.
- `scripts/agent-session-regression.mjs` — regression suite.
- `docs/history/teaching-agent-research.md`, `worklog.md` — prior research/log.

## 4. Files changed by PRIOR work (Task ID 14 — not part of this audit)

Added: `teaching-framework.ts`, `teaching-bank.ts`, `teaching-intent.ts`,
`teaching/lesson-renderer.tsx`, `teaching/teaching-panel.tsx`, `docs/history/teaching-agent-research.md`.
Changed: `agent-session.ts` (integration), `sessions-view.tsx`, `tasks-view.tsx`,
`scripts/agent-session-regression.mjs`, `worklog.md`.

## 5. Files changed by THIS audit (remediation)

| ID | Change | Files |
|----|--------|-------|
| R1 | Syntax highlighting for **SQL** and **C** (per-family tokenizer, `--` vs `#` comments, case-insensitive keywords) | `agent-session.ts` |
| R2 | Added 3 missing bank topics (`python-exceptions`, `sql-select`, `sql-null-group`) so the prerequisite/next graph resolves and no raw slug leaks | `teaching-bank.ts` |
| R3 | Follow-up prompt carries a bounded lesson excerpt (continuity without resending the lesson) | `teaching-intent.ts`, `agent-session.ts`, `teaching-panel.tsx` |
| R4 | Quick-vs-full lesson **scope** (`LessonScope`, `QUICK_SECTIONS`, `detectScope`, `LessonRequest.scope`, quick filter) | `teaching-framework.ts` |
| R6 | Section prompts include the learner's own words | `teaching-framework.ts` |
| — | New regression tests T56a–T56j | `scripts/agent-session-regression.mjs` |

### 5.1 Hardening pass (later revision) — remaining issues resolved

Root cause and before/after for each issue found in §9:

| Issue | Root cause | Before → after | Files |
|-------|-----------|----------------|-------|
| Unknown sub-topic silently substituted the subject default | `findTopic(subject, text)` returned the subject's `defaultTopicId` whenever no bank topic matched | `matchTopic(text, subject)` returns `undefined` (never a default) and is strictly subject-scoped; `resolveTopic(subject, detectText, learnerText)` classifies coverage as `bank` / `general` / `default`, keeps the learner's own sub-topic for a general explanation (honestly marked not-in-bank), and asks a short clarifying question when the request is ambiguous. Surfaced via `LessonPlan.resolution`, `LessonView.coverage`/`coverageNote`, `AgentTask.clarification`. | `teaching-framework.ts`, `teaching-intent.ts`, `agent-session.ts`, `teaching-panel.tsx`, `lesson-renderer.tsx` |
| Cross-subject false match ("SQL window functions" resolved to Python) | `detectSubject`/`matchTopic` let any topic keyword win even when a *different* subject was named | `detectSubject` prefers a topic owned by an explicitly named subject and ignores another subject's topic when a subject is named; `matchTopic` never matches outside a known subject. | `teaching-framework.ts` |
| Offline follow-up returned a bare transport error | `askWithinLesson` forwarded `callLLM`'s failure straight to the UI | Model first; on failure `answerFromLessonMaterial` answers only from the matched bank topic / bounded lesson excerpt (literal keyword overlap, no invention) with an honest "model offline" note, else returns a clear "needs the model" message with a next step. Provider error is logged via `addLog`, never thrown. | `agent-session.ts` |
| Exercises were never auto-graded (R5) | No answer keys existed in the bank | Added optional `Exercise.options`/`answerIndex`/`expected`; `gradeExercise` grades only unambiguous items (multiple-choice, exact / standalone-token expected output); three such bank exercises added (`py-oop-e4`, `py-fn-e3`, `sql-j-e4`). Open-ended items stay self-marked; learner code is never executed. | `teaching-bank.ts`, `teaching-framework.ts`, `lesson-renderer.tsx` |
| `SubjectSpec.visual` was dead config | Declared, never read — per-topic `topic.diagram` already drives visuals | Removed from the type and all subject literals; per-topic diagram rendering unchanged. | `teaching-framework.ts` |

New regression cases: T57a–g (topic selection), T58a–c (ambiguous → clarification, no lesson, no
model call), T59a–c (offline follow-up answerable / not answerable / model available), T60a–g
(deterministic grading + bank answer keys), T61a–c (`visual` removed).

## 6. Tests run (actual results)

| Command | Result |
|---------|--------|
| `node scripts/agent-session-regression.mjs` | **388 passed, 0 failed** (365 → +23 new cases T57–T61) |
| `npx tsc --noEmit` | 2 errors — both pre-existing `examples/websocket/*` (missing `socket.io*` types); **0 in changed files** |
| `npx eslint <6 changed files>` | **0 errors**, 1 pre-existing warning (`agent-session.ts:1315`, unused eslint-disable) |
| Live browser (`http://localhost:3000/?view=sessions`) | Known lesson (Python OOP): full framework, 4 exercises, E4 auto-graded, solutions hidden until requested. Unknown sub-topic (Python list): header "Python list" + honest non-bank note, **no** default substitution. Offline follow-up: answered from lesson material when possible, honest refusal otherwise. |

---

## 7. Six representative scenarios

1. **Python OOP** — LIVE: `MODEL-ENRICHED`, full framework, real model code/output (Dog/`bark`).
2. **SQL joins (sample tables + resulting rows)** — LIVE: `MODEL-ENRICHED`, prerequisites read "SQL SELECT & WHERE" (no raw slug), SQL tokens highlighted, full framework. Bank example shows `JOIN` with tables and result rows; deterministic checks T56g/T56h.
3. **Excel XLOOKUP** — bank topic `EXCEL_LOOKUP` reviewed and exercised deterministically (regression); not live-run this pass (local model offline).
4. **Python exercise without revealing the solution** — LIVE (model offline this pass): exercise cards expose `Show solution` with **no solution in the DOM** (`Hide solution` count 0) until it is pressed; pressing it renders the solution. Deterministic grading of unambiguous items is proven by T60a–g.
5. **Arduino push-button-to-LED** — bank topic `ELECTRONICS_BASICS` reviewed and exercised deterministically; not live-run this pass.
6. **Follow-up using prior lesson context** — LIVE: with the model available the answer reuses the lesson's example; T56i proves the bounded excerpt reaches the prompt. With the model **offline**, a question the lesson's own material can answer is answered from it with an honest "model offline" note, and one that needs the model returns a clear "needs the model" message with a next step (T59; live-verified).
7. **Unknown sub-topic (e.g. "What is a Python list?")** — LIVE: header "Python list" plus the note "… is not one of the app's verified bank topics, so this is a general explanation built with the Programming (Python) framework — not a bank topic." The subject default *Python functions and scope* is **not** substituted (T57a).

## 8. Verified / partial / missing / untested

- **Verified (implementation + check):** registration/delegation (A), framework + scope (C), subject coverage (D), highlighting (E), interactive controls (F), honest topic/coverage selection (H), deterministic grading of unambiguous items (G), resources/progress continuity (H), model-offline fallback + offline follow-ups + bounded prompts (I), safety/scope (J).
- **Partial (deliberate):** open-ended exercises (write-code / scenario / find-error / explain) stay **self-marked** — the app never fakes a grade and never executes learner code. Documented in the UI and in `gradeExercise`.
- **Missing:** none required for the audited scope.
- **Untested (live):** Excel XLOOKUP and Arduino push-button-to-LED lessons were code-reviewed and deterministically tested but not rendered live this pass; only one real local model (LM Studio 8B-class) exists and it was offline during the hardening pass's browser checks (deterministic content was used).

## 9. Prioritized issues

1. **Resolved (hardening pass) — unknown sub-topic no longer falls back to the subject default.** `resolveTopic` keeps the learner's own sub-topic as a general explanation (honestly marked not-in-bank) or, when the request is ambiguous, asks a short clarifying question. `matchTopic` is subject-scoped so a generic word cannot pull in another subject's topic. Evidence: T57a–g, T58a–c; live-verified.
2. **Resolved for unambiguous items; deliberately retained for the rest (R5).** Multiple-choice and exact-expected-output exercises are now deterministically graded (`gradeExercise`, T60a–g); open-ended items stay honestly self-marked.
3. **Resolved (hardening pass) — offline follow-ups no longer return a bare transport error.** `askWithinLesson` falls back to `answerFromLessonMaterial` (matched bank topic / bounded lesson excerpt only, no invention) with an honest "model offline" note, or a clear "needs the model" message with a next step. Evidence: T59a–c; live-verified.
4. **Resolved (hardening pass) — `SubjectSpec.visual` removed.** It was declared but never read (per-topic `topic.diagram` drives visuals); removed from the type and all subject literals. Evidence: T61a–c.
5. **Info — workspace is not a git repository**, so VCS-level change attribution was not possible.

---

*Produced from direct inspection, the deterministic regression suite (388/0), tsc/eslint, and a
live browser session. Claims not backed by a run are marked as code-reviewed only.*
