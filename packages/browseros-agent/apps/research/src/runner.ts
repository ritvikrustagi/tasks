import { executeStep, type Providers } from './providers'
import { type Step, steps } from './schema'
import type { ResearchStore } from './store'

export async function runStep(
  store: ResearchStore,
  providers: Providers,
  id: string,
  step: Step,
) {
  const claim = store.claim(id, step)
  if ('cached' in claim) return claim.cached
  const { task, lease } = claim
  try {
    if (store.consumeFailure(id, step))
      throw new Error(
        'Controlled demo failure: evidence is saved; retry will continue from this step',
      )
    const result = await executeStep(
      providers,
      step,
      task.question,
      task.brief,
      task.events.flatMap((e) => (e.result ? [e.result] : [])),
    )
    store.finish(id, step, lease, result, null)
    return result
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Research step failed'
    try {
      store.finish(id, step, lease, null, message)
    } catch {
      /* Stop/stale lease wins over an in-flight result. */
    }
    throw error
  }
}

export async function runLocal(
  store: ResearchStore,
  providers: Providers,
  id: string,
) {
  try {
    for (const step of steps) await runStep(store, providers, id, step)
  } catch (error) {
    store.fail(id, error instanceof Error ? error.message : 'Research failed')
  }
}
