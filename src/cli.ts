#!/usr/bin/env -S npx tsx
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createBrowser, type BrowserSession } from './browser.js';
import { Repl } from './repl.js';
import { runAgent } from './agent.js';
import { loginSubscription, subscriptionStatus, type Provider } from './subscription.js';

const help = `Usage: agent [options] "<task>"
       agent login --provider claude|chatgpt
       agent auth --provider claude|chatgpt

A browser task agent using your Claude or ChatGPT subscription and copied Chrome profile.

  --provider <id>   claude (default), chatgpt, or anthropic (API key)
  --profile <dir>   Chrome user-data directory (or a Default/Profile N directory)
  --model <id>      Model supported by the selected provider
  --headed         Show Chrome (default)
  --headless       Hide Chrome
  --continue       Resume the latest run's transcript and saved variables
  --max-turns <n>   Stop after n model turns (default: 60)
  --help           Show this help

Subscription modes use your Claude Code or Codex sign-in. No API key required.
Only --provider anthropic uses ANTHROPIC_API_KEY from your environment or .env.
Outputs: runs/<timestamp>/artifacts/; full history: transcript.json.
`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  try { process.loadEnvFile('.env'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    profile: { type: 'string' }, model: { type: 'string' }, provider: { type: 'string' },
    headed: { type: 'boolean' }, headless: { type: 'boolean' },
    continue: { type: 'boolean' }, 'max-turns': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  const selectedProvider = values.provider ?? process.env.AGENT_PROVIDER;
  if (selectedProvider && !['anthropic', 'claude', 'chatgpt'].includes(selectedProvider)) throw new Error('--provider must be claude, chatgpt, or anthropic.');
  if (positionals.length === 1 && ['login', 'auth'].includes(positionals[0])) {
    const provider = (selectedProvider ?? 'claude') as Provider;
    if (provider === 'anthropic') throw new Error('Use --provider claude or chatgpt for subscription sign-in. Anthropic API mode uses ANTHROPIC_API_KEY.');
    if (positionals[0] === 'login') await loginSubscription(provider);
    const status = await subscriptionStatus(provider);
    console.log(status.detail);
    if (!status.connected) process.exitCode = 1;
    return;
  }
  if (values.headed && values.headless) throw new Error('Choose either --headed or --headless.');
  const maxTurns = Number(values['max-turns'] ?? 60);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error('--max-turns must be a positive integer.');
  const task = positionals.join(' ').trim();
  if (!task && !values.continue) throw new Error(`Provide a task, or use --continue.\n\n${help}`);

  const runsDir = path.resolve('runs');
  await mkdir(runsDir, { recursive: true });
  let runDir: string;
  let previous: { model?: string; provider?: Provider; task?: string; urls?: string[] } = {};
  if (values.continue) {
    let runName: string;
    try { runName = (await readFile(path.join(runsDir, 'latest'), 'utf8')).trim(); }
    catch { throw new Error('No saved run found. Start a task without --continue first.'); }
    if (!runName || path.basename(runName) !== runName) throw new Error('Invalid saved run path.');
    runDir = path.join(runsDir, runName);
    previous = JSON.parse(await readFile(path.join(runDir, 'run.json'), 'utf8'));
  } else {
    runDir = path.join(runsDir, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
  }
  const provider = (selectedProvider ?? (values.continue ? previous.provider ?? 'anthropic' : 'claude')) as Provider;
  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY for --provider anthropic, or use --provider claude or chatgpt with your subscription.');
  } else {
    const status = await subscriptionStatus(provider);
    if (!status.connected) throw new Error(status.detail);
  }
  await mkdir(path.join(runDir, 'tmp'), { recursive: true });
  await mkdir(path.join(runDir, 'artifacts'), { recursive: true });
  const model = values.model ?? process.env.AGENT_MODEL
    ?? (provider === 'anthropic' ? process.env.ANTHROPIC_MODEL : undefined)
    ?? ((previous.provider ?? 'anthropic') === provider ? previous.model : undefined)
    ?? (provider === 'claude' ? 'sonnet' : provider === 'chatgpt' ? 'gpt-5.5' : 'claude-sonnet-4-6');
  const runTask = task || previous.task || 'Continue the previous task.';
  const resumeTranscript = Boolean(values.continue) && await access(path.join(runDir, 'transcript.json')).then(() => true, () => false);
  const metadata = { task: runTask, model, provider, urls: previous.urls ?? [] };
  await writeFile(path.join(runDir, 'run.json'), JSON.stringify(metadata, null, 2));
  const latestTmp = path.join(runsDir, `latest-${randomUUID()}.tmp`);
  await writeFile(latestTmp, path.basename(runDir));
  await rename(latestTmp, path.join(runsDir, 'latest'));
  console.error(`Run: ${runDir}`);
  console.error(`Provider: ${provider}${provider === 'anthropic' ? ' (API key)' : ' (subscription sign-in)'}`);

  let session: BrowserSession | undefined;
  let repl: Repl | undefined;
  const controller = new AbortController();
  const save = async () => {
    if (session && !interrupted) metadata.urls = session.context.pages().map(p => p.url()).filter(url => /^https?:/.test(url));
    await writeFile(path.join(runDir, 'run.json'), JSON.stringify(metadata, null, 2));
  };
  let interrupted = false;
  const interrupt = () => {
    if (interrupted) { process.exit(130); }
    interrupted = true;
    console.error('\nStopping; saving resumable state.');
    controller.abort(new Error('Run interrupted. Resume with --continue.'));
    if (session) {
      metadata.urls = session.context.pages().map(p => p.url()).filter(url => /^https?:/.test(url));
      void session.context.close().catch(() => {});
    }
    process.exitCode = 130;
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    session = await createBrowser({ profile: values.profile, headed: !values.headless, runDir, signal: controller.signal });
    controller.signal.throwIfAborted();
    if (values.continue) {
      for (const url of previous.urls ?? []) {
        try { await session.openTab(url); }
        catch (error) { session.signals.push(`Could not reopen ${url}: ${String(error)}`); }
      }
    }
    repl = new Repl(session, runDir);
    if (values.continue) await repl.restore();
    const result = await runAgent({ task: task || (resumeTranscript ? '' : runTask), model, runDir,
      resume: resumeTranscript, session, repl, maxTurns, signal: controller.signal, provider });
    await writeFile(path.join(runDir, 'artifacts', 'answer.md'), `${result.answer}\n`);
    console.error(`\nFinished in ${result.turns} turns; ${result.inputTokens} input / ${result.outputTokens} output tokens.`);
    console.error(`Artifacts: ${path.join(runDir, 'artifacts')}`);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    try { await save(); } finally {
      try { await repl?.close(); } finally { await session?.close(); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Error: ${error instanceof Error ? error.message : String(error)}`); process.exitCode ||= 1; });
}
