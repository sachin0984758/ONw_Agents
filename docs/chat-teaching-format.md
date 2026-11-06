# Chat teaching, diagrams and scored quizzes

Select **Teach** for a complete progressive lesson. The supplied AI Agents guide
provides the subject-specific outline, architecture and three introductory MCQs.
Other subjects use the same teaching approach with examples for that subject.

Try: `Teach me AI Agents with a detailed architecture diagram and a three-question knowledge check.`

Select **Advanced** for the five-step tutor: simplified concept, real-world
friction, three-sentence stakeholder script, three practical methods, then an
edge-case audit. Confirm each step in chat before continuing. Confusion keeps
the current step active; a vague topic prompts clarification. Practice requests
retain the current lesson context and do not advance it.

Try: `Teach me how AI agents choose and use permitted tools.`

## Diagrams

The model supplies a fenced `diagram` JSON object with plain-text nodes and
edges. The app validates it and draws SVG nodes, colored outlines and arrows.
Both Teach and Advanced share the renderer. Narrow screens provide horizontal
panning with a visible hint; keyboard focus and arrow keys also allow scrolling.
Malformed or incomplete diagrams retain a readable source fallback.

## Quizzes

Each question has four radio choices. Press **Submit Quiz** to reveal its
correct answer, explanation and score. Selection alone does not reveal answers.
The reset icon clears the attempt. Scoring uses the saved answer keys directly;
it does not require another model request. Advanced practice uses scenario
questions by default, while an explicit difficulty request takes precedence.

The supplied introductory AI Agents knowledge check keeps its original
questions and answer key **B, C, B**. Scores are computed from the learner's
actual selection; they are never prefilled from the reference screenshot.

## Verification

- `npm run check:teaching-rendering`: reference content, SVG rendering, input
  validation, layout bounds, hidden answers, scoring and quiz controls.
- `npm run check:chat-quiz-rendering`: supported model output formats.
- `npm run check:chat-isolation`: mode selection, topic scope and request routing.
- `npm run check:live-teaching`: actual local-model lessons and all five Advanced
  steps, including clarification, confusion, confirmation and quiz requests.
- Browser checks cover submission, feedback, reset, themes and a 390 px viewport.

Live test responses are recorded locally under `.verification/teaching-ui/`.
Browser screenshots are saved under `output/teaching-verification/`.

Verified on 2026-10-25: **593 regression assertions passed** across teaching
rendering (20), quiz parsing/scoring (15), chat routing/isolation (45), UI (56)
and the agent regression suite (457). TypeScript and ESLint passed. Live local
model responses exercised both modes, all five Advanced steps, vague and confused
learner cases, and current-step practice. Browser checks confirmed 3/3 and 0/3
attempts, hidden answers until submission, reset, light/dark themes and sideways
diagram panning in a 390 px viewport. The mobile toolbar/composer wrapping issue
found during this pass was repaired and visually checked again.

The response recorded as `Advanced quiz` predates the lesson-context correction;
`Advanced current-step practice` is the successful verification after that fix.
