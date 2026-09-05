import { ArrowRight, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react'
import { formatCents } from '../../../src/offload/money'
import { canConfirmOffer } from '../../../src/offload/negotiation'
import type { Item, Offer, SellerPolicy } from '../../../src/offload/types'
const labels = {
  rejected: 'Not available',
  countered: 'Counter sent',
  needs_review: 'Needs your review',
  awaiting_confirmation: 'Ready for your decision',
  confirmed: 'Pickup confirmed',
  auto_replied: 'Answered from your listing',
}
export function OfferCard({
  item,
  policy,
  offer,
  onConfirm,
  disabled,
}: {
  item: Item
  policy: SellerPolicy
  offer: Offer
  onConfirm: (id: string) => void
  disabled: boolean
}) {
  const check = canConfirmOffer({ item, policy, offer })
  return (
    <article
      className={`offer-card ${offer.status === 'awaiting_confirmation' ? 'qualifying' : ''}`}
    >
      <div className="row between">
        <span className="eyebrow">
          {offer.status === 'countered'
            ? `Counter to ${offer.buyerAlias}`
            : `${offer.buyerAlias}’s ${offer.amountCents === null ? 'request' : 'offer'}`}
        </span>
        {offer.status === 'confirmed' ? (
          <CheckCircle2 size={18} />
        ) : (
          <Clock3 size={18} />
        )}
      </div>
      {offer.amountCents !== null && (
        <strong className="offer-amount">
          {formatCents(offer.amountCents)}
        </strong>
      )}
      <p className="offer-status">{labels[offer.status]}</p>
      {offer.slot && (
        <p className="small muted">
          {offer.locationLabel}
          <br />
          {offer.slot}
        </p>
      )}
      {offer.status === 'awaiting_confirmation' && (
        <>
          <p className="safe-note">
            <ShieldCheck size={15} />
            Your selling rules are checked again when you confirm.
          </p>
          <button
            className="button"
            disabled={!check.ok || disabled}
            onClick={() => onConfirm(offer.id)}
          >
            Confirm pickup <ArrowRight size={16} />
          </button>
          {!check.ok && <p className="error-text">{check.reason}</p>}
        </>
      )}
      {offer.status === 'needs_review' && (
        <p className="small muted">
          No acceptance was sent. Check the conversation; a new offer using your
          approved pickup rules can continue the demo.
        </p>
      )}
    </article>
  )
}
