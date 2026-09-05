import { timingSafeEqual } from 'node:crypto'
import { Render } from '@renderinc/sdk'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import {
  createOffloadProviders,
  offloadConfig,
  type OffloadConfig,
  type OffloadProviders,
} from './offload/providers'
import { OffloadStore } from './offload/store'
import { registerOffload } from './offload/routes'
import type { Providers } from './providers'
import { runLocal } from './runner'
import {
  planSchema,
  type Result,
  reportMarkdown,
  reportSchema,
  sourceSchema,
  steps,
  taskInput,
} from './schema'
import type { ResearchStore } from './store'

export const contentSecurityPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

export type AppConfig = {
  origin: string
  accessCode: string
  workerSecret: string
  executor: 'local' | 'render'
  renderKey: string
  workflowSlug: string
  allowFailure: boolean
  linkup: boolean
  nebius: boolean
  model: string
}
const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
const resultSchema = z.object({
  query: z.string().max(2000).optional(),
  sources: z.array(sourceSchema).max(24).optional(),
  plan: planSchema.optional(),
  report: reportSchema.optional(),
  usage: z
    .object({
      model: z.string(),
      inputTokens: z.number().nonnegative(),
      outputTokens: z.number().nonnegative(),
      elapsedMs: z.number().nonnegative(),
    })
    .optional(),
})

export function createResearchApp(
  store: ResearchStore,
  providers: Providers,
  config: AppConfig,
  offload?: { providers: OffloadProviders; config: OffloadConfig },
) {
  const app = new Hono<{ Variables: { owner: string } }>()
  const jobs = new Set<Promise<void>>()
  const attempts = new Map<string, { n: number; at: number }>()
  const render = config.renderKey
    ? new Render({ token: config.renderKey })
    : null
  const ready = () =>
    config.linkup &&
    config.nebius &&
    !!config.model &&
    (config.executor === 'local' ||
      !!(render && config.workflowSlug && config.workerSecret))

  function launch(id: string) {
    const work = (async () => {
      if (config.executor === 'local') return runLocal(store, providers, id)
      try {
        if (!render || !config.workflowSlug)
          throw new Error('Render Workflows is not configured')
        const run = await render.workflows.startTask(
          `${config.workflowSlug}/research`,
          [id],
          AbortSignal.timeout(30000),
        )
        store.attachRun(id, run.taskRunId)
        if (store.get(id)?.state === 'cancelled')
          await render.workflows.cancelTaskRun(run.taskRunId)
      } catch {
        store.fail(
          id,
          'Could not confirm Render dispatch. Check Render runs before resuming; completed steps are deduplicated.',
        )
      }
    })()
    jobs.add(work)
    void work.finally(() => jobs.delete(work))
  }

  app.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }))
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    if (new URL(c.req.url).host !== new URL(config.origin).host)
      return c.json({ error: 'Unrecognized host' }, 403)
    if (c.req.path.startsWith('/internal/')) {
      const token = c.req.header('Authorization')?.replace(/^Bearer /, '') ?? ''
      if (!config.workerSecret || !safeEqual(token, config.workerSecret))
        return c.json({ error: 'Worker authentication required' }, 401)
    } else if (c.req.path.startsWith('/api/')) {
      if (
        !['GET', 'HEAD'].includes(c.req.method) &&
        c.req.header('Origin') !== config.origin
      )
        return c.json({ error: 'Same-origin request required' }, 403)
      if (!['/api/session', '/api/health'].includes(c.req.path)) {
        const owner = getCookie(c, 'research_session') ?? ''
        if (!store.session(owner))
          return c.json({ error: 'Sign in to your research workspace' }, 401)
        c.set('owner', owner)
      }
    }
    await next()
  })
  app.onError((err, c) =>
    c.json(
      {
        error:
          err instanceof z.ZodError
            ? 'Invalid input: check field lengths and required values'
            : err.message.slice(0, 1000),
      },
      400,
    ),
  )
  app.get('/api/health', (c) =>
    c.json({ ok: true, accessCodeRequired: !!config.accessCode }),
  )
  app.post('/api/session', async (c) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0] ?? 'local'
    const recent = attempts.get(key)
    const now = Date.now()
    if (recent && now - recent.at < 60000 && recent.n >= 10)
      return c.json({ error: 'Too many attempts; wait a minute' }, 429)
    const { code } = z
      .object({ code: z.string().max(256).default('') })
      .parse(await c.req.json())
    if (config.accessCode && !safeEqual(code, config.accessCode)) {
      attempts.set(key, {
        n: recent && now - recent.at < 60000 ? recent.n + 1 : 1,
        at: recent && now - recent.at < 60000 ? recent.at : now,
      })
      return c.json({ error: 'Incorrect access code' }, 401)
    }
    attempts.delete(key)
    const existing = getCookie(c, 'research_session') ?? ''
    if (!store.session(existing))
      setCookie(c, 'research_session', store.newSession(), {
        httpOnly: true,
        secure: config.origin.startsWith('https:'),
        sameSite: 'Strict',
        path: '/',
        maxAge: 30 * 86400,
      })
    return c.json({ ok: true })
  })
  app.get('/api/config', (c) =>
    c.json({
      executor: config.executor,
      ready: ready(),
      allowFailure: config.allowFailure,
      connections: [
        {
          name: 'Linkup',
          purpose: 'Web evidence and follow-up searches',
          configured: config.linkup,
        },
        {
          name: 'Nebius Token Factory',
          purpose: config.model || 'Gap analysis and final report',
          configured: config.nebius && !!config.model,
        },
        {
          name: 'Render Workflows',
          purpose:
            config.executor === 'render'
              ? 'Background execution and retries'
              : 'Local execution selected',
          configured:
            config.executor === 'render' &&
            !!(render && config.workflowSlug && config.workerSecret),
        },
      ],
    }),
  )
  app.get('/api/brief', (c) => c.json({ text: store.brief(c.get('owner')) }))
  app.put('/api/brief', async (c) => {
    const { text } = z
      .object({ text: z.string().max(24000) })
      .parse(await c.req.json())
    store.saveBrief(c.get('owner'), text)
    return c.json({ text })
  })
  app.get('/api/tasks', (c) => c.json(store.list(c.get('owner'))))
  app.post('/api/tasks', async (c) => {
    if (!ready())
      return c.json(
        {
          error:
            'Connect Linkup and Nebius, and configure the selected executor before running research',
        },
        503,
      )
    const input = taskInput.parse(await c.req.json())
    if (input.failOnce && !config.allowFailure)
      return c.json({ error: 'Failure demonstration is disabled' }, 400)
    const created = store.create(c.get('owner'), input, config.executor)
    if (created.created) launch(input.id)
    return c.json(created.task, created.created ? 201 : 200)
  })
  app.use('/api/tasks/:id/*', async (c, next) => {
    if (!store.owned(c.req.param('id')!, c.get('owner')))
      return c.json({ error: 'Task not found' }, 404)
    await next()
  })
  app.get('/api/tasks/:id', (c) => c.json(store.get(c.req.param('id'))))
  app.post('/api/tasks/:id/resume', (c) => {
    if (!ready())
      return c.json({ error: 'Required connections are missing' }, 503)
    if (store.get(c.req.param('id'))?.executor !== config.executor)
      return c.json(
        { error: "Restore this task's original executor before resuming" },
        409,
      )
    if (!store.resume(c.req.param('id')))
      return c.json({ error: 'Only failed or paused tasks can resume' }, 409)
    launch(c.req.param('id'))
    return c.json(store.get(c.req.param('id')))
  })
  app.post('/api/tasks/:id/stop', async (c) => {
    const id = c.req.param('id'),
      task = store.get(id)!
    store.cancel(id)
    let warning: string | undefined
    if (task.executor === 'render' && task.runId && render) {
      try {
        await render.workflows.cancelTaskRun(task.runId)
      } catch {
        warning =
          'Local task stopped. Remote cancellation could not be confirmed; no further results will be accepted.'
      }
    }
    return c.json({ task: store.get(id), warning })
  })
  app.delete('/api/tasks/:id', (c) => {
    store.remove(c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/api/tasks/:id/export', (c) => {
    c.header('Content-Disposition', 'attachment; filename="research-report.md"')
    return c.text(reportMarkdown(store.get(c.req.param('id'))!))
  })
  app.get('/api/tasks/:id/evidence', (c) => {
    c.header(
      'Content-Disposition',
      'attachment; filename="research-evidence.json"',
    )
    return c.json(store.get(c.req.param('id')))
  })

  app.post('/internal/tasks/:id/claim/:step', (c) => {
    const step = z.enum(steps).parse(c.req.param('step'))
    const claim = store.claim(c.req.param('id'), step)
    if ('cached' in claim) return c.json({ cached: true, result: claim.cached })
    return c.json({
      ...claim,
      failOnce: store.consumeFailure(c.req.param('id'), step),
      cached: false,
    })
  })
  app.post('/internal/tasks/:id/finish/:step', async (c) => {
    const step = z.enum(steps).parse(c.req.param('step'))
    const body = z
      .object({
        lease: z.string().uuid(),
        result: resultSchema.nullable(),
        error: z.string().max(1000).nullable(),
      })
      .parse(await c.req.json())
    if (
      !body.error &&
      (!body.result || (step === 'report' && !body.result.report))
    )
      throw new Error('Step result is missing')
    store.finish(
      c.req.param('id'),
      step,
      body.lease,
      body.result as Result | null,
      body.error,
    )
    return c.json({ ok: true })
  })
  app.post('/internal/tasks/:id/fail', async (c) => {
    const { error } = z
      .object({ error: z.string().max(1000) })
      .parse(await c.req.json())
    store.fail(c.req.param('id'), error)
    return c.json({ ok: true })
  })
  registerOffload(
    app,
    new OffloadStore(store.db),
    offload?.providers ?? createOffloadProviders(providers.search),
    offload?.config ?? offloadConfig(),
    config,
    render,
    jobs,
  )
  return { app, drain: () => Promise.allSettled(jobs) }
}
