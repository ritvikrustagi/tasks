# Browser Agent

A CLI for people who want research and multi-step web tasks completed in their existing Chrome sessions. Give it a task; Claude or ChatGPT drives a visible, persistent copy of your Chrome profile and writes a source-cited answer and files into a run directory.

This implements the browser-agent brief with the requested subscription-auth extension: Node 22, TypeScript executed with `tsx`, `playwright-core`, a persistent JavaScript tool and one bash tool. Claude Code and Codex provide subscription-backed inference; direct Anthropic API streaming remains optional. There is no server, database, build step, or product-level subagent system.

## Run

Requires Node 22+, Google Chrome, and either Claude Code signed in with your Claude subscription or Codex CLI signed in with ChatGPT. These CLIs must be on PATH. Recent versions supporting safe/isolated execution and structured output are required (tested: Claude Code 2.1.257, Codex 0.153.2).

```sh
npm ci
# Connect either subscription using the provider's native browser sign-in:
npm run agent -- login --provider claude
npm run agent -- login --provider chatgpt

# Existing Claude Code / Codex sign-ins are reused automatically.
npm run agent -- "What are the top 3 posts on Hacker News right now?"
npm run agent -- --provider chatgpt "What are the top 3 posts on Hacker News right now?"

# Check sign-in without printing private account details:
npm run agent -- auth --provider claude
npm run agent -- auth --provider chatgpt

# Optional: install the local executable on your PATH.
npm link
agent --profile "$HOME/Library/Application Support/Google/Chrome/Default" \
  "Go to my Gmail and tell me who emailed me most in the last 7 days. Read only."
```

`--provider claude` is the default and uses Claude Code's `sonnet` alias. `--provider chatgpt` defaults to the verified `gpt-5.5` model, or specify a supported model with `--model`. Set `AGENT_PROVIDER` and `AGENT_MODEL` in your environment or `.env` for defaults. `--headed` is the default; `--headless` is available. `--max-turns 60` bounds the model loop.

Subscription modes remove API-key and alternate-provider environment overrides and disable the native CLI's built-in tools. Your existing browser REPL remains responsible for every action. The provider receives the bounded conversation history and screenshot attachments each decision step, then returns structured next-action requests. Progress text appears as each decision completes. Authentication and token refresh stay with the provider CLI; no OAuth tokens are copied into this repo. Usage counts against the applicable subscription limits, not an unlimited allowance. There is no automatic API-billing fallback.

For the original token-streaming API mode, configure `ANTHROPIC_API_KEY` and explicitly use `--provider anthropic`. Its default model remains `claude-sonnet-4-6`; `ANTHROPIC_MODEL` applies only to that mode.

Official authentication references: [Claude subscription support](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [Codex ChatGPT sign-in](https://developers.openai.com/codex/auth).

Chrome's user-data root is detected by platform. `--profile` accepts that root or an individual `Default` / `Profile N` directory. The selected profile is copied to the run directory before launch; the original is not automated. Closing Chrome before the first copy gives the most consistent cookie/database snapshot. OS keychain access and the site's session policy still determine whether copied logins work; copying a profile does not guarantee Gmail authentication. If needed, log in to the agent's visible Chrome window.

Each new run copies the selected profile before opening Chrome. Large profiles can take about a minute; startup messages report the copy and elapsed waiting time. The CLI also reports when Chrome is ready and when the model is thinking. `--continue` reuses that run's existing profile copy.

Only run tasks and generated code you trust: the REPL and bash have your user's filesystem/network access. The run directory contains private browser data and potentially private screenshots and transcripts, and is gitignored. Provider CLIs retain their own credentials and may write their own runtime logs outside the run directory; generated code can access other paths.

## Results and resume

Each `runs/<timestamp>/` contains:

- `artifacts/`: downloads, user-requested deliverables, and the final `answer.md`.
- `tmp/`: images displayed to the model.
- `transcript.json`: messages, visited sources, token counts and completion/error status.
- `repl.json`: supported saved REPL variables.
- `run.json` and `browser-profile/`: run metadata and copied browser state.

```sh
agent --continue
agent --continue "Write the findings to a markdown table in artifacts/."
```

Resume remembers the selected provider and model. You can explicitly switch providers with `--continue --provider chatgpt`. It reopens saved tabs, restores the transcript and JSON-compatible variables, and reuses the copied profile. Live objects such as locators, closures, page handles and network connections cannot be serialized to JSON. Recreate those bindings after resume. Previous tool code is never replayed automatically; the agent must verify the state of any interrupted action before retrying it. Saved artifacts and the transcript survive failed runs.

## Browser tools

The model gets exactly two tools: `javascript` and `bash`.

The persistent JavaScript context provides `page`, `tabs`, `openTab(url)`, `closeTab(tab)`, `snapshot(page, options)`, `readPage(page)`, `console.log`, `display`, `fetch`, `fs`, `path`, `Buffer`, `sleep`, and `pwd`. Top-level await and bindings across calls are supported. `snapshot()` returns a pruned accessibility tree and a line diff. A ref such as `e13` can be used as `page.locator('e13')`; read a new snapshot after navigation or an action. Scope large pages with `{ ref }` or `{ selector }`, and use `{ interactive: true }` during recovery. `showHidden` uses the fallback walker.

```js
const hn = await openTab('https://news.ycombinator.com');
console.log((await snapshot(hn)).tree);
// In the next tool call, hn still exists.
await display(await hn.screenshot());
```

Popup, navigation, download and dialog signals reach the next tool result. Dialogs remain pending for explicit handling through `page.pendingDialog`. Downloads are saved in `artifacts/`. Locator errors include a fresh interactive snapshot. Canvas and custom-widget tasks can use screenshots and `page.mouse.click(x, y)`.

Final HTTP(S) source links are checked against URLs the browser actually visited. This checks provenance of URLs, not factual accuracy of every claim. The agent is instructed to flag missing evidence and use cleaned page text, never raw DOM/CDP dumps.

## Verification

```sh
npm run typecheck
npm test
npm run smoke
npm run evaluate -- --profile "$HOME/Library/Application Support/Google/Chrome/Default"
# Or one case:
npm run evaluate -- --case pricing
```

The smoke test opens live Hacker News with a fresh profile, checks snapshot size and working refs, and displays a screenshot through the REPL. The evaluation runner executes the brief's pricing, Gmail and flight tasks in separate unattended CLI runs. It saves task criteria, wall time, token use, transcripts and status. `completed_needs_review` means the CLI finished; inspect the artifacts against the recorded criteria before declaring a pass. A missing subscription sign-in (or API key for explicit Anthropic API mode) is recorded as `blocked`, never as a passing evaluation. Choose the evaluation provider with `--provider claude|chatgpt|anthropic`.

Known difficult cases include websites with bot challenges, inaccessible canvas interfaces, copied sessions that require reauthentication, large mailbox result sets, and dynamic flight prices. Research can report a product or pricing page unavailable; it must not invent current plans. Dates and flight coverage must be stated explicitly.

See [VALIDATION.md](VALIDATION.md) for observed checks and [rubric alignment](RUBRIC_ALIGNMENT.md) for submission eligibility. The definition of done is all three live acceptance tasks passing in one unattended run each; implementing the machinery alone does not meet it.
