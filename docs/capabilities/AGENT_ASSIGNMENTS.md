# Agent capability assignments

The six built-in packs are visible in the UI and start uninstalled, disabled and
unassigned. When installed, only agents listed in `compatibleAgents` can be
assigned. Compatibility controls routing eligibility; it is not a grant of
permissions.

| Pack | Compatible agent | Current resource coverage |
|---|---|---|
| Website Builder | `/website` | Existing component search/read/review-install tools and website template catalog |
| Coding Workflows | `/website`, `/game`, `/research`, `/other` | Existing workspace inspection, approval-gated mutations and approved commands |
| Game Development | `/game` | Existing game skill routing and selected-project tools; external engine dependencies are not bundled |
| Research Workflows | `/research` | Selected-project listing/count/read/search and evidence reporting; no web search |
| General Tasks | `/other` | Existing selected-workspace tools and approval-gated file actions |
| Teaching | `/other` | Existing teaching framework, lesson bank and roadmap resources |

These compatible-agent lists are initial product defaults. The independent
agent-team registry in `agent-session.ts` has its own tool-derived capability
selection and is not yet backed by this pack assignment store.

