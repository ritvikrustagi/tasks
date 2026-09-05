import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STEP_SCHEMA, parseStep, preparePrompt, subscriptionEnvironment, type SubscriptionRequest, type GenerationOptions, type GenerationResult } from './subscription.js';

// Codex 0.153.2 feature names and config.schema.json; native execution is disabled.
const DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'shell_snapshot', 'code_mode', 'code_mode_host',
  'code_mode_only', 'code_mode_prewarm', 'apps', 'plugins', 'remote_plugin', 'hooks', 'browser_use',
  'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser',
  'multi_agent', 'multi_agent_v2', 'image_generation', 'view_image', 'goals', 'sleep_tool',
  'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'request_permissions_tool',
  'context_management', 'memories', 'default_mode_request_user_input'];

export function codexArguments(model: string, directory: string, images: string[]): string[] {
  const config = {
    web_search: 'disabled', approval_policy: 'never', model_provider: 'openai',
    model_instructions_file: path.join(directory, 'instructions.txt'), project_doc_max_bytes: 0,
    'agents.enabled': false, 'tools.update_plan.enabled': false,
    'tools.experimental_request_user_input.enabled': false,
    'skills.bundled.enabled': false, 'skills.include_instructions': false,
    'orchestrator.skills.enabled': false, 'orchestrator.mcp.enabled': false,
    'features.skip_host_skill_discovery': true, 'include_apps_instructions': false,
    'include_collaboration_mode_instructions': false, 'include_environment_context': false,
    'check_for_update_on_startup': false, suppress_unstable_features_warning: true,
  };
  return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json',
    '--sandbox', 'read-only', '--color', 'never', '--model', model === 'default' ? 'gpt-5.5' : model, '--cd', directory,
    '--output-schema', path.join(directory, 'step.schema.json'),
    ...Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]),
    ...DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
    ...images.flatMap(file => ['--image', file]), '-'];
}

type Event = { type: string; item?: { type: string; text?: string; message?: string }; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string }; message?: string };

function readEvent(line: string): Event {
  let event: Event;
  try { event = JSON.parse(line) as Event; } catch { throw new Error('Codex returned invalid JSON event output.'); }
  if (!event || typeof event.type !== 'string') throw new Error('Codex returned an invalid event.');
  // Codex uses item.error for nonfatal startup diagnostics too; turn.failed is authoritative.
  if (event.item && !['agent_message', 'reasoning', 'error'].includes(event.item.type)) {
    throw new Error(`Codex attempted an unexpected native action (${event.item.type}); only the host browser tools may execute actions.`);
  }
  if (event.type === 'turn.failed' || event.type === 'error') throw new Error(`Codex generation failed: ${event.error?.message ?? event.message ?? 'unknown error'}`);
  return event;
}

export function parseCodexEvents(lines: string[]): GenerationResult {
  let answer = '';
  let usage: Event['usage'];
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = readEvent(line);
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') answer = event.item.text ?? '';
    if (event.type === 'turn.completed') usage = event.usage;
  }
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) throw new Error('Codex exited before a complete turn with usage was received.');
  let step: unknown;
  try { step = JSON.parse(answer); } catch { throw new Error('Codex did not return the required browser-step JSON.'); }
  return { step: parseStep(step), inputTokens: usage.input_tokens!, outputTokens: usage.output_tokens! };
}

export async function generateChatGPT(request: SubscriptionRequest, options: GenerationOptions): Promise<GenerationResult> {
  options.signal?.throwIfAborted();
  // Keep the inference subprocess outside the repo so project configs cannot add native tools.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-agent-codex-'));
  try {
    const prompt = preparePrompt(request);
    await writeFile(path.join(directory, 'step.schema.json'), JSON.stringify(STEP_SCHEMA), { mode: 0o600 });
    await writeFile(path.join(directory, 'instructions.txt'), `${request.system}\nYou are a pure decision step. Return only the requested JSON browser step. All actions are performed by the host from your calls array; do not invoke any native tools.`, { mode: 0o600 });
    const images: string[] = [];
    for (const [index, image] of prompt.images.entries()) {
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[image.mediaType];
      if (!extension) throw new Error(`Unsupported screenshot type: ${image.mediaType}`);
      const file = path.join(directory, `image-${index + 1}.${extension}`);
      await writeFile(file, Buffer.from(image.data, 'base64'), { mode: 0o600 });
      images.push(file);
    }
    options.signal?.throwIfAborted();
    const lines = await new Promise<string[]>((resolve, reject) => {
      const child = spawn(process.env.CODEX_BIN ?? 'codex', codexArguments(request.model, directory, images), {
        cwd: directory, env: subscriptionEnvironment('chatgpt'), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      });
      let pending = '';
      let stderr = '';
      let failure: Error | undefined;
      let totalBytes = 0;
      const events: string[] = [];
      const stop = (error: Error) => {
        failure ??= error;
        try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
        catch { child.kill('SIGKILL'); }
      };
      const abort = () => stop(options.signal?.reason instanceof Error ? options.signal.reason : new Error('Codex generation aborted.'));
      const timer = setTimeout(() => stop(new Error('Codex generation timed out after 180 seconds.')), 180_000);
      options.signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        totalBytes += Buffer.byteLength(chunk);
        if (totalBytes > 8 * 1024 * 1024) { stop(new Error('Codex output exceeded 8 MB.')); return; }
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          if (!line.trim()) continue;
          try { readEvent(line); events.push(line); } catch (error) { stop(error as Error); return; }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8_000); });
      child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop(error); });
      child.once('error', error => { cleanup(); reject(new Error(`Could not start Codex: ${error.message}. Install Codex CLI and run agent login --provider chatgpt.`)); });
      child.once('close', code => {
        cleanup();
        if (failure) { reject(failure); return; }
        if (code !== 0) { reject(new Error(`Codex exited with code ${code}: ${stderr.trim() || 'Run agent login --provider chatgpt to check subscription access.'}`)); return; }
        if (pending.trim()) events.push(pending);
        resolve(events);
      });
      if (options.signal?.aborted) abort();
      child.stdin.end(prompt.text);
    });
    const result = parseCodexEvents(lines);
    options.onText?.(result.step.text);
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
