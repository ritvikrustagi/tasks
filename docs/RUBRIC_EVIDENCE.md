# Rubric Evidence

Date: 2026-09-05. Requirements in ../OVERALL_RUBRIC.md remain unchecked until
live evidence exists. Implementation is not the same as a verified connection.

## Product

Product: Bloom Search.
User: a small team's operator evaluating software for specific requirements.
Task: combine their requirements brief with current public documentation and
return a cited comparison, missing information, and practical next actions.
Success: claims supported by sources, requirements addressed, unknown prices or
capabilities not invented, and research surviving retry without duplicate reports.

## Implementation Map

| Requirement | Implementation | Evidence / gap |
| --- | --- | --- |
| Linkup search/retrieve | research/src/providers.ts | Real endpoint adapter; mocked HTTP contract tested; live keys needed |
| Store findings | research/src/store.ts | SQLite persistence/restart test passes |
| Findings drive next search | investigate -> followup in providers.ts | Pipeline test checks second query uses saved plan |
| Nebius essential inference | plan and report requests in providers.ts | Real endpoint adapter; live model evaluation pending |
| Representative evaluations | research/tests/evaluate.ts | Ordinary, recovery, unavailable-info cases; fixtures only so far |
| Measured results | elapsedMs and provider usage | Local fixture pipeline timings recorded; no quality score claimed |
| Render Workflows | research/src/workflows.ts | SDK task registration and child retries implemented; deployment pending |
| Recovery/deduplication | lease + task/step keys in store.ts | Controlled local failure/resume and cancellation tests pass |
| Usable final result | report, citations, uncertainty, Markdown export | UI and API implemented; live report review pending |
| Deployed outside-user entry | root render.yaml and DEVELOPMENT.md | Not deployed; access and credentials needed |

Paths prefixed `research/` are relative to `packages/browseros-agent/apps/`.

## Verification

- Research suite: 9 tests, 40 assertions passed.
- Research TypeScript and production frontend build: passed.
- New research Biome error-level checks: passed.
- Desktop (1440px) and mobile (390px, 320px) UI smoke test: passed. Includes
  explicit failure/resume, exactly one report/source, and no horizontal overflow
  or page errors. Screenshots in `research/test-results/` are fixture evidence,
  not sponsor output. Reproduce with `bun run test:ui`.
- BrowserOS extension build and full monorepo typecheck: passed. Root `check`
  exits successfully with lint/dead-code warnings retained from both upstream
  and the new code; this is not a warning-free audit.
- Modified extension loaded in the downloaded upstream BrowserOS app. Verified
  Research navigation URL and Nebius provider settings in the packaged production
  extension. ChatGPT and Claude Code entries appeared after the local server
  finished starting; ChatGPT's button opened the real OpenAI sign-in page.
  MCP settings displayed the local server URL and supported client controls.
  The initial check did not complete login or a task; the subsequent native
  subscription tests below did. MCP pairing and a native Chromium source build
  remain unverified.
- [Fixture evaluation artifact](evaluation-fixture.json) records actual fixture
  outputs and timings; no model-quality or live-service claims.
- Latest focused suite: 13 tests / 51 assertions passed across research,
  desktop packaging validation, and provider presets. Objective-C launcher
  compilation and deep/strict package signature verification passed.
- Desktop v3 builds the matching local server (0.0.155), fixing the initial
  vendor-server/provider API mismatch. In native UI the default provider loaded
  and the composer enabled after opening a new tab. First-start new-tab
  registration polish remains. Subsequent sidebar tests passed using existing
  Claude and ChatGPT subscription sign-ins: Claude read the top three Hacker
  News posts, and ChatGPT opened and summarized the top article. Both answers
  were checked against the browser pages. Providers and conversations persisted
  after restarting the installed app. See [desktop subscription evidence](DESKTOP_SUBSCRIPTIONS.md).
- Latest upstream full test suite: two failures, missing Go executable and
  CDP startup timeout in server integration. The earlier native-addon failure
  did not recur. Logs: `.context/predeploy-test.log`; `check` exited zero with
  warnings in `.context/predeploy-check.log`.
- No sponsor credentials used; no deployed Workflows run or live inference
  quality evidence has been claimed.
- Source branch published to `ritvikrustagi/tasks:build-aside-ai-browser`.
  Staged-file audit excluded credentials, profiles, local artifacts, and
  databases. Gitleaks flagged 11 unchanged public-upstream entries, not new
  account secrets; the redacted report is in `.context/staged-secrets-redacted.json`.

## Account and Deployment Check

- Render GitHub sign-in succeeded. The Burning Token workspace is accessible;
  a new-service form is staged, not submitted. Paid compute/storage approval and
  app-secret creation confirmation are pending. No paid service was provisioned.
- Linkup session and existing key availability were verified without printing
  the key. Balance was $0; no billable search or funding change was made.
- Nebius Builder welcome email arrived. The credit-code request was submitted
  and the page confirmed the promo would be emailed. Token Factory account,
  API key, and active balance are not verified. No signup terms were accepted.

## Live Demo To Record After Access

1. Deploy both the web entry and actual Workflow service.
2. Submit a software comparison with a saved requirements brief and consent.
3. Show Linkup sources, persisted findings, gap reasoning, and follow-up query.
4. Show Nebius report and source support for each important claim.
5. Repeat with the fail-once option. Show Render retry and prior search retained,
   then verify exactly one report row and no duplicated sources in the result.
6. Run live evaluations, retain inputs/output/timings, manually score evidence
   support, and present the unavailable-information case even if it fails.
7. Add deployed URLs, redacted run IDs, screenshots, and evaluation artifacts to
   this file. Only then update the corresponding rubric checkboxes.
