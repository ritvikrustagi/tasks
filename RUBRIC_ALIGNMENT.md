# CLI rubric alignment

The standalone CLI follows the supplied browser-agent brief. The initial fixed stack, now extended at the user’s request to support Claude and ChatGPT subscriptions, does not implement the sponsor track entry requirements in `OVERALL_RUBRIC.md`. This record keeps eligibility claims separate from engineering progress.

## Product definition

- User: a person doing web research or repetitive browser work using accounts already logged in to Chrome.
- Task: complete multi-step research, compare pricing, summarize a mailbox read-only, or inspect flight results.
- Inputs and stored data: a natural-language request, a copied Chrome profile, run transcript, saved variables, visited URLs and artifacts.
- Result: a final answer with opened source links, plus requested markdown files, downloads or screenshots.
- Success: the three acceptance tasks finish unattended, with verified evidence and usable artifacts; evaluation also records elapsed time and token usage.

## Entry requirements

| Track | Evidence currently implemented | Unmet entry requirements |
| --- | --- | --- |
| Linkup Deep Research | Browser research can preserve findings in transcript/artifacts and follow up on gaps; final URLs must have been visited. | The brief explicitly specifies browser-native search. Linkup is not used; no deployed public product. Ineligible as implemented. |
| Nebius Applied AI | Evaluation runner records representative inputs, review criteria, outputs, full task wall time and token usage. | Inference uses Claude subscriptions, ChatGPT subscriptions, or the optional Anthropic API. Nebius Token Factory is not used. Live output quality still requires evaluation. Ineligible as implemented. |
| Render Workflows | Local progress, saved transcripts, bounded API retries and interrupted-call recovery. | Render Workflows is not used; no deployed workflow, external entry point or demonstrated workflow deduplication. Ineligible as implemented. |

No sponsor integration is claimed for this CLI. The separate desktop research app is documented in `docs/RUBRIC_EVIDENCE.md`. The build-time coding agents are implementation collaborators; the shipped CLI has no subagent feature. Sponsor integrations remain additional work outside the subscription-auth change; unused API calls would not satisfy the checklist.

All competition checkboxes remain unchecked until supported by observed evidence. `VALIDATION.md` and per-run evaluation results record what was actually tested and what remains blocked.
