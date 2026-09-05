import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppConfig, createResearchApp } from '../src/app'
import { createProviders } from '../src/providers'
import { runLocal, runStep } from '../src/runner'
import { reportMarkdown, validateCitations } from '../src/schema'
import { ResearchStore } from '../src/store'
import { evidence, fixtureProviders } from './fixtures'

const opened: ResearchStore[] = []
afterEach(() => {
  for (const s of opened.splice(0)) s.close()
})
function setup(failOnce = false) {
  const store = new ResearchStore(':memory:')
  opened.push(store)
  const input = {
    id: crypto.randomUUID(),
    question: 'Compare support tools for a small team',
    brief: 'SSO required; retention under 30 days',
    consent: true as const,
    failOnce,
  }
  store.create('owner', input, 'local')
  return { store, input, ...fixtureProviders() }
}
const config: AppConfig = {
  origin: 'http://localhost:4318',
  accessCode: 'demo-code',
  workerSecret: 'worker-test-secret',
  executor: 'local',
  renderKey: '',
  workflowSlug: '',
  allowFailure: true,
  linkup: true,
  nebius: true,
  model: 'fixture',
}

describe('research execution', () => {
  test('uses saved evidence for follow-up and produces one cited report', async () => {
    const { store, input, providers, calls } = setup()
    await runLocal(store, providers, input.id)
    const task = store.get(input.id)!
    expect(task.state).toBe('succeeded')
    expect(calls).toEqual([
      'search:Compare support tools for a small team',
      'infer:investigate',
      'search:Example vendor official retention policy',
      'infer:report',
    ])
    expect(reportMarkdown(task)).toContain('https://example.com/pricing')
    expect(store.create('owner', input, 'local').created).toBe(false)
    await runLocal(store, providers, input.id)
    expect(calls.length).toBe(4)
    expect(store.get(input.id)!.events).toHaveLength(4)
  })
  test('controlled failure preserves evidence and resume does not repeat search', async () => {
    const { store, input, providers, calls } = setup(true)
    await runLocal(store, providers, input.id)
    expect(store.get(input.id)!.state).toBe('failed')
    expect(store.get(input.id)!.events[0].result!.sources).toHaveLength(1)
    expect(store.resume(input.id)).toBe(true)
    await runLocal(store, providers, input.id)
    expect(store.get(input.id)!.state).toBe('succeeded')
    expect(calls.filter((c) => c.startsWith('search:Compare'))).toHaveLength(1)
    expect(store.get(input.id)!.events[1].attempts).toBe(2)
  })
  test('cancellation rejects in-flight results and subsequent actions', async () => {
    const { store, input } = setup()
    const claim = store.claim(input.id, 'search')
    if (!claim.lease) throw new Error('Expected lease')
    store.cancel(input.id)
    expect(() =>
      store.finish(
        input.id,
        'search',
        claim.lease!,
        { sources: [evidence] },
        null,
      ),
    ).toThrow('stopped')
    expect(() => store.claim(input.id, 'investigate')).toThrow('not running')
    expect(store.get(input.id)!.state).toBe('cancelled')
  })
  test('concurrent execution and changed idempotency inputs are rejected', () => {
    const { store, input } = setup()
    store.claim(input.id, 'search')
    expect(() => store.claim(input.id, 'search')).toThrow('already running')
    expect(() => store.create('other', input, 'local')).toThrow()
    expect(() =>
      store.create('owner', { ...input, brief: 'different' }, 'local'),
    ).toThrow()
  })
  test('unknown citations are rejected', () => {
    expect(() =>
      validateCitations([{ sources: ['not-found'] }], [evidence]),
    ).toThrow('unknown source')
  })
  test('empty evidence fails explicitly', async () => {
    const { store, input } = setup()
    await runLocal(
      store,
      fixtureProviders({ noSources: true }).providers,
      input.id,
    )
    expect(store.get(input.id)!.state).toBe('failed')
    expect(store.get(input.id)!.error).toContain('no usable sources')
  })
  test('restart pauses local work and preserves the brief and completed steps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'research-')),
      path = join(dir, 'data.sqlite')
    const a = new ResearchStore(path),
      id = crypto.randomUUID()
    a.saveBrief('u', 'Prior requirements')
    a.create(
      'u',
      {
        id,
        question: 'Investigate vendor retention policy',
        brief: '',
        consent: true,
        failOnce: false,
      },
      'local',
    )
    await runStep(a, fixtureProviders().providers, id, 'search')
    a.close()
    const b = new ResearchStore(path)
    expect(b.get(id)!.state).toBe('paused')
    expect(b.get(id)!.events[0].state).toBe('succeeded')
    expect(b.brief('u')).toBe('Prior requirements')
    b.close()
    rmSync(dir, { recursive: true })
  })
})

test('HTTP API enforces session, origin, task ownership, and worker authentication', async () => {
  const store = new ResearchStore(':memory:')
  opened.push(store)
  const { app, drain } = createResearchApp(
    store,
    fixtureProviders().providers,
    config,
  )
  const req = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie?: string,
    origin = config.origin,
  ) =>
    app.request(`${config.origin}${path}`, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  expect((await req('/api/tasks')).status).toBe(401)
  expect(
    (
      await req(
        '/api/session',
        'POST',
        { code: 'demo-code' },
        undefined,
        'https://evil.example',
      )
    ).status,
  ).toBe(403)
  const login = await req('/api/session', 'POST', { code: 'demo-code' }),
    cookie = login.headers.get('set-cookie')!.split(';')[0]
  const input = {
    id: crypto.randomUUID(),
    question: 'Compare support tools for a small team',
    brief: 'SSO required',
    consent: true,
  }
  expect((await req('/api/tasks', 'POST', input, cookie)).status).toBe(201)
  await drain()
  const second = await req('/api/session', 'POST', { code: 'demo-code' }),
    other = second.headers.get('set-cookie')!.split(';')[0]
  for (const [method, suffix] of [
    ['GET', ''],
    ['POST', '/stop'],
    ['POST', '/resume'],
    ['GET', '/export'],
    ['DELETE', ''],
  ])
    expect(
      (await req(`/api/tasks/${input.id}${suffix}`, method, {}, other)).status,
    ).toBe(404)
  expect(
    (await req(`/internal/tasks/${input.id}/claim/search`, 'POST', {})).status,
  ).toBe(401)
  const exported = await req(
    `/api/tasks/${input.id}/export`,
    'GET',
    undefined,
    cookie,
  )
  expect(exported.status).toBe(200)
  expect(await exported.text()).toContain('Vendor recommendation')
  expect(
    (
      await req(
        '/api/tasks',
        'POST',
        { ...input, id: crypto.randomUUID(), consent: false },
        cookie,
      )
    ).status,
  ).toBe(400)
})

test('real provider adapters use documented endpoints and reject invented citations', async () => {
  const urls: string[] = [],
    bodies: unknown[] = []
  const fake = (async (url: unknown, init?: RequestInit) => {
    urls.push(String(url))
    bodies.push(JSON.parse(String(init?.body)))
    if (String(url).includes('linkup'))
      return Response.json({
        results: [
          {
            name: 'Policy',
            url: 'https://example.com/policy',
            content: '30 day retention',
          },
          { name: 'Unsafe', url: 'javascript:alert(1)', content: 'bad' },
        ],
      })
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: 'Bad',
              summary: 'Bad citation',
              findings: [{ text: 'Unsupported', sources: ['invented'] }],
              uncertainties: [],
              nextActions: [],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
  }) as typeof fetch
  const p = createProviders(
    { linkupKey: 'test', nebiusKey: 'test', model: 'test-model' },
    fake,
  )
  const evidenceResult = await p.search('policy')
  expect(evidenceResult.sources).toHaveLength(1)
  await expect(
    p.infer('report', 'policy', '', [evidenceResult]),
  ).rejects.toThrow('unknown source')
  expect(urls).toEqual([
    'https://api.linkup.so/v1/search',
    'https://api.tokenfactory.nebius.com/v1/chat/completions',
  ])
  expect(bodies[0]).toEqual({
    q: expect.stringContaining('research request: policy'),
    depth: 'deep',
    outputType: 'searchResults',
  })
})
