import { type TaskContext, task } from '@renderinc/sdk/workflows'
import { createProviders, executeStep } from './providers'
import { type Result, type Step, steps, type Task } from './schema'

const providers = createProviders({
  linkupKey: process.env.LINKUP_API_KEY ?? '',
  nebiusKey: process.env.NEBIUS_API_KEY ?? '',
  model: process.env.NEBIUS_MODEL ?? '',
})

async function checkpoint(path: string, body: unknown = {}) {
  const base = process.env.RESEARCH_API_URL,
    secret = process.env.RESEARCH_WORKER_SECRET
  if (!base || !secret)
    throw new Error('Research checkpoint URL and worker secret are required')
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Checkpoint rejected (${response.status})`)
  return response.json()
}

const researchStep = task(
  {
    name: 'research-step',
    retry: { maxRetries: 2, waitDurationMs: 3000, backoffScaling: 2 },
    timeoutSeconds: 180,
  },
  async (_ctx: TaskContext, id: string, step: Step) => {
    if (!/^[a-f0-9-]{36}$/.test(id) || !steps.includes(step))
      throw new Error('Invalid task or step')
    const path = `/internal/tasks/${id}`
    const claim = (await checkpoint(`${path}/claim/${step}`)) as {
      cached: boolean
      result?: Result
      task?: Task
      lease?: string
      failOnce?: boolean
    }
    if (claim.cached) return { step, cached: true }
    const { task: current, lease } = claim
    if (!current || !lease) throw new Error('Invalid checkpoint response')
    try {
      if (claim.failOnce)
        throw new Error(
          'Controlled demo failure after saved evidence; Render will retry this step',
        )
      const result = await executeStep(
        providers,
        step,
        current.question,
        current.brief,
        current.events.flatMap((e) => (e.result ? [e.result] : [])),
      )
      await checkpoint(`${path}/finish/${step}`, { lease, result, error: null })
      return { step, cached: false }
    } catch (error) {
      try {
        await checkpoint(`${path}/finish/${step}`, {
          lease,
          result: null,
          error:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : 'Step failed',
        })
      } catch {
        /* A committed result or cancellation must win. */
      }
      throw error
    }
  },
)

export const research = task(
  {
    name: 'research',
    retry: { maxRetries: 0, waitDurationMs: 1000 },
    timeoutSeconds: 1800,
  },
  async (ctx: TaskContext, id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid task ID')
    try {
      for (const step of steps) await ctx.run(researchStep, id, step)
      return { taskId: id, state: 'succeeded' }
    } catch (error) {
      await checkpoint(`/internal/tasks/${id}/fail`, {
        error:
          'Workflow step failed after retries; saved evidence is retained. Review the step and resume.',
      })
      throw error
    }
  },
)
