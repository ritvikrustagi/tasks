import type { Researched } from './research'
import { z } from 'zod'

export const frameSchema = z.object({
  id: z.string().regex(/^f\d+$/),
  dataUrl: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .max(600_000),
})
export const scanInputSchema = z
  .object({
    frames: z.array(frameSchema).min(1).max(6),
    sellerNotes: z.string().max(1000).default(''),
    controlledFailure: z.boolean().default(false),
    provider: z.enum(['nebius', 'pioneer']).default('nebius'),
  })
  .refine(
    (input) =>
      new Set(input.frames.map((f) => f.id)).size === input.frames.length,
    'Frame IDs must be unique',
  )
export type ScanInput = z.infer<typeof scanInputSchema>
export type Frame = z.infer<typeof frameSchema>
export const detectedItemSchema = z.object({
  title: z.string().min(1).max(160),
  category: z.string().max(80),
  brand: z.string().max(100).nullable(),
  model: z.string().max(100).nullable(),
  description: z.string().min(1).max(2000),
  visibleCondition: z.string().min(1).max(500),
  needsConfirmation: z.array(z.string().max(250)).max(10),
  suggestedAskCents: z.number().int().min(0).max(100_000_000),
  estimatedLowCents: z.number().int().min(0).max(100_000_000).nullable(),
  estimatedHighCents: z.number().int().min(0).max(100_000_000).nullable(),
  bestFrameId: z.string(),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  identityConfidence: z.enum(['high', 'medium', 'low', 'unknown']),
  warnings: z.array(z.string().max(250)).max(10),
})
export const analysisSchema = z.object({
  items: z.array(detectedItemSchema).min(1).max(4),
})
export type Analysis = z.infer<typeof analysisSchema>
export type Identification = {
  analysis: Analysis
  model: string
  inferenceMs: number
  promptTokens: number | null
  completionTokens: number | null
}
export type Draft = z.infer<typeof detectedItemSchema> & { id: string }
export type JobStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'failed'
  | 'completed'
  | 'paused'
  | 'cancelled'
export type JobEvent = {
  id: number
  step: string
  status: JobStatus
  message: string
  at: string
}
export type PipelineResult = {
  jobId: string
  research?: Record<string, Researched>
  researchMs?: number
  drafts: Draft[]
  identification: Omit<Identification, 'analysis'>
  totalMs: number
  completedAt: string
}
export type JobView = {
  id: string
  status: JobStatus
  stage: string
  runId: string | null
  runStatus: string | null
  error: string | null
  events: JobEvent[]
  result: PipelineResult | null
  frames?: Frame[]
  createdAt: string
  listingCount: number
  controlledFailure: boolean
  failureInjected: boolean
  execution: 'render' | 'local'
}
