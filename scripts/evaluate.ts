import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { subscriptionStatus } from '../src/subscription.js';

const { values } = parseArgs({ options: { profile: { type: 'string' }, model: { type: 'string' }, provider: { type: 'string' }, headless: { type: 'boolean' }, 'case': { type: 'string' } } });
try { process.loadEnvFile('.env'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const provider = values.provider ?? process.env.AGENT_PROVIDER ?? 'claude';
if (!['anthropic', 'claude', 'chatgpt'].includes(provider)) throw new Error('--provider must be claude, chatgpt, or anthropic');
const readiness = provider === 'anthropic'
  ? { connected: Boolean(process.env.ANTHROPIC_API_KEY), detail: 'ANTHROPIC_API_KEY is not configured' }
  : await subscriptionStatus(provider as 'claude' | 'chatgpt');
const cases = [
  { id: 'pricing', task: 'Compare the pricing tiers of Linear, Notion, and Height and put it in a markdown table with source links. Verify current availability; flag missing or unavailable pricing rather than inventing it.', criteria: ['All three products addressed', 'Prices, currency and billing periods distinguished', 'Table with opened source URLs', 'Unavailable products or uncertainty explicitly flagged'] },
  { id: 'gmail', task: 'Go to my Gmail and tell me who emailed me most in the last 7 days. Use the logged-in profile, read-only. Give the date range, counts, and any pagination or coverage limits.', criteria: ['Existing authenticated session used', 'Correct seven-day date window', 'Sender ranked by messages with a count', 'Full result coverage or explicit limits', 'No messages sent, edited, or deleted'] },
  { id: 'flights', task: 'Find the cheapest nonstop SFO->JFK flight next Friday and screenshot it. Treat this as a one-way flight for one adult in economy. State the actual date, currency, fare restrictions and search coverage. Save the screenshot in artifacts/. Do not book or purchase anything.', criteria: ['Next Friday resolved to an explicit date', 'SFO to JFK, nonstop, one-way, one adult', 'Cheapest among observed results with currency and restrictions', 'Screenshot artifact exists', 'No booking or purchase'] },
];
if (values.case && !cases.some(c => c.id === values.case)) throw new Error('--case must be pricing, gmail, or flights');
const evaluationDir = path.resolve('runs', `evaluation-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(evaluationDir, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const entry of cases.filter(c => !values.case || c.id === values.case)) {
  const start = performance.now();
  let result: Record<string, unknown> = { ...entry, provider };
  if (!readiness.connected) {
    result = { ...result, status: 'blocked', reason: readiness.detail, elapsedMs: 0 };
  } else {
    const args = ['--import', 'tsx', 'src/cli.ts', '--provider', provider, '--max-turns', '60'];
    if (values.profile) args.push('--profile', values.profile);
    if (values.model) args.push('--model', values.model);
    if (values.headless) args.push('--headless');
    args.push(entry.task);
    let output = '';
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk: Buffer) => { process.stdout.write(chunk); output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(chunk); output += chunk.toString(); });
      child.once('error', reject);
      child.once('close', resolve);
    });
    await writeFile(path.join(evaluationDir, `${entry.id}.log`), output);
    let transcript: { inputTokens?: number; outputTokens?: number; turns?: number } = {};
    const runDir = output.match(/^Run: (.+)$/m)?.[1];
    if (runDir) {
      try { transcript = JSON.parse(await readFile(path.join(runDir, 'transcript.json'), 'utf8')); } catch { /* Startup failures may have no transcript. */ }
    }
    result = { ...result, status: exitCode === 0 ? 'completed_needs_review' : 'failed', exitCode,
      elapsedMs: Math.round(performance.now() - start), runDir, inputTokens: transcript.inputTokens,
      outputTokens: transcript.outputTokens, turns: transcript.turns,
      note: 'Completion is not a quality pass; review artifacts against the saved criteria.' };
  }
  results.push(result);
  await writeFile(path.join(evaluationDir, 'results.json'), JSON.stringify({ measuredAt: new Date().toISOString(), scope: 'Full CLI wall time, including profile copy, browser startup, inference and tool execution. Blocked cases have no timing measurement.', results }, null, 2));
  console.error(`${entry.id}: ${result.status}`);
}
console.error(`Evaluation evidence: ${evaluationDir}`);
if (results.some(result => result.status !== 'completed_needs_review')) process.exitCode = 1;
