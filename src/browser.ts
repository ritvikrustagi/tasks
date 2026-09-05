import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  signals: string[];
  visitedUrls: Set<string>;
  openTab(url?: string): Promise<Page>;
  closeTab(tab: Page | number): Promise<void>;
  close(): Promise<void>;
}

export async function waitInteractive(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  // Long-polling sites never become idle; DOM readiness is sufficient there.
  await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => {});
}

function defaultProfile(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Google/Chrome/User Data');
  return path.join(os.homedir(), '.config/google-chrome');
}

export async function createBrowser(options: { profile?: string; headed: boolean; runDir: string; signal?: AbortSignal }): Promise<BrowserSession> {
  options.signal?.throwIfAborted();
  const runDir = path.resolve(options.runDir);
  const profileDir = path.join(runDir, 'browser-profile');
  const artifacts = path.join(runDir, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const source = path.resolve(options.profile ?? defaultProfile());
  let profileName: string | undefined;
  const sourceIsProfile = await stat(path.join(source, 'Preferences')).then(() => true, () => false);
  if (sourceIsProfile) profileName = path.basename(source);
  const sourceRoot = sourceIsProfile ? path.dirname(source) : source;
  if (!profileName) {
    const localState = await readFile(path.join(sourceRoot, 'Local State'), 'utf8').then(data => JSON.parse(data), () => ({}));
    profileName = localState.profile?.last_used ?? 'Default';
  }
  const sourceMarker = '.browser-agent-source.json';
  const existingSource = await readFile(path.join(profileDir, sourceMarker), 'utf8')
    .catch(() => readFile(path.join(runDir, 'profile-source.json'), 'utf8'))
    .then(data => JSON.parse(data), () => undefined);
  if (options.profile && existingSource && (existingSource.root !== sourceRoot || existingSource.profile !== profileName)) {
    throw new Error('This run already uses a different copied profile. Start a new run to change --profile.');
  }
  if (existingSource && !options.profile) profileName = existingSource.profile;
  const profileExists = await stat(profileDir).then(() => true, () => false);
  if (profileExists && !existingSource) throw new Error('Copied browser profile has no completion marker. Start a new run; this profile may be incomplete.');
  if (!profileExists) {
    const copyStarted = Date.now();
    process.stderr.write('Preparing Chrome: copying your signed-in profile. Large profiles can take about a minute.\n');
    const progress = setInterval(() => process.stderr.write(`Still copying Chrome profile (${Math.round((Date.now() - copyStarted) / 1000)}s elapsed)…\n`), 10_000);
    try {
      const stagingDir = `${profileDir}.copying`;
      await rm(stagingDir, { recursive: true, force: true });
      await mkdir(stagingDir, { recursive: true });
      const entries = await readdir(sourceRoot).catch((error: NodeJS.ErrnoException) => {
        if (options.profile || error.code !== 'ENOENT') throw error;
        process.stderr.write(`Chrome profile not found at ${sourceRoot}; starting a fresh profile. Use --profile to retain signed-in sessions.\n`);
        return [];
      });
      for (const entry of entries) {
        if (entry !== 'Local State' && entry !== profileName) continue;
        await cp(path.join(sourceRoot, entry), path.join(stagingDir, entry), {
          recursive: true, mode: constants.COPYFILE_FICLONE,
          filter: (file) => {
            options.signal?.throwIfAborted();
            return !/^(Singleton.*|LOCK|lockfile|.*Cache.*|Cache|Code Cache|GPUCache|Service Worker|Crashpad|BrowserMetrics.*)$/i.test(path.basename(file));
          },
        });
      }
      options.signal?.throwIfAborted();
      await writeFile(path.join(stagingDir, sourceMarker), JSON.stringify({ root: sourceRoot, profile: profileName }));
      await rename(stagingDir, profileDir);
      process.stderr.write(`Chrome profile ready (${Math.round((Date.now() - copyStarted) / 1000)}s).\n`);
    } finally { clearInterval(progress); }
  }
  options.signal?.throwIfAborted();
  process.stderr.write('Opening Chrome…\n');
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome', headless: !options.headed,
    viewport: { width: 1440, height: 900 }, acceptDownloads: true,
    downloadsPath: artifacts,
    ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
    args: profileName ? [`--profile-directory=${profileName}`] : [],
  });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(45_000);
  process.stderr.write('Chrome is ready.\n');
  const signals: string[] = [];
  const visitedUrls = new Set<string>();
  const downloads = new Set<Promise<void>>();
  const remember = (url: string) => { if (/^https?:\/\//.test(url)) visitedUrls.add(url); };
  const attach = (tab: Page) => {
    remember(tab.url());
    tab.on('popup', popup => signals.push(`popup opened: ${popup.url()}`));
    tab.on('dialog', dialog => signals.push(`dialog ${dialog.type()}: ${dialog.message()} (use page.pendingDialog.accept() or .dismiss())`));
    // Keep the actual dialog available to the REPL without dismissing it.
    tab.on('dialog', dialog => { (tab as Page & { pendingDialog?: unknown }).pendingDialog = dialog; });
    tab.on('framenavigated', frame => {
      remember(frame.url());
      signals.push(`navigated${frame === tab.mainFrame() ? '' : ' iframe'}: ${frame.url()}`);
    });
    tab.on('download', download => {
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${path.basename(download.suggestedFilename())}`;
      const destination = path.join(artifacts, filename);
      const task = download.saveAs(destination).then(
        () => { signals.push(`download saved: ${destination}`); },
        error => { signals.push(`download failed: ${String(error)}`); },
      );
      downloads.add(task);
      void task.finally(() => downloads.delete(task));
    });
  };
  context.on('page', attach);
  context.pages().forEach(attach);
  let currentPage = context.pages()[0] ?? await context.newPage();
  return {
    context, signals, visitedUrls,
    get page() { return currentPage; },
    async openTab(url) {
      currentPage = await context.newPage();
      if (url) await currentPage.goto(url, { waitUntil: 'domcontentloaded' });
      await waitInteractive(currentPage);
      return currentPage;
    },
    async closeTab(tab) {
      const target = typeof tab === 'number' ? context.pages()[tab] : tab;
      if (!target) throw new Error('No tab at that index');
      await target.close();
      if (currentPage === target) currentPage = context.pages().at(-1) ?? await context.newPage();
    },
    async close() { await Promise.allSettled(downloads); await context.close(); },
  };
}
