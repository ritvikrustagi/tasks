import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Repl, executeBash } from '../src/repl.js';
import type { BrowserSession } from '../src/browser.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const text = (blocks: Awaited<ReturnType<Repl['execute']>>) => blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');

test('persistent VM supports await, const, destructuring, functions, images, errors, and safe resume', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-repl-'));
  const page = {
    screenshot: async () => png,
    // Playwright sends the callback source into an unrelated browser JS context.
    evaluate: async (callback: Function) => vm.runInNewContext(`(${callback.toString()})()`),
  };
  const session = { page, context: { pages: () => [page] }, signals: [], visitedUrls: new Set(), openTab: async () => page, closeTab: async () => {}, close: async () => {} } as unknown as BrowserSession;
  const repl = new Repl(session, directory);
  try {
    assert.match(text(await repl.execute('const answer = await Promise.resolve(41); console.log(answer);')), /41/);
    assert.equal(text(await repl.execute('console.log(answer + 1);')), '42');
    assert.match(text(await repl.execute('answer = 5;')), /read only|Cannot assign|TypeError/);
    assert.match(text(await repl.execute('const answer = 99;')), /already been declared/);
    assert.equal(text(await repl.execute('const {one, nested: [two]} = await Promise.resolve({one: "hello", nested: [2]}); console.log(one, two);')), 'hello 2');
    assert.equal(text(await repl.execute('console.log(one, two);')), 'hello 2');
    assert.equal(text(await repl.execute('function plus(a) { return a + answer; } console.log(plus(1));')), '42');
    assert.equal(text(await repl.execute('console.log(plus(2));')), '43');
    assert.equal(text(await repl.execute('console.log(await page.evaluate(async () => { let total = 0; for (let i = 0; i < 3; i++) total += i; await Promise.resolve(); return total; }));')), '3');
    assert.equal(text(await repl.execute('const browserFn = async () => { await Promise.resolve(); let i = 0; while (i < 3) i++; return i; }; console.log(await page.evaluate(browserFn));')), '3');
    const images = await repl.execute('display(await page.screenshot());');
    assert.equal(images[0].type, 'image');
    assert.equal((await readdir(path.join(directory, 'tmp'))).length, 1);
    assert.match(text(await repl.execute('throw new Error("recoverable");')), /recoverable/);
    assert.equal(text(await repl.execute('console.log(answer);')), '41');
    assert.ok(text(await repl.execute('console.log("x".repeat(20000));')).length <= 10_000);
    assert.match(text(await repl.execute('console.log("x".repeat(20000));')), /\[truncated\]/);
    const manyLogs = text(await repl.execute('console.log("x".repeat(9987)); console.log("more");'));
    assert.ok(manyLogs.length <= 10_000);
    assert.match(manyLogs, /\[truncated\]/);
    assert.match(text(await repl.execute('console.log("x".repeat(20000)); throw new Error("visible recovery");')), /visible recovery/);
    assert.match(text(await repl.execute('console.log("<html><body>private raw DOM</body></html>");')), /Raw DOM\/CDP output omitted/);
    await repl.execute('await fs.writeFile(path.join(pwd, "side-effect.txt"), "only once"); const handle = page;');
    await repl.save();
    const saved = JSON.parse(await readFile(path.join(directory, 'repl.json'), 'utf8'));
    assert.ok(saved.skipped.includes('handle'));
    assert.ok(saved.skipped.includes('plus'));
    const resumed = new Repl(session, directory);
    await resumed.restore();
    assert.equal(text(await resumed.execute('console.log(answer, one, two);')), '41 hello 2');
    assert.match(text(await resumed.execute('answer = 2;')), /read only|Cannot assign|TypeError/);
    assert.equal(await readFile(path.join(directory, 'side-effect.txt'), 'utf8'), 'only once');
    await resumed.close();
  } finally {
    await repl.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('bash runs in run directory and bounds stdout/stderr', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-bash-'));
  try {
    assert.match((await executeBash('pwd; printf error >&2; exit 3', directory))[0].text, /Exit: 3/);
    assert.ok((await executeBash('pwd', directory))[0].text.includes(directory));
    const large = (await executeBash("node -e 'process.stdout.write(\"a\".repeat(20000))'", directory))[0].text;
    assert.ok(large.length <= 10_000);
    assert.match(large, /\[truncated\]/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('post-await CPU loops obey deadline and preserve the previous checkpoint', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-timeout-'));
  let repl: Repl;
  const page = { expire: () => { (repl as unknown as { deadline: number }).deadline = 0; } };
  const session = { page, context: { pages: () => [page] }, signals: [] } as unknown as BrowserSession;
  repl = new Repl(session, directory);
  try {
    await repl.execute('const checkpoint = 7;');
    await repl.save();
    const before = await readFile(path.join(directory, 'repl.json'), 'utf8');
    assert.match(text(await repl.execute('await Promise.resolve(); while (true) { page.expire(); }')), /exceeded 120 seconds/);
    assert.match(text(await repl.execute('console.log("should not run")')), /stopped after a timeout/);
    await repl.save();
    assert.equal(await readFile(path.join(directory, 'repl.json'), 'utf8'), before);
  } finally { await repl.close(); await rm(directory, { recursive: true, force: true }); }
});
