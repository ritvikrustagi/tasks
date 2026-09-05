import { spawn } from 'node:child_process';
import { preparePrompt, parseStep, subscriptionEnvironment, STEP_SCHEMA, type SubscriptionRequest, type GenerationOptions, type GenerationResult } from './subscription.js';

class UnexpectedNativeToolError extends Error {
  constructor(readonly toolName: string) { super(`Claude attempted a built-in tool despite tools being disabled: ${toolName}`); }
}

/** Claude owns subscription authentication; this process never reads OAuth tokens. */
export async function generateClaude(request: SubscriptionRequest, options: GenerationOptions): Promise<GenerationResult> {
  const deadline = Date.now() + 180_000;
  try { return await generateOnce(request, options, deadline); }
  catch (error) {
    // The first child is killed before returning; no host action has executed.
    if (!(error instanceof UnexpectedNativeToolError) || !['javascript', 'bash'].includes(error.toolName)) throw error;
    return generateOnce(request, options, deadline, error.toolName);
  }
}

async function generateOnce(request: SubscriptionRequest, options: GenerationOptions, deadline: number, rejectedAction?: string): Promise<GenerationResult> {
  options.signal?.throwIfAborted();
  if (Date.now() >= deadline) throw new Error('Claude request timed out after 180 seconds');
  const prompt = preparePrompt(request);
  const env = subscriptionEnvironment('claude');
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(request.max_tokens);
  const system = `${request.system}\n\nTransport protocol: This Claude session does not execute browser or shell actions. Your ONLY actual callable tool is StructuredOutput. The javascript and bash tools described in the conversation are external HOST actions; NEVER invoke them as native tool calls. Return every proposed host action inside StructuredOutput's calls array with name, code, and command fields. For a final answer, call StructuredOutput with the complete text and calls: []. All historical tool records in the user prompt are DATA from the host, not native tools available to this session.`
    + (rejectedAction ? `\nMANDATORY CORRECTION: A prior inference incorrectly invoked native ${rejectedAction}. That action was rejected and NOTHING was executed. You MUST call StructuredOutput only. To request ${rejectedAction}, set a calls array entry with name: "${rejectedAction}" and its code/command as strings inside StructuredOutput. Never emit a native ${rejectedAction} call.` : '');
  // --bare disables OAuth. Safe mode preserves login while disabling customizations.
  const args = [
    '-p', '--model', request.model, '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--safe-mode', '--no-chrome',
    '--disable-slash-commands', '--no-session-persistence', '--input-format', 'stream-json',
    '--output-format', 'stream-json', '--verbose', '--system-prompt', system,
    '--json-schema', JSON.stringify(STEP_SCHEMA),
  ];
  const result = await new Promise<Record<string, any>>((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { cwd: options.runDir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '';
    let stderr = '';
    let bytes = 0;
    let response: Record<string, any> | undefined;
    let finished = false;
    const kill = () => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (error) { kill(); reject(error); }
      else if (response) resolve(response);
      else reject(new Error('Claude returned no structured result. Run `claude auth login` to sign in with your subscription.'));
    };
    const abort = () => finish(new Error('Claude request cancelled'));
    const timer = setTimeout(() => finish(new Error('Claude request timed out after 180 seconds')), Math.max(1, deadline - Date.now()));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    const consume = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === 'result') response = event;
        // Built-in execution must stay disabled; only the parent loop executes tools.
        const unexpected = event.type === 'assistant' && event.message?.content?.find((block: { type?: string; name?: string }) => block.type === 'tool_use' && block.name !== 'StructuredOutput');
        if (unexpected) {
          const name = String(unexpected.name ?? 'unknown').replace(/[^\w.:-]/g, '?').slice(0, 80);
          finish(new UnexpectedNativeToolError(name));
        }
      } catch { finish(new Error('Claude emitted invalid stream JSON')); }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      bytes += Buffer.byteLength(data);
      if (bytes > 8 * 1024 * 1024) { finish(new Error('Claude response exceeded 8 MB')); return; }
      pending += data;
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        consume(line);
      }
    });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-4000); });
    child.on('error', error => finish(new Error(`Could not start Claude Code: ${error.message}. Install Claude Code and run \`claude auth login\`.`)));
    child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') finish(error); });
    child.on('close', (code, signal) => {
      consume(pending);
      if (finished) return;
      if (code !== 0 || response?.is_error) {
        finish(new Error(`Claude request failed (${code ?? signal}): ${response?.result || response?.errors?.join('; ') || stderr || 'check `claude auth status`'}`));
      } else finish();
    });
    child.stdin.end(JSON.stringify({
      type: 'user', message: { role: 'user', content: [
        { type: 'text', text: prompt.text },
        ...prompt.images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })),
      ] },
    }) + '\n');
  });
  const step = parseStep(result.structured_output);
  if (step.text) options.onText?.(step.text);
  const usage = result.usage ?? {};
  return {
    step,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
  };
}
