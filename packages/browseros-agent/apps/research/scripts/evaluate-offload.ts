import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, extname } from 'node:path'
import { z } from 'zod'
import { scanInputSchema, type JobView } from '../src/offload/pipeline-contract'

const manifestSchema = z.object({
  cases: z
    .array(
      z.object({
        id: z.string(),
        files: z.array(z.string()).min(1).max(6),
        expectedObjects: z.array(z.string()),
        notes: z.string().default(''),
        controlledFailure: z.boolean().default(false),
      }),
    )
    .min(1),
})
const args = process.argv.slice(2),
  live = args.includes('--live'),
  paths = args.filter((a) => a !== '--live')
const manifestPath = resolve(paths[0] ?? 'eval/offload-cases.json'),
  outputPath = resolve(
    paths[1] ?? `test-results/offload-evaluation-${Date.now()}.json`,
  )
const manifest = manifestSchema.parse(
  JSON.parse(await readFile(manifestPath, 'utf8')),
)
if (!live) {
  console.log(
    `Validated ${manifest.cases.length} evaluation cases. Add --live to submit actual photos and spend provider credits.`,
  )
  process.exit(0)
}
const base = process.env.EVAL_BASE_URL ?? 'http://127.0.0.1:4318'
const login = await fetch(new URL('/api/session', base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ code: process.env.RESEARCH_ACCESS_CODE ?? '' }),
})
if (!login.ok)
  throw new Error(
    'Evaluation sign-in failed; check the URL and RESEARCH_ACCESS_CODE',
  )
const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .join('; ')
const headers = {
  Cookie: cookie,
  Origin: base,
  'Content-Type': 'application/json',
}
const results: unknown[] = []
for (const testCase of manifest.cases) {
  const id = crypto.randomUUID(),
    started = Date.now()
  let job: JobView | undefined,
    error: string | null = null
  try {
    const frames = await Promise.all(
      testCase.files.map(async (file, i) => {
        const mime = (
          {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
          } as Record<string, string>
        )[extname(file).toLowerCase()]
        if (!mime) throw new Error('Evaluation files must be JPEG, PNG or WebP')
        return {
          id: `f${i}`,
          dataUrl: `data:${mime};base64,${(await readFile(resolve(dirname(manifestPath), file))).toString('base64')}`,
        }
      }),
    )
    const input = scanInputSchema.parse({
      frames,
      sellerNotes: '',
      controlledFailure: testCase.controlledFailure,
      provider: process.env.OFFLOAD_PROVIDER ?? 'nebius',
    })
    const submitted = await fetch(new URL('/api/offload/jobs', base), {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, input }),
      signal: AbortSignal.timeout(30000),
    })
    if (!submitted.ok)
      throw new Error(
        (await submitted.json()).error ?? 'Scan submission failed',
      )
    while (Date.now() - started < 20 * 60_000) {
      const response = await fetch(new URL(`/api/offload/jobs/${id}`, base), {
        headers,
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error('Could not retrieve scan progress')
      job = await response.json()
      if (
        job &&
        ['completed', 'failed', 'paused', 'cancelled'].includes(job.status)
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
    if (job?.status !== 'completed')
      error =
        job?.error ??
        'Evaluation deadline reached; inspect the saved task before retrying'
  } catch (e) {
    error = e instanceof Error ? e.message : 'Evaluation failed'
  }
  results.push({
    caseId: testCase.id,
    expectedObjects: testCase.expectedObjects,
    notes: testCase.notes,
    jobId: id,
    runId: job?.runId,
    execution: job?.execution,
    status: job?.status ?? 'request_failed',
    elapsedMs: Date.now() - started,
    result: job?.result,
    listingCount: job?.listingCount,
    events: job?.events,
    failureInjected: job?.failureInjected,
    error,
    humanReview: {
      misses: null,
      duplicates: null,
      unsupportedClaims: null,
      comparableRelevance: null,
      struggleObserved: null,
    },
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        method:
          'Actual images submitted to the scan API. Accuracy and comparable relevance require human grading.',
        results,
      },
      null,
      2,
    ),
  )
  console.log(`${testCase.id}: ${error ?? 'completed'}`)
}
console.log(
  `Saved ${outputPath}. Grade humanReview fields before making accuracy claims.`,
)
if (results.some((r) => (r as { error: string | null }).error))
  process.exitCode = 1
