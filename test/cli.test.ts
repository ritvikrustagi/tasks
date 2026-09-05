import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('CLI explains arguments and validates incompatible browser flags before launching', () => {
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { encoding: 'utf8' });
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--continue/);
  assert.match(help.stdout, /--profile/);
  const invalid = run(['--headless', '--headed', 'test']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Choose either/);
  const badTurns = run(['--max-turns', '0', 'test']);
  assert.equal(badTurns.status, 1);
  assert.match(badTurns.stderr, /positive integer/);
});
