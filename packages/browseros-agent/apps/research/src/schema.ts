import { z } from 'zod'

export const steps = ['search', 'investigate', 'followup', 'report'] as const
export type Step = (typeof steps)[number]
export const taskInput = z.object({
  id: z.string().uuid(),
  question: z.string().trim().min(8).max(2000),
  brief: z.string().max(24000).default(''),
  consent: z.literal(true),
  failOnce: z.boolean().default(false),
})
export type TaskInput = z.infer<typeof taskInput>
export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  content: z.string(),
})
export type Source = z.infer<typeof sourceSchema>
export const planSchema = z.object({
  findings: z
    .array(
      z.object({
        text: z.string().max(3000),
        sources: z.array(z.string()).max(12),
      }),
    )
    .max(12),
  gaps: z.array(z.string().max(1000)).min(1).max(5),
  query: z.string().trim().min(5).max(1500),
  reason: z.string().max(2000),
})
export const reportSchema = z.object({
  title: z.string().max(200),
  summary: z.string().max(5000),
  findings: z
    .array(
      z.object({
        text: z.string().max(4000),
        sources: z.array(z.string()).min(1).max(12),
      }),
    )
    .min(1)
    .max(20),
  uncertainties: z.array(z.string().max(2000)).max(15),
  nextActions: z.array(z.string().max(1000)).max(10),
})
export type Report = z.infer<typeof reportSchema>
export type Usage = {
  model: string
  inputTokens: number
  outputTokens: number
  elapsedMs: number
}
export type Result = {
  sources?: Source[]
  query?: string
  plan?: z.infer<typeof planSchema>
  report?: Report
  usage?: Usage
}
export type TaskState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
export type Task = {
  id: string
  question: string
  brief: string
  state: TaskState
  executor: string
  created: number
  updated: number
  error: string | null
  runId: string | null
  events: {
    step: Step
    state: string
    attempts: number
    result: Result | null
    error: string | null
    updated: number
  }[]
}

export function validateCitations(
  items: { sources: string[] }[],
  sources: Source[],
) {
  const ids = new Set(sources.map((s) => s.id))
  for (const item of items)
    for (const id of item.sources) {
      if (!ids.has(id)) throw new Error(`Model cited unknown source ${id}`)
    }
}

export function combinedSources(results: Result[]): Source[] {
  return [
    ...new Map(
      results.flatMap((r) => r.sources ?? []).map((s) => [s.id, s]),
    ).values(),
  ]
}

export function reportMarkdown(task: Task): string {
  const results = task.events.flatMap((e) => (e.result ? [e.result] : []))
  const report = results.find((r) => r.report)?.report
  if (!report) throw new Error('No completed report')
  const sources = combinedSources(results)
  return [
    `# ${report.title}`,
    report.summary,
    '## Findings',
    ...report.findings.map(
      (f) => `- ${f.text} ${f.sources.map((id) => `[${id}]`).join(' ')}`,
    ),
    '## Uncertainty',
    ...report.uncertainties.map((s) => `- ${s}`),
    '## Next actions',
    ...report.nextActions.map((s) => `- ${s}`),
    '## Sources',
    ...sources.map((s) => `[${s.id}]: <${s.url}>`),
  ].join('\n\n')
}
