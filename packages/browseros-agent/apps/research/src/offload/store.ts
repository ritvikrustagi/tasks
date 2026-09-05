import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import {
  analysisSchema,
  detectedItemSchema,
  scanInputSchema,
  type Draft,
  type Identification,
  type JobView,
  type PipelineResult,
} from './pipeline-contract'
import { researchedSchema, searchSchema, type Researched } from './research'

export const draftSchema = detectedItemSchema.extend({
  id: z.string().min(1).max(100),
})
export const inputSchema = z.union([
  scanInputSchema,
  z.object({
    item: draftSchema,
    provider: z.enum(['nebius', 'pioneer']).default('nebius'),
    controlledFailure: z.literal(false).default(false),
  }),
])
export type JobInput = z.infer<typeof inputSchema>
export type ScanResult = PipelineResult & {
  research: Record<string, Researched>
  researchMs: number
}
export type JobContext = {
  id: string
  input: JobInput
  results: Record<string, unknown>
  created: number
}
type JobRow = {
  id: string
  owner: string
  input: string
  state: JobView['status']
  executor: 'local' | 'render'
  stage: string
  created: number
  updated: number
  run_id: string | null
  error: string | null
  failure_injected: number
}
export function jobSteps(results: Record<string, unknown>): string[] {
  const drafts = results.validate as Draft[] | undefined
  return [
    'identify',
    'validate',
    ...(drafts ?? []).flatMap((_, i) => [
      `search-${i}-1`,
      `search-${i}-2`,
      `ground-${i}`,
    ]),
    'publish',
  ]
}
export function outputSchema(step: string) {
  if (step === 'identify')
    return z.object({
      analysis: analysisSchema,
      model: z.string(),
      inferenceMs: z.number(),
      promptTokens: z.number().nullable(),
      completionTokens: z.number().nullable(),
    })
  if (step === 'validate') return z.array(draftSchema).min(1).max(4)
  if (step.startsWith('search-')) return searchSchema
  if (step.startsWith('ground-')) return researchedSchema
  if (step === 'publish') return z.object({ ready: z.literal(true) })
  throw new Error('Unknown scan step')
}
export class OffloadStore {
  constructor(readonly db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS offload_jobs (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL,
      executor TEXT NOT NULL, stage TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
      run_id TEXT, error TEXT, failure_injected INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS offload_steps (
        job_id TEXT NOT NULL REFERENCES offload_jobs(id) ON DELETE CASCADE, step TEXT NOT NULL,
        state TEXT NOT NULL, output TEXT, lease TEXT, updated INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(job_id,step));
      CREATE TABLE IF NOT EXISTS offload_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES offload_jobs(id) ON DELETE CASCADE,
        step TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS offload_listings (
        job_id TEXT NOT NULL REFERENCES offload_jobs(id) ON DELETE CASCADE, item_id TEXT NOT NULL,
        draft TEXT NOT NULL, PRIMARY KEY(job_id,item_id));`)
    db.exec(`UPDATE offload_steps SET state='failed',lease=NULL WHERE state='running' AND job_id IN (SELECT id FROM offload_jobs WHERE executor='local' AND state IN ('running','queued','retrying'));
      UPDATE offload_jobs SET state='paused',error='Service restarted; resume from saved steps' WHERE executor='local' AND state IN ('running','queued','retrying');`)
  }
  row(id: string) {
    return this.db
      .query('SELECT * FROM offload_jobs WHERE id=?')
      .get(id) as JobRow | null
  }
  owned(id: string, owner: string) {
    return this.row(id)?.owner === owner
  }
  context(id: string): JobContext {
    const row = this.row(id)
    if (!row) throw new Error('Scan not found')
    const outputs = this.db
      .query(
        "SELECT step,output FROM offload_steps WHERE job_id=? AND state='completed'",
      )
      .all(id) as { step: string; output: string }[]
    return {
      id,
      input: JSON.parse(row.input),
      created: row.created,
      results: Object.fromEntries(
        outputs.map((r) => [r.step, JSON.parse(r.output)]),
      ),
    }
  }
  event(id: string, step: string, status: string, message: string) {
    this.db
      .query(
        'INSERT INTO offload_events(job_id,step,status,message,at) VALUES (?,?,?,?,?)',
      )
      .run(id, step, status, message, Date.now())
  }
  create(
    owner: string,
    id: string,
    input: JobInput,
    executor: 'local' | 'render',
  ) {
    return this.db.transaction(() => {
      const prior = this.row(id)
      if (prior) {
        if (prior.owner !== owner || prior.input !== JSON.stringify(input))
          throw new Error('Scan ID is already used for different input')
        return false
      }
      const count = this.db
        .query(
          "SELECT count(*) AS n FROM offload_jobs WHERE owner=? AND state IN ('queued','running','retrying')",
        )
        .get(owner) as { n: number }
      if (count.n >= 3)
        throw new Error('Finish or stop an active scan before starting another')
      this.db
        .query(
          "INSERT INTO offload_jobs(id,owner,input,state,executor,stage,created,updated) VALUES (?,?,?,'queued',?,'identify',?,?)",
        )
        .run(id, owner, JSON.stringify(input), executor, Date.now(), Date.now())
      this.event(
        id,
        'identify',
        'queued',
        'Scan saved. Waiting for processing.',
      )
      return true
    })()
  }
  view(id: string): JobView {
    const row = this.row(id)
    if (!row) throw new Error('Scan not found')
    const { input, results } = this.context(id)
    const events = this.db
      .query('SELECT * FROM offload_events WHERE job_id=? ORDER BY id')
      .all(id) as {
      id: number
      step: string
      status: JobView['status']
      message: string
      at: number
    }[]
    const count = this.db
      .query('SELECT count(*) AS n FROM offload_listings WHERE job_id=?')
      .get(id) as { n: number }
    return {
      id,
      status: row.state,
      stage: row.stage,
      runId: row.run_id,
      runStatus: null,
      error: row.error,
      events: events.map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
      result:
        row.state === 'completed' ? (results.publish as ScanResult) : null,
      ...('frames' in input ? { frames: input.frames } : {}),
      createdAt: new Date(row.created).toISOString(),
      listingCount: count.n,
      controlledFailure: input.controlledFailure,
      failureInjected: !!row.failure_injected,
      execution: row.executor,
    }
  }
  list(owner: string) {
    return (
      this.db
        .query(
          'SELECT id,state,stage,created,error,input FROM offload_jobs WHERE owner=? ORDER BY created DESC LIMIT 50',
        )
        .all(owner) as Pick<
        JobRow,
        'id' | 'state' | 'stage' | 'created' | 'error' | 'input'
      >[]
    ).map(({ input, ...row }) => ({
      ...row,
      title:
        'item' in JSON.parse(input)
          ? `Recheck: ${(JSON.parse(input) as { item: Draft }).item.title}`
          : 'Sell my stuff',
    }))
  }
  attachRun(id: string, run: string) {
    this.db
      .query('UPDATE offload_jobs SET run_id=?,updated=? WHERE id=?')
      .run(run, Date.now(), id)
  }
  claim(id: string, step: string) {
    return this.db.transaction(() => {
      const row = this.row(id)
      if (!row || ['failed', 'paused', 'cancelled'].includes(row.state))
        throw new Error('Scan is not running')
      const context = this.context(id),
        sequence = jobSteps(context.results)
      if (!sequence.includes(step)) throw new Error('Unknown scan step')
      if (context.results[step])
        return { cached: true as const, result: context.results[step] }
      if (row.state === 'completed') throw new Error('Scan already completed')
      if (
        sequence
          .slice(0, sequence.indexOf(step))
          .some((s) => !context.results[s])
      )
        throw new Error('Previous scan step is incomplete')
      const previous = this.db
        .query(
          'SELECT state,updated FROM offload_steps WHERE job_id=? AND step=?',
        )
        .get(id, step) as { state: string; updated: number } | null
      if (
        previous?.state === 'running' &&
        previous.updated > Date.now() - 180000
      )
        throw new Error('Scan step still running; wait for its lease to expire')
      const lease = crypto.randomUUID()
      this.db
        .query(
          "INSERT INTO offload_steps(job_id,step,state,lease,updated,attempts) VALUES (?,?,'running',?,?,1) ON CONFLICT(job_id,step) DO UPDATE SET state='running',lease=excluded.lease,updated=excluded.updated,attempts=attempts+1",
        )
        .run(id, step, lease, Date.now())
      this.db
        .query(
          "UPDATE offload_jobs SET state='running',stage=?,error=NULL,updated=? WHERE id=?",
        )
        .run(step, Date.now(), id)
      this.event(id, step, 'running', `Started ${step}.`)
      return { cached: false as const, lease, context }
    })()
  }
  finish(
    id: string,
    step: string,
    lease: string,
    output: unknown,
    error: string | null,
  ) {
    let injected = false
    this.db.transaction(() => {
      const row = this.row(id)
      const current = this.db
        .query('SELECT lease FROM offload_steps WHERE job_id=? AND step=?')
        .get(id, step) as { lease: string } | null
      if (
        !row ||
        !['running', 'retrying'].includes(row.state) ||
        current?.lease !== lease
      )
        throw new Error('Scan stopped or step lease is stale')
      let result: unknown = error ? null : outputSchema(step).parse(output)
      if (!error && step === 'publish') {
        const { results, input } = this.context(id),
          drafts = results.validate as Draft[],
          identification = results.identify as Identification
        for (const draft of drafts)
          this.db
            .query(
              'INSERT INTO offload_listings VALUES (?,?,?) ON CONFLICT(job_id,item_id) DO NOTHING',
            )
            .run(id, draft.id, JSON.stringify(draft))
        if (input.controlledFailure && !row.failure_injected) {
          injected = true
          this.db
            .query('UPDATE offload_jobs SET failure_injected=1 WHERE id=?')
            .run(id)
          error =
            'Controlled failure after saving listings. Retry will reuse the saved work without duplicates.'
          result = null
        } else {
          const { analysis, ...metadata } = identification
          void analysis
          const timing = this.db
            .query(`SELECT COALESCE(SUM(s.updated - (
            SELECT MAX(e.at) FROM offload_events e
            WHERE e.job_id=s.job_id AND e.step=s.step AND e.status='running'
          )), 0) AS ms FROM offload_steps s
          WHERE s.job_id=? AND s.state='completed'
          AND (s.step LIKE 'search-%' OR s.step LIKE 'ground-%')`)
            .get(id) as { ms: number }
          result = {
            jobId: id,
            drafts,
            identification: metadata,
            totalMs: Date.now() - row.created,
            completedAt: new Date().toISOString(),
            research: Object.fromEntries(
              drafts.map((d, i) => [
                d.id,
                researchedSchema.parse(results[`ground-${i}`]),
              ]),
            ),
            researchMs: Math.max(0, timing.ms),
          } satisfies ScanResult
        }
      }
      this.db
        .query(
          'UPDATE offload_steps SET state=?,output=?,lease=NULL,updated=? WHERE job_id=? AND step=?',
        )
        .run(
          error ? 'failed' : 'completed',
          result ? JSON.stringify(result) : null,
          Date.now(),
          id,
          step,
        )
      this.db
        .query('UPDATE offload_jobs SET state=?,error=?,updated=? WHERE id=?')
        .run(
          error ? 'retrying' : step === 'publish' ? 'completed' : 'running',
          error,
          Date.now(),
          id,
        )
      this.event(
        id,
        step,
        error ? 'retrying' : 'completed',
        error ?? `${step} completed and saved.`,
      )
    })()
    if (injected)
      throw new Error('Controlled failure after durable publication')
  }
  fail(id: string, error: string) {
    if (
      this.db
        .query(
          "UPDATE offload_jobs SET state='failed',error=?,updated=? WHERE id=? AND state IN ('running','queued','retrying')",
        )
        .run(error.slice(0, 1000), Date.now(), id).changes
    )
      this.event(id, 'workflow', 'failed', error.slice(0, 1000))
  }
  resume(id: string) {
    return (
      this.db
        .query(
          "UPDATE offload_jobs SET state='queued',error=NULL,updated=? WHERE id=? AND state IN ('failed','paused')",
        )
        .run(Date.now(), id).changes === 1
    )
  }
  stop(id: string) {
    this.db
      .query(
        "UPDATE offload_jobs SET state='cancelled',updated=? WHERE id=? AND state<>'completed'",
      )
      .run(Date.now(), id)
  }
  remove(id: string) {
    if (['running', 'queued', 'retrying'].includes(this.row(id)?.state ?? ''))
      throw new Error('Stop the scan before deleting it')
    this.db.query('DELETE FROM offload_jobs WHERE id=?').run(id)
  }
}
