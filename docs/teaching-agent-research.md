# Teaching Agent — Pedagogy Research Notes

**Purpose.** Before designing the Teaching Agent we looked at how a well-known
programming-education publisher (GeeksforGeeks) structures its teaching pages, so
the *shape* of a lesson could be borrowed from established pedagogy rather than
invented by the model on every request. This document records what was actually
examined, what was observed, what we deliberately did **not** copy, and the
limits of the research.

**This is an original write-up.** No article text was copied, and nothing from
the site is bundled, cached, scraped at runtime, or shipped with this project.

---

## 1. Access & method (honest limits)

- A small, one-off manual inspection was performed with a normal browser
  session. **No crawler, no bulk download, no automated harvesting.**
- `robots.txt` was checked first. At the time of inspection the file
  disallowed a set of named AI agents (`anthropic-ai`, and similar
  `*-ai` / `*-bot` user-agents; `ClaudeBot`/`Claude-Web` entries were commented
  out rather than active). We therefore treated the site as opted out of
  automated AI crawling and limited ourselves to reading a **handful of public
  pages by hand**, the same way a person would.
- Because of that policy, this research is intentionally **thin**: four pages,
  one pass, no re-crawl. Any claim below that we could not observe directly is
  marked as *not observed*.
- Site design changes over time; the observations are a point-in-time snapshot
  and are described structurally (not verbatim).

Pages examined (by hand, once):

| # | Page (type) | Why it was looked at |
|---|-------------|----------------------|
| 1 | Python OOP — concepts article | Representative *concept* page |
| 2 | Python OOP — exercise / practice page | Representative *practice* page |
| 3 | Python — syllabus / roadmap page | How a *course* is sequenced |
| 4 | A self-paced DSA course landing page | How a *program* is packaged |

Anything beyond these four pages was **not** examined and is not asserted.

---

## 2. What the pages actually did (observed pedagogy)

These are recurring structural patterns, not wording we copied.

### 2.1 Concept article (pages 1)

- **Definition first, in-one-breath.** The page opens with a tight definition of
  the single concept, before any context.
- **Scannable highlight bullets.** A short bullet list of the key properties /
  "why it matters" immediately after the definition, so a reader can skim.
- **Term-by-term expansion.** Each sub-term (class, object, attribute, method,
  the four OOP pillars…) gets its own sub-heading with a two-or-three-sentence
  explanation and a tiny code fragment.
- **Code + real output pairs.** Every code fragment is followed by the output it
  produces, and often a sentence explaining *why* that output appears.
- **Diagrams where relationships matter.** Inheritance/relationship ideas are
  shown as a simple box-and-arrow picture, not only as prose.
- **Deep links between related concepts.** A concept page links out to its
  prerequisite and its follow-on topics.
- **Freshness + provenance cues.** A visible "last updated" date and a by-line
  signal that the material is maintained.
- **A related-topics list at the end.** Serves as a manual "next topic" pointer.

### 2.2 Practice page (page 2)

- **Difficulty tiers.** Questions are grouped/labelled by difficulty
  (basic → intermediate → advanced) rather than shuffled.
- **Varied question shapes.** Multiple-choice, "what is the output", "find the
  error", and short "write the code" prompts appear together.
- **Answers are separate from questions.** The problem statement never leaks the
  solution in the same visual block; the answer/explanation is set apart
  (collapsed/spoiler) so the learner must attempt first.
- **Explanation accompanies the answer**, not just the letter.

### 2.3 Syllabus / roadmap page (page 3)

- **Ordered modules.** The subject is broken into a sequence of modules, each a
  prerequisite for the next.
- **Per-module topic lists.** Each module lists its constituent topics and often
  a small practice pointer, so progress can be measured module by module.

### 2.4 Self-paced course page (page 4)

- **Program packaging.** A full course is presented as a track (modules + a
  capstone flavour), with an explicit "start here / what you'll learn" frame.
- **Length signalling.** Number of modules/hours is surfaced up front so the
  learner can judge commitment.

---

## 3. What was deliberately NOT copied

- **No verbatim content.** No article prose, code listings, diagrams, or
  question banks were copied. The Teaching Agent's content is written from
  scratch in `teaching-bank.ts` (deterministic) or generated locally by the
  model.
- **No site assets or branding.** The UI is the project's own design language;
  nothing from the site is embedded. The Research/Teaching features do not
  reference or brand against the site.
- **No runtime dependency.** The app never fetches the site. There is no
  scrape, no proxy, no cache of their pages. The lesson format is an original
  adaptation of *pedagogical structure*, which is not protectable expression.
- **No aggressive crawling / no bulk download**, per §1.

---

## 4. How the observations informed the implementation

The lesson framework in `src/lib/agent-hub/teaching-framework.ts` +
`teaching-bank.ts` is an original reconstruction of the *structure* above, made
app-owned and deterministic so a small local model does not have to reinvent it:

| Observed pattern | Teaching Agent implementation |
|---|---|
| Definition first | Section A — Introduction (one-paragraph definition) |
| Ordered modules | Section B — Prerequisites & sequence; subject registry sequencing |
| Term-by-term expansion | Section C — Core concepts as an 11-element sequence |
| Diagrams for relationships | Section D — Visual explanation (app-drawn SVG + ASCII fallback) |
| Code + real output + why | Section E — Worked examples (simple → complex, output, tracing, edge cases) |
| *(gap: mistakes aren't a first-class block on the concept page but recur in exercises)* | Section F — Common mistakes & debugging (wrong → corrected) |
| Difficulty tiers + varied shapes + separated answers | Section G — Progressive practice (easy/medium/hard; MCQ / predict-output / find-error / write-code / complete / explain / scenario; answers hidden until checked) |
| Course packaging / capstone | Section H — Mini-project |
| Related-topics + freshness + syllabus | Section I — Revision / cheat-sheet / next topic |

Subject-specific registries (Python, SQL, C, Excel, Linux, electronics, ML,
aptitude) apply these sections with an appropriate *pattern* and *visual style*
so, e.g., an electronics lesson is not taught like a Python article — a direct
lesson from the site's own subject separation.

---

## 5. Limits of this research (stated plainly)

- **Four pages, one pass.** Not a survey; not statistically representative.
- **Robots/AI-crawler policy.** The site disallows named AI agents, so this was
  a minimal human inspection, not a crawl. Conclusions rest on a small sample.
- **Not observed:** the site's internal authoring tools, its exact scoring
  rules, any A/B-tested pedagogy, non-Python subjects' page layouts, or
  behaviour behind login/paywall. None of these are asserted.
- **Point-in-time.** Layouts change; observations are a snapshot.
- **No performance claims.** We did not measure learning outcomes, only page
  structure. No claim is made that this structure improves learning.
- The existing in-app **Chat "teach mode"** (`teach-prompt.ts`) predates this
  work and is a separate, single-prompt feature. The new Teaching Agent lives
  in **Sessions** and is app-owned; the two do not depend on each other.
