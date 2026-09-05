import assert from 'node:assert/strict';
import test from 'node:test';
import { codexArguments, parseCodexEvents } from '../src/chatgpt-subscription.js';

test('Codex adapter disables native actions and enables isolated subscription execution', () => {
  const args = codexArguments('gpt-5.4', '/tmp/inference', ['/tmp/shot.png']);
  for (const flag of ['--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json', '--output-schema']) assert.ok(args.includes(flag));
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'browser_use', 'computer_use', 'multi_agent', 'view_image', 'code_mode_host']) assert.ok(args.some((arg, index) => arg === '--disable' && args[index + 1] === feature));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes('tools.update_plan.enabled=false'));
  assert.ok(args.includes('read-only'));
  assert.equal(args.at(-1), '-');
  assert.ok(codexArguments('default', '/tmp/inference', []).includes('gpt-5.5'));
});

test('Codex event parser returns a validated host tool step and token usage', () => {
  const result = parseCodexEvents([
    JSON.stringify({ type: 'thread.started', thread_id: 'example' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'error', message: 'Code Mode is unavailable because its host is disabled.' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'Choose the next step.' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ text: 'Opening the page.', calls: [{ name: 'javascript', code: 'await openTab("https://example.com")', command: '' }] }) } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30 } }),
  ]);
  assert.equal(result.step.calls[0]?.name, 'javascript');
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 30);
});

test('Codex event parser rejects native tool execution, malformed output, and unfinished turns', () => {
  for (const type of ['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'plan']) {
    assert.throws(() => parseCodexEvents([JSON.stringify({ type: 'item.started', item: { type } })]), /unexpected native action/);
  }
  assert.throws(() => parseCodexEvents(['broken JSON']), /invalid JSON/);
  assert.throws(() => parseCodexEvents([]), /complete turn/);
  assert.throws(() => parseCodexEvents([JSON.stringify({ type: 'turn.failed', error: { message: 'Limit reached' } })]), /Limit reached/);
});
