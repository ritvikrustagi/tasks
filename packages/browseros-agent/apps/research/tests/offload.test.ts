import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResearchStore } from '../src/store'
import { OffloadStore, jobSteps } from '../src/offload/store'
import {
  executeOffloadStep,
  runOffloadStep,
  runOffloadLocal,
} from '../src/offload/runner'
import { createResearchApp } from '../src/app'
import { createOffloadProviders } from '../src/offload/providers'
import {
  mergeEvidence,
  priceCents,
  priceResearch,
} from '../src/offload/research'
import { buildDrafts } from '../src/offload/pipeline-drafts'
import { fixtureProviders } from './fixtures'
import {
  appSettings,
  identification,
  offloadFixtures,
  offloadSettings,
  scanInput,
} from './offload-fixtures'
const stores: ResearchStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})
function setup() {
  const db = new ResearchStore(':memory:')
  stores.push(db)
  const store = new OffloadStore(db.db),
    id = crypto.randomUUID()
  store.create('alice', id, scanInput, 'local')
  return { db, store, id, ...offloadFixtures() }
}
test('full scan preserves two searches and grounded prices; rerun does not spend twice', async () => {
  const { store, id, providers, calls } = setup()
  await runOffloadLocal(store, providers, id)
  expect(store.view(id)).toMatchObject({ status: 'completed', listingCount: 1 })
  const result = store.view(id).result!
  expect(result.research![result.drafts[0].id]).toMatchObject({
    askingCents: 4000,
    priceSource: 'evidence',
  })
  expect(calls).toEqual(['identify', 'search:1', 'search:2', 'ground'])
  await runOffloadLocal(store, providers, id)
  expect(calls).toHaveLength(4)
  expect(store.create('alice', id, scanInput, 'local')).toBe(false)
  expect(() => store.create('bob', id, scanInput, 'local')).toThrow()
})
test('failure after publication commits one listing and retries without repeating inference or searches', async () => {
  const { store, id, providers, calls } = setup()
  store.db
    .query('UPDATE offload_jobs SET input=? WHERE id=?')
    .run(JSON.stringify({ ...scanInput, controlledFailure: true }), id)
  let index = 0
  while (true) {
    const step = jobSteps(store.context(id).results)[index++]
    if (step === 'publish') break
    await runOffloadStep(store, providers, id, step)
  }
  await expect(runOffloadStep(store, providers, id, 'publish')).rejects.toThrow(
    'Controlled failure',
  )
  expect(store.view(id)).toMatchObject({
    status: 'retrying',
    listingCount: 1,
    failureInjected: true,
    result: null,
  })
  await runOffloadStep(store, providers, id, 'publish')
  expect(store.view(id)).toMatchObject({ status: 'completed', listingCount: 1 })
  expect(calls).toEqual(['identify', 'search:1', 'search:2', 'ground'])
})
test('saved first search survives a failed follow-up and resume', async () => {
  const { store, id, providers, calls } = setup()
  for (const step of ['identify', 'validate', 'search-0-1'])
    await runOffloadStep(store, providers, id, step)
  const claim = store.claim(id, 'search-0-2')
  if (claim.cached) throw new Error('Expected claim')
  store.finish(id, 'search-0-2', claim.lease, null, 'Temporary search outage')
  store.fail(id, 'Exhausted retries')
  expect(store.resume(id)).toBe(true)
  await runOffloadLocal(store, providers, id)
  expect(calls.filter((c) => c === 'search:1')).toHaveLength(1)
  expect(store.view(id).status).toBe('completed')
})
test('leases reject concurrent claims, stale results and cancelled results', () => {
  const { store, id } = setup(),
    first = store.claim(id, 'identify')
  if (first.cached) throw new Error('Expected claim')
  expect(() => store.claim(id, 'identify')).toThrow('still running')
  expect(() => store.claim(id, 'publish')).toThrow('Previous')
  store.db.query('UPDATE offload_steps SET updated=0 WHERE job_id=?').run(id)
  const second = store.claim(id, 'identify')
  if (second.cached) throw new Error('Expected claim')
  expect(() =>
    store.finish(id, 'identify', first.lease, identification, null),
  ).toThrow('stale')
  store.stop(id)
  expect(() =>
    store.finish(id, 'identify', second.lease, identification, null),
  ).toThrow('stale')
  expect(store.view(id).status).toBe('cancelled')
})
test('SQLite restart pauses local work and retains completed checkpoints', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'offload-')),
    path = join(folder, 'db.sqlite'),
    id = crypto.randomUUID()
  let db = new ResearchStore(path)
  try {
    let store = new OffloadStore(db.db)
    store.create('alice', id, scanInput, 'local')
    const { providers, calls } = offloadFixtures()
    await runOffloadStep(store, providers, id, 'identify')
    store.claim(id, 'validate')
    db.close()
    db = new ResearchStore(path)
    store = new OffloadStore(db.db)
    expect(store.view(id).status).toBe('paused')
    store.resume(id)
    await runOffloadLocal(store, providers, id)
    expect(store.view(id).status).toBe('completed')
    expect(calls.filter((c) => c === 'identify')).toHaveLength(1)
  } finally {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
test('price rechecks use seller identity without invoking image analysis', async () => {
  const { store, id, providers, calls } = setup(),
    newId = crypto.randomUUID()
  const draft = buildDrafts(id, identification.analysis)[0]
  store.create(
    'alice',
    newId,
    {
      item: { ...draft, model: 'Seller label' },
      provider: 'nebius',
      controlledFailure: false,
    },
    'local',
  )
  await runOffloadLocal(store, providers, newId)
  expect(calls).not.toContain('identify')
  expect(store.view(newId).result?.drafts[0].model).toBe('Seller label')
  expect(store.view(newId).result?.research?.[draft.id].askingCents).toBe(4000)
})
test('first-pass prices skip the second search; weak evidence stays an estimate', async () => {
  const { providers } = offloadFixtures(),
    draft = buildDrafts('test', identification.analysis)[0]
  const first = await providers.search(draft, 2)
  const result = await executeOffloadStep(
    providers,
    {
      id: 'test',
      input: scanInput,
      created: Date.now(),
      results: { validate: [draft], 'search-0-1': first },
    },
    'search-0-2',
  )
  expect(result).toEqual({ query: null, evidence: [] })
  const estimate = priceResearch(draft, [{ ...first, evidence: [] }])
  expect(estimate.priceSource).toBe('ai_estimate')
  expect(estimate.estimatedLowCents).toBeNull()
  expect(
    priceCents([
      {
        ...first.evidence[0],
        snippet:
          'Sold for $500. Shipping price: $30. Monthly price: $20. Asking price: $49.99.',
      },
    ]),
  ).toEqual([4999])
  expect(
    mergeEvidence([
      [first.evidence[0]],
      [
        {
          ...first.evidence[0],
          url: first.evidence[0].url + '?utm_source=demo#top',
        },
      ],
    ]),
  ).toHaveLength(1)
})
test('vision validates model availability, JSON, photo references and bounded payload', async () => {
  const calls: unknown[] = []
  let output: unknown = identification.analysis
  const request = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init?.body)
    return new Response(
      JSON.stringify(
        init?.method === 'POST'
          ? { choices: [{ message: { content: JSON.stringify(output) } }] }
          : { data: [{ id: 'fixture-only' }] },
      ),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch
  const provider = createOffloadProviders(
    fixtureProviders().providers.search,
    offloadSettings,
    request,
  )
  expect((await provider.identify(scanInput)).analysis.items).toHaveLength(1)
  expect(JSON.parse(calls[1] as string).messages[0].content).toHaveLength(3)
  output = {
    items: [{ ...identification.analysis.items[0], bestFrameId: 'invented' }],
  }
  await expect(provider.identify(scanInput)).rejects.toThrow('unknown source')
  output = {
    items: [{ ...identification.analysis.items[0], suggestedAskCents: -10 }],
  }
  await expect(provider.identify(scanInput)).rejects.toThrow()
})
test('Hono scan routes enforce session ownership, origin and worker authentication', async () => {
  const db = new ResearchStore(':memory:')
  stores.push(db)
  const { providers } = offloadFixtures()
  const { app, drain } = createResearchApp(
    db,
    fixtureProviders().providers,
    appSettings,
    { providers, config: offloadSettings },
  )
  const alice = db.newSession(),
    bob = db.newSession(),
    id = crypto.randomUUID()
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    owner: string = alice,
    extra: Record<string, string> = {},
  ) {
    return app.request(appSettings.origin + path, {
      method,
      headers: {
        Origin: appSettings.origin,
        Cookie: `research_session=${owner}`,
        'Content-Type': 'application/json',
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  expect(
    (await request('/api/offload/jobs', 'GET', undefined, 'missing')).status,
  ).toBe(401)
  expect(
    (
      await request(
        '/api/offload/jobs',
        'POST',
        { id, input: scanInput },
        alice,
        { Origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403)
  expect(
    (await request('/api/offload/jobs', 'POST', { id, input: scanInput }))
      .status,
  ).toBe(202)
  await drain()
  expect((await request(`/api/offload/jobs/${id}`)).status).toBe(200)
  for (const [suffix, method] of [
    ['', 'GET'],
    ['', 'DELETE'],
    ['/export', 'GET'],
    ['/retry', 'POST'],
    ['/stop', 'POST'],
  ])
    expect(
      (
        await request(
          `/api/offload/jobs/${id}${suffix}`,
          method,
          undefined,
          bob,
        )
      ).status,
    ).toBe(404)
  expect(
    (await request(`/internal/offload/${id}/claim/identify`, 'POST', {}))
      .status,
  ).toBe(401)
  expect(
    (
      await request(
        `/internal/offload/${id}/claim/identify`,
        'POST',
        {},
        alice,
        { Authorization: 'Bearer fixture-worker' },
      )
    ).status,
  ).toBe(200)
  expect(
    (await request('/api/offload/jobs', 'GET', undefined, bob)).status,
  ).toBe(200)
  expect(
    await (await request('/api/offload/jobs', 'GET', undefined, bob)).json(),
  ).toEqual([])
  expect(
    (await request(`/api/offload/jobs/${id}`)).headers.get('Cache-Control'),
  ).toBe('no-store')
})

test('Render checkpoint HTTP contract carries saved inputs and survives failure after commit', async () => {
  const db = new ResearchStore(':memory:')
  stores.push(db)
  const { providers, calls } = offloadFixtures()
  const { app } = createResearchApp(
    db,
    fixtureProviders().providers,
    appSettings,
    { providers, config: offloadSettings },
  )
  const store = new OffloadStore(db.db),
    id = crypto.randomUUID()
  store.create(
    'worker-owner',
    id,
    { ...scanInput, controlledFailure: true },
    'render',
  )
  const checkpoint = (path: string, body: unknown = {}) =>
    app.request(appSettings.origin + `/internal/offload/${id}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  let index = 0
  while (true) {
    const step = jobSteps(store.context(id).results)[index++]
    if (!step) break
    const claimed = await checkpoint(`claim/${step}`)
    expect(claimed.status).toBe(200)
    const claim = await claimed.json()
    expect(claim.context.input.provider).toBe('nebius')
    const output = await executeOffloadStep(providers, claim.context, step)
    const finished = await checkpoint(`finish/${step}`, {
      lease: claim.lease,
      result: output,
      error: null,
    })
    if (step === 'publish') {
      expect(finished.status).toBe(400)
      expect(store.view(id).listingCount).toBe(1)
      const retry = await (await checkpoint('claim/publish')).json()
      expect(
        (
          await checkpoint('finish/publish', {
            lease: retry.lease,
            result: { ready: true },
            error: null,
          })
        ).status,
      ).toBe(200)
    } else expect(finished.status).toBe(200)
  }
  expect(store.view(id)).toMatchObject({
    status: 'completed',
    failureInjected: true,
    listingCount: 1,
  })
  expect((await (await checkpoint('claim/publish')).json()).cached).toBe(true)
  expect(calls).toEqual(['identify', 'search:1', 'search:2', 'ground'])
})
