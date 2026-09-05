import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { citationProblems, elideOldToolResults, runAgent, SYSTEM_PROMPT, TOOLS, type AgentOptions } from '../src/agent.js';

function response(content: unknown[], stop_reason = 'end_turn') {
  return { content, stop_reason, usage: { input_tokens: 10, output_tokens: 5 } } as Anthropic.Message;
}

async function harness(responses: Array<Anthropic.Message | Error>, visitedUrls = new Set(['https://example.com/'])) {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'browser-agent-loop-'));
  const requests: Anthropic.MessageParam[][] = [];
  const executions: string[] = [];
  const options = {
    task: 'Read the example page', model: 'test-model', runDir, resume: false,
    session: { visitedUrls, signals: ['popup opened: https://example.com/'] },
    repl: { execute: async (code: string) => { executions.push(code); return [{ type: 'text', text: 'Example page' }]; }, save: async () => {} },
    client: { messages: { stream: (request: { messages: Anthropic.MessageParam[] }) => {
      requests.push(structuredClone(request.messages));
      const result = responses.shift();
      return { on() {}, finalMessage: async () => { if (result instanceof Error) throw result; if (!result) throw new Error('Unexpected API call'); return result; } };
    } } },
  } as unknown as AgentOptions;
  return { options, requests, executions, clean: () => rm(runDir, { recursive: true, force: true }) };
}

test('two small tool schemas and citation verification reject unvisited sources', () => {
  assert.deepEqual(TOOLS.map(tool => tool.name), ['javascript', 'bash']);
  assert.ok((SYSTEM_PROMPT + JSON.stringify(TOOLS)).length < 12_000);
  const visited = new Set(['https://example.com/']);
  assert.deepEqual(citationProblems('Read [Example](https://example.com/#section).', visited), []);
  assert.match(citationProblems('https://invented.example/', visited)[0]!, /Unvisited/);
  assert.match(citationProblems('An unsupported answer.', visited)[0]!, /no source URLs/);
  assert.match(citationProblems('An unsupported answer.', new Set())[0]!, /no source URLs/);
  const complex = new Set(['https://example.com/wiki/Example_(topic)', 'https://example.com/search?q=what?!', 'https://example.com/odd)']);
  assert.deepEqual(citationProblems('Read [Article](https://example.com/wiki/Example_(topic)) and [Search](https://example.com/search?q=what?!) or <https://example.com/odd)>.', complex), []);
  assert.deepEqual(citationProblems('Source: https://example.com/wiki/Example_(topic). Query: https://example.com/search?q=what?!.', complex), []);
  assert.match(citationProblems('[Changed query](https://example.com/search?q=what?)', complex)[0]!, /Unvisited/);
  assert.deepEqual(citationProblems('[Filters](https://example.com/?tags[]=news) and <http://[::1]/>', new Set(['https://example.com/?tags[]=news', 'http://[::1]/'])), []);
  assert.match(citationProblems('[https://example.com/](https://invented.example/)', visited)[0]!, /Unvisited/);
});

test('executes tools, prepends async signals, persists transcript and returns verified result', async () => {
  const h = await harness([
    response([{ type: 'tool_use', id: 'tool-1', name: 'javascript', input: { code: 'console.log(await readPage(page))' } }], 'tool_use'),
    response([{ type: 'text', text: 'Example result. [Source](https://example.com/)' }]),
  ]);
  try {
    const result = await runAgent(h.options);
    assert.equal(result.turns, 2);
    assert.equal(result.inputTokens, 20);
    assert.equal(h.executions.length, 1);
    const toolResult = h.requests[1]!.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    assert.match(JSON.stringify(toolResult), /\[signal\] popup opened/);
    const saved = JSON.parse(await readFile(path.join(h.options.runDir, 'transcript.json'), 'utf8'));
    assert.equal(saved.status, 'complete');
    assert.deepEqual(saved.visitedUrls, ['https://example.com/']);
    const resumed = await runAgent({ ...h.options, task: '', resume: true });
    assert.equal(resumed.answer, result.answer);
    assert.equal(h.requests.length, 2);
  } finally { await h.clean(); }
});

test('asks for correction rather than accepting a fabricated citation', async () => {
  const h = await harness([
    response([{ type: 'text', text: 'See https://invented.example/' }]),
    response([{ type: 'text', text: 'Verified https://example.com/' }]),
  ]);
  try {
    assert.match((await runAgent(h.options)).answer, /example.com/);
    assert.match(JSON.stringify(h.requests[1]), /Source verification failed/);
  } finally { await h.clean(); }
});

test('never returns an unverified final answer after bounded corrections', async () => {
  const h = await harness(Array.from({ length: 3 }, () => response([{ type: 'text', text: 'https://invented.example/' }])));
  try {
    await assert.rejects(runAgent(h.options), /failed source verification/);
    assert.equal(h.requests.length, 3);
    const saved = JSON.parse(await readFile(path.join(h.options.runDir, 'transcript.json'), 'utf8'));
    assert.equal(saved.status, 'failed');
    assert.match(saved.error, /Unvisited source/);
    await assert.rejects(readFile(path.join(h.options.runDir, 'artifacts', 'answer.md')), { code: 'ENOENT' });
  } finally { await h.clean(); }
});

test('repairs interrupted partial tool batches without repeating actions', async () => {
  const h = await harness([response([{ type: 'text', text: 'Recovered https://example.com/' }])]);
  try {
    await writeFile(path.join(h.options.runDir, 'transcript.json'), JSON.stringify({
      version: 1, task: 'Original task', model: 'test-model', turns: 1, inputTokens: 10, outputTokens: 5,
      visitedUrls: ['https://example.com/'], status: 'running',
      messages: [
        { role: 'user', content: 'Original task' },
        { role: 'assistant', content: [
          { type: 'tool_use', id: 'done', name: 'javascript', input: { code: 'done()' } },
          { type: 'tool_use', id: 'unknown', name: 'javascript', input: { code: 'unknown()' } },
        ] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'done', content: 'Finished' }] },
      ],
    }));
    await runAgent({ ...h.options, task: '', resume: true });
    assert.equal(h.executions.length, 0);
    const repaired = h.requests[0]![2]!.content as Anthropic.ToolResultBlockParam[];
    assert.equal(repaired.length, 2);
    assert.equal(repaired[1]!.tool_use_id, 'unknown');
    assert.equal(repaired[1]!.is_error, true);
    assert.match(String(repaired[1]!.content), /may have happened/);
  } finally { await h.clean(); }
});

test('abort between batched tools saves the completed result and skips the next action', async () => {
  const h = await harness([response([
    { type: 'tool_use', id: 'first', name: 'javascript', input: { code: 'firstAction()' } },
    { type: 'tool_use', id: 'second', name: 'javascript', input: { code: 'secondAction()' } },
  ], 'tool_use')]);
  const controller = new AbortController();
  h.options.signal = controller.signal;
  const execute = h.options.repl.execute.bind(h.options.repl);
  h.options.repl.execute = async code => { const result = await execute(code); controller.abort(); return result; };
  try {
    await assert.rejects(runAgent(h.options), { name: 'AbortError' });
    assert.deepEqual(h.executions, ['firstAction()']);
    const saved = JSON.parse(await readFile(path.join(h.options.runDir, 'transcript.json'), 'utf8'));
    assert.equal(saved.status, 'failed');
    assert.equal(saved.messages.at(-1).content[0].tool_use_id, 'first');
    assert.equal(saved.messages.at(-1).content.length, 1);
  } finally { await h.clean(); }
});

test('an already aborted run makes no API request or tool call', async () => {
  const h = await harness([]);
  try {
    await assert.rejects(runAgent({ ...h.options, signal: AbortSignal.abort() }), { name: 'AbortError' });
    assert.equal(h.requests.length, 0);
    assert.equal(h.executions.length, 0);
  } finally { await h.clean(); }
});

test('retries transient API failure before executing any tool', async () => {
  const error = Object.assign(new Error('busy'), { status: 429 });
  const h = await harness([error, response([{ type: 'text', text: 'https://example.com/' }])]);
  try {
    assert.equal((await runAgent(h.options)).turns, 1);
    assert.equal(h.requests.length, 2);
    assert.equal(h.executions.length, 0);
  } finally { await h.clean(); }
});

test('naive context elision keeps recent tool results and tool IDs intact', () => {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Task' }];
  for (let index = 0; index < 8; index++) messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: String(index), content: 'Large output' }] });
  elideOldToolResults(messages);
  const old = (messages[1]!.content as Anthropic.ToolResultBlockParam[])[0]!;
  assert.equal(old.content, '[older tool output elided]');
  assert.equal(old.tool_use_id, '0');
  assert.equal((messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!.content, 'Large output');
});
