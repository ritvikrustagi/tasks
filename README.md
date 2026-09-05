# Bloom Search

Bloom Search is our hackathon project: a research browser that tries to give you an actual sourced answer instead of a pile of tabs.

You give it a question and a short brief. It searches, saves what it found, looks for gaps, searches again, and writes a cited report.

The **Sell my stuff** task also turns photos/video into researched listing drafts, with editable prices, a simulated selling desk, and pickup reservations. See [Offload integration](docs/OFFLOAD.md).

The browser shell is still alpha. The main thing we are showing is the deep research workflow.

## Hackathon Connections

This is the part that maps to the rubric:

| Connection | Role in Bloom Search | Current status |
| --- | --- | --- |
| Linkup | Finds sources and does the follow-up search after we know what is missing. | Built with fixture tests. Needs live credits/key for the demo. |
| Nebius | Reads the brief and evidence, finds gaps, and writes the report. | Built with token tracking. Needs live model evaluation. |
| Render Workflows | Runs the steps in the background and lets us show retry/recovery. | Workflow code exists. Deployment still needs to happen. |

## What It Does Right Now

- Takes a research question.
- Lets you paste or upload context.
- Searches with Linkup.
- Stores sources and intermediate findings in SQLite.
- Uses Nebius for gap analysis and report writing.
- Runs locally, or through Render Workflows for the demo path.
- Exports evidence and the final Markdown report.

## Important Files

| Path | Purpose |
| --- | --- |
| `packages/browseros-agent/apps/research/` | The actual Bloom Search app. |
| `site/` | The simple landing page. |
| `OVERALL_RUBRIC.md` | The rubric we are trying to hit. |
| `docs/RUBRIC_EVIDENCE.md` | What is real vs. what still needs live proof. |
| `DEVELOPMENT.md` | Setup and deploy notes. |

## Run It

Requires Bun 1.4.2.

```sh
cd packages/browseros-agent
bun install --frozen-lockfile --ignore-scripts
cd apps/research
bun run build
bun run start
```

Open `http://127.0.0.1:4318`.

For live research, add a `.env` in `packages/browseros-agent/apps/research/` with `LINKUP_API_KEY`, `NEBIUS_API_KEY`, and `NEBIUS_MODEL`.

## Verify

From `packages/browseros-agent/apps/research`:

```sh
bun run typecheck
bun test tests
bun run build
bun run evaluate
```

`bun run evaluate` uses fixtures. `bun run evaluate --live` uses real services and can spend credits.

## Status

Alpha. The app exists, but the final demo still needs live sponsor credentials, Render deployment, and evidence screenshots/logs.
