import './offload.css'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  Leaf,
  LoaderCircle,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { ScanUpload } from './components/scan-upload'
import { ItemReview } from './components/item-review'
import { ItemImage } from './components/item-image'
import { SellingDesk } from './components/selling-desk'
import { addSampleItems } from './lib/demo-fixtures'
import { formatCents } from '../../src/offload/money'
import {
  canConfirmOffer,
  decideBuyerEvent,
  reserveOffer,
  listingPack,
} from '../../src/offload/negotiation'
import {
  configureStorage,
  emptySession,
  importPipeline,
  loadSession,
  resetStorage,
  saveSession,
} from './lib/storage'
import type {
  BuyerEvent,
  Item,
  Offer,
  PipelineItem,
  RunMetrics,
  Session,
  Step,
} from '../../src/offload/types'

const steps: { id: Step; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'listings', label: 'Listings' },
  { id: 'desk', label: 'Deal' },
  { id: 'reserved', label: 'Reserved' },
]
class ScanBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: '' }
  static getDerivedStateFromError(error: unknown) {
    return {
      failed: true,
      message:
        error instanceof Error
          ? error.message
          : 'An unexpected error interrupted the scan.',
    }
  }
  render() {
    return this.state.failed ? (
      <div className="scan-placeholder">
        <h3>The scan couldn’t finish.</h3>
        <p role="alert">{this.state.message}</p>
        <button
          className="button secondary"
          onClick={() => this.setState({ failed: false, message: '' })}
        >
          Retry scan
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
export default function Offload({ scanId }: { scanId?: string | null }) {
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void fetch('/api/offload/config')
      .then(async (r) => {
        if (!r.ok) throw new Error('Sign in to open your selling workspace')
        const data = await r.json()
        if (!cancelled) {
          configureStorage(data.storageKey)
          setStorageKey(data.storageKey)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (error) return <p role="alert">{error}</p>
  if (!storageKey) return <p>Opening selling workspace…</p>
  return <SellingWorkspace key={storageKey} scanId={scanId} />
}
function SellingWorkspace({ scanId }: { scanId?: string | null }) {
  const [session, setSession] = useState<Session>(emptySession)
  const current = useRef(session)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('Opening your workspace…')
  const [stage, setStage] = useState('')
  const [health, setHealth] = useState('Sample only')
  const [resetOpen, setResetOpen] = useState(false)
  const saveVersion = useRef(0)
  const operation = useRef(false)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [session.step])
  useEffect(() => {
    let cancelled = false
    void loadSession()
      .then((value) => {
        if (!cancelled) {
          current.current = value
          setSession(value)
          setSaved('Saved on this device')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Local storage is unavailable. Changes may not survive refresh.',
          )
          setSaved('Storage unavailable')
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    const controller = new AbortController()
    void fetch('/api/offload/config', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled)
          setHealth(
            data.ready
              ? data.local
                ? 'Local workflow testing'
                : 'Background scans connected'
              : 'Live setup needed · samples ready',
          )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])
  useEffect(() => {
    if (scanId && ready) {
      current.current = { ...current.current, step: 'scan' }
      setSession(current.current)
    }
  }, [scanId, ready])
  function commit(next: Session) {
    current.current = next
    setSession(next)
    setSaved('Saving…')
    const version = ++saveVersion.current
    void saveSession(next)
      .then(() => {
        if (version === saveVersion.current) setSaved('Saved on this device')
      })
      .catch(() => {
        setSaved('Changes not saved')
        setError(
          'Your changes are still visible, but could not be saved on this device. Free some browser storage and try again before refreshing.',
        )
      })
  }
  function go(step: Step) {
    commit({ ...current.current, step })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function addSamples() {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      commit(await addSampleItems(current.current))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load samples.')
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  async function onPipeline(items: PipelineItem[], metrics: RunMetrics) {
    if (operation.current)
      throw new Error(
        'Another operation is still finishing. Please retry importing your drafts.',
      )
    operation.current = true
    setBusy(true)
    setError('')
    try {
      if (!items.length)
        throw new Error(
          'No listing drafts were returned. Retry with clearer photos.',
        )
      const next = await importPipeline(items, metrics, current.current)
      await saveSession(next)
      commit(next)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not save the scanned items. Please retry.',
      )
      throw err
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  function exportListings() {
    const value = current.current
    const text = value.items
      .filter((i) => i.selected)
      .map((i) => listingPack(i, value.policies[i.id]))
      .join('\n\n---\n\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'offload-listings.md'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function updateItem(id: string, patch: Partial<Item>) {
    const value = current.current,
      item = value.items.find((i) => i.id === id)
    if (!item || item.status === 'reserved') return
    const policies = { ...value.policies }
    if (patch.askingCents !== undefined)
      policies[id] = {
        ...policies[id],
        askingCents: patch.askingCents,
        minimumCents: Math.min(policies[id].minimumCents, patch.askingCents),
      }
    commit({
      ...value,
      policies,
      items: value.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    })
  }
  function deleteItem(id: string) {
    const value = current.current
    if (value.items.find((i) => i.id === id)?.status === 'reserved') return
    const items = value.items.filter((i) => i.id !== id),
      offers = value.offers.filter((o) => o.itemId !== id)
    const policies = { ...value.policies }
    delete policies[id]
    commit({
      ...value,
      items,
      offers,
      policies,
      selectedId:
        value.selectedId === id ? (items[0]?.id ?? null) : value.selectedId,
      messages: value.messages.filter((m) =>
        offers.some((o) => o.id === m.offerId),
      ),
    })
  }
  function buyerEvent(event: BuyerEvent) {
    const value = current.current,
      item = value.items.find((i) => i.id === value.selectedId)
    if (!item) return
    const policy = value.policies[item.id],
      decision = decideBuyerEvent({ item, policy, event })
    const offer: Offer = {
      id: crypto.randomUUID(),
      itemId: item.id,
      buyerAlias: event.buyerAlias,
      amountCents: decision.amountCents,
      locationLabel: decision.locationLabel,
      slot: decision.slot,
      status: decision.status,
      reason: decision.reason,
      policySnapshot: {
        askingCents: policy.askingCents,
        minimumCents: policy.minimumCents,
        locationLabel: policy.locationLabel,
        availableSlots: [...policy.availableSlots],
      },
    }
    const incoming = `${event.amountCents !== undefined ? `I can offer ${formatCents(event.amountCents)}. Pickup: ${event.slot}, ${event.locationLabel}. ` : ''}${event.text ?? 'Would that work?'}`
    const timestamp = new Date().toISOString()
    commit({
      ...value,
      items: value.items.map((i) =>
        i.id === item.id && decision.status === 'awaiting_confirmation'
          ? { ...i, status: 'offer_received' }
          : i,
      ),
      offers: [...value.offers, offer],
      messages: [
        ...value.messages,
        {
          id: crypto.randomUUID(),
          offerId: offer.id,
          speaker: 'buyer',
          text: incoming,
          timestamp,
        },
        {
          id: crypto.randomUUID(),
          offerId: offer.id,
          speaker: 'offload',
          text: decision.reply,
          timestamp,
        },
      ],
    })
  }
  function confirm(id: string) {
    const value = current.current,
      offer = value.offers.find((o) => o.id === id),
      item = value.items.find((i) => i.id === offer?.itemId)
    if (!offer || !item) return
    if (offer.status === 'confirmed' && item.status === 'reserved') return
    const check = canConfirmOffer({
      item,
      policy: value.policies[item.id],
      offer,
    })
    if (!check.ok) {
      setError(check.reason)
      return
    }
    commit(reserveOffer(value, id))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function reset() {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    try {
      await resetStorage()
      const next = emptySession()
      current.current = next
      setSession(next)
      ++saveVersion.current
      setSaved('Saved on this device')
      setError('')
      setStage('')
      setResetOpen(false)
    } catch {
      setError('The saved session could not be cleared. Please retry.')
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  const selected =
    session.items.find((i) => i.id === session.selectedId) ??
    session.items.find((i) => i.selected)
  const confirmed = session.offers.find(
    (o) => o.id === session.confirmedOfferId && o.status === 'confirmed',
  )
  const reservedItem = session.items.find((i) => i.id === confirmed?.itemId)
  const stepIndex = steps.findIndex((s) => s.id === session.step)
  return (
    <div className="offload app-shell">
      <header className="site-header">
        <button
          className="wordmark"
          onClick={() => ready && !busy && go('scan')}
          aria-label="Offload home"
        >
          <span className="brand-icon">
            <ArrowDown size={21} strokeWidth={2.5} />
          </span>
          offload<span className="brand-period">.</span>
        </button>
        <div className="header-note">
          <Leaf size={14} />
          <span>Less to move. More to look forward to.</span>
        </div>
        {!!session.items.length && (
          <button className="text-button" onClick={exportListings}>
            Export listing pack
          </button>
        )}
        <button
          className="text-button reset-button"
          disabled={!ready || busy}
          onClick={() => setResetOpen(true)}
        >
          <RotateCcw size={14} />
          Reset session
        </button>
      </header>
      <div className="offload-main">
        <nav className="stepper" aria-label="Progress">
          {steps.map((step, index) => (
            <button
              key={step.id}
              aria-current={session.step === step.id ? 'step' : undefined}
              className={`${session.step === step.id ? 'active' : ''} ${index < stepIndex ? 'complete' : ''}`}
              disabled={
                !ready ||
                busy ||
                (step.id === 'listings' && !session.items.length) ||
                (step.id === 'desk' && !selected) ||
                (step.id === 'reserved' && !confirmed)
              }
              onClick={() => go(step.id)}
            >
              <span className="step-number">
                {index < stepIndex ? <Check size={13} /> : `0${index + 1}`}
              </span>
              {step.label}
            </button>
          ))}
        </nav>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <button className="text-button" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}
        {!ready ? (
          <div className="loading">
            <LoaderCircle className="spin" />
            Opening your workspace…
          </div>
        ) : (
          <div aria-busy={busy} className={busy ? 'busy-surface' : ''}>
            {session.step === 'scan' && (
              <section className="scan-screen">
                <div className="hero-copy">
                  <div className="hero-tag">
                    <span className="dot" /> A lighter way to move out
                  </div>
                  <h1>
                    Turn your clutter
                    <br />
                    into your
                    <br />
                    <em>next payday.</em>
                    <span className="handdrawn-line" />
                  </h1>
                  <p>
                    The chair, the lamp, the “I’ll deal with it later.”
                    <br />
                    Give your good stuff a second home, without
                    <br className="desktop-break" /> making selling it your
                    second job.
                  </p>
                  <div className="hero-proof">
                    <span className="proof-icon">
                      <ShieldCheck size={20} />
                    </span>
                    <span>
                      Your prices. Your pickup.
                      <br />
                      <b>Your final say.</b>
                    </span>
                  </div>
                  <div className="hero-mini-note">
                    <Leaf size={16} /> Good for your next chapter. Better for
                    the planet.
                  </div>
                </div>
                <div className="scan-workspace">
                  <div className="scan-card">
                    <div className="scan-card-header">
                      <span className="eyebrow">
                        Meet your moving-out assistant
                      </span>
                      <span className="badge neutral">{health}</span>
                    </div>
                    <ScanBoundary>
                      <ScanUpload
                        scanId={scanId}
                        onResearch={(result) => {
                          const value = current.current
                          const updates = result.research ?? {}
                          if (!value.items.some((item) => updates[item.id])) {
                            setError(
                              'This price recheck belongs to a listing no longer saved on this device. The research is still available in its evidence export.',
                            )
                            return
                          }
                          const policies = { ...value.policies }
                          const items = value.items.map((item) => {
                            const research = updates[item.id]
                            if (!research || item.status === 'reserved')
                              return item
                            const askingCents =
                              item.priceSource === 'seller'
                                ? item.askingCents
                                : research.askingCents
                            policies[item.id] = {
                              ...policies[item.id],
                              askingCents,
                              minimumCents: Math.min(
                                policies[item.id].minimumCents,
                                askingCents,
                              ),
                            }
                            return {
                              ...item,
                              ...research,
                              askingCents,
                              priceSource:
                                item.priceSource === 'seller'
                                  ? ('seller' as const)
                                  : research.priceSource,
                              researchStatus: 'completed' as const,
                              researchJobId: undefined,
                            }
                          })
                          commit({
                            ...value,
                            items,
                            policies,
                            step: 'listings',
                          })
                        }}
                        onItems={onPipeline}
                        onError={setError}
                        onStage={setStage}
                      />
                    </ScanBoundary>
                    {stage && (
                      <p className="stage-note" role="status">
                        {stage}
                      </p>
                    )}
                    <div className="or-divider">
                      <span>or take a look around</span>
                    </div>
                    <button
                      className="sample-cta"
                      disabled={busy}
                      onClick={() => void addSamples()}
                    >
                      <span className="sample-stack">
                        <img src="/offload-samples/chair.svg" alt="" />
                        <img src="/offload-samples/lamp.svg" alt="" />
                        <img src="/offload-samples/speaker.svg" alt="" />
                      </span>
                      <span>
                        <b>
                          {busy
                            ? 'Getting your items ready…'
                            : 'Try sample items'}
                        </b>
                        <small>Three dorm favorites. No upload needed.</small>
                      </span>
                      <ArrowRight size={19} />
                    </button>
                    <div className="scan-footnote">
                      <LockNote />
                      Your video stays on your device. You approve every deal.
                    </div>
                  </div>
                  <div className="floating-note">
                    <Sparkles size={16} />
                    <span>
                      Less clutter. A little extra cash. <em>A fresh start.</em>
                    </span>
                  </div>
                </div>
                <div className="how-it-works">
                  {[
                    {
                      title: 'Scan your stuff',
                      text: 'A short video or a few photos.',
                      n: '01',
                    },
                    {
                      title: 'Review your drafts',
                      text: 'Check visible details and estimated prices.',
                      n: '02',
                    },
                    {
                      title: 'Approve the deal',
                      text: 'Set your terms. Confirm the pickup.',
                      n: '03',
                    },
                  ].map((info) => (
                    <div key={info.n}>
                      <span>{info.n}</span>
                      <div>
                        <h3>{info.title}</h3>
                        <p>{info.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {session.step === 'listings' && (
              <ItemReview
                items={session.items}
                onChange={updateItem}
                onDelete={deleteItem}
                onScan={() => go('scan')}
                onContinue={() => {
                  const item = current.current.items.find(
                    (i) => i.selected && i.status !== 'reserved',
                  )
                  if (item) {
                    commit({
                      ...current.current,
                      step: 'desk',
                      selectedId: item.id,
                    })
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                }}
              />
            )}
            {session.step === 'desk' && selected && (
              <SellingDesk
                key={selected.id}
                item={selected}
                items={session.items.filter(
                  (i) => i.selected || i.id === selected.id,
                )}
                policy={session.policies[selected.id]}
                offers={session.offers.filter((o) => o.itemId === selected.id)}
                messages={session.messages.filter((m) =>
                  session.offers.some(
                    (o) => o.id === m.offerId && o.itemId === selected.id,
                  ),
                )}
                onSelect={(id) =>
                  commit({ ...current.current, selectedId: id })
                }
                onBack={() => go('listings')}
                onPolicy={(policy) =>
                  commit({
                    ...current.current,
                    policies: {
                      ...current.current.policies,
                      [policy.itemId]: policy,
                    },
                    items: current.current.items.map((i) =>
                      i.id === policy.itemId
                        ? {
                            ...i,
                            askingCents: policy.askingCents,
                            priceSource:
                              i.askingCents === policy.askingCents
                                ? i.priceSource
                                : 'seller',
                          }
                        : i,
                    ),
                  })
                }
                onActivate={() => updateItem(selected.id, { status: 'listed' })}
                onEvent={buyerEvent}
                onConfirm={confirm}
                onViewReservation={() => {
                  const offer = current.current.offers.find(
                    (o) => o.itemId === selected.id && o.status === 'confirmed',
                  )
                  if (offer)
                    commit({
                      ...current.current,
                      confirmedOfferId: offer.id,
                      step: 'reserved',
                    })
                }}
              />
            )}
            {session.step === 'reserved' && confirmed && reservedItem && (
              <section className="reserved-screen">
                <span className="success-seal">
                  <CheckCircle2 size={40} strokeWidth={1.4} />
                </span>
                <p className="eyebrow green-text">One less thing to move</p>
                <h1>
                  Good stuff.
                  <br />
                  <em>New home.</em>
                </h1>
                <p>
                  The pickup is reserved. {confirmed.buyerAlias} has the
                  details,
                  <br />
                  and this item is off the table for other demo buyers.
                </p>
                <div className="reservation-card">
                  <ItemImage item={reservedItem} />
                  <div>
                    <span className="badge green">
                      Pickup confirmed{reservedItem.sample ? ' · sample' : ''}
                    </span>
                    <h2>{reservedItem.title}</h2>
                    <div className="reservation-price">
                      {formatCents(confirmed.amountCents ?? 0)}
                      <span>with {confirmed.buyerAlias}</span>
                    </div>
                    <p>
                      <MapPin size={16} />
                      {confirmed.locationLabel}
                    </p>
                    <p>{confirmed.slot}</p>
                  </div>
                </div>
                <div className="row reservation-actions">
                  <button className="button" onClick={() => go('listings')}>
                    Back to your items <ArrowRight size={17} />
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setResetOpen(true)}
                  >
                    Start a fresh demo
                  </button>
                </div>
                <p className="small muted">
                  Demo reservation only. No buyer was contacted and no payment
                  was collected.
                </p>
              </section>
            )}
          </div>
        )}
      </div>
      <footer className="site-footer">
        <span>Made for moving on.</span>
        <span className="save-status" role="status">
          <span className="dot" />
          {saved}
        </span>
        <span>Offload · a little lighter.</span>
      </footer>
      {resetOpen && (
        <div className="modal-backdrop">
          <section
            className="reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <span className="icon-tile">
              <RotateCcw size={23} />
            </span>
            <h2 id="reset-title">Start with a clean slate?</h2>
            <p>
              This removes this device’s Offload drafts, photos, conversations,
              and reservations. It can’t be undone.
            </p>
            <div className="row">
              <button
                className="button secondary"
                autoFocus
                disabled={busy}
                onClick={() => setResetOpen(false)}
              >
                Keep my session
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => void reset()}
              >
                {busy ? 'Clearing…' : 'Reset everything'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
function LockNote() {
  return <ShieldCheck size={13} />
}
