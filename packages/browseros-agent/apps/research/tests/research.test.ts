import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntegrationActivity } from '../client/IntegrationActivity'
import { ResearchSteps } from '../client/ResearchSteps'
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
    const activity = renderToStaticMarkup(
      createElement(IntegrationActivity, { task }),
    )
    expect(activity).toContain('Not used — this task runs locally.')
    expect(activity).toContain('fixture-not-live')
    expect(activity).toContain('No live response metadata')
    expect(activity).not.toContain('Live response recorded')
    expect(activity).toContain('href="#research-report"')
    expect(activity).toContain('100 input / 50 output tokens')
    const dispatched = { ...task, executor: 'render', runId: 'run-test-123' }
    expect(
      renderToStaticMarkup(
        createElement(IntegrationActivity, { task: dispatched }),
      ),
    ).toContain('run-test-123')
    expect(
      renderToStaticMarkup(
        createElement(IntegrationActivity, {
          task: { ...dispatched, runId: null },
        }),
      ),
    ).toContain('no dispatch confirmation recorded')
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
    ['GET', '/evidence'],
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
  const saved = await req(
    `/api/tasks/${input.id}/evidence`,
    'GET',
    undefined,
    cookie,
  )
  expect(saved.status).toBe(200)
  expect(saved.headers.get('content-disposition')).toContain(
    'research-evidence.json',
  )
  expect((await saved.json()).events).toHaveLength(4)
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
  expect(evidenceResult.providerResponse).toBeUndefined()
  await expect(
    p.infer('report', 'policy', '', [evidenceResult]),
  ).rejects.toThrow('unknown source')
  expect(urls).toEqual([
    'https://api.linkup.so/v1/search',
    'https://api.tokenfactory.nebius.com/v1/chat/completions',
  ])
  expect(bodies[0]).toEqual({
    q: 'policy',
    depth: 'standard',
    outputType: 'searchResults',
  })
})

test('worker checkpoints retain provider response evidence for the activity panel', async () => {
  const { store, input, providers } = setup()
  const { app } = createResearchApp(store, providers, config)
  const post = (path: string, body: unknown) =>
    app.request(`${config.origin}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.workerSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  const claim = await post(`/internal/tasks/${input.id}/claim/search`, {})
  const { lease } = await claim.json()
  // Synthetic metadata tests the display contract, not a live sponsor call.
  const providerResponse = {
    provider: 'linkup' as const,
    completedAt: 1700000000000,
    elapsedMs: 1250,
  }
  const response = await post(`/internal/tasks/${input.id}/finish/search`, {
    lease,
    result: { sources: [evidence], query: input.question, providerResponse },
    error: null,
  })
  expect(response.status).toBe(200)
  const task = store.get(input.id)!
  expect(task.events[0].result?.providerResponse).toEqual(providerResponse)
  const html = renderToStaticMarkup(
    createElement(IntegrationActivity, { task }),
  )
  expect(html).toContain('Live response recorded')
  expect(html).toContain('1.25')
  expect(html).not.toContain(config.workerSecret)
})

test('saved trace survives restart and connects both searches to the outcome', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-trace-'))
  const db = join(dir, 'data.sqlite')
  let store = new ResearchStore(db)
  try {
    const id = crypto.randomUUID()
    store.create(
      'owner',
      {
        id,
        question: 'Compare support tools for our team',
        brief: 'Retention under 30 days',
        consent: true,
        failOnce: false,
      },
      'local',
    )
    const { providers } = fixtureProviders()
    const policy = {
      ...evidence,
      id: 'policy',
      title: 'Retention policy',
      url: 'https://example.com/retention',
      content: 'Retention is 14 days on Enterprise.',
    }
    const search = providers.search
    providers.search = async (query) =>
      query.includes('retention policy')
        ? { query, sources: [policy] }
        : search(query)
    const infer = providers.infer
    providers.infer = async (stage, question, brief, results) => {
      if (stage === 'investigate') {
        expect(results[0].sources).toEqual([evidence])
        expect(store.get(id)!.events[0].state).toBe('succeeded')
      } else {
        expect(results[2].sources).toEqual([policy])
        expect(store.get(id)!.events[2].state).toBe('succeeded')
      }
      const result = await infer(stage, question, brief, results)
      if (result.report) {
        result.report.findings.push({
          text: policy.content,
          sources: [policy.id],
        })
        result.report.uncertainties = [
          'Enterprise price could not be confirmed.',
        ]
      }
      return result
    }
    await runLocal(store, providers, id)
    store.close()
    store = new ResearchStore(db)
    const task = store.get(id)!
    expect(task.state).toBe('succeeded')
    const markdown = reportMarkdown(task)
    for (const text of [
      'Saved research steps',
      'Why this search',
      'Retention is unspecified',
      'Example vendor official retention policy',
      policy.content,
      'Cited in final findings: 2.',
      'Enterprise price could not be confirmed.',
    ])
      expect(markdown).toContain(text)
    const html = renderToStaticMarkup(createElement(ResearchSteps, { task }))
    for (const text of [
      'Research steps',
      'Search the web · Linkup',
      'What the saved evidence says',
      'Why we searched again',
      'Retention is unspecified',
      policy.content,
      'href="#finding-2"',
      'Could not confirm',
    ])
      expect(html).toContain(text)
    expect(html.match(/<time /g)).toHaveLength(4)
    expect(html.match(/<details/g)).toHaveLength(2)
  } finally {
    store.close()
    rmSync(dir, { recursive: true })
  }
})

test('stopped tasks never show a running spinner or claim a planned search ran', () => {
  const { store, input } = setup()
  store.claim(input.id, 'search')
  store.cancel(input.id)
  const html = renderToStaticMarkup(
    createElement(ResearchSteps, { task: store.get(input.id)! }),
  )
  expect(html).toContain('cancelled')
  expect(html).toContain('Planned search')
  expect(html).not.toContain('spin')
  expect(html).not.toContain('Saved <time')
})
