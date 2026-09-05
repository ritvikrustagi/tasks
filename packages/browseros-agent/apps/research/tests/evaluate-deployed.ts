import { mkdirSync, writeFileSync } from 'node:fs'
import { Render } from '@renderinc/sdk'
import { combinedSources, type Task, validateCitations } from '../src/schema'
import { cases } from './evaluation-cases'

const origin = process.env.RESEARCH_ORIGIN ?? ''
const code = process.env.RESEARCH_ACCESS_CODE
const renderKey = process.env.RENDER_API_KEY
if (!origin.startsWith('https://') || !code || !renderKey)
  throw new Error(
    'Deployed verification requires HTTPS RESEARCH_ORIGIN, RESEARCH_ACCESS_CODE and RENDER_API_KEY',
  )
const url = new URL(origin)
if (url.origin !== origin)
  throw new Error(
    'RESEARCH_ORIGIN must be an origin without a path or credentials',
  )
const render = new Render({ token: renderKey })
let cookie = ''
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${origin}/api/${path}`, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  if (path === 'session')
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
  if (!response.ok)
    throw new Error(
      `Research API ${path.split('/')[0]} returned HTTP ${response.status}`,
    )
  return response.json()
}
await api('session', 'POST', { code })
const config = await api('config')
if (!config.ready || config.executor !== 'render' || !config.allowFailure)
  throw new Error(
    'Live Render connections and the controlled failure demo must be enabled',
  )
const { url: connector } = await api('connector')
async function tool(name: string, args: unknown = {}) {
  const response = await fetch(connector, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`MCP returned HTTP ${response.status}`)
  const data = await response.json()
  if (data.error || data.result?.isError)
    throw new Error('MCP operation failed; inspect service logs')
  return JSON.parse(data.result.content[0].text)
}
const observations: unknown[] = []
const output = `test-results/deployed-${new Date().toISOString().replaceAll(':', '-')}.json`
mkdirSync('test-results', { recursive: true })
let failed = false
for (const c of cases) {
  const started = Date.now(),
    id = crypto.randomUUID()
  console.log(`Starting ${c.name}: ${id}`)
  try {
    await tool('research_context', { text: c.brief })
    const saved = await tool('research_context')
    const input = {
      id,
      question: c.question,
      brief: saved.text,
      consent: true,
      failOnce: c.failOnce,
    }
    await tool('research_start', input)
    // Retry the exact start request to check operation-level deduplication.
    await tool('research_start', input)
    let t: Task
    do {
      await Bun.sleep(3000)
      t = await api(`tasks/${id}`)
      if (Date.now() - started > 35 * 60 * 1000)
        throw new Error(
          'Task exceeded verification deadline; inspect and stop it before rerunning',
        )
    } while (['queued', 'running'].includes(t.state))
    const chatResult = await tool('research_get', { id, includeEvidence: true })
    const results = t.events.flatMap((e) => (e.result ? [e.result] : []))
    const report = results.find((r) => r.report)?.report
    let citationsValid = false
    if (report) {
      validateCitations(report.findings, combinedSources(results))
      citationsValid = true
    }
    let renderRun = t.runId ? await render.workflows.getTaskRun(t.runId) : null
    const remoteDeadline = Date.now() + 60000
    while (
      t.runId &&
      renderRun &&
      ['pending', 'running'].includes(renderRun.status) &&
      Date.now() < remoteDeadline
    ) {
      await Bun.sleep(1000)
      renderRun = await render.workflows.getTaskRun(t.runId)
    }
    const childRuns = t.runId
      ? await render.workflows.listTaskRuns({
          rootTaskRunId: [t.runId],
          limit: 100,
        })
      : []
    const reportRecords = t.events.filter((e) => e.result?.report).length
    const checks = {
      renderCompleted: renderRun?.status === 'completed',
      reportComplete: t.state === 'succeeded' && reportRecords === 1,
      citationsValid,
      followupRecorded: !!results.find((r) => r.plan)?.plan?.query,
      savedContextUsed: t.brief === c.brief,
      oneTask:
        ((await api('tasks')) as Task[]).filter((task) => task.id === id)
          .length === 1,
      recovery:
        !c.failOnce ||
        (t.events.find((e) => e.step === 'search')?.attempts === 1 &&
          (t.events.find((e) => e.step === 'investigate')?.attempts ?? 0) > 1 &&
          childRuns.some(({ taskRun }) => taskRun.retries > 0)),
    }
    if (c.name !== 'difficult' && Object.values(checks).some((v) => !v))
      failed = true
    observations.push({
      case: c.name,
      input,
      elapsedMs: Date.now() - started,
      actual: t,
      chatResult,
      renderRun,
      childRuns,
      checks,
      semanticQuality:
        'Requires review of claims against saved source evidence; citation IDs alone do not prove accuracy.',
    })
  } catch (error) {
    failed = true
    observations.push({
      case: c.name,
      taskId: id,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'Verification failed',
    })
  }
  writeFileSync(
    output,
    JSON.stringify(
      {
        mode: 'live-deployed-render-through-mcp',
        origin,
        timingScope:
          'Full task including Render queue, searches, inference, checkpoints and retries',
        observations,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  console.log(`Saved ${c.name} evidence to ${output}`)
}
if (failed) process.exitCode = 1
