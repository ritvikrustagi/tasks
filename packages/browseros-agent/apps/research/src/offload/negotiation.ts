import { formatCents } from './money'
import type {
  BuyerEvent,
  Item,
  Offer,
  OfferStatus,
  SellerPolicy,
  Session,
} from './types'

export type Decision = {
  status: OfferStatus
  amountCents: number | null
  locationLabel: string | null
  slot: string | null
  reply: string
  reason: string
}
const validMoney = (n: number) =>
  Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000
export function validPolicy(policy: SellerPolicy): boolean {
  return (
    validMoney(policy.askingCents) &&
    validMoney(policy.minimumCents) &&
    policy.minimumCents <= policy.askingCents &&
    Boolean(policy.locationLabel.trim()) &&
    policy.availableSlots.length === 2 &&
    policy.availableSlots.every((s) => s.trim()) &&
    policy.availableSlots[0] !== policy.availableSlots[1]
  )
}
export function defaultPolicy(item: Item): SellerPolicy {
  return {
    itemId: item.id,
    askingCents: item.askingCents,
    minimumCents: Math.max(0, Math.round(item.askingCents * 0.8)),
    locationLabel: 'Library steps (public)',
    availableSlots: ['Sat 11:00–13:00', 'Sun 14:00–16:00'],
  }
}
export function decideBuyerEvent({
  item,
  policy,
  event,
}: {
  item: Item
  policy: SellerPolicy
  event: BuyerEvent
}): Decision {
  const amountCents = event.amountCents ?? null
  const locationLabel = event.locationLabel ?? null
  const slot = event.slot ?? null
  const decide = (
    status: OfferStatus,
    reason: string,
    reply: string,
    amount = amountCents,
  ): Decision => ({
    status,
    reason,
    reply,
    amountCents: amount,
    locationLabel,
    slot,
  })
  if (item.status === 'reserved')
    return decide(
      'rejected',
      'item_reserved',
      'This item is already reserved. Thanks for your interest.',
    )
  if (item.status === 'draft')
    return decide(
      'needs_review',
      'listing_inactive',
      'The seller needs to activate this listing first.',
    )
  if (policy.itemId !== item.id || !validPolicy(policy))
    return decide(
      'needs_review',
      'invalid_policy',
      'The seller needs to review the pickup rules first.',
    )
  const text = event.text ?? ''
  if (
    /\b(zelle|venmo|wire|gift\s*card|verification\s*code|whatsapp|off[ -]?platform|payment\s*link|telegram|cash\s*app)\b|https?:\/\//i.test(
      text,
    )
  )
    return decide(
      'needs_review',
      'scam_or_off_platform',
      'The seller will review this request. Please keep arrangements in this conversation.',
    )
  if (
    event.kind === 'ask_delivery' ||
    /\b(deliver\w*|ship\w*|mail|trade|swap|bundle)\b/i.test(text)
  )
    return decide(
      'needs_review',
      'delivery_or_trade',
      'This listing is pickup only. I’ve passed your request to the seller for review.',
    )
  if (
    /\b(authentic\w*|genuine|fake|counterfeit|damage\w*|broken|missing|parts?|compatible|compatibility|included|accessories|battery|warranty)\b/i.test(
      text,
    )
  )
    return decide(
      'needs_review',
      'unconfirmed_claim',
      'The seller needs to check that detail before answering.',
    )
  if (event.kind === 'condition_question') {
    if (!item.conditionConfirmed)
      return decide(
        'needs_review',
        'condition_unconfirmed',
        'The seller hasn’t confirmed the condition and functionality yet. I’ll ask them to check.',
      )
    // Do not send arbitrary free-form buyer questions through the safe template.
    if (
      text &&
      !/^(does it still work\??|what(?:’s|'s| is) (?:the|its) condition\??)$/i.test(
        text.trim(),
      )
    )
      return decide(
        'needs_review',
        'unconfirmed_claim',
        'The seller needs to check that detail before answering.',
      )
    return decide(
      'auto_replied',
      'confirmed_condition',
      `Seller-confirmed details: ${item.visibleCondition}. ${item.description}`,
    )
  }
  if (
    /\b(work\w*|function\w*|scratch\w*|crack\w*|dent\w*|stain\w*|condition|tested|test)\b|\?/i.test(
      text,
    )
  )
    return decide(
      'needs_review',
      'unconfirmed_claim',
      'The seller needs to review your question before this offer can proceed.',
    )
  if (amountCents === null)
    return decide(
      'needs_review',
      'missing_amount',
      'Please send an offer amount so the seller can review it.',
    )
  if (!validMoney(amountCents))
    return decide(
      'needs_review',
      'invalid_amount',
      'Please enter a valid non-negative amount in dollars and cents.',
    )
  if (
    !slot ||
    !policy.availableSlots.includes(slot) ||
    locationLabel !== policy.locationLabel
  )
    return decide(
      'needs_review',
      'unapproved_logistics',
      `Pickup is at ${policy.locationLabel}. Please choose ${policy.availableSlots.join(' or ')}.`,
    )
  if (amountCents < policy.minimumCents)
    return decide(
      'countered',
      'below_minimum',
      `Thanks for the offer! The asking price is ${formatCents(policy.askingCents)}. Would that work for you?`,
      policy.askingCents,
    )
  return decide(
    'awaiting_confirmation',
    'qualifying_offer',
    `Your ${formatCents(amountCents)} offer is with the seller. Pickup is only reserved once they confirm.`,
  )
}
export function canConfirmOffer({
  item,
  policy,
  offer,
}: {
  item: Item
  policy: SellerPolicy
  offer: Offer
}): { ok: true } | { ok: false; reason: string } {
  if (item.status === 'reserved')
    return { ok: false, reason: 'This item is already reserved.' }
  if (
    item.status === 'draft' ||
    offer.itemId !== item.id ||
    policy.itemId !== item.id
  )
    return {
      ok: false,
      reason: 'This offer does not belong to an active listing.',
    }
  if (
    !validPolicy(policy) ||
    offer.status !== 'awaiting_confirmation' ||
    offer.amountCents === null ||
    !validMoney(offer.amountCents) ||
    offer.amountCents < policy.minimumCents
  )
    return {
      ok: false,
      reason: 'This offer no longer meets your selling rules.',
    }
  if (
    offer.locationLabel !== policy.locationLabel ||
    !offer.slot ||
    !policy.availableSlots.includes(offer.slot)
  )
    return {
      ok: false,
      reason: 'Pickup details changed. Ask the buyer for a new offer.',
    }
  return { ok: true }
}
export function reserveOffer(session: Session, offerId: string): Session {
  const offer = session.offers.find((o) => o.id === offerId)
  const item = session.items.find((i) => i.id === offer?.itemId)
  if (!offer || !item) return session
  const policy = session.policies[item.id]
  if (!policy || !canConfirmOffer({ item, policy, offer }).ok) return session
  return {
    ...session,
    step: 'reserved',
    selectedId: item.id,
    confirmedOfferId: offer.id,
    items: session.items.map((i) =>
      i.id === item.id ? { ...i, status: 'reserved' } : i,
    ),
    offers: session.offers.map((o) =>
      o.id === offer.id
        ? { ...o, status: 'confirmed' }
        : o.itemId === item.id && o.status === 'awaiting_confirmation'
          ? { ...o, status: 'rejected', reason: 'item_reserved' }
          : o,
    ),
    messages: [
      ...session.messages,
      {
        id: crypto.randomUUID(),
        offerId,
        speaker: 'seller',
        text: `Pickup confirmed for ${offer.slot} at ${offer.locationLabel}.`,
        timestamp: new Date().toISOString(),
      },
    ],
  }
}
export function listingPack(item: Item, policy: SellerPolicy): string {
  const sourced = item.priceSource === 'evidence' && item.evidence.length > 0
  const range =
    item.estimatedLowCents !== null && item.estimatedHighCents !== null
      ? `${formatCents(item.estimatedLowCents)}–${formatCents(item.estimatedHighCents)}`
      : 'Range unavailable'
  const price = sourced
    ? `Asking ${formatCents(policy.askingCents)} · Comparable asking range ${range} (${item.sample ? 'from fictional sample listings' : 'from listings'}; not sold prices)`
    : `Asking ${formatCents(policy.askingCents)} (${item.priceSource === 'seller' ? 'seller price' : 'AI estimate'} — confirm before posting)`
  const sources = item.evidence.length
    ? item.evidence.map((e) => `- ${e.publisher}: ${e.url}`).join('\n')
    : 'No web sources stored'
  return `${item.sample ? 'SAMPLE LISTING — illustrative item and evidence, not a real offer\n\n' : ''}${item.title}\n${price}\nCondition: ${item.visibleCondition}${item.conditionConfirmed ? ' (seller confirmed)' : ' (not yet confirmed)'}\n\n${item.description}\n\nPickup only\n${policy.locationLabel}\n${policy.availableSlots.join(' · ')}\n\nSources${item.sample ? ' (fictional sample evidence)' : ''}\n${sources}`
}
