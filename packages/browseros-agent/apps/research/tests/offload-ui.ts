import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { serveStatic } from 'hono/bun'
import puppeteer from 'puppeteer'
import { createResearchApp, contentSecurityPolicy } from '../src/app'
import { ResearchStore } from '../src/store'
import { fixtureProviders } from './fixtures'
import {
  appSettings,
  offloadFixtures,
  offloadSettings,
} from './offload-fixtures'

const store = new ResearchStore(':memory:'),
  origin = 'http://127.0.0.1:4330'
const { providers, calls } = offloadFixtures()
const { app, drain } = createResearchApp(
  store,
  fixtureProviders().providers,
  { ...appSettings, origin },
  { providers, config: offloadSettings },
)
app.use('*', async (c, next) => {
  c.header('Content-Security-Policy', contentSecurityPolicy)
  await next()
})
app.use('/assets/*', serveStatic({ root: './dist' }))
app.use('/offload-samples/*', serveStatic({ root: './dist' }))
app.get('/', serveStatic({ path: './dist/index.html' }))
app.get('/favicon.ico', (c) => c.body(null, 204))
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 4330,
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
  const page = await browser.newPage(),
    errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewport({ width: 1440, height: 1000 })
  async function click(text: string, scope = '') {
    const selector = `${scope} button`
    await page.waitForFunction(
      (selector, text) =>
        Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).some(
          (e) => e.textContent?.trim() === text && !e.disabled,
        ),
      {},
      selector,
      text,
    )
    await page.evaluate(
      (selector, text) => {
        const el = Array.from(
          document.querySelectorAll<HTMLButtonElement>(selector),
        ).find((e) => e.textContent?.trim() === text && !e.disabled)!
        el.click()
      },
      selector,
      text,
    )
  }
  async function open() {
    await page.waitForSelector('button.primary:not([disabled])')
    await page.click('button.primary')
    await click('Sell my stuff', '.rail')
    await page.waitForSelector('.offload .stepper')
  }
  async function field(selector: string, value: string) {
    await page.$eval(selector, (e) => (e as HTMLInputElement).select())
    await page.keyboard.press('Backspace')
    await page.type(selector, value)
  }
  await page.goto(origin)
  await open()
  await page.waitForSelector('.sample-cta:not([disabled])')
  await page.click('.sample-cta')
  await page.waitForSelector('.item-card')
  assert.equal((await page.$$('.item-card')).length, 3)
  await click('Edit listing', '.item-card:first-child')
  await field('.item-card:first-child input[name="title"]', 'Study chair')
  await field('.item-card:first-child input[name="ask"]', '49.50')
  await click('Save listing', '.item-card:first-child')
  await page.click('.item-card:first-child .condition-check input')
  await page.waitForFunction(() =>
    document
      .querySelector('.item-card:first-child')
      ?.textContent?.includes('Condition confirmed'),
  )
  await page.screenshot({
    path: 'test-results/offload-listings.png',
    fullPage: true,
  })
  await click('Set your selling rules')
  await click('Activate demo listing')
  await click('Low offer')
  await page.waitForFunction(() =>
    document.body.textContent?.includes('Counter sent'),
  )
  await click('Ask for delivery')
  await page.waitForFunction(() =>
    document.body.textContent?.includes('Needs your review'),
  )
  await click('Accept asking price')
  await click('Confirm pickup')
  await page.waitForSelector('.reservation-card')
  await page.screenshot({
    path: 'test-results/offload-reserved.png',
    fullPage: true,
  })
  await page.reload()
  await open()
  await page.waitForSelector('.reservation-card')
  assert(
    await page.$eval('.reservation-card', (e) =>
      e.textContent?.includes('Study chair'),
    ),
  )
  await click('Back to your items')
  assert(
    await page.$eval(
      '.item-card:first-child .card-actions button',
      (e) => (e as HTMLButtonElement).disabled,
    ),
  )
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: 844 })
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      console.log(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll('*'))
            .filter((e) => e.getBoundingClientRect().right > innerWidth)
            .slice(0, 15)
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              width: e.getBoundingClientRect().width,
              right: e.getBoundingClientRect().right,
            })),
        ),
      )
    await page.screenshot({
      path: `test-results/offload-mobile-${width}.png`,
      fullPage: true,
    })
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Listing overflow at ${width}`,
    )
    await page.screenshot({
      path: `test-results/offload-mobile-${width}.png`,
      fullPage: true,
    })
  }
  await page.setViewport({ width: 1440, height: 1000 })
  await click('Reset session')
  await click('Reset everything', '.reset-dialog')
  await page.waitForSelector('.live-upload input[type="file"]')
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 80
    canvas.getContext('2d')!.fillRect(5, 5, 70, 70)
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    )
    const input = document.querySelector<HTMLInputElement>(
      '.live-upload input[type="file"]',
    )!
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([blob], 'chair-fixture.png', { type: 'image/png' }),
    )
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.click('.failure-toggle input')
  await click('Create my listing drafts')
  await page.waitForFunction(
    () =>
      document
        .querySelector('.pipeline-progress')
        ?.textContent?.includes('Your drafts are ready'),
    { timeout: 30000 },
  )
  await page.screenshot({
    path: 'test-results/offload-scan-recovery.png',
    fullPage: true,
  })
  await click('Review 1 listing drafts')
  await page.waitForSelector('.item-card')
  assert(
    await page.$eval('.item-card', (e) =>
      e.textContent?.includes('From listings'),
    ),
  )
  await click('Edit listing', '.item-card')
  await field('.item-card input[name="model"]', 'Seller label')
  await click('Save listing', '.item-card')
  await click('Recheck prices', '.item-card')
  await page.waitForFunction(
    () =>
      document
        .querySelector('.item-card')
        ?.textContent?.includes('Research: completed'),
    { timeout: 30000 },
  )
  assert.equal(calls.filter((c) => c === 'identify').length, 1)
  assert.equal(calls.filter((c) => c === 'search:1').length, 2)
  await page.click('.research-actions details summary')
  await field('input[name="width"]', '0.5')
  await click('Rebuild listing photo')
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLImageElement>('.item-card img')
        ?.naturalWidth === 40,
  )
  await page.reload()
  await open()
  await page.waitForSelector('.item-card')
  assert.equal((await page.$$('.item-card')).length, 1)
  assert.equal(
    await page.$eval(
      '.item-card img',
      (e) => (e as HTMLImageElement).naturalWidth,
    ),
    40,
  )
  const jobs = await page.evaluate(
    async () => await (await fetch('/api/offload/jobs')).json(),
  )
  assert.equal(jobs.length, 2)
  await page.evaluate(() => {
    const task = Array.from(document.querySelectorAll<HTMLButtonElement>('.task-list button')).find(el => el.textContent?.includes('Sell my stuff'))
    task!.click()
  })
  await click('Review 1 listing drafts')
  await page.waitForSelector('.item-card')
  assert.equal((await page.$$('.item-card')).length, 1)
  assert.equal(await page.$eval('.item-card img', e => (e as HTMLImageElement).naturalWidth), 40)
  await page.click('.item-card .evidence summary')
  assert(await page.$eval('.item-card', e => e.textContent?.includes('Seller label')))

  assert.deepEqual(errors, [])
  console.log(
    'Offload UI passed: sample editing, rules, offers, reservation, refresh, mobile, mocked live scan/recovery, sourced prices, recheck, crop and persistence',
  )
} finally {
  await browser.close()
  await drain()
  server.stop(true)
  store.close()
}
