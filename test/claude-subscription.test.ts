import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateClaude } from '../src/claude-subscription.js';
import type { SubscriptionRequest } from '../src/subscription.js';

const request: SubscriptionRequest = {
  model: 'sonnet', system: 'Only produce the requested next step.', tools: [], max_tokens: 1024,
  messages: [{ role: 'user', content: [
    { type: 'text', text: 'Inspect this screenshot.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
  ] }],
};

test('Claude subscription CLI isolates tools and keys, transports images, validates output, and cancels', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-subscription-'));
  const previous = { PATH: process.env.PATH, CLAUDE_BIN: process.env.CLAUDE_BIN, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, CLAUDE_TEST_MODE: process.env.CLAUDE_TEST_MODE };
  try {
    const executable = path.join(directory, 'claude');
    await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', part => input += part);
process.stdin.on('end', () => {
  const attempts = Number(fs.existsSync('attempts.txt') ? fs.readFileSync('attempts.txt', 'utf8') : 0) + 1;
  fs.writeFileSync('attempts.txt', String(attempts));
  fs.writeFileSync('capture.json', JSON.stringify({ args: process.argv.slice(2), input: JSON.parse(input), hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY), maxTokens: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS }));
  if ((['retry', 'retry-bash'].includes(process.env.CLAUDE_TEST_MODE) && attempts === 1) || process.env.CLAUDE_TEST_MODE === 'retry-always') { console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:process.env.CLAUDE_TEST_MODE === 'retry-bash' ? 'bash' : 'javascript'}]}})); setInterval(() => {}, 1000); return; }
  if (process.env.CLAUDE_TEST_MODE === 'slow') { setInterval(() => {}, 1000); return; }
  if (process.env.CLAUDE_TEST_MODE === 'tool') { console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Bash'}]}})); setInterval(() => {}, 1000); return; }
  if (process.env.CLAUDE_TEST_MODE === 'invalid') { console.log(JSON.stringify({type:'result',structured_output:{text:3,calls:[]}})); return; }
  console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Do not leak raw JSON: {"text":"draft"}'}]}}));
  const line = JSON.stringify({type:'result',is_error:false,structured_output:{text:'Ready.',calls:[{name:'javascript',code:'console.log(1)',command:''}]},usage:{input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:30,output_tokens:4}});
  process.stdout.write(line.slice(0, 20));
  setTimeout(() => process.stdout.write(line.slice(20) + '\\n'), 5);
});
`);
    await chmod(executable, 0o755);
    process.env.PATH = `${directory}${path.delimiter}${previous.PATH}`;
    process.env.CLAUDE_BIN = executable;
    process.env.ANTHROPIC_API_KEY = 'fake-key-that-must-not-reach-the-cli';
    const output: string[] = [];
    const generated = await generateClaude(request, { runDir: directory, onText: text => output.push(text) });
    assert.equal(generated.step.calls[0].code, 'console.log(1)');
    assert.equal(generated.inputTokens, 60);
    assert.equal(generated.outputTokens, 4);
    assert.deepEqual(output, ['Ready.']);
    const capture = JSON.parse(await readFile(path.join(directory, 'capture.json'), 'utf8'));
    assert.equal(capture.hasApiKey, false);
    assert.equal(capture.maxTokens, '1024');
    assert.equal(capture.args[capture.args.indexOf('--tools') + 1], '');
    assert.equal(capture.args[capture.args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
    assert.match(capture.args[capture.args.indexOf('--system-prompt') + 1], /ONLY actual callable tool is StructuredOutput/);
    assert.ok(capture.args.includes('--safe-mode'));
    assert.ok(!capture.args.includes('--bare'));
    assert.equal(capture.input.message.content[1].source.data, 'aGVsbG8=');
    assert.ok(capture.input.message.content[0].text.includes('Inspect this screenshot.'));
    process.env.CLAUDE_TEST_MODE = 'invalid';
    await assert.rejects(generateClaude(request, { runDir: directory }), /invalid|schema|text/i);
    process.env.CLAUDE_TEST_MODE = 'tool';
    await writeFile(path.join(directory, 'attempts.txt'), '0');
    await assert.rejects(generateClaude(request, { runDir: directory }), /built-in tool.*Bash/);
    assert.equal(await readFile(path.join(directory, 'attempts.txt'), 'utf8'), '1');
    for (const mode of ['retry', 'retry-bash']) {
      process.env.CLAUDE_TEST_MODE = mode;
      await writeFile(path.join(directory, 'attempts.txt'), '0');
      const retried = await generateClaude(request, { runDir: directory });
      assert.equal(retried.step.text, 'Ready.');
      assert.equal(await readFile(path.join(directory, 'attempts.txt'), 'utf8'), '2');
      const retryCapture = JSON.parse(await readFile(path.join(directory, 'capture.json'), 'utf8'));
      assert.match(retryCapture.args[retryCapture.args.indexOf('--system-prompt') + 1], /MANDATORY CORRECTION/);
    }
    process.env.CLAUDE_TEST_MODE = 'retry-always';
    await writeFile(path.join(directory, 'attempts.txt'), '0');
    await assert.rejects(generateClaude(request, { runDir: directory }), /built-in tool.*javascript/);
    assert.equal(await readFile(path.join(directory, 'attempts.txt'), 'utf8'), '2');
    process.env.CLAUDE_TEST_MODE = 'slow';
    await assert.rejects(generateClaude(request, { runDir: directory, signal: AbortSignal.timeout(100) }), /cancelled/);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
