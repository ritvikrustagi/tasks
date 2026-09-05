import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { serveStatic } from 'hono/bun'
import puppeteer from 'puppeteer'
import { createResearchApp } from '../src/app'
import { ResearchStore } from '../src/store'
import { fixtureProviders } from './fixtures'

// This isolated test server never becomes the user-facing development server.
const store = new ResearchStore(':memory:')
const origin = 'http://127.0.0.1:4329'
const { app, drain } = createResearchApp(store, fixtureProviders().providers, {
  origin,
  accessCode: '',
  workerSecret: 'test-only',
  executor: 'local',
  renderKey: '',
  workflowSlug: '',
  allowFailure: true,
  linkup: true,
  nebius: true,
  model: 'fixture-not-live',
})
app.use('/assets/*', serveStatic({ root: './dist' }))
app.get('/', serveStatic({ path: './dist/index.html' }))
app.get('/favicon.ico', (c) => c.body(null, 204))
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 4329,
  fetch: app.fetch,
})
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
mkdirSync('test-results', { recursive: true })
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(origin)
  await page.waitForSelector('button.primary:not([disabled])')
  await page.click('button.primary')
  await page.waitForNetworkIdle()
  await page.waitForSelector('textarea[name="question"]')
  assert(
    await page.$eval(
      '.integration-activity',
      (el) =>
        el.textContent?.includes('No task started.') &&
        el.textContent.includes('Configured; no run yet.') &&
        el.textContent.includes('Not used — local execution selected.'),
    ),
  )
  await page.screenshot({ path: 'test-results/desktop-empty.png' })
  await page.type(
    'textarea[name="question"]',
    '[UI test: simulated sources] Compare vendor pricing and retention for our team',
  )
  await page.click('input[name="consent"]')
  await page.click('input[name="failOnce"]')
  await page.waitForSelector('.composer button[type="submit"]:not([disabled])')
  await page.click('.composer button[type="submit"]')
  await page.waitForSelector('button[title="Resume from saved evidence"]')
  await page.click('button[title="Resume from saved evidence"]')
  await page.waitForSelector('a[title="Download report"]')
  await page.waitForFunction(() =>
    document.body.textContent?.includes('Why we searched again'),
  )
  assert(
    await page.$eval(
      '.integration-activity',
      (el) =>
        el.textContent?.includes('Not used — this task runs locally.') &&
        el.textContent.includes('fixture-not-live') &&
        !el.textContent.includes('Live response recorded'),
    ),
  )
  await page.click('.integration-activity a[href="#research-report"]')
  await page.waitForFunction(() => location.hash === '#research-report')
  assert(
    await page.$eval('#research-report', (el) =>
      el.textContent?.includes('NEBIUS REPORT'),
    ),
  )
  await page.click('.integration-activity summary')
  assert.equal(await page.$('.integration-activity details[open]'), null)
  await page.click('.integration-activity summary')
  await page.click('.sources details summary')
  await page.waitForSelector('.sources details[open] .source-impact a')
  assert(
    await page.$eval('.sources details[open]', (el) =>
      el.textContent?.includes('Cited in final findings'),
    ),
  )
  await page.screenshot({
    path: 'test-results/desktop-result-fixture.png',
    fullPage: true,
  })
  const saved = await page.evaluate(async () => {
    const link = document.querySelector<HTMLAnchorElement>(
      'a[title="Download saved research steps and evidence"]',
    )!
    return (await fetch(link.href)).json()
  })
  assert.equal(saved.events.length, 4)
  assert.equal(
    saved.events[2].result.query,
    'Example vendor official retention policy',
  )
  await Bun.write(
    'test-results/saved-evidence-fixture.json',
    JSON.stringify(saved, null, 2),
  )
  assert.equal(await page.$$eval('.report', (els) => els.length), 1)
  assert.equal(await page.$$eval('.sources details', (els) => els.length), 2)
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: 844 })
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Overflow at ${width}px`,
    )
    assert(
      await page.$eval(
        '.task-list',
        (el) => el.getBoundingClientRect().height > 0,
      ),
    )
    assert(
      await page.$eval(
        '.integration-activity',
        (el) => el.getBoundingClientRect().width <= innerWidth,
      ),
    )
    await page.screenshot({
      path: `test-results/mobile-${width}-fixture.png`,
      fullPage: true,
    })
  }
  await page.click('.rail nav button:nth-child(2)')
  await page.waitForFunction(() =>
    document.body.textContent?.includes('Configured, not verified'),
  )
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  )
  assert.deepEqual(errors, [])
  console.log(
    'UI passed: desktop/mobile, failure/resume, one report/two saved searches, connection states, no page errors',
  )
} finally {
  await browser.close()
  await drain()
  server.stop(true)
  store.close()
}
