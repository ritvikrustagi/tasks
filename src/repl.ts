import vm from 'node:vm';
import fs from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import type Anthropic from '@anthropic-ai/sdk';
import type { BrowserSession } from './browser.js';
import { snapshot, readPage } from './snapshot.js';

type Block = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;
const OUTPUT_LIMIT = 10_000;
const CALL_TIMEOUT = 120_000;
const truncate = (value: string) => value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT - 13)}\n[truncated]` : value;

// Page observations must go through the pruned accessibility/text helpers.
function safeText(value: string): string {
  return /<(?:!doctype|html|body|script|div|span|a|button|input)\b[^>]*>|<\/[a-z][\w-]*\s*>/i.test(value)
    || /["\']?(?:nodeId|backendNodeId|documentURL)["\']?\s*:/.test(value)
    ? '[Raw DOM/CDP output omitted. Use snapshot(page) or readPage(page).]' : value;
}

function names(binding: ts.BindingName): string[] {
  return ts.isIdentifier(binding) ? [binding.text] : binding.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : names(element.name));
}

/** The async wrapper writes top-level declarations into the persistent VM global. */
function prepare(code: string): { code: string; declarations: { name: string; constant: boolean }[] } {
  const source = ts.createSourceFile('repl.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations: { name: string; constant: boolean }[] = [];
  const f = ts.factory;
  // Stored callbacks can later be serialized by Playwright, outside this VM.
  const check = (expression?: ts.Expression) => f.createConditionalExpression(
    f.createStrictEquality(f.createTypeOfExpression(f.createIdentifier('__replCheck')), f.createStringLiteral('function')),
    undefined, f.createCallExpression(f.createIdentifier('__replCheck'), undefined, expression ? [expression] : []),
    undefined, expression ?? f.createVoidZero(),
  );
  const guard = () => f.createExpressionStatement(check());
  const transformed = ts.transform(source, [context => {
    const visit: ts.Visitor = node => {
      // Browser callbacks have Playwright timeouts; VM guards cannot stop their CPU work.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && /^(evaluate|evaluateAll|evaluateHandle|waitForFunction|\$eval|\$\$eval)$/.test(node.expression.name.text)) {
        return f.updateCallExpression(node, ts.visitNode(node.expression, visit) as ts.Expression, node.typeArguments,
          node.arguments.map(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
            ? argument : ts.visitNode(argument, visit) as ts.Expression));
      }
      const next = ts.visitEachChild(node, visit, context);
      if (ts.isAwaitExpression(next)) return check(next);
      if (ts.isForStatement(next) || ts.isForOfStatement(next) || ts.isForInStatement(next) || ts.isWhileStatement(next) || ts.isDoStatement(next)) {
        const body = f.createBlock([guard(), ...(ts.isBlock(next.statement) ? next.statement.statements : [next.statement])], true);
        if (ts.isForStatement(next)) return f.updateForStatement(next, next.initializer, next.condition, next.incrementor, body);
        if (ts.isForOfStatement(next)) return f.updateForOfStatement(next, next.awaitModifier, next.initializer, next.expression, body);
        if (ts.isForInStatement(next)) return f.updateForInStatement(next, next.initializer, next.expression, body);
        if (ts.isWhileStatement(next)) return f.updateWhileStatement(next, next.expression, body);
        return f.updateDoStatement(next, body, next.expression);
      }
      return next;
    };
    return file => ts.visitNode(file, visit) as ts.SourceFile;
  }]);
  const file = transformed.transformed[0] as ts.SourceFile;
  const printer = ts.createPrinter();
  const print = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, file);
  const output = file.statements.map(node => {
    if (ts.isVariableStatement(node)) {
      const constant = Boolean(node.declarationList.flags & ts.NodeFlags.Const);
      return node.declarationList.declarations.map(declaration => {
        const identifiers = names(declaration.name);
        declarations.push(...identifiers.map(name => ({ name, constant })));
        return `(${print(declaration.name)} = ${declaration.initializer ? print(declaration.initializer) : 'undefined'});\n`
          + (constant ? identifiers.map(name => `__replFreeze(${JSON.stringify(name)});`).join('\n') : '');
      }).join('\n');
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      declarations.push({ name: node.name.text, constant: false });
      return `${node.name.text} = ${print(node)};`;
    }
    return print(node);
  }).join('\n');
  transformed.dispose();
  return { code: output, declarations };
}

export class Repl {
  private readonly context: vm.Context;
  private readonly bindings = new Map<string, boolean>();
  private output: Block[] = [];
  private textLength = 0;
  private deadline = Infinity;
  private expired = false;

  constructor(private readonly session: BrowserSession, readonly runDir: string) {
    mkdirSync(path.join(runDir, 'tmp'), { recursive: true });
    mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
    const log = (...values: unknown[]) => this.log(safeText(format(...values)));
    this.context = vm.createContext({
      console: { log, info: log, warn: log, error: log, dir: log },
      openTab: (url?: string) => session.openTab(url),
      closeTab: (tab: Parameters<BrowserSession['closeTab']>[0]) => session.closeTab(tab),
      snapshot: async (page = session.page, options?: Parameters<typeof snapshot>[1]) => {
        const result = await snapshot(page, options);
        if (result.tree.trim().length < 30) {
          log('Accessibility tree has little content. Screenshot fallback: inspect the image and use page.mouse.click(x, y), then snapshot again.');
          this.display(await page.screenshot());
        }
        return result;
      },
      readPage: (page = session.page) => readPage(page),
      display: (data: Buffer | string) => this.display(data),
      fetch, fs, path, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder,
      sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(Math.max(ms, 0), CALL_TIMEOUT))),
      pwd: path.resolve(runDir),
      __replCheck: (value?: unknown) => { if (this.expired || Date.now() >= this.deadline) throw new Error('REPL call exceeded 120 seconds'); return value; },
      __replFreeze: (name: string) => this.freeze(name),
    });
    Object.defineProperties(this.context, {
      page: { get: () => session.page, configurable: false },
      tabs: { get: () => session.context.pages(), configurable: false },
    });
  }

  private freeze(name: string): void {
    const value = this.context[name];
    Object.defineProperty(this.context, name, { get: () => value, set: () => { throw new TypeError(`Cannot assign to constant '${name}'`); }, enumerable: true, configurable: true });
  }

  private log(text: string): void {
    if (this.expired || this.textLength >= OUTPUT_LIMIT) return;
    const remaining = Math.max(0, OUTPUT_LIMIT - this.textLength - 13);
    const bounded = text.length > remaining ? `${text.slice(0, remaining)}\n[truncated]` : text;
    this.output.push({ type: 'text', text: bounded });
    this.textLength = text.length > remaining ? OUTPUT_LIMIT : this.textLength + bounded.length;
  }

  private display(data: Buffer | string): void {
    if (this.expired) return;
    const buffer = typeof data === 'string' ? Buffer.from(data.replace(/^data:image\/[^;]+;base64,/, ''), 'base64') : Buffer.from(data);
    const media = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : buffer[0] === 0xff && buffer[1] === 0xd8 ? 'image/jpeg'
      : buffer.subarray(0, 3).toString() === 'GIF' ? 'image/gif'
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined;
    if (!media) throw new Error('display expects a PNG, JPEG, GIF, or WebP buffer/base64 string');
    if (buffer.length > 5 * 1024 * 1024) throw new Error('Image exceeds 5 MB; screenshot a smaller area or use JPEG');
    const filename = path.join(this.runDir, 'tmp', `${randomUUID()}.${media.split('/')[1]}`);
    writeFileSync(filename, buffer);
    this.output.push({ type: 'image', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } });
  }

  async execute(code: string): Promise<Block[]> {
    if (this.expired) return [{ type: 'text', text: 'REPL stopped after a timeout. Start or continue a run to create a fresh context.' }];
    this.output = [];
    this.textLength = 0;
    this.deadline = Date.now() + CALL_TIMEOUT;
    let timer: NodeJS.Timeout | undefined;
    try {
      const prepared = prepare(code);
      const seen = new Set<string>();
      for (const binding of prepared.declarations) {
        if (seen.has(binding.name) || binding.name in this.context || this.bindings.has(binding.name)) throw new SyntaxError(`Identifier '${binding.name}' has already been declared; use a new variable name`);
        seen.add(binding.name);
      }
      const script = new vm.Script(`(async () => { "use strict";\n${prepared.code}\n})()`, { filename: 'agent-repl.js' });
      for (const binding of prepared.declarations) {
        Object.defineProperty(this.context, binding.name, { value: undefined, writable: true, enumerable: true, configurable: true });
        this.bindings.set(binding.name, binding.constant);
      }
      const pending = script.runInContext(this.context, { timeout: CALL_TIMEOUT }) as Promise<unknown>;
      await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REPL call exceeded 120 seconds')), CALL_TIMEOUT); })]);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const locatorFailure = /locator|strict mode violation|element.*(?:visible|attached)|waiting for.*(?:selector|element)/i.test(message);
      if (this.textLength > OUTPUT_LIMIT / 2 || (locatorFailure && this.textLength > 0)) {
        this.output = this.output.filter(block => block.type === 'image');
        this.textLength = 0;
        this.log('[Earlier console output omitted to show error recovery]');
      }
      this.log(safeText(message));
      if (/exceeded 120 seconds|Script execution timed out/.test(message)) this.expired = true;
      else if (locatorFailure) {
        try { this.log(`Fresh interactive snapshot:\n${(await snapshot(this.session.page, { interactive: true })).tree}`); }
        catch (snapshotError) { this.log(`Snapshot recovery failed: ${String(snapshotError)}. Try display(await page.screenshot()) and page.mouse.click(x, y).`); }
      }
    } finally {
      clearTimeout(timer);
      this.deadline = Infinity;
    }
    return this.output.length ? this.output : [{ type: 'text', text: 'Completed with no console output.' }];
  }

  async save(): Promise<void> {
    if (this.expired) return;
    const values: Record<string, { value: unknown; constant: boolean }> = {};
    const skipped: string[] = [];
    for (const [name, constant] of this.bindings) {
      const value = this.context[name];
      try {
        const json = JSON.stringify(value, (_key, entry) => {
          if (typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint' || entry === undefined) throw new Error('Not JSON-serializable');
          if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.prototype.toString.call(entry) !== '[object Object]') throw new Error('Not a plain JSON value');
          return entry;
        });
        values[name] = { value: JSON.parse(json), constant };
      } catch { skipped.push(name); }
    }
    const destination = path.join(this.runDir, 'repl.json');
    await fs.writeFile(`${destination}.tmp`, JSON.stringify({ values, skipped }, null, 2));
    await fs.rename(`${destination}.tmp`, destination);
  }

  async restore(): Promise<void> {
    const saved = await fs.readFile(path.join(this.runDir, 'repl.json'), 'utf8').then(JSON.parse).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!saved) return;
    for (const [name, binding] of Object.entries(saved.values ?? {}) as [string, { value: unknown; constant: boolean }][]) {
      if (name in this.context || !/^[$A-Z_a-z][$\w]*$/.test(name)) continue;
      Object.defineProperty(this.context, name, { value: binding.value, writable: true, enumerable: true, configurable: true });
      if (binding.constant) this.freeze(name);
      this.bindings.set(name, binding.constant);
    }
    if (saved.skipped?.length) this.session.signals.push(`resume omitted non-JSON bindings: ${saved.skipped.join(', ')}; recreate browser handles and functions`);
  }

  async close(): Promise<void> { await this.save(); this.expired = true; }
}

export async function executeBash(command: string, runDir: string): Promise<Anthropic.TextBlockParam[]> {
  return new Promise(resolve => {
    const child = spawn('/bin/bash', ['-c', command], { cwd: runDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const append = (data: Buffer) => { if (output.length <= OUTPUT_LIMIT) output += data.toString().slice(0, OUTPUT_LIMIT + 1 - output.length); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, 60_000);
    child.on('error', error => { clearTimeout(timer); resolve([{ type: 'text', text: `bash failed: ${error.message}` }]); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve([{ type: 'text', text: truncate(`${timedOut ? 'Timed out after 60 seconds. ' : ''}Exit: ${status ?? signal}\n${safeText(output)}`) }]);
    });
  });
}
