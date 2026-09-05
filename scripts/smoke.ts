import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBrowser } from '../src/browser.js';
import { snapshot } from '../src/snapshot.js';
import { Repl } from '../src/repl.js';

const runDir = path.resolve('runs', `smoke-${new Date().toISOString().replaceAll(':', '-')}`);
const profile = path.join(runDir, 'empty-source-profile');
await mkdir(profile, { recursive: true });
const started = performance.now();
const session = await createBrowser({ profile, headed: !process.argv.includes('--headless'), runDir });
const repl = new Repl(session, runDir);
try {
  await session.openTab('https://news.ycombinator.com');
  const first = await snapshot(session.page);
  assert.ok(first.tree.length < 8_000, `Hacker News snapshot too large: ${first.tree.length} chars`);
  const ref = first.tree.match(/link "new" \[ref=((?:f\d+)?e\d+)\]/)?.[1];
  assert.ok(ref, 'Hacker News new-post navigation ref is missing');
  await session.page.locator(ref).click();
  await session.page.waitForURL('**/newest');
  const next = await snapshot(session.page);
  assert.notEqual(next.diff, '[no changes]');
  const setup = await repl.execute('const savedNumber = 41; const savedTab = page; console.log(savedNumber);');
  assert.ok(setup.some(block => block.type === 'text' && block.text.includes('41')));
  const reuse = await repl.execute('console.log(savedNumber + 1); await display(await savedTab.screenshot());');
  assert.ok(reuse.some(block => block.type === 'text' && block.text.includes('42')));
  assert.ok(reuse.some(block => block.type === 'image'), 'Screenshot did not become an image tool result');
  await repl.save();
  const restored = new Repl(session, runDir);
  try {
    await restored.restore();
    const output = await restored.execute('console.log(savedNumber + 2)');
    assert.ok(output.some(block => block.type === 'text' && block.text.includes('43')));
  } finally { await restored.close(); }
  const evidence = { status: 'passed', measuredAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
    checks: ['Live Hacker News snapshot under ~2K estimated tokens', 'Clicked new-post link through a snapshot ref', 'Post-action diff changed', 'Sequential REPL calls preserve const binding and Page handle', 'Screenshot returned as an image content block', 'JSON binding saved and restored'],
    snapshotChars: first.tree.length, estimatedSnapshotTokens: Math.ceil(first.tree.length / 4),
    visitedUrls: [...session.visitedUrls], note: 'Deterministic browser integration smoke; not an unattended model acceptance task.' };
  await writeFile(path.join(runDir, 'artifacts', 'smoke.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${runDir}`);
} finally { await repl.close(); await session.close(); }
