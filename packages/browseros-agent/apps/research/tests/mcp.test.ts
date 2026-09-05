import { expect, test } from 'bun:test'
import { createResearchApp } from '../src/app'
import { ResearchStore } from '../src/store'
import { fixtureProviders } from './fixtures'

test('BrowserOS MCP shares API consent, ownership, idempotency, saved context and recovery', async () => {
  const store = new ResearchStore(':memory:')
  const owner = store.newSession(),
    other = store.newSession()
  const { app, drain } = createResearchApp(
    store,
    fixtureProviders().providers,
    {
      origin: 'http://127.0.0.1:4329',
      accessCode: '',
      workerSecret: 'test-only',
      executor: 'local',
      renderKey: '',
      workflowSlug: '',
      allowFailure: true,
      linkup: true,
      nebius: true,
      model: 'fixture-not-live',
    },
  )
  const rpc = (
    token: string,
    method: string,
    params: unknown = {},
    origin?: string,
  ) =>
    app.request(`http://127.0.0.1:4329/mcp/${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  const call = async (name: string, args: unknown = {}, token = owner) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.error).toBeUndefined()
    return body.result
  }
  try {
    expect((await rpc(crypto.randomUUID(), 'tools/list')).status).toBe(401)
    expect(
      (await rpc(owner, 'tools/list', {}, 'https://untrusted.example')).status,
    ).toBe(403)
    const init = await (
      await rpc(owner, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'browseros-test', version: '1' },
      })
    ).json()
    expect(init.result.serverInfo.name).toBe('ai-browser-research')
    const discovery = await (await rpc(owner, 'tools/list')).json()
    expect(
      discovery.result.tools.map((t: { name: string }) => t.name),
    ).toContain('research_start')
    expect(JSON.stringify(discovery)).not.toContain(owner)
    const status = JSON.parse((await call('research_status')).content[0].text)
    expect(status.config.ready).toBe(true)
    await call('research_context', { text: 'Need export and SSO.' })
    expect(
      JSON.parse((await call('research_context')).content[0].text).text,
    ).toBe('Need export and SSO.')
    const id = crypto.randomUUID()
    const input = {
      id,
      question: 'Compare Linear and Jira using official documentation',
      brief: store.brief(owner),
      consent: true,
      failOnce: true,
    }
    expect(
      (await call('research_start', { ...input, consent: false })).isError,
    ).toBe(true)
    expect(store.get(id)).toBeNull()
    expect((await call('research_start', input)).isError).toBeUndefined()
    await drain()
    expect(store.get(id)?.state).toBe('failed')
    expect((await call('research_get', { id }, other)).isError).toBe(true)
    expect(
      (await call('research_action', { id, action: 'resume' }, other)).isError,
    ).toBe(true)
    await call('research_start', input)
    expect(store.list(owner)).toHaveLength(1)
    await call('research_action', { id, action: 'resume' })
    await drain()
    const result = JSON.parse(
      (await call('research_get', { id, includeEvidence: true })).content[0]
        .text,
    )
    expect(result.state).toBe('succeeded')
    expect(result.report).toContain('https://')
    expect(result.followup.query).toBeTruthy()
    expect(result.evidence).toHaveLength(1)
    expect(
      result.steps.find((s: { step: string }) => s.step === 'search').attempts,
    ).toBe(1)
    expect(
      result.steps.find((s: { step: string }) => s.step === 'investigate')
        .attempts,
    ).toBe(2)
    expect(store.get(id)?.events.filter((e) => e.result?.report)).toHaveLength(
      1,
    )
    expect(JSON.stringify(result)).not.toContain(owner)
    store.db
      .query('UPDATE research_sessions SET expires=0 WHERE id=?')
      .run(owner)
    expect((await rpc(owner, 'tools/list')).status).toBe(401)
  } finally {
    await drain()
    store.close()
  }
})
