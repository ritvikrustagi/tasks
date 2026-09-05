import { createHash } from 'node:crypto'
import type { Hono } from 'hono'
import type { Render } from '@renderinc/sdk'
import { z } from 'zod'
import type { AppConfig } from '../app'
import type { OffloadConfig, OffloadProviders } from './providers'
import { runOffloadLocal } from './runner'
import { inputSchema, type OffloadStore, outputSchema } from './store'

export function registerOffload(
  app: Hono<{ Variables: { owner: string } }>,
  store: OffloadStore,
  providers: OffloadProviders,
  settings: OffloadConfig,
  config: AppConfig,
  render: Render | null,
  jobs: Set<Promise<void>>,
) {
  const executorReady = () =>
    config.executor === 'local' ||
    !!(render && config.workflowSlug && config.workerSecret)
  function ready(provider: 'nebius' | 'pioneer') {
    return (
      settings.linkup &&
      executorReady() &&
      (provider === 'nebius'
        ? !!(settings.nebiusKey && settings.visionModel)
        : !!(settings.pioneerKey && settings.pioneerModel))
    )
  }
  function launch(id: string) {
    const work = (async () => {
      if (config.executor === 'local')
        return runOffloadLocal(store, providers, id)
      try {
        if (!render || !config.workflowSlug)
          throw new Error('Render is not configured')
        const run = await render.workflows.startTask(
          `${config.workflowSlug}/offload`,
          [id],
          AbortSignal.timeout(30000),
        )
        store.attachRun(id, run.taskRunId)
        if (store.row(id)?.state === 'cancelled')
          await render.workflows.cancelTaskRun(run.taskRunId)
      } catch {
        store.fail(
          id,
          'Could not confirm Render dispatch. Check the remote run, then resume saved steps.',
        )
      }
    })()
    jobs.add(work)
    void work.finally(() => jobs.delete(work))
  }
  app.get('/api/offload/config', (c) =>
    c.json({
      executor: config.executor,
      workflows: executorReady(),
      database: true,
      local: config.executor === 'local',
      allowControlledFailure: config.allowFailure,
      ready: ready('nebius') || ready('pioneer'),
      providers: { nebius: ready('nebius'), pioneer: ready('pioneer') },
      linkup: settings.linkup,
      storageKey: createHash('sha256')
        .update(c.get('owner'))
        .digest('hex')
        .slice(0, 24),
    }),
  )
  app.get('/api/offload/jobs', (c) => c.json(store.list(c.get('owner'))))
  app.post('/api/offload/jobs', async (c) => {
    const { id, input } = z
      .object({ id: z.uuid(), input: inputSchema })
      .parse(await c.req.json())
    if (!ready(input.provider))
      return c.json(
        {
          error:
            'Connect Linkup, a configured vision provider, and the selected executor before running this task',
        },
        503,
      )
    if (input.controlledFailure && !config.allowFailure)
      return c.json({ error: 'Failure demonstration is disabled' }, 400)
    const created = store.create(c.get('owner'), id, input, config.executor)
    if (created) launch(id)
    return c.json({ id }, created ? 202 : 200)
  })
  app.use('/api/offload/jobs/:id/*', async (c, next) => {
    if (!store.owned(c.req.param('id') ?? '', c.get('owner')))
      return c.json({ error: 'Scan not found' }, 404)
    await next()
  })
  app.get('/api/offload/jobs/:id', async (c) => {
    const view = store.view(c.req.param('id'))
    if (
      view.execution === 'render' &&
      view.runId &&
      render &&
      ['queued', 'running', 'retrying'].includes(view.status)
    ) {
      try {
        const run = await render.workflows.getTaskRun(view.runId)
        view.runStatus = run.status
        if (
          ['failed', 'canceled', 'completed', 'succeeded'].includes(run.status)
        ) {
          // Re-read after the remote call: the worker may have just committed.
          if (store.row(view.id)?.state !== 'completed')
            store.fail(
              view.id,
              'Workflow ended without a completed scan; resume saved steps',
            )
          return c.json({ ...store.view(view.id), runStatus: run.status })
        }
      } catch {
        view.error =
          'Remote execution status is temporarily unavailable. Saved progress is retained.'
      }
    }
    return c.json(view)
  })
  app.post('/api/offload/jobs/:id/retry', async (c) => {
    const id = c.req.param('id'),
      row = store.row(id),
      input = store.context(id).input
    if (!row) return c.json({ error: 'Scan not found' }, 404)
    if (!ready(input.provider) || row.executor !== config.executor)
      return c.json(
        {
          error: 'Restore this scan’s connections and executor before resuming',
        },
        409,
      )
    if (row.executor === 'render' && row.run_id && render) {
      const run = await render.workflows.getTaskRun(row.run_id)
      if (
        !['failed', 'canceled', 'completed', 'succeeded'].includes(run.status)
      )
        return c.json(
          {
            error: 'The remote workflow is still active; wait for it to finish',
          },
          409,
        )
    }
    if (!store.resume(id))
      return c.json({ error: 'Only failed or paused scans can resume' }, 409)
    launch(id)
    return c.json({ id })
  })
  app.post('/api/offload/jobs/:id/stop', async (c) => {
    const id = c.req.param('id'),
      row = store.row(id)
    if (!row) return c.json({ error: 'Scan not found' }, 404)
    store.stop(id)
    let warning: string | undefined
    if (row.executor === 'render' && row.run_id && render)
      try {
        await render.workflows.cancelTaskRun(row.run_id)
      } catch {
        warning =
          'Stopped accepting results. Remote cancellation could not be confirmed.'
      }
    return c.json({ ok: true, warning })
  })
  app.delete('/api/offload/jobs/:id', (c) => {
    store.remove(c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/api/offload/jobs/:id/export', (c) => {
    c.header(
      'Content-Disposition',
      'attachment; filename="offload-evidence.json"',
    )
    return c.json(store.view(c.req.param('id')))
  })
  app.post('/internal/offload/:id/claim/:step', (c) => {
    const step = c.req.param('step')
    outputSchema(step)
    return c.json(store.claim(c.req.param('id'), step))
  })
  app.post('/internal/offload/:id/finish/:step', async (c) => {
    const step = c.req.param('step')
    const { lease, result, error } = z
      .object({
        lease: z.uuid(),
        result: z.unknown(),
        error: z.string().max(1000).nullable(),
      })
      .parse(await c.req.json())
    store.finish(c.req.param('id'), step, lease, result, error)
    return c.json({ ok: true })
  })
  app.post('/internal/offload/:id/fail', async (c) => {
    const { error } = z
      .object({ error: z.string().max(1000) })
      .parse(await c.req.json())
    store.fail(c.req.param('id'), error)
    return c.json({ ok: true })
  })
}
