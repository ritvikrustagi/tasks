import { describe, expect, it } from 'bun:test'
import { createSampleItems } from '../client/offload/lib/demo-fixtures'
import {
  canConfirmOffer,
  decideBuyerEvent,
  defaultPolicy,
  listingPack,
  reserveOffer,
} from '../src/offload/negotiation'
import { dollarsToCents, formatCents } from '../src/offload/money'
import { emptySession } from '../client/offload/lib/storage'
import type {
  BuyerEvent,
  Item,
  Offer,
  SellerPolicy,
  Session,
} from '../src/offload/types'

function fixture() {
  const item: Item = { ...createSampleItems()[0], status: 'listed' }
  const policy: SellerPolicy = { ...defaultPolicy(item), minimumCents: 3275 }
  const event: BuyerEvent = {
    kind: 'custom_offer',
    buyerAlias: 'Sam',
    amountCents: policy.askingCents,
    locationLabel: policy.locationLabel,
    slot: policy.availableSlots[0],
  }
  const offer: Offer = {
    id: 'offer-1',
    itemId: item.id,
    buyerAlias: 'Sam',
    amountCents: policy.askingCents,
    locationLabel: policy.locationLabel,
    slot: policy.availableSlots[0],
    status: 'awaiting_confirmation',
    reason: 'qualifying_offer',
    policySnapshot: { ...policy },
  }
  return { item, policy, event, offer }
}
describe('buyer policy', () => {
  it('counters below the minimum at ask without revealing the minimum', () => {
    const f = fixture()
    f.event.amountCents = f.policy.minimumCents - 1
    const result = decideBuyerEvent(f)
    expect(result.status).toBe('countered')
    expect(result.amountCents).toBe(f.policy.askingCents)
    expect(result.reply).toContain(formatCents(f.policy.askingCents))
    expect(result.reply).not.toContain('32.75')
    expect(result.reply).not.toContain('3275')
  })
  it.each([3275, 3276, 4500, 9000])(
    'waits for seller confirmation for valid offer %i',
    (amount) => {
      const f = fixture()
      f.event.amountCents = amount
      expect(decideBuyerEvent(f).status).toBe('awaiting_confirmation')
    },
  )
  it.each([
    'Could you deliver?',
    'Can you ship it?',
    'trade',
    'swap',
    'bundle',
    'mail it',
  ])('escalates delivery and trades: %s', (text) => {
    const f = fixture()
    f.event.text = text
    expect(decideBuyerEvent(f)).toMatchObject({
      status: 'needs_review',
      reason: 'delivery_or_trade',
    })
  })
  it('escalates the delivery button without message text', () => {
    const f = fixture()
    f.event.kind = 'ask_delivery'
    expect(decideBuyerEvent(f).reason).toBe('delivery_or_trade')
  })
  it.each([
    'Zelle',
    'Venmo',
    'wire',
    'gift card',
    'verification code',
    'WhatsApp',
    'off-platform',
    'https://payment.invalid',
  ])('escalates payment and off-platform requests: %s', (text) => {
    const f = fixture()
    f.event.text = text
    expect(decideBuyerEvent(f).reason).toBe('scam_or_off_platform')
  })
  it('rejects events for reserved items', () => {
    const f = fixture()
    f.item.status = 'reserved'
    expect(decideBuyerEvent(f).status).toBe('rejected')
  })
  it('does not accept drafts', () => {
    const f = fixture()
    f.item.status = 'draft'
    expect(decideBuyerEvent(f).reason).toBe('listing_inactive')
  })
  it.each(['slot', 'locationLabel'] as const)(
    'does not accept an unapproved %s',
    (key) => {
      const f = fixture()
      f.event[key] = 'Not approved'
      expect(decideBuyerEvent(f).reason).toBe('unapproved_logistics')
    },
  )
  it('does not invent missing logistics', () => {
    const f = fixture()
    delete f.event.slot
    expect(decideBuyerEvent(f).status).toBe('needs_review')
  })
  it('answers condition questions with confirmed facts only', () => {
    const f = fixture()
    f.event.kind = 'condition_question'
    f.event.text = 'Does it still work?'
    f.item.conditionConfirmed = true
    const result = decideBuyerEvent(f)
    expect(result.status).toBe('auto_replied')
    expect(result.reply).toBe(
      `Seller-confirmed details: ${f.item.visibleCondition}. ${f.item.description}`,
    )
  })
  it('escalates condition questions before confirmation', () => {
    const f = fixture()
    f.event.kind = 'condition_question'
    expect(decideBuyerEvent(f).reason).toBe('condition_unconfirmed')
  })
  it.each([
    'Is it authentic?',
    'Is the battery new?',
    'Does it have missing parts?',
    'Is it compatible?',
    'Is it scratched?',
    'Does it work?',
  ])('does not accept an offer with a new factual question: %s', (text) => {
    const f = fixture()
    f.item.conditionConfirmed = true
    f.event.text = text
    expect(decideBuyerEvent(f).status).toBe('needs_review')
  })
  it('does not use the safe template for an arbitrary question', () => {
    const f = fixture()
    f.item.conditionConfirmed = true
    f.event.kind = 'condition_question'
    f.event.text = 'Can I use this outdoors?'
    expect(decideBuyerEvent(f).status).toBe('needs_review')
  })
  it('escalates a missing amount', () => {
    const f = fixture()
    delete f.event.amountCents
    expect(decideBuyerEvent(f).reason).toBe('missing_amount')
  })
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    'rejects invalid money %s',
    (amount) => {
      const f = fixture()
      f.event.amountCents = amount
      expect(decideBuyerEvent(f).reason).toBe('invalid_amount')
    },
  )
  it('allows a zero-priced item', () => {
    const f = fixture()
    f.policy.askingCents = 0
    f.policy.minimumCents = 0
    f.event.amountCents = 0
    expect(decideBuyerEvent(f).status).toBe('awaiting_confirmation')
  })
})
describe('confirmation guard', () => {
  it('blocks below-floor confirmation', () => {
    const f = fixture()
    f.offer.amountCents = 3274
    expect(canConfirmOffer(f).ok).toBe(false)
  })
  it('blocks a reservation when already reserved', () => {
    const f = fixture()
    f.item.status = 'reserved'
    expect(canConfirmOffer(f).ok).toBe(false)
  })
  it('blocks offers that are not awaiting confirmation', () => {
    const f = fixture()
    f.offer.status = 'needs_review'
    expect(canConfirmOffer(f).ok).toBe(false)
  })
  it('checks the current minimum, not just the saved snapshot', () => {
    const f = fixture()
    f.offer.amountCents = 3500
    f.policy.minimumCents = 4000
    expect(canConfirmOffer(f).ok).toBe(false)
  })
  it('checks the current meeting location', () => {
    const f = fixture()
    f.policy.locationLabel = 'Campus cafe'
    expect(canConfirmOffer(f).ok).toBe(false)
  })
  it('checks the current pickup slots', () => {
    const f = fixture()
    f.policy.availableSlots = ['Monday', 'Tuesday']
    expect(canConfirmOffer(f).ok).toBe(false)
  })
  it('checks item identity', () => {
    const f = fixture()
    f.offer.itemId = 'other-item'
    expect(canConfirmOffer(f).ok).toBe(false)
  })
  it('is idempotent and rejects competing offers', () => {
    const f = fixture()
    const session: Session = {
      ...emptySession(),
      items: [f.item],
      policies: { [f.item.id]: f.policy },
      offers: [f.offer, { ...f.offer, id: 'offer-2', buyerAlias: 'Jordan' }],
    }
    const reserved = reserveOffer(session, f.offer.id)
    expect(reserved.items[0].status).toBe('reserved')
    expect(reserved.offers[0].status).toBe('confirmed')
    expect(reserved.offers[1].status).toBe('rejected')
    expect(reserveOffer(reserved, f.offer.id)).toBe(reserved)
    expect(reserveOffer(reserved, 'offer-2')).toBe(reserved)
    expect(reserved.messages).toHaveLength(1)
    expect(session.items[0].status).toBe('listed')
  })
})
describe('listing export and money', () => {
  it('includes listing facts, pickup and sources without the minimum', () => {
    const f = fixture(),
      pack = listingPack(f.item, f.policy)
    for (const text of [
      f.item.title,
      formatCents(f.policy.askingCents),
      f.item.visibleCondition,
      'Pickup only',
      f.policy.locationLabel,
      f.policy.availableSlots[0],
      f.item.evidence[0].url,
    ])
      expect(pack).toContain(text)
    expect(pack).not.toContain('32.75')
    expect(pack).not.toContain('minimum')
    expect(pack).toContain('SAMPLE LISTING')
  })
  it('labels missing sources', () => {
    const f = fixture()
    f.item.evidence = []
    expect(listingPack(f.item, f.policy)).toContain('No web sources stored')
  })
  it('does not claim seller prices are AI estimates', () => {
    const f = fixture()
    f.item.priceSource = 'seller'
    expect(listingPack(f.item, f.policy)).toContain('seller price')
  })
  it.each([
    ['12.34', 1234],
    ['0.01', 1],
    ['0', 0],
    ['450', 45000],
    ['1.1', 110],
  ])('converts %s to integer cents', (input, expected) =>
    expect(dollarsToCents(String(input))).toBe(expected),
  )
  it.each(['', '-1', '1e3', '1.001', 'NaN', 'Infinity', '0x10', '1,000'])(
    'rejects invalid price %s',
    (value) => expect(dollarsToCents(value)).toBeNull(),
  )
})
