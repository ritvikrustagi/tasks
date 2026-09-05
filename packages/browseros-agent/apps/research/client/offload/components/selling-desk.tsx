import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { dollarsToCents, formatCents } from '../../../src/offload/money'
import { listingPack, validPolicy } from '../../../src/offload/negotiation'
import type {
  BuyerEvent,
  Item,
  Message,
  Offer,
  SellerPolicy,
} from '../../../src/offload/types'
import { ItemImage } from './item-image'
import { OfferCard } from './offer-card'

export function SellingDesk({
  item,
  items,
  policy,
  offers,
  messages,
  onSelect,
  onPolicy,
  onActivate,
  onEvent,
  onConfirm,
  onBack,
  onViewReservation,
}: {
  item: Item
  items: Item[]
  policy: SellerPolicy
  offers: Offer[]
  messages: Message[]
  onSelect: (id: string) => void
  onPolicy: (policy: SellerPolicy) => void
  onActivate: () => void
  onEvent: (event: BuyerEvent) => void
  onConfirm: (id: string) => void
  onBack: () => void
  onViewReservation: () => void
}) {
  const [ask, setAsk] = useState((policy.askingCents / 100).toFixed(2))
  const [floor, setFloor] = useState((policy.minimumCents / 100).toFixed(2))
  const [location, setLocation] = useState(policy.locationLabel)
  const [slots, setSlots] = useState<[string, string]>([
    ...policy.availableSlots,
  ])
  const [formError, setFormError] = useState('')
  const [copied, setCopied] = useState(false)
  const [pack, setPack] = useState<string | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [customSlot, setCustomSlot] = useState(policy.availableSlots[0])
  const [customText, setCustomText] = useState('')
  const [buyerError, setBuyerError] = useState('')
  const conversationRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = conversationRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages.length])
  const dirty =
    dollarsToCents(ask) !== policy.askingCents ||
    dollarsToCents(floor) !== policy.minimumCents ||
    location !== policy.locationLabel ||
    slots.some((s, i) => s !== policy.availableSlots[i])
  const reserved = item.status === 'reserved'
  const active = item.status !== 'draft' && !reserved
  const disabled = !active || dirty
  const emit = (
    kind: BuyerEvent['kind'],
    alias: string,
    amountCents?: number,
    text?: string,
  ) =>
    onEvent({
      kind,
      buyerAlias: alias,
      amountCents,
      locationLabel: policy.locationLabel,
      slot: policy.availableSlots[0],
      text,
    })
  async function copyPack() {
    const value = listingPack(item, policy)
    setPack(value)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <section className="screen desk-screen">
      <div className="section-heading">
        <div>
          <p className="eyebrow green-text">Your stuff. Your terms.</p>
          <h1>
            A good deal starts
            <br />
            with <em>clear boundaries.</em>
          </h1>
          <p>
            Set the rules. We’ll handle the back-and-forth. You make the final
            call.
          </p>
        </div>
        <span className="badge marketplace">
          <span className="dot" /> Demo marketplace
        </span>
      </div>
      <div className="desk-layout">
        <aside className="rules-panel">
          <div className="panel-header">
            <h2>Your listing</h2>
            <button className="text-button" onClick={onBack}>
              Edit items
            </button>
          </div>
          <label className="sr-only" htmlFor="selected-item">
            Selected listing
          </label>
          <select
            id="selected-item"
            value={item.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
                {i.status === 'reserved' ? ' · Reserved' : ''}
              </option>
            ))}
          </select>
          <div className="desk-item">
            <ItemImage item={item} />
            <div>
              <span className="eyebrow">
                {item.sample ? 'Sample item' : item.category}
              </span>
              <h3>{item.title}</h3>
              <strong>{formatCents(policy.askingCents)}</strong>
            </div>
          </div>
          <form
            className="policy-form"
            onSubmit={(e) => {
              e.preventDefault()
              const askingCents = dollarsToCents(ask),
                minimumCents = dollarsToCents(floor)
              const next = {
                ...policy,
                askingCents: askingCents ?? -1,
                minimumCents: minimumCents ?? -1,
                locationLabel: location.trim(),
                availableSlots: slots.map((s) => s.trim()) as [string, string],
              }
              if (!validPolicy(next)) {
                setFormError(
                  'Use valid prices (minimum at or below ask), a public meeting place, and two different time slots.',
                )
                return
              }
              onPolicy(next)
              setLocation(next.locationLabel)
              setSlots(next.availableSlots)
              setCustomSlot(next.availableSlots[0])
              setFormError('')
            }}
          >
            <div className="row between">
              <h2>Selling rules</h2>
              <LockKeyhole size={15} />
            </div>
            <fieldset disabled={reserved}>
              <div className="form-pair">
                <label>
                  Asking price ($)
                  <input
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label>
                  Private minimum ($)
                  <input
                    type="password"
                    autoComplete="off"
                    inputMode="decimal"
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    required
                  />
                </label>
              </div>
              <p className="private-note">
                <LockKeyhole size={12} />
                Your minimum stays private. Buyers only see your ask.
              </p>
              <label>
                Public pickup location
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  required
                  maxLength={160}
                />
              </label>
              <label>
                Pickup option 1
                <input
                  value={slots[0]}
                  onChange={(e) => setSlots([e.target.value, slots[1]])}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Pickup option 2
                <input
                  value={slots[1]}
                  onChange={(e) => setSlots([slots[0], e.target.value])}
                  required
                  maxLength={100}
                />
              </label>
              <p className="safe-note">
                <MapPin size={14} />
                Pickup only. No shipping or payments in this demo.
              </p>
              {formError && (
                <p className="error-text" role="alert">
                  {formError}
                </p>
              )}
              <button
                className="button secondary full"
                type="submit"
                disabled={!dirty}
              >
                {dirty ? (
                  'Save selling rules'
                ) : (
                  <>
                    <Check size={15} /> Rules saved
                  </>
                )}
              </button>
            </fieldset>
          </form>
          <button
            className="button full"
            disabled={dirty || reserved || active}
            onClick={onActivate}
          >
            {reserved ? (
              'Item reserved'
            ) : active ? (
              <>
                <Check size={16} /> Demo listing active
              </>
            ) : (
              'Activate demo listing'
            )}
          </button>
          <button
            className="text-button copy-button"
            disabled={dirty}
            onClick={() => void copyPack()}
          >
            <Copy size={15} />
            {copied ? 'Copied · view listing pack' : 'Copy listing pack'}
          </button>
          {reserved && (
            <button
              className="button secondary full"
              onClick={onViewReservation}
            >
              View reservation
            </button>
          )}
        </aside>
        <div className="conversation-panel">
          <div className="panel-header">
            <div className="row">
              <span className="icon-tile small">
                <MessageCircle size={20} />
              </span>
              <div>
                <h2>The conversation</h2>
                <p className="small muted">
                  Simulated buyers · real selling rules
                </p>
              </div>
            </div>
            <span className={`badge ${active ? 'green' : 'neutral'}`}>
              {reserved ? 'Reserved' : active ? 'Listing active' : 'Draft'}
            </span>
          </div>
          <div
            ref={conversationRef}
            className="conversation"
            aria-live="polite"
            role="log"
            aria-label="Buyer conversation"
          >
            {messages.length ? (
              messages.map((message) => {
                const offer = offers.find((o) => o.id === message.offerId)
                return (
                  <div
                    key={message.id}
                    className={`message ${message.speaker}`}
                  >
                    <span className="message-speaker">
                      {message.speaker === 'buyer'
                        ? (offer?.buyerAlias ?? 'Buyer')
                        : message.speaker === 'seller'
                          ? 'You'
                          : 'Offload'}
                    </span>
                    <p>{message.text}</p>
                  </div>
                )
              })
            ) : (
              <div className="conversation-empty">
                <span className="conversation-orbit">
                  <MessageCircle size={32} />
                </span>
                <h3>A little less back-and-forth.</h3>
                <p>
                  {active
                    ? 'Choose a demo buyer below to see your rules in action.'
                    : 'Activate your listing, then invite a demo buyer to the conversation.'}
                </p>
              </div>
            )}
          </div>
          <div className="buyer-controls">
            <div className="row between">
              <span className="eyebrow">
                <Sparkles size={13} /> Try a demo buyer
              </span>
              <span className="small muted">Nothing is posted publicly</span>
            </div>
            {dirty && (
              <p className="warning-note">
                Save your updated rules to continue.
              </p>
            )}
            <div className="demo-buttons">
              <button
                disabled={disabled || policy.minimumCents === 0}
                onClick={() =>
                  emit('low_offer', 'Jordan', policy.minimumCents - 1)
                }
              >
                Low offer
              </button>
              <button
                disabled={disabled}
                onClick={() => emit('accept_asking', 'Sam', policy.askingCents)}
              >
                Accept asking price
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  emit(
                    'ask_delivery',
                    'Riley',
                    undefined,
                    'Can you deliver it?',
                  )
                }
              >
                Ask for delivery
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  emit(
                    'condition_question',
                    'Jordan',
                    undefined,
                    'Does it still work?',
                  )
                }
              >
                Does it still work?
              </button>
            </div>
            {policy.minimumCents === 0 && (
              <small>
                A low offer isn’t available for these selling rules.
              </small>
            )}
            <form
              className="custom-offer"
              onSubmit={(e) => {
                e.preventDefault()
                const amountCents = dollarsToCents(customAmount)
                if (amountCents === null) {
                  setBuyerError('Enter a valid offer amount.')
                  return
                }
                onEvent({
                  kind: 'custom_offer',
                  buyerAlias: 'Taylor',
                  amountCents,
                  slot: customSlot,
                  locationLabel: policy.locationLabel,
                  text: customText || undefined,
                })
                setBuyerError('')
                setCustomText('')
              }}
            >
              <fieldset disabled={disabled}>
                <div className="custom-offer-row">
                  <label>
                    Custom offer ($)
                    <input
                      placeholder="Your offer"
                      inputMode="decimal"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Pickup slot
                    <select
                      value={customSlot}
                      onChange={(e) => setCustomSlot(e.target.value)}
                    >
                      {policy.availableSlots.map((slot) => (
                        <option key={slot}>{slot}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="send-button"
                    aria-label="Send custom offer"
                    type="submit"
                  >
                    <Send size={18} />
                  </button>
                </div>
                <label className="custom-message">
                  Buyer message (optional)
                  <input
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Try a delivery, condition, or payment question…"
                    maxLength={500}
                  />
                </label>
              </fieldset>
              {buyerError && (
                <p role="alert" className="error-text">
                  {buyerError}
                </p>
              )}
            </form>
          </div>
        </div>
        <aside className="offers-panel">
          <div className="panel-header">
            <h2>Your offers</h2>
            <span className="count">{offers.length}</span>
          </div>
          {offers.length ? (
            <div className="offer-list">
              {[...offers].reverse().map((offer) => (
                <OfferCard
                  key={offer.id}
                  item={item}
                  policy={policy}
                  offer={offer}
                  onConfirm={onConfirm}
                  disabled={dirty}
                />
              ))}
            </div>
          ) : (
            <div className="offers-empty">
              <ShieldCheck size={27} />
              <h3>You have the final say.</h3>
              <p>Offers that meet your rules appear here for confirmation.</p>
            </div>
          )}
          <div className="desk-reassurance">
            <LockKeyhole size={16} />
            <p>
              No deal is done until you say so. Your minimum is never shared
              with buyers.
            </p>
          </div>
        </aside>
      </div>
      {pack !== null && (
        <div className="modal-backdrop">
          <section
            className="pack-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pack-title"
          >
            <div className="row between">
              <h2 id="pack-title">Your listing pack</h2>
              <button
                className="button secondary"
                autoFocus
                onClick={() => setPack(null)}
              >
                Close
              </button>
            </div>
            <p className="small muted">
              {copied
                ? 'Copied to your clipboard. Paste it into a marketplace when you’re ready.'
                : 'Select and copy the text below to post it manually.'}
            </p>
            <textarea
              aria-label="Copyable listing pack"
              readOnly
              value={pack}
              onFocus={(e) => e.target.select()}
            />
            <span className="badge neutral">
              Demo marketplace · no automatic posting
            </span>
          </section>
        </div>
      )}
    </section>
  )
}
