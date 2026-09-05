import { createProviders } from '../src/providers'
import { runLocal } from '../src/runner'
import { combinedSources, validateCitations } from '../src/schema'
import { ResearchStore } from '../src/store'
import { cases } from './evaluation-cases'
import { fixtureProviders } from './fixtures'

const live = process.argv.includes('--live')
if (
  live &&
  (!process.env.LINKUP_API_KEY ||
    !process.env.NEBIUS_API_KEY ||
    !process.env.NEBIUS_MODEL)
)
  throw new Error(
    'Live evaluation requires Linkup and Nebius credentials and a model',
  )

const observations = []
for (const c of cases) {
  const store = new ResearchStore(':memory:'),
    id = crypto.randomUUID(),
    started = performance.now()
  const providers = live
    ? createProviders({
        linkupKey: process.env.LINKUP_API_KEY!,
        nebiusKey: process.env.NEBIUS_API_KEY!,
        model: process.env.NEBIUS_MODEL!,
      })
    : fixtureProviders({ noSources: c.name === 'difficult' }).providers
  store.create(
    'eval',
    {
      id,
      question: c.question,
      brief: c.brief,
      consent: true,
      failOnce: c.failOnce,
    },
    'local',
  )
  await runLocal(store, providers, id)
  if (c.failOnce && store.resume(id)) await runLocal(store, providers, id)
  const t = store.get(id)!,
    results = t.events.flatMap((e) => (e.result ? [e.result] : [])),
    report = results.find((r) => r.report)?.report
  let citationsValid = false
  if (report) {
    try {
      validateCitations(report.findings, combinedSources(results))
      citationsValid = true
    } catch {}
  }
  observations.push({
    case: c.name,
    input: { question: c.question, brief: c.brief },
    expected:
      c.name === 'difficult'
        ? 'Explicit missing evidence, never an invented exact price'
        : 'Cited report, follow-up from stored evidence; recovery produces one report',
    actual: t,
    error: t.error,
    elapsedMs: Math.round(performance.now() - started),
    citationsValid,
    reportRecords: t.events.filter((e) => e.result?.report).length,
    followupRecorded: results.some((r) => r.plan?.query),
    semanticQuality: 'Requires human review of evidence against findings',
  })
  store.close()
}
console.log(
  JSON.stringify(
    {
      mode: live
        ? 'live-provider-local-executor'
        : 'deterministic-fixture-not-live',
      timingScope:
        'Entire local pipeline including controlled failure and resume; excludes Render queue and deployment',
      note: 'Fixture runs verify behavior, not model quality or sponsor execution. No accuracy score inferred from citation validity.',
      observations,
    },
    null,
    2,
  ),
)
