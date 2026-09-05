import type { OffloadProviders, OffloadConfig } from '../src/offload/providers'
import type {
  ScanInput,
  Identification,
} from '../src/offload/pipeline-contract'
import type { AppConfig } from '../src/app'
export const scanInput: ScanInput = {
  provider: 'nebius',
  sellerNotes: '',
  controlledFailure: false,
  frames: [
    {
      id: 'f0',
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
    },
  ],
}
export const identification: Identification = {
  model: 'fixture-vision',
  inferenceMs: 1,
  promptTokens: 20,
  completionTokens: 40,
  analysis: {
    items: [
      {
        title: 'Wooden chair',
        category: 'Furniture',
        brand: null,
        model: null,
        description: 'A wooden chair with visible scuffs.',
        visibleCondition: 'Scuffs; stability untested',
        needsConfirmation: ['Check stability'],
        suggestedAskCents: 4500,
        estimatedLowCents: 3000,
        estimatedHighCents: 6000,
        bestFrameId: 'f0',
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        identityConfidence: 'unknown',
        warnings: [],
      },
    ],
  },
}
export function offloadFixtures() {
  const calls: string[] = []
  const providers: OffloadProviders = {
    async identify() {
      calls.push('identify')
      return structuredClone(identification)
    },
    async search(draft, pass) {
      calls.push(`search:${pass}`)
      return {
        query: {
          id: `query-${pass}`,
          pass,
          query: `Used ${draft.title}`,
          reason: 'Check comparable asks',
          mode: 'standard',
          status: 'ok',
          resultCount: 1,
          at: new Date().toISOString(),
        },
        evidence: [
          {
            id: `e${pass}`,
            url: `https://example.com/chair/${pass}`,
            publisher: 'Example resale listing',
            snippet:
              pass === 1
                ? 'Used wooden chair, no price shown.'
                : 'Used wooden chair. Asking price: $40.',
            claim: 'Comparable ask',
            pass,
          },
        ],
      }
    },
    async ground(_draft, result) {
      calls.push('ground')
      return result
    },
  }
  return { providers, calls }
}
export const offloadSettings: OffloadConfig = {
  nebiusKey: 'fixture-only',
  visionModel: 'fixture-only',
  pioneerKey: '',
  pioneerModel: '',
  pioneerBase: 'https://example.com',
  nebiusBase: 'https://example.com',
  linkup: true,
}
export const appSettings: AppConfig = {
  origin: 'http://localhost:4318',
  accessCode: '',
  workerSecret: 'fixture-worker',
  executor: 'local',
  renderKey: '',
  workflowSlug: '',
  allowFailure: true,
  linkup: true,
  nebius: true,
  model: 'fixture',
}
