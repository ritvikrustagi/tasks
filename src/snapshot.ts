import type { Frame, Locator, Page } from 'playwright-core';

export interface SnapshotOptions { interactive?: boolean; showHidden?: boolean; ref?: string; selector?: string }
type RefPage = Page & { refs?: Map<string, Locator>; _snapshotForAI?: () => Promise<string | { full: string }> };
const states = new WeakMap<Page, { previous: string; locator: Page['locator'] }>();
const interactive = /^(button|link|textbox|searchbox|checkbox|radio|combobox|listbox|option|menuitem\w*|tab|switch|slider|spinbutton|treeitem)\b/;

function prepare(page: RefPage) {
  let state = states.get(page);
  if (!state) {
    state = { previous: '', locator: page.locator.bind(page) };
    states.set(page, state);
    page.refs = new Map();
    const original = state.locator;
    page.locator = ((selector, options) => {
      if (/^(f\d+)?e\d+$/.test(selector)) {
        const locator = page.refs!.get(selector);
        if (!locator) throw new Error(`Unknown or stale ref ${selector}; take a fresh snapshot.`);
        return locator;
      }
      return original(selector, options);
    }) as Page['locator'];
  }
  return state;
}

// ponytail: bounded line diff uses an LCS table; snapshots are capped at 6,500 characters.
function lineDiff(before: string, after: string): string {
  if (!before) return after;
  if (before === after) return '[no changes]';
  const a = before.split('\n'), b = after.split('\n');
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const changes: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (j < b.length && (i === a.length || rows[i][j + 1] >= rows[i + 1][j])) changes.push(`+ ${b[j++]}`);
    else changes.push(`- ${a[i++]}`);
  }
  const diff = changes.join('\n');
  return diff.length <= 7500 ? diff : `[many changes; current snapshot]\n${after}`;
}

async function walk(frame: Frame, root: Locator, prefix: string, options: SnapshotOptions): Promise<{ text: string; refs: Map<string, Locator> }> {
  const rows = await root.evaluate((element, config) => {
    const found: Array<{ ref: string; text: string }> = [];
    let index = 0;
    const roles: Record<string, string> = { A: 'link', BUTTON: 'button', TEXTAREA: 'textbox', SELECT: 'combobox', OPTION: 'option', IMG: 'img', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', P: 'paragraph', LI: 'listitem', IFRAME: 'iframe' };
    const walker = { visit(node: Element) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/.test(node.tagName)) return;
      const style = getComputedStyle(node);
      if (!config.showHidden && (style.display === 'none' || style.visibility === 'hidden' || node.getAttribute('aria-hidden') === 'true')) return;
      const input = node as HTMLInputElement;
      let role = node.getAttribute('role') || roles[node.tagName] || '';
      if (node.tagName === 'INPUT') role = ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', range: 'slider', number: 'spinbutton' } as Record<string, string>)[input.type] || 'textbox';
      if (!role && (node.hasAttribute('onclick') || node.getAttribute('tabindex') === '0' || node.getAttribute('contenteditable') === 'true')) role = 'button';
      const labelled = (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      let name = labelled.trim() || node.getAttribute('aria-label') || Array.from(input.labels || []).map(label => label.textContent).join(' ') || node.getAttribute('alt') || node.getAttribute('placeholder') || node.getAttribute('title') || (node.tagName === 'INPUT' ? input.value : node.textContent) || '';
      name = name.replace(/\s+/g, ' ').trim().slice(0, 180);
      if (role && (name || /textbox|checkbox|radio|combobox/.test(role))) {
        const ref = `${config.prefix}e${++index}`;
        node.setAttribute('data-browser-agent-ref', ref);
        let flags = '';
        if (input.disabled || node.getAttribute('aria-disabled') === 'true') flags += ' [disabled]';
        if (input.checked || node.getAttribute('aria-checked') === 'true') flags += ' [checked]';
        found.push({ ref, text: `- ${role} ${JSON.stringify(name)} [ref=${ref}]${flags}` });
      }
      for (const child of Array.from(node.children)) walker.visit(child);
      if (node.shadowRoot) for (const child of Array.from(node.shadowRoot.children)) walker.visit(child);
    } };
    walker.visit(element);
    return found;
  }, { prefix, showHidden: options.showHidden });
  return { text: rows.map(row => row.text).join('\n'), refs: new Map(rows.map(row => [row.ref, frame.locator(`[data-browser-agent-ref="${row.ref}"]`)])) };
}

export async function snapshot(page: Page, options: SnapshotOptions = {}): Promise<{ tree: string; diff: string }> {
  const target = page as RefPage;
  const state = prepare(target);
  const root = options.ref ? page.locator(options.ref) : state.locator(options.selector ?? 'body');
  let raw = '';
  let refs = new Map<string, Locator>();
  if (!options.showHidden) {
    try {
      raw = await root.ariaSnapshot({ mode: 'ai', ref: true, timeout: 10_000 } as Parameters<Locator['ariaSnapshot']>[0]);
    } catch { /* Older Playwright builds use the internal snapshot API. */ }
    if (!raw.includes('[ref=') && target._snapshotForAI && !options.ref && !options.selector) {
      try { const legacy = await target._snapshotForAI(); raw = typeof legacy === 'string' ? legacy : legacy.full; } catch { /* DOM walker below. */ }
    }
    if (raw.includes('[ref=')) {
      for (const match of raw.matchAll(/\[ref=((?:f\d+)?e\d+)\]/g)) refs.set(match[1], state.locator(`aria-ref=${match[1]}`));
    }
  }
  if (!refs.size) {
    const rootHandle = await root.elementHandle();
    const rootFrame = await rootHandle?.ownerFrame() ?? page.mainFrame();
    await rootHandle?.dispose();
    const main = await walk(rootFrame, root, rootFrame === page.mainFrame() ? '' : `f${page.frames().indexOf(rootFrame)}`, options);
    raw = main.text; refs = main.refs;
    if (!options.ref && !options.selector) {
      let frameIndex = 0;
      for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
        try {
          const child = await walk(frame, frame.locator('body'), `f${++frameIndex}`, options);
          raw += `\n- iframe ${JSON.stringify(frame.url())}\n${child.text}`;
          for (const [ref, locator] of child.refs) refs.set(ref, locator);
        } catch { /* A frame can detach while reading; the next snapshot sees its replacement. */ }
      }
    }
  }
  const lines = raw.split('\n').map(line => line.trim()).filter(line => {
    if (!line.startsWith('- ') || /^- \/(url|placeholder):/.test(line)) return false;
    const content = line.slice(2);
    if (options.interactive) return interactive.test(content);
    return !/^(generic|rowgroup|table|row|cell|list|listitem|group)(?:\s*\[.*?\])*:$/.test(content);
  }).map(line => line.replace(/ \[cursor=pointer\]/g, '').replace(/ \[active\]/g, ''));
  const selected = new Set<number>();
  let size = 0;
  const indexes = lines.map((_, index) => index);
  const isControl = (index: number) => /^- (textbox|searchbox|combobox|tab)\b/.test(lines[index]);
  // Keep primary action controls before spending the budget on long data rows.
  for (const index of [...indexes.filter(isControl), ...indexes.filter(index => !isControl(index))]) {
    const line = lines[index];
    if (size + line.length + 1 > 6200) continue;
    selected.add(index); size += line.length + 1;
  }
  const kept = lines.filter((_, index) => selected.has(index));
  if (kept.length < lines.length) kept.push(`[${lines.length - kept.length} lower-priority lines omitted; focus with {ref} or {selector}, or use readPage(page)]`);
  const tree = kept.join('\n') || '[empty accessibility tree; try a screenshot]';
  const visibleRefs = new Set(Array.from(tree.matchAll(/\[ref=((?:f\d+)?e\d+)\]/g), match => match[1]));
  target.refs = new Map([...refs].filter(([ref]) => visibleRefs.has(ref)));
  const diff = lineDiff(state.previous, tree);
  state.previous = tree;
  return { tree, diff };
}

export async function readPage(page: Page): Promise<string> {
  return page.locator('body').evaluate(body => {
    const article = body.querySelector('article, main, [role="main"]') ?? body;
    const copy = article.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('nav,footer,header,script,style,noscript,aside,[aria-hidden="true"]').forEach(node => node.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30_000);
  });
}
