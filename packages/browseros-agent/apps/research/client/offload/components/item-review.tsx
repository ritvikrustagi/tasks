import { ResearchActions } from './research-actions'
import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Pencil,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { formatCents, dollarsToCents } from '../../../src/offload/money'
import type { Item } from '../../../src/offload/types'
import { ItemImage } from './item-image'

export function PriceBadge({ item }: { item: Item }) {
  return (
    <span
      className={`badge ${item.priceSource === 'evidence' && item.evidence.length ? 'green' : 'neutral'}`}
    >
      {item.priceSource === 'evidence' && item.evidence.length ? (
        <>
          <ShieldCheck size={12} />{' '}
          {item.sample ? 'From listings · sample' : 'From listings'}
        </>
      ) : item.priceSource === 'seller' ? (
        'Seller price'
      ) : (
        'AI estimate'
      )}
    </span>
  )
}
function ReviewCard({
  item,
  onChange,
  onDelete,
}: {
  item: Item
  onChange: (patch: Partial<Item>) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [original, setOriginal] = useState(false)
  const [error, setError] = useState('')
  const locked = item.status === 'reserved' || !!item.researchJobId
  return (
    <article className={`item-card ${item.selected ? 'selected' : ''}`}>
      <div className="item-photo">
        <ItemImage item={item} original={original} />
        <label className="select-item">
          <input
            aria-label={`Select ${item.title}`}
            type="checkbox"
            checked={item.selected}
            disabled={locked}
            onChange={(e) => onChange({ selected: e.target.checked })}
          />
          <span>
            <Check size={14} />
          </span>
        </label>
        <span className="photo-label">
          {item.sample
            ? 'SAMPLE ILLUSTRATION'
            : original
              ? 'ORIGINAL FRAME'
              : 'YOUR PHOTO'}
        </span>
        <button className="photo-toggle" onClick={() => setOriginal(!original)}>
          {original ? 'Listing image' : 'View original'}
        </button>
      </div>
      <div className="item-content">
        <div className="row between">
          <span className="eyebrow">{item.category}</span>
          <PriceBadge item={item} />
        </div>
        <h3>{item.title}</h3>
        <p className="item-description">{item.description}</p>
        <div className="price-row">
          <strong>{formatCents(item.askingCents)}</strong>
          <div>
            <span>Suggested range</span>
            <b>
              {item.estimatedLowCents !== null &&
              item.estimatedHighCents !== null
                ? `${formatCents(item.estimatedLowCents)}–${formatCents(item.estimatedHighCents)}`
                : 'Not established'}
            </b>
          </div>
        </div>
        <div className="card-actions">
          <button
            className="text-button"
            disabled={locked}
            onClick={() => setEditing(!editing)}
          >
            <Pencil size={14} />
            {editing ? 'Close editor' : 'Edit listing'}
          </button>
          <button
            className="icon-button"
            aria-label={`Delete ${item.title}`}
            disabled={locked}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
        {editing && (
          <form
            className="edit-form"
            onSubmit={(e) => {
              e.preventDefault()
              const data = new FormData(e.currentTarget)
              const askingCents = dollarsToCents(String(data.get('ask')))
              if (askingCents === null) {
                setError(
                  'Enter a valid asking price with up to two decimal places.',
                )
                return
              }
              onChange({
                title: String(data.get('title')).trim(),
                description: String(data.get('description')).trim(),
                brand: String(data.get('brand')).trim() || null,
                model: String(data.get('model')).trim() || null,
                visibleCondition: String(data.get('condition')).trim(),
                askingCents,
                ...(askingCents !== item.askingCents
                  ? { priceSource: 'seller' as const }
                  : {}),
                category: String(data.get('category')).trim(),
                ...([
                  ['title', item.title],
                  ['brand', item.brand ?? ''],
                  ['model', item.model ?? ''],
                  ['category', item.category],
                  ['condition', item.visibleCondition],
                ].some(
                  ([field, old]) => String(data.get(field!)).trim() !== old,
                )
                  ? {
                      evidence: [],
                      researchQueries: [],
                      researchStatus: 'idle' as const,
                      priceSource: 'seller' as const,
                      estimatedLowCents: null,
                      estimatedHighCents: null,
                      followUpDecision:
                        'Identity or condition changed. Recheck prices for these details.',
                    }
                  : {}),
                conditionConfirmed: false,
              })
              setEditing(false)
              setError('')
            }}
          >
            <fieldset disabled={locked}>
              <label>
                Title
                <input
                  name="title"
                  defaultValue={item.title}
                  required
                  maxLength={160}
                />
              </label>
              <label>
                Category
                <input
                  name="category"
                  defaultValue={item.category}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={item.description}
                  required
                  maxLength={2000}
                />
              </label>
              <div className="form-pair">
                <label>
                  Brand
                  <input
                    name="brand"
                    defaultValue={item.brand ?? ''}
                    placeholder="Unknown"
                  />
                </label>
                <label>
                  Model
                  <input
                    name="model"
                    defaultValue={item.model ?? ''}
                    placeholder="Unknown"
                  />
                </label>
              </div>
              <label>
                Condition & functionality
                <textarea
                  name="condition"
                  defaultValue={item.visibleCondition}
                  required
                />
              </label>
              <label>
                Asking price ($)
                <input
                  name="ask"
                  inputMode="decimal"
                  defaultValue={(item.askingCents / 100).toFixed(2)}
                  required
                />
              </label>
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <button className="button secondary" type="submit">
                Save listing
              </button>
              <small>Editing facts resets your condition confirmation.</small>
            </fieldset>
          </form>
        )}
        <ResearchActions item={item} onChange={onChange} />
        <details className="evidence">
          <summary>
            Sources & details <ChevronDown size={15} />
          </summary>
          <div className="evidence-body">
            <p>
              <b>Research:</b> {item.researchStatus} · Identity:{' '}
              {item.identityConfidence}
            </p>
            <p>
              Brand: {item.brand ?? 'Unknown'} · Model:{' '}
              {item.model ?? 'Unknown'}
            </p>
            {item.evidence.length ? (
              item.evidence.map((e) => (
                <div key={e.id} className="source">
                  <a
                    href={/^https?:\/\//.test(e.url) ? e.url : undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {e.publisher}
                    <ExternalLink size={12} />
                  </a>
                  <p>{e.snippet}</p>
                </div>
              ))
            ) : (
              <p>No web sources stored. Treat pricing as an estimate.</p>
            )}
            {item.researchQueries.map((q) => (
              <p key={q.id}>
                <b>Search {q.pass}:</b> {q.query}
                <br />
                <small>
                  {q.reason} · {q.status}
                </small>
              </p>
            ))}
            <p>{item.followUpDecision}</p>
            {[...item.warnings, ...item.needsConfirmation].map(
              (warning, index) => (
                <p className="warning-note" key={index}>
                  {warning}
                </p>
              ),
            )}
          </div>
        </details>
        <p className="condition-notes">
          <b>Condition notes:</b> {item.visibleCondition}
        </p>
        <label
          className={`condition-check ${item.conditionConfirmed ? 'confirmed' : ''}`}
        >
          <input
            type="checkbox"
            checked={item.conditionConfirmed}
            disabled={locked}
            onChange={(e) => onChange({ conditionConfirmed: e.target.checked })}
          />
          <span>
            <b>
              {item.conditionConfirmed
                ? 'Condition confirmed'
                : 'One quick check'}
            </b>
            <small>
              I confirm the condition and functionality described in this
              listing.
            </small>
          </span>
        </label>
        {item.status === 'reserved' && (
          <span className="badge green">Reserved · editing locked</span>
        )}
      </div>
    </article>
  )
}
export function ItemReview({
  items,
  onChange,
  onDelete,
  onContinue,
  onScan,
}: {
  items: Item[]
  onChange: (id: string, patch: Partial<Item>) => void
  onDelete: (id: string) => void
  onContinue: () => void
  onScan: () => void
}) {
  const selected = items.filter((i) => i.selected && i.status !== 'reserved')
  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <p className="eyebrow green-text">A fresh start for your stuff</p>
          <h1>
            Your next chapter.
            <br />
            <em>Their next favorite.</em>
          </h1>
          <p>
            Review your drafts, add the details only you know, and set your
            price.
          </p>
        </div>
        <button className="button secondary" onClick={onScan}>
          Add more items <span>+</span>
        </button>
      </div>
      {items.some((i) => i.sample) && (
        <div className="sample-notice">
          <span className="badge neutral">Sample items</span> Illustrations,
          prices, and sample sources are fictional. No live scan or search has
          run.
        </div>
      )}
      {items.length ? (
        <div className="item-grid">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              onChange={(patch) => onChange(item.id, patch)}
              onDelete={() => onDelete(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>A clean slate.</h3>
          <p>Add photos or try sample items to create your first listings.</p>
          <button className="button" onClick={onScan}>
            Back to scan
          </button>
        </div>
      )}
      <div className="review-summary">
        <div>
          <span className="eyebrow">Your selected items</span>
          <p>
            <strong>
              {formatCents(selected.reduce((sum, i) => sum + i.askingCents, 0))}
            </strong>
            <span>
              {selected.length} {selected.length === 1 ? 'item' : 'items'} ·
              total asking value
            </span>
          </p>
        </div>
        <button
          className="button"
          disabled={!selected.length}
          onClick={onContinue}
        >
          Set your selling rules <ArrowRight size={17} />
        </button>
      </div>
    </section>
  )
}
