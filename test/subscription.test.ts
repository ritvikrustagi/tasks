import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStep, preparePrompt, subscriptionEnvironment } from '../src/subscription.js';

test('subscription steps preserve the two-tool contract and attach screenshots outside JSON history', () => {
  const call = { name: 'javascript', code: 'console.log(1)', command: '' };
  assert.deepEqual(parseStep({ text: 'Read page', calls: [call] }).calls, [call]);
  assert.throws(() => parseStep({ text: '', calls: [] }), /empty/);
  assert.throws(() => parseStep({ text: '', calls: [{ ...call, name: 'navigate' }] }), /invalid/);
  assert.throws(() => parseStep({ text: '', calls: [{ ...call, code: '' }] }), /invalid/);
  const prompt = preparePrompt({ model: 'default', system: 'Browser agent', tools: [], max_tokens: 100,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }] }] });
  assert.equal(prompt.images[0].data, 'aW1hZ2U=');
  assert.ok(!prompt.text.includes('aW1hZ2U='));
  assert.match(prompt.text, /Screenshot 1/);
  assert.match(prompt.text, /Describe this/);
  const history = preparePrompt({ model: 'default', system: '', tools: [], max_tokens: 100, messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call1', name: 'javascript', input: { code: 'console.log(1)' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: '1', is_error: false }] },
  ] });
  assert.match(history.text, /external_host_action/); assert.match(history.text, /external_host_result/);
  assert.ok(!history.text.includes('"type":"tool_use"')); assert.ok(!history.text.includes('"type":"tool_result"'));
  assert.match(history.text, /console.log\(1\)/);
});

test('subscription subprocess environment cannot silently select API credentials', () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = 'test-only'; process.env.OPENAI_API_KEY = 'test-only';
    for (const provider of ['claude', 'chatgpt'] as const) {
      const env = subscriptionEnvironment(provider);
      assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
      assert.equal(env.HOME, process.env.HOME); assert.equal(env.CODEX_HOME, process.env.CODEX_HOME);
    }
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous;
    if (openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = openai;
  }
});
