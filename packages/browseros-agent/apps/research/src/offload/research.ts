import { z } from 'zod'
import type { Draft } from './pipeline-contract'
import type { Evidence, ResearchQuery } from './types'

export const evidenceSchema = z.object({
  id: z.string(),
  url: z
    .string()
    .url()
    .refine((s) => /^https?:\/\//.test(s)),
  publisher: z.string(),
  snippet: z.string().max(8000),
  claim: z.string(),
  pass: z.union([z.literal(1), z.literal(2)]),
})
export const searchSchema = z.object({
  evidence: z.array(evidenceSchema).max(24),
  query: z
    .object({
      id: z.string(),
      pass: z.union([z.literal(1), z.literal(2)]),
      query: z.string(),
      reason: z.string(),
      mode: z.literal('standard'),
      status: z.enum(['ok', 'error']),
      resultCount: z.number(),
      at: z.string(),
    })
    .nullable(),
})
export type SearchResult = z.infer<typeof searchSchema>
export const researchedSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(2000),
  askingCents: z.number().int().min(0).max(100_000_000),
  estimatedLowCents: z.number().int().nullable(),
  estimatedHighCents: z.number().int().nullable(),
  priceSource: z.enum(['evidence', 'ai_estimate']),
  evidence: z.array(evidenceSchema).max(48),
  researchQueries: z.array(searchSchema.shape.query.unwrap()).max(2),
  followUpDecision: z.string(),
  warnings: z.array(z.string()),
})
export type Researched = z.infer<typeof researchedSchema>

export function mergeEvidence(groups: Evidence[][]): Evidence[] {
  const unique = new Map<string, Evidence>()
  for (const row of groups.flat()) {
    const url = new URL(row.url)
    url.hash = ''
    for (const key of [...url.searchParams.keys()])
      if (key.startsWith('utm_')) url.searchParams.delete(key)
    if (!unique.has(url.href)) unique.set(url.href, row)
  }
  return [...unique.values()]
}

// Only explicit asking/listed prices count. Sold prices, shipping, monthly
// payments and unlabeled dollar amounts do not establish a comparable ask.
export function priceCents(evidence: Evidence[]): number[] {
  const prices: number[] = []
  for (const row of evidence) {
    for (const line of row.snippet.split(/[\n;]|(?<=[.!?])\s+/)) {
      if (
        /\b(sold|shipping|delivery|monthly|per month|deposit|save|discount)\b/i.test(
          line,
        )
      )
        continue
      const match =
        /\b(?:asking(?: price)?|list(?:ing|ed)? price|price)\s*(?:is|of|:|at)?\s*(?:USD\s*)?\$\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?(?!\d|\.\d)/i.exec(
          line,
        )
      if (!match) continue
      const cents = Math.round(
        Number(match[1].replaceAll(',', '') + (match[2] ?? '')) * 100,
      )
      if (cents > 0 && cents <= 10_000_000) prices.push(cents)
    }
  }
  return prices
}
export function comparableQuery(
  draft: Draft,
  pass: 1 | 2,
): { query: string; reason: string } {
  const identity = [draft.brand, draft.model, draft.title]
    .filter(Boolean)
    .join(' ')
  const reason =
    pass === 1
      ? 'Find used asking prices for the seller’s identified item.'
      : 'The saved first search did not establish asking prices; broaden to comparable items.'
  return {
    reason,
    query: [
      `Find current US used resale listings for ${pass === 1 ? identity : `${draft.category}; comparable to ${identity}`}.`,
      `Visible condition: ${draft.visibleCondition}.`,
      !draft.model
        ? 'Exact model unknown: label broader comparables, never claim an exact match.'
        : '',
      'Prefer individual eBay, Mercari, OfferUp or Craigslist listings. Return title, condition, explicit USD asking price labeled "Asking price: $...", and source URL.',
      'Keep sold prices, shipping costs and installment amounts separate. Say none found when unavailable. Do not invent listings or prices.',
    ]
      .filter(Boolean)
      .join(' '),
  }
}
export function priceResearch(
  draft: Draft,
  searches: SearchResult[],
): Researched {
  const evidence = mergeEvidence(searches.map((s) => s.evidence))
  const prices = priceCents(evidence).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const queries = searches.flatMap((s) =>
    s.query ? [s.query as ResearchQuery] : [],
  )
  return {
    title: draft.title,
    description: draft.description,
    askingCents: prices.length
      ? prices.length % 2
        ? prices[mid]
        : Math.round((prices[mid - 1] + prices[mid]) / 2)
      : draft.suggestedAskCents,
    estimatedLowCents: prices.length ? prices[0] : null,
    estimatedHighCents: prices.at(-1) ?? null,
    priceSource: prices.length ? 'evidence' : 'ai_estimate',
    evidence,
    researchQueries: queries,
    followUpDecision: prices.length
      ? `${queries.length === 2 ? 'A broader follow-up search was needed.' : 'First search had asking prices; no follow-up was needed.'} Range reflects comparable asking prices, not verified sales.`
      : 'No explicit comparable asking prices were found after two searches. Price remains an AI estimate.',
    warnings: [
      ...draft.warnings.filter((w) => !w.startsWith('AI price estimate')),
      ...(!draft.model
        ? [
            'Exact model unknown; sources are broader comparables. Confirm the label before posting.',
          ]
        : []),
      ...(!prices.length
        ? ['AI price estimate — verify before posting.']
        : ['Comparable relevance and condition need seller review.']),
    ],
  }
}
