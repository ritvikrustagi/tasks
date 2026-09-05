import type { Item, Session } from '../../../src/offload/types'
import { defaultPolicy } from '../../../src/offload/negotiation'
import { saveImages } from './storage'
import { sampleIllustrations } from './sample-art'

export const sampleAssets = ['chair', 'lamp', 'speaker'] as const
const samples = [
  {
    title: 'The study-break chair',
    category: 'Furniture',
    description:
      'A compact wooden chair with a curved back and a green seat. A useful extra seat for a desk or a small dining table.',
    visibleCondition: 'Light scuffs on the legs; seller should check stability',
    askingCents: 4500,
    estimatedLowCents: 3500,
    estimatedHighCents: 6000,
    priceSource: 'evidence' as const,
  },
  {
    title: 'One-more-chapter lamp',
    category: 'Lighting',
    description:
      'An adjustable desk lamp with a warm cream shade and a round base. Confirm the bulb and switch work before listing.',
    visibleCondition: 'Small marks on the base; functionality not checked',
    askingCents: 2500,
    estimatedLowCents: 1500,
    estimatedHighCents: 3500,
    priceSource: 'ai_estimate' as const,
  },
  {
    title: 'Little room, big sound',
    category: 'Electronics',
    description:
      'A small portable speaker with a fabric front. Brand and model are unknown. Seller should test sound and charging.',
    visibleCondition: 'Fabric looks clean; sound and charging not checked',
    askingCents: 3000,
    estimatedLowCents: 2000,
    estimatedHighCents: 4500,
    priceSource: 'ai_estimate' as const,
  },
]
export function createSampleItems(): Item[] {
  return samples.map((sample, index) => {
    const id = crypto.randomUUID()
    return {
      ...sample,
      id,
      brand: null,
      model: null,
      conditionConfirmed: false,
      needsConfirmation: [
        'Confirm condition and functionality before answering buyers.',
      ],
      originalFrameId: `sample-${sampleAssets[index]}`,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      status: 'draft',
      researchStatus: 'completed',
      selected: true,
      sample: true,
      researchQueries: [
        {
          id: crypto.randomUUID(),
          pass: 1,
          query: `used ${sample.category.toLowerCase()} comparable asking prices`,
          reason: 'Illustrative query only; no search was performed.',
          mode: 'standard',
          status: 'ok',
          resultCount: index === 0 ? 1 : 0,
          at: new Date().toISOString(),
        },
      ],
      evidence:
        index === 0
          ? [
              {
                id: crypto.randomUUID(),
                url: 'https://sample.invalid/wooden-chair',
                publisher: 'Sample resale listing (fictional)',
                snippet:
                  'Illustrative asking range: $35–$60. This is not a real comparable sale.',
                claim: 'Sample pricing evidence only.',
                pass: 1,
              },
            ]
          : [],
      followUpDecision:
        index === 0
          ? 'Sample evidence demonstrates the sourced-price layout. No live research performed.'
          : 'No web sources in this fixture. Price is an illustrative AI estimate.',
      identityConfidence: 'unknown',
      warnings: ['Sample illustration and pricing — not a real scanned item.'],
      listingImageKey: `image:${id}:listing`,
      sourceImageKey: `image:${id}:source`,
    }
  })
}
export async function addSampleItems(previous: Session): Promise<Session> {
  const items = createSampleItems()
  const blobs: [string, Blob][] = []
  for (const [index, item] of items.entries()) {
    const blob = new Blob([sampleIllustrations[index]], {
      type: 'image/svg+xml',
    })
    blobs.push([item.listingImageKey, blob], [item.sourceImageKey, blob])
  }
  await saveImages(blobs)
  return {
    ...previous,
    items: [...previous.items, ...items],
    step: 'listings',
    selectedId: items[0].id,
    policies: {
      ...previous.policies,
      ...Object.fromEntries(
        items.map((item) => [item.id, defaultPolicy(item)]),
      ),
    },
    metrics: [
      ...previous.metrics,
      {
        at: new Date().toISOString(),
        itemCount: 3,
        identifyMs: null,
        researchMs: null,
        sample: true,
        identifyError: null,
        researchFailures: 0,
      },
    ],
  }
}
