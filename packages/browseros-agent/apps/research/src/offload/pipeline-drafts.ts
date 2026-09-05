import type {
  Analysis,
  Draft,
  Frame,
  Identification,
  PipelineResult,
} from './pipeline-contract'
import type { PipelineItem, RunMetrics } from './types'
export function buildDrafts(jobId: string, analysis: Analysis): Draft[] {
  return analysis.items.map((item, index) => {
    const box = item.bbox
    const valid =
      [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
      box.width > 0 &&
      box.height > 0 &&
      box.x < 1 &&
      box.y < 1 &&
      box.x + box.width > 0 &&
      box.y + box.height > 0
    const x = Math.max(0, box.x),
      y = Math.max(0, box.y)
    const bbox = valid
      ? {
          x,
          y,
          width: Math.min(1, box.x + box.width) - x,
          height: Math.min(1, box.y + box.height) - y,
        }
      : { x: 0, y: 0, width: 1, height: 1 }
    const validRange =
      item.estimatedLowCents !== null &&
      item.estimatedHighCents !== null &&
      item.estimatedLowCents <= item.estimatedHighCents
    return {
      ...item,
      id: `${jobId}:${index}`,
      bbox,
      estimatedLowCents: validRange ? item.estimatedLowCents : null,
      estimatedHighCents: validRange ? item.estimatedHighCents : null,
      warnings: [
        ...item.warnings,
        'AI price estimate — no web comparables were used.',
        ...(!valid
          ? ['Automatic crop unavailable; showing the original photo.']
          : []),
      ],
    }
  })
}
export function toPipelineItem(
  draft: Draft,
  frame: Frame,
  crop: string,
): PipelineItem {
  return {
    id: draft.id,
    title: draft.title,
    category: draft.category,
    brand: draft.brand,
    model: draft.model,
    description: draft.description,
    visibleCondition: draft.visibleCondition,
    needsConfirmation: draft.needsConfirmation,
    originalFrameId: frame.id,
    bbox: draft.bbox,
    askingCents: draft.suggestedAskCents,
    estimatedLowCents: draft.estimatedLowCents,
    estimatedHighCents: draft.estimatedHighCents,
    priceSource: 'ai_estimate',
    researchStatus: 'idle',
    researchQueries: [],
    evidence: [],
    followUpDecision:
      'No web research was performed. Pricing is an AI estimate.',
    identityConfidence: draft.identityConfidence,
    warnings: draft.warnings,
    sample: false,
    listingDataUrl: crop,
    sourceDataUrl: frame.dataUrl,
  }
}
export function pipelineMetrics(result: PipelineResult): RunMetrics {
  return {
    at: result.completedAt,
    itemCount: result.drafts.length,
    identifyMs: result.identification.inferenceMs,
    researchMs: result.researchMs ?? null,
    sample: false,
    identifyError: null,
    researchFailures: 0,
    jobId: result.jobId,
    totalMs: result.totalMs,
    model: result.identification.model,
  }
}
export function identificationMetadata(value: Identification) {
  const { analysis, ...metadata } = value
  void analysis
  return metadata
}
