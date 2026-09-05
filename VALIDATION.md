# CLI observed validation

Checked September 5, 2026, on macOS with Node 22.16.0 and installed Google Chrome.

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 20 tests passed, 0 failed, 0 skipped |
| Live headed Hacker News smoke | Passed in 3.454 seconds; 6,289-character snapshot (~1,573 tokens by chars/4 estimate); clicked the `new` ref, verified navigation and changed diff |
| Persistent REPL and screenshots | Passed: const and Page handle reused across sequential calls; screenshot returned as an image content block and visually inspected; JSON variable restored without replay |
| Copied real Chrome profile + Gmail | Authenticated Gmail opened successfully; 6,289-character snapshot (~1,573 estimated tokens); clickable refs resolved; `Search mail` control was present and safely focused |
| Browser fixture | Passed main/iframe ref clicks, focused/hidden snapshots, changed/unchanged diffs, cleaned article text, tab lifecycle, popup signal, pending dialog and explicit dismissal, artifact download, interrupted-profile-copy recovery |
| Agent loop with mocked API | Passed streaming/tool sequencing, three-attempt transient retry, source verification and bounded correction, interrupted tool-batch resume, cancellation, transcript persistence, and old-output elision |
| REPL failure behavior | Passed errors without ending loop, bounded output, raw HTML/CDP suppression, browser callback serialization, and a post-await CPU loop hitting its deadline without replacing the prior checkpoint |

Gmail verification was read-only. No message contents or mailbox tree were included in this evidence document. The Gmail smoke's final check took 5.984 seconds with the already copied profile; that timing excludes the initial profile copy.

Local, gitignored evidence:

- `runs/smoke-2026-09-05T18-36-05.173Z/artifacts/smoke.json`
- `runs/smoke-2026-09-05T18-36-05.173Z/tmp/a6ec8903-e32a-4071-bf52-b23019e57d7c.png`
- `.context/gmail-smoke-run/gmail-smoke.json`
- `runs/evaluation-2026-09-05T18-36-13.641Z/results.json`

## Subscription authentication extension

Both native subscription sign-ins were present, and both providers completed a real public browser task without an API key:

| Provider | Observed result |
| --- | --- |
| Claude Code / Claude Max | Live Hacker News top-three task completed unattended in 2 turns; 10,474 input / 516 output tokens |
| Codex / ChatGPT | Live Hacker News top-three task completed unattended in 2 turns; 7,661 input / 264 output tokens |
| Claude screenshot input | Correctly identified Hacker News from the supplied screenshot; 3,122 input / 108 output tokens |
| ChatGPT screenshot input | Correctly identified Hacker News from the supplied screenshot; 2,367 input / 20 output tokens |
| Authentication commands | Both `agent auth --provider claude` and `agent auth --provider chatgpt` report connected without printing account identifiers |

Native built-in tools are disabled; structured action requests are executed by the existing browser REPL/bash loop. A live Claude recovery test caught native `javascript` tool hallucination, which was fixed by explicitly requiring the native structured-output protocol. Unexpected native tool actions still fail closed. Codex was separately probed and reported no available native tools.

Provider subprocess tests cover screenshot transport, credential-environment isolation, strict step parsing, unexpected native-tool rejection and cancellation. Claude and Codex CLIs own sign-in, refresh and usage limits. Codex JSON mode emits text on completed decisions and has no hard output-token flag; inference subprocesses have a 180-second timeout and 8 MB output ceiling. The API-key provider retains its original streaming behavior.

Live task transcripts:

- `runs/2026-09-05T18-48-06.259Z-a014db0b/transcript.json` (Claude)
- `runs/2026-09-05T18-48-12.403Z-a919ba57/transcript.json` (ChatGPT)

## Initial API-mode acceptance record (before subscription support)

`npm run evaluate` checked all three task prerequisites and recorded each case as **blocked** because `ANTHROPIC_API_KEY` was not configured. No real Anthropic request was made, and no task success or model-quality score is claimed.

| Task | Status |
| --- | --- |
| Compare Linear, Notion and Height pricing, with a sourced table | Blocked: API key missing |
| Identify the most frequent Gmail sender over the last seven days | Blocked: API key missing; copied Gmail authentication separately verified |
| Find cheapest observed nonstop SFO–JFK flight next Friday and screenshot it | Blocked: API key missing |

At the time of that initial API-only evaluation, the live 8+ step task across 2+ sites and model-driven Hacker News task were also unverified. The subscription Hacker News runs above have since passed. The deterministic browser smoke and mocked API tests do not substitute for those acceptance runs.

The API-key prerequisite above is historical: subscription mode now runs without a key. Run `npm run evaluate -- --provider claude` or `--provider chatgpt` to evaluate through a connected subscription. Review the saved outputs against the runner's explicit criteria, including date ranges, pagination coverage, source links and the flight screenshot. Completion alone is not an accuracy score.

The brief's definition of done is **not yet met**. Sponsor eligibility is separately recorded in [RUBRIC_ALIGNMENT.md](RUBRIC_ALIGNMENT.md).

## Subscription acceptance follow-up

The pricing comparison completed unattended through ChatGPT in 138.4 seconds / 9 turns (86,370 input and 3,463 output tokens). The source gate detected an unopened Height URL and obtained a corrected final answer. Linear and Notion headline prices matched captured official evidence; Height pricing stayed explicitly unverified.

This is a **partial quality result**, not a full acceptance pass: currency was shown only as `$`, and one Notion agent-credit detail was described too broadly as “Notion AI.” A successful process exit demonstrates the subscription/browser integration, not that every comparison claim is precise.

- Answer: `runs/2026-09-05T18-49-06.056Z-437b7dc6/artifacts/answer.md`
- Evaluation: `runs/evaluation-2026-09-05T18-49-04.480Z/results.json`

The flight task completed unattended through ChatGPT in **262.089 seconds / 22 turns** (647,641 input and 5,618 output tokens). The saved screenshot was visually reviewed: September 11, 2026, one-way SFO–JFK, nonstop, one adult, Alaska AS20, with observed agency totals starting at USD 342 versus USD 347 for Alaska Saver. The answer labels the fare restrictions as the direct Alaska Saver offer, identifies its search coverage, and makes no claim of exhaustive vendor coverage. No purchase was attempted. This is a qualified pass for the cheapest-observed-results task; the lower agency offer's own restrictions were not inspected.

- Answer and screenshot: `runs/2026-09-05T18-49-30.516Z-495f4080/artifacts/`
- Evaluation: `runs/evaluation-2026-09-05T18-49-29.085Z/results.json`

The Gmail task authenticated and applied its seven-day filter, but failed after **149.13 seconds / 8 turns**, before producing sender rankings or establishing pagination coverage. Claude attempted a native `javascript` call rather than returning the external host action. No mailbox changes were observed. The transport has since been hardened by relabeling historical native-tool records as external host actions/results, with one bounded retry for that specific generation error. A native call is never executed by this recovery path. The failed full Gmail acceptance run remains a failure until a new unattended run verifies the complete result.

- Evaluation: `runs/evaluation-2026-09-05T18-49-09.331Z/results.json`
- Transcript: `runs/2026-09-05T18-49-10.701Z-ab2fd5c0/transcript.json`

The exact failed Gmail decision was replayed after the transport fix and returned a valid structured JavaScript host action (57,293 input / 2,150 output tokens). No native or host actions were executed during this focused reproduction. Evidence is private at `.context/gmail-transport-recovery.json`. The complete sender-count task has not been rerun after the fix. Final typecheck and all 20 tests pass.
