# Sell my stuff (Offload)

DeepTrail includes Offload as a dedicated task in the existing React/Vite/Hono application. It uses the same authenticated workspace, SQLite database and optional Render checkpoint service. No Next.js or Postgres service is required.

## Use it

Open **Sell my stuff** in the sidebar. Upload up to six photos (20 MB each) or one video (30 seconds / 50 MB). The browser creates compressed frames at up to 768px; the original video never leaves the device.

The task identifies up to four objects, validates drafts, searches Linkup for comparable asking prices per item, performs a broader second search if the first has no explicit asking prices, writes evidence-informed descriptions, and saves the listing package. Inspect the saved query trail, sources, model metadata and workflow events. Price ranges are comparable asking prices, never verified sale prices; weak evidence stays labeled as an AI estimate.

Review, select, delete and edit listings; confirm condition; adjust the crop from the original photo; recheck prices after editing the identity. Set an asking price, private minimum, public pickup location and two pickup windows. The selling desk exercises low offers, qualifying offers, condition questions, delivery requests and custom messages. Confirmation checks the current rules, locks reserved items and rejects competing reservations. Copy a listing pack or export selected listings as Markdown.

**Try sample items** needs no provider credentials. Its illustrations, prices, sources, buyers and reservations are explicitly fictional. Marketplace activity remains simulated for live scans too: there is no automatic posting, buyer contact, payment or shipping integration.

## Connections

Use the existing app setup in `DEVELOPMENT.md`. In `packages/browseros-agent/apps/research/.env`, configure:

- `LINKUP_API_KEY` for comparable-price searches.
- `NEBIUS_API_KEY` and `NEBIUS_VISION_MODEL` for image analysis and evidence-informed listing writing. The ordinary research task still uses `NEBIUS_MODEL` independently.
- Optionally `PIONEER_API_KEY`, `PIONEER_MODEL`, and `PIONEER_BASE_URL` to choose Pioneer instead of Nebius. No model name is assumed to be available.

The same `RESEARCH_EXECUTOR=local|render` setting controls both task types. Local mode runs real provider calls in the Bun service. Render mode registers `offload` and `offload-step` alongside the research workflow in `src/workflows.ts`; use the existing workflow slug, API URL and worker secret. Give the workflow service the same vision and search credentials. Nebius model availability is checked before each scan; a configured key alone is not proof of a successful run.

## Persistence and recovery

SQLite tables `offload_jobs`, `offload_steps`, `offload_events`, and `offload_listings` share the existing database. Every job belongs to a workspace session. Internal Render requests use the existing worker secret; public routes enforce session ownership and same-origin writes.

Each image-analysis step, validation step, individual search pass and listing-writing step saves an independent checkpoint. Leases prevent concurrent work from overwriting newer results. Publication uses unique `(job_id,item_id)` keys. Enable `RESEARCH_ALLOW_FAILURE_DEMO=true` to demonstrate a failure **after** listing records have been committed; retry finishes without duplicate listings or repeated paid steps.

Local in-flight jobs pause after a service restart and can resume. The sidebar retains scan and price-recheck history. Stopping a job rejects later results, and attempts to cancel its Render run when applicable. Export a scan's evidence and measurements from its progress view.

Editable listings, source/cropped image blobs, selling policies, conversations and reservations are saved in native IndexedDB, namespaced to the workspace session. These are device-local, not cross-device seller records. Reset clears those local records. Server-side scans remain until deleted; clearing a pending scan does not cancel it. Session access expires under the existing app's 30-day session policy.

## Validation and evaluation

From `packages/browseros-agent/apps/research`:

```sh
bun run typecheck
bun test tests
bun run build
bun run test:offload-ui
```

The UI check runs an isolated server and a headless Chrome browser. It covers samples, editing, offers, reservations, refresh, mobile layout, a mocked scan with failure recovery, price rechecks and recropping. It does not spend provider credits or demonstrate hosted Render execution.

For actual-input evaluation, copy `eval/offload-cases.example.json` to `eval/offload-cases.json` and supply JPEG/PNG/WebP photos. Prepare photos at roughly 768px and keep each base64 frame under 600,000 characters, matching the API limit. The browser upload flow does resizing automatically; this CLI expects prepared images. Expected object labels remain grading metadata and are not sent to the model.

```sh
bun run evaluate:offload -- eval/offload-cases.json
bun run evaluate:offload -- eval/offload-cases.json --live
```

The first command validates the manifest. `--live` submits photos and spends provider credits. Set `EVAL_BASE_URL` if different from `http://127.0.0.1:4318`, `RESEARCH_ACCESS_CODE` for the workspace, and optionally `OFFLOAD_PROVIDER=pioneer`. Reports include end-to-end time, successful search/writing step time (excluding retry waits), token metadata, search evidence, recovery events and blank human-grading fields. Complete those fields before claiming accuracy or comparable-price quality. Live provider accuracy and hosted Render recovery are not established by fixture tests.

## Source provenance

Adapted from [pickerof/offload](https://github.com/pickerof/offload), main commit `554d6667f228d3e24b76ac08ddb8ae51938da138`, and the listing-research approach on `person-a-listing-pipeline` commit `0d1bf0814469b7df1cca47767cc6090b95435182`. The React review/selling components, negotiation rules, image helpers and sample assets are ported. Provider orchestration, persistence, routes and research checkpoints are adapted to DeepTrail. No upstream server scaffold, database service, or dependencies were imported.
