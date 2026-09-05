import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function researchOrigin(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'RESEARCH_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment',
    )
  }
  return url.origin
}

export function packagedManifest(manifest: Record<string, unknown>) {
  const { update_url: _upstreamUpdate, ...local } = manifest
  return {
    ...local,
    name: 'Bloom Search Assistant',
    version_name: 'Development alpha',
  }
}

async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited)
    throw new Error(`Packaging command failed: ${args[0]}`)
}

async function cleanCopyMetadata(path: string) {
  // Keep quarantine/security attributes intact; only remove unsigned Finder metadata.
  for (const attribute of ['com.apple.FinderInfo', 'com.apple.ResourceFork']) {
    const cleanup = Bun.spawn(['xattr', '-dr', attribute, path], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await cleanup.exited
  }
}

if (import.meta.main) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error(
      'This desktop package currently supports Apple Silicon macOS only',
    )
  const root = resolve(import.meta.dir, '../../../..')
  const origin = researchOrigin(process.env.RESEARCH_ORIGIN ?? '')
  const vendor = resolve(
    process.env.BROWSEROS_APP ?? `${root}/.context/BrowserOS.app`,
  )
  const extension = resolve(import.meta.dir, '../app/dist/chrome-mv3')
  const destination = resolve(
    process.env.DESKTOP_OUTPUT ?? `${root}/.context/desktop/Bloom Search.app`,
  )
  if (existsSync(destination))
    throw new Error(
      `Output already exists: ${destination}; choose a new DESKTOP_OUTPUT`,
    )
  if (
    !existsSync(`${vendor}/Contents/MacOS/BrowserOS`) ||
    !existsSync(`${extension}/manifest.json`)
  )
    throw new Error(
      'Download the official BrowserOS app and build the assistant extension first',
    )
  const resources = `${destination}/Contents/Resources`
  mkdirSync(`${destination}/Contents/MacOS`, { recursive: true })
  mkdirSync(resources, { recursive: true })
  await run(['ditto', vendor, `${resources}/BrowserOS.app`])
  await cleanCopyMetadata(`${resources}/BrowserOS.app`)
  await run([
    'codesign',
    '--verify',
    '--deep',
    '--strict',
    `${resources}/BrowserOS.app`,
  ])
  // Build the matching server; the downloaded browser can bundle an older API.
  const serverBuild = Bun.spawn(
    [
      process.execPath,
      'scripts/build/server.ts',
      '--target',
      'darwin-arm64',
      '--ci',
    ],
    {
      cwd: resolve(import.meta.dir, '../..'),
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  if (await serverBuild.exited)
    throw new Error('Local agent server build failed')
  await run([
    'ditto',
    `${vendor}/Contents/Resources/BrowserOSServer/default/resources`,
    `${resources}/server/resources`,
  ])
  await run([
    'ditto',
    '-x',
    '-k',
    resolve(
      import.meta.dir,
      '../../dist/prod/server/browseros-server-resources-darwin-arm64.zip',
    ),
    `${resources}/server`,
  ])
  const build = Bun.spawn([process.execPath, 'run', 'build'], {
    cwd: resolve(import.meta.dir, '../app'),
    env: { ...process.env, VITE_RESEARCH_URL: origin },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (await build.exited) throw new Error('Assistant extension build failed')
  await run(['ditto', extension, `${resources}/extension`])
  await Bun.write(
    `${resources}/extension/manifest.json`,
    JSON.stringify(
      packagedManifest(await Bun.file(`${extension}/manifest.json`).json()),
      null,
      2,
    ),
  )
  await run([
    'xcrun',
    'clang',
    '-fobjc-arc',
    '-framework',
    'AppKit',
    '-mmacosx-version-min=14.0',
    `${import.meta.dir}/launcher.m`,
    '-o',
    `${destination}/Contents/MacOS/Bloom Search`,
  ])
  await run([
    'ditto',
    resolve(import.meta.dir, 'bloom.icns'),
    `${resources}/browser.icns`,
  ])
  const plist = `${destination}/Contents/Info.plist`
  await Bun.write(
    plist,
    JSON.stringify({
      CFBundleName: 'Bloom Search',
      CFBundleDisplayName: 'Bloom Search',
      CFBundleExecutable: 'Bloom Search',
      CFBundleIdentifier: 'dev.aibrowser.launcher',
      CFBundleVersion: '3',
      CFBundleShortVersionString: '0.1.2',
      CFBundlePackageType: 'APPL',
      CFBundleIconFile: 'browser.icns',
      LSMinimumSystemVersion: '14.0',
      LSUIElement: true,
      ResearchOrigin: origin,
    }),
  )
  await run(['plutil', '-convert', 'xml1', plist])
  await Bun.write(
    `${resources}/LICENSE`,
    await Bun.file(`${root}/LICENSE`).text(),
  )
  await Bun.write(
    `${resources}/UPSTREAM.md`,
    await Bun.file(`${root}/UPSTREAM.md`).text(),
  )
  await Bun.write(
    `${resources}/SOURCE.txt`,
    'Source: https://github.com/ritvikrustagi/tasks/tree/build-aside-ai-browser\nDevelopment launcher around the unmodified BrowserOS runtime. Not a notarized independent browser release.\n',
  )
  await cleanCopyMetadata(destination)
  await run(['codesign', '--force', '--sign', '-', destination])
  await run(['codesign', '--verify', '--deep', '--strict', destination])
  console.log(
    `Desktop app built: ${destination}\nResearch: ${origin}\nVendor signature retained; launcher is ad-hoc signed, not notarized.`,
  )
  console.log(`Open the application from ${dirname(destination)}.`)
}
