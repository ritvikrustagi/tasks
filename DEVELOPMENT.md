# AI Browser Development

This is an open-source BrowserOS-based browser foundation plus an implemented
research workspace, not a finished Aside replacement. See SPEC.md for the full
product scope and docs/RUBRIC_EVIDENCE.md for what is actually verified.

## Research workspace

Requires Bun 1.4.2. From the repository root:

```sh
cd packages/browseros-agent
bun install --frozen-lockfile --ignore-scripts
cd apps/research
bun run build
bun run start
```

Open http://127.0.0.1:4318. The UI works without credentials, but execution is
disabled until real providers are configured. There is no production mock mode.

Create a gitignored `apps/research/.env` using `.env.example` as the reference.
Set `LINKUP_API_KEY`, `NEBIUS_API_KEY`, and a model ID available to your Nebius
account in `NEBIUS_MODEL`. Restart after changing environment variables.
`RESEARCH_EXECUTOR=local` runs the same four steps on your machine; this does
not qualify as Render Workflows usage. Keys remain on the server.

The user approves a question and saved/uploaded text brief. Linkup retrieves
sources; Nebius identifies gaps; Linkup searches the resulting follow-up query;
Nebius writes the cited report. SQLite stores each step, evidence, and usage.
Stop blocks further checkpoints; an already-started provider request can still
consume credits. Resume reuses completed steps. Download exports Markdown.

## Render deployment

Requires account access, credits, and this branch pushed to a connected repo.
No resources have been provisioned. The blueprint selects a paid web instance
and persistent disk; review costs before applying it.

1. Create the web service from `render.yaml`. Set `RESEARCH_ORIGIN` to its exact
   HTTPS origin, without a trailing slash. Keep one instance with its persistent
   disk: this SQLite implementation is not a horizontally scaled service.
2. In Render Dashboard choose **New > Workflow** using the same repository.
   Set runtime Node, root directory `packages/browseros-agent`, build command
   `bun install --frozen-lockfile --ignore-scripts`, and start command
   `bun run --cwd apps/research workflow`. Set `BUN_VERSION=1.4.2`.
3. Set the workflow's `LINKUP_API_KEY`, `NEBIUS_API_KEY`, `NEBIUS_MODEL`,
   `RESEARCH_API_URL` (the web service's public HTTPS origin), and
   `RESEARCH_WORKER_SECRET` (exactly the web service's generated secret).
4. Copy the registered workflow slug into the web service's
   `RENDER_WORKFLOW_SLUG`. Give the web service `RENDER_API_KEY` with access to
   that workflow. The registered tasks are `research` and `research-step`.
5. Use the web service's generated `RESEARCH_ACCESS_CODE` to open a workspace.
   Each browser gets its own HttpOnly session and isolated research. This is a
   shared-code alpha, not full account management or team collaboration.
6. Run a real task, inspect its four child runs in Render, and check the exported
   report against its sources. Set `RESEARCH_ALLOW_FAILURE_DEMO=true` on the web
   service for the retry demonstration, then disable it after recording.

Workflows use the actual Render SDK and child-task retries, not a background
worker pretending to be Workflows. Blueprints do not currently define Workflow
services, so `render.yaml` deliberately configures only the web service.
Sources: [workflow deployment](https://render.com/docs/workflows-tutorial),
[SDK](https://render.com/docs/workflows-sdk-typescript),
[Blueprint limitation](https://github.com/render-oss/skills/blob/main/skills/render-workflows/SKILL.md).

For local Render runtime development, install the Render CLI and run
`render workflows dev -- bun run workflow` from `apps/research`. A plain
`bun run workflow` without Render's runtime registers definitions and exits;
it is not a standalone queue server.

## Tests and evaluations

From `packages/browseros-agent/apps/research`:

```sh
bun run typecheck
bun test tests
bun run build
bun run test:ui
bun run evaluate
bun run evaluate --live
```

The UI test uses an isolated fixture server and an installed Google Chrome
(override `CHROME_PATH` on other systems); screenshots go in `test-results/`.
The default evaluation is explicitly deterministic fixture data, not provider
quality evidence. `--live` requires keys and makes billable Linkup/Nebius calls.
It measures entire local task duration, records actual outputs and token usage,
and includes an unavailable-information case. It does not measure Render queue
time or infer semantic accuracy from valid citation IDs. Human review must check
whether evidence really supports each claim. Do not commit private evaluation
inputs or results without redacting them.

## Browser foundation

### Double-click Mac development app

The packager supports Apple Silicon macOS 14+ and requires Xcode Command Line
Tools. It bundles the downloaded signed BrowserOS runtime, the modified
extension, an Objective-C/AppKit launcher, and upstream license/source notices:

```sh
cd packages/browseros-agent
RESEARCH_ORIGIN=https://YOUR-SERVICE.onrender.com bun run --cwd apps/desktop build
```

The default output is `.context/desktop/AI Browser.app` at the repository root.
Set `DESKTOP_OUTPUT` to an absolute unused path for another build. The packager
refuses to overwrite existing output. `BROWSEROS_APP` overrides the vendor app
path. Use the real deployed HTTPS origin, not a URL that has only been reserved
in a deployment form.

The launcher creates `~/Library/Application Support/AI Browser/Profile`, loads
the bundled extension, and opens the normal new-tab page. It does not import
Chrome cookies/passwords or enable remote debugging. The vendor signature is
verified; only the new launcher is ad-hoc signed. This is not a notarized
independent release. Do not bypass macOS security warnings to distribute it.

The desktop artifact is `.context/desktop-v3/AI Browser.app`.
Its Research link targets `https://ritvik-ai-browser.onrender.com`, which is
**not deployed yet**. Ordinary browser and settings UI were checked; live
provider login and agent execution were not. Allow the local agent server to
finish starting: ChatGPT and Claude Code appear once its capabilities load.
ChatGPT's connection button opened the real OpenAI sign-in page in this isolated
profile. Completing sign-in and a real task remain user-dependent acceptance
steps. See `docs/ASIDE_PARITY.md` for the remaining release gates.

The packager builds the matching agent server with the upstream `--ci` build
mode, adds its current database migrations, and retains vendor third-party
runtime assets. The launcher's `--browseros-server-resources-dir` points to this
separate payload without altering the signed browser. CI mode does not include
production BrowserOS service credentials; bring your own model provider.
Version-matching matters: the initial vendor-only package opened OAuth but
failed to load providers against the newer assistant's API.

On the first launch, the initial tab can open before the assistant registers
its new-tab override. Opening another new tab loads the assistant. Startup
sequencing still needs polish before distributing this as a daily-use browser.

### Upstream runtime

The imported Chromium browser, tab/session machinery, agent server, provider
settings, tools, routines, and MCP integrations are upstream BrowserOS code.
Our changes add a Research navigation link and a Nebius provider preset.
Set `VITE_RESEARCH_URL` in the agent environment when deploying the research UI.

Build the extension with `bun run build` from `packages/browseros-agent/apps/app`.
It requires BrowserOS's native APIs; it is not a regular Chrome extension.
The source manifest retains upstream identity and update URLs; the desktop
packager removes the extension update URL in the generated artifact. Before
distributing a fork, replace signing/update identities,
audit upstream telemetry/service defaults, hydrate LFS assets, and follow AGPL
source-disclosure obligations. Do not publish this as an independently maintained
signed browser yet.

The downloaded upstream development app lives in `.context/BrowserOS.app`.
It is not a native build of this branch. Full Chromium build instructions remain
in the upstream README and docs; this machine lacks full Xcode and sufficient
disk headroom for the stated native build requirements.

The modified extension has been smoke-tested in that downloaded browser using
an isolated profile. To reopen it from the repository root after building:

```sh
open -n .context/BrowserOS.app --args \
  --user-data-dir="$PWD/.context/browser-profile" \
  --no-first-run --no-default-browser-check \
  --load-extension="$PWD/packages/browseros-agent/apps/app/dist/chrome-mv3" \
  http://127.0.0.1:4318
```

ChatGPT OAuth and Claude API/provider code are inherited, not live-verified in
this workspace. Claude subscription authentication for a third-party product
requires provider-policy review/approval; it is not interchangeable with an API
key. Do not paste provider cookies or subscription tokens into custom endpoints.

## Operational limits

- SQLite checkpoints deduplicate final records. Provider reads may repeat after
  a crash or expired lease; exactly-once billing is not claimed.
- A dispatch timeout has an ambiguous remote outcome. Check Render runs before
  resuming. Cancel or reconcile an old run first; do not switch executor modes
  for existing tasks.
- After a local service restart, active tasks pause for explicit resume. A
  crashed step lease expires after three minutes. Render runtime failures that
  bypass task exception handling may need operator reconciliation in Render.
- The service stores approved briefs/evidence on disk. Deleting a task removes
  its local records, not provider logs, Render logs, or disk snapshots. Clearing
  cookies loses access to that browser's research; account recovery is deferred.
- Access codes are a demo gate, not strong multi-tenant authentication. Before
  public launch add identity, quota enforcement, retention jobs, monitoring,
  backups, and independently audited browser action approvals.
