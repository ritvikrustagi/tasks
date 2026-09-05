# Aside Parity Status

This is a real desktop-browser development package, but **not full Aside
parity**. A launcher and a successful build are not evidence that an agent can
reliably complete every supported task. Last updated: 2026-09-05.

## Product Architecture

The Mac runs BrowserOS/Chromium with an isolated AI Browser profile and our
assistant extension. Render hosts approved research jobs, not the user's
logged-in browser. The desktop remains usable for ordinary browsing while
research services are unavailable. Linkup and Nebius keys belong on the server,
never inside the downloadable application.

## Capability Matrix

| Aside capability | Current implementation | Remaining acceptance work |
| --- | --- | --- |
| Desktop browser, tabs, sessions, history, downloads | Bundled BrowserOS native runtime; new macOS launcher | Clean installation and upgrade tests; our own signed/notarized native distribution |
| Ask about tabs and automate websites | BrowserOS assistant and native browser tool engine | Live multi-site tasks with chosen model; intervention and cancellation checks |
| ChatGPT subscription connection | Upstream provider; connection button opened OpenAI sign-in in the packaged app | User sign-in, real task, expiry/reconnect/revoke tests and distribution review remain |
| Claude connection | Anthropic API preset and Claude Code agent option visible after runtime startup | User credentials and lifecycle tests remain; no promise of arbitrary Claude subscription reuse |
| Multiple providers/local models | Upstream provider settings, Ollama, OpenAI-compatible; added Nebius preset | Verify each enabled provider and tool-call compatibility |
| Task history and progress | Upstream conversation history; research SQLite checkpoints and timeline | Live browser crash/recovery and durable hosted research tests |
| Research with citations | Linkup -> Nebius gap analysis -> Linkup follow-up -> Nebius report | Fund Linkup, activate Nebius, verify real outputs and evaluations |
| Routines/scheduled tasks | Upstream scheduled-task UI and scheduler | Timezone, sleep/wake, overlap, failure, and sensitive-action approval tests |
| Persistent memory | Saved research brief and upstream personalization/workspace context | Aside-style extracted cross-session memory with provenance, review, deletion, and reliable retrieval is not implemented |
| External app connections | Upstream MCP/Strata integration and connection UI | User-authorized service connections and end-to-end tests; not all catalogs are verified |
| MCP/CLI control | Upstream server and CLI source | Pairing, authentication, scope, cancellation, and revocation acceptance tests |
| Browser password manager | Native Chromium facilities inherited | AI-mediated secure autofill and vault integration not implemented or tested |
| Consequential-action approval | Upstream tool policies and model instructions | Independently enforced, parameter-bound approval gate across every mutating tool; do not assume prompts guarantee safety |
| Reliable native updates | Vendor browser update machinery retained; packaged extension update URL removed | Own release identity, signing/notarization, update channel, and rollback |

## Release Gates

Do not distribute this as an audited autonomous browser. Before claiming parity:
run the SPEC.md scenarios against representative websites; verify connected
provider login and billing behavior; implement and test missing memory/autofill
and approval boundaries; audit telemetry and third-party service defaults; ship
an independently maintained security-update path.

The current app preserves BrowserOS's native identity and visible branding.
It does not impersonate Aside or claim affiliation with Aside or BrowserOS.
The application source remains AGPL; upstream notices are bundled.

## Free Versus Credit-Funded

- The local browser does not need a paid hosting instance just to browse. AI
  calls still need the user's provider or subscription and may incur usage fees.
- Render has free web/static hosting, but its free web instances lose local
  files on restart and cannot attach persistent disks. The current durable
  SQLite design needs a paid web instance and disk.
- A free Render Postgres instance expires after 30 days and would require a
  storage migration; it is not a permanent free replacement for persistence.
- Render credits offset charges until exhausted; they do not make Workflows,
  storage, Linkup, or Nebius indefinitely free. No card has been added by this
  implementation agent.

Sources: [Aside browser](https://docs.aside.com/changelog/native),
[Aside providers](https://docs.aside.com/help/ai),
[Aside memory](https://docs.aside.com/help/memory),
[Render free-tier limits](https://render.com/docs/free).
