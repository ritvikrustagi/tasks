export type Step = 'scan' | 'listings' | 'desk' | 'reserved'
export type ItemStatus = 'draft' | 'listed' | 'offer_received' | 'reserved'
export type PriceSource = 'evidence' | 'ai_estimate' | 'seller'
export type ResearchStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'retrying'
  | 'failed'
  | 'completed'
export type BBox = { x: number; y: number; width: number; height: number }
export type ResearchQuery = {
  id: string
  pass: 1 | 2
  query: string
  reason: string
  mode: 'standard'
  status: 'ok' | 'error'
  resultCount: number
  at: string
}
export type Evidence = {
  id: string
  url: string
  publisher: string
  snippet: string
  claim: string
  pass: 1 | 2
}
export type Item = {
  id: string
  title: string
  description: string
  category: string
  brand: string | null
  model: string | null
  visibleCondition: string
  needsConfirmation: string[]
  conditionConfirmed: boolean
  originalFrameId: string
  bbox: BBox
  askingCents: number
  estimatedLowCents: number | null
  estimatedHighCents: number | null
  priceSource: PriceSource
  status: ItemStatus
  researchStatus: ResearchStatus
  researchJobId?: string
  researchQueries: ResearchQuery[]
  evidence: Evidence[]
  followUpDecision: string | null
  identityConfidence: 'high' | 'medium' | 'low' | 'unknown'
  warnings: string[]
  selected: boolean
  sample: boolean
  listingImageKey: string
  sourceImageKey: string
}
export type PipelineItem = Omit<
  Item,
  | 'listingImageKey'
  | 'sourceImageKey'
  | 'status'
  | 'selected'
  | 'conditionConfirmed'
  | 'sample'
> & {
  listingDataUrl: string
  sourceDataUrl: string
  sample: false
}
export type SellerPolicy = {
  itemId: string
  askingCents: number
  minimumCents: number
  locationLabel: string
  availableSlots: [string, string]
}
export type OfferStatus =
  | 'rejected'
  | 'countered'
  | 'needs_review'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'auto_replied'
export type Offer = {
  id: string
  itemId: string
  buyerAlias: string
  amountCents: number | null
  locationLabel: string | null
  slot: string | null
  status: OfferStatus
  reason: string
  policySnapshot: Pick<
    SellerPolicy,
    'askingCents' | 'minimumCents' | 'locationLabel' | 'availableSlots'
  >
}
export type Message = {
  id: string
  offerId: string
  speaker: 'buyer' | 'offload' | 'seller'
  text: string
  timestamp: string
}
export type BuyerEventKind =
  | 'low_offer'
  | 'accept_asking'
  | 'ask_delivery'
  | 'condition_question'
  | 'custom_offer'
export type BuyerEvent = {
  kind: BuyerEventKind
  buyerAlias: string
  amountCents?: number
  slot?: string
  locationLabel?: string
  text?: string
}
export type RunMetrics = {
  jobId?: string
  totalMs?: number
  model?: string
  at: string
  itemCount: number
  identifyMs: number | null
  researchMs: number | null
  sample: boolean
  identifyError: string | null
  researchFailures: number
}
export type Session = {
  version: 1
  items: Item[]
  policies: Record<string, SellerPolicy>
  offers: Offer[]
  messages: Message[]
  step: Step
  selectedId: string | null
  metrics: RunMetrics[]
  confirmedOfferId: string | null
}
export type ScanUploadProps = {
  onItems: (items: PipelineItem[], metrics: RunMetrics) => void | Promise<void>
  onError: (message: string) => void
  onStage: (stage: string) => void
}
