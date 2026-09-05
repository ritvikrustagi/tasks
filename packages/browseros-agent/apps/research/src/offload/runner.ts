import { buildDrafts } from './pipeline-drafts'
import type { Draft, Identification } from './pipeline-contract'
import type { OffloadProviders } from './providers'
import { priceCents, priceResearch, type SearchResult } from './research'
import { jobSteps, type JobContext, type OffloadStore } from './store'

export async function executeOffloadStep(
  providers: OffloadProviders,
  context: JobContext,
  step: string,
): Promise<unknown> {
  const { input, results, id } = context
  if (step === 'identify') {
    if ('item' in input)
      return {
        analysis: { items: [input.item] },
        model: 'Seller-edited identity',
        inferenceMs: 0,
        promptTokens: null,
        completionTokens: null,
      }
    return providers.identify(input)
  }
  if (step === 'validate')
    return 'item' in input
      ? [input.item]
      : buildDrafts(id, (results.identify as Identification).analysis)
  if (step === 'publish') return { ready: true }
  const [, index, passText] = step.split('-'),
    i = Number(index),
    draft = (results.validate as Draft[])[i]
  if (!draft) throw new Error('Unknown item in scan step')
  if (step.startsWith('search-')) {
    if (
      passText === '2' &&
      priceCents((results[`search-${i}-1`] as SearchResult).evidence).length
    )
      return { evidence: [], query: null }
    return providers.search(draft, passText === '1' ? 1 : 2)
  }
  if (step.startsWith('ground-')) {
    const research = priceResearch(draft, [
      results[`search-${i}-1`],
      results[`search-${i}-2`],
    ] as SearchResult[])
    return providers.ground(draft, research, input.provider)
  }
  throw new Error('Unknown scan step')
}
export async function runOffloadStep(
  store: OffloadStore,
  providers: OffloadProviders,
  id: string,
  step: string,
) {
  const claim = store.claim(id, step)
  if (claim.cached) return claim.result
  try {
    const result = await executeOffloadStep(providers, claim.context, step)
    store.finish(id, step, claim.lease, result, null)
    return result
  } catch (error) {
    try {
      store.finish(
        id,
        step,
        claim.lease,
        null,
        error instanceof Error ? error.message : 'Scan step failed',
      )
    } catch {
      /* A committed result or cancellation wins. */
    }
    throw error
  }
}
export async function runOffloadLocal(
  store: OffloadStore,
  providers: OffloadProviders,
  id: string,
) {
  try {
    let index = 0
    while (true) {
      const step = jobSteps(store.context(id).results)[index++]
      if (!step) return
      for (let attempt = 0; ; attempt++) {
        try {
          await runOffloadStep(store, providers, id, step)
          break
        } catch (error) {
          if (
            attempt >= 2 ||
            ['cancelled', 'failed', 'paused'].includes(
              store.row(id)?.state ?? '',
            )
          )
            throw error
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1)),
          )
        }
      }
    }
  } catch (error) {
    store.fail(id, error instanceof Error ? error.message : 'Scan failed')
  }
}
