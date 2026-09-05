import { useEffect, useRef, useState } from 'react'
import type { Item } from '../../../src/offload/types'
import type { JobView } from '../../../src/offload/pipeline-contract'
import { cropImage } from '../lib/crop-image'
import { getImage, saveImages } from '../lib/storage'

export function ResearchActions({
  item,
  onChange,
}: {
  item: Item
  onChange: (patch: Partial<Item>) => void
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [provider, setProvider] = useState<'nebius' | 'pioneer'>('nebius')
  const current = useRef({ item, onChange })
  current.current = { item, onChange }
  const locked = item.status === 'reserved' || busy || !!item.researchJobId
  useEffect(() => {
    if (!item.researchJobId || item.researchStatus === 'completed') return
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    function receive(job: JobView) {
      if (job.status === 'completed') {
        const { item, onChange } = current.current
        const research = job.result?.research?.[item.id]
        if (!research)
          throw new Error('No price research was returned for this item')
        onChange({
          ...research,
          ...(item.priceSource === 'seller'
            ? {
                askingCents: item.askingCents,
                priceSource: 'seller' as const,
              }
            : {}),
          researchStatus: 'completed',
          researchJobId: undefined,
        })
        setError('')
        return true
      }
      if (['failed', 'paused', 'cancelled'].includes(job.status)) {
        current.current.onChange({ researchStatus: 'failed' })
        setError(
          job.error || 'Price research stopped. Resume it from task history.',
        )
        return true
      }
      return false
    }
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/offload/jobs/${item.researchJobId}`,
          { signal: controller.signal },
        )
        const job: JobView = await response.json()
        if (!response.ok)
          throw new Error(job.error || 'Could not retrieve price research')
        if (cancelled || receive(job)) return
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Price research failed')
      }
      if (!cancelled) timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [item.researchJobId, item.researchStatus])
  async function recheck() {
    setBusy(true)
    setError('')
    try {
      const id = crypto.randomUUID()
      onChange({ researchJobId: id, researchStatus: 'queued' })
      const response = await fetch('/api/offload/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          input: {
            provider,
            controlledFailure: false,
            item: {
              id: item.id,
              title: item.title,
              category: item.category,
              brand: item.brand,
              model: item.model,
              description: item.description,
              visibleCondition: item.visibleCondition,
              needsConfirmation: item.needsConfirmation,
              suggestedAskCents: item.askingCents,
              estimatedLowCents: item.estimatedLowCents,
              estimatedHighCents: item.estimatedHighCents,
              bestFrameId: item.originalFrameId,
              bbox: item.bbox,
              identityConfidence: item.identityConfidence,
              warnings: item.warnings,
            },
          },
        }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Could not start price research')
      onChange({ researchJobId: id, researchStatus: 'running' })
    } catch (e) {
      onChange({ researchJobId: undefined, researchStatus: 'failed' })
      setError(e instanceof Error ? e.message : 'Could not recheck prices')
    } finally {
      setBusy(false)
    }
  }
  async function recrop(form: HTMLFormElement) {
    setBusy(true)
    setError('')
    try {
      const data = new FormData(form)
      const bbox = {
        x: Number(data.get('x')),
        y: Number(data.get('y')),
        width: Number(data.get('width')),
        height: Number(data.get('height')),
      }
      if (
        bbox.width <= 0 ||
        bbox.height <= 0 ||
        bbox.x + bbox.width > 1.001 ||
        bbox.y + bbox.height > 1.001
      )
        throw new Error('Crop must fit within the original photo')
      const source = await getImage(item.sourceImageKey)
      if (!source) throw new Error('Original photo is unavailable')
      const original = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(source)
      })
      const cropped = await cropImage(original, bbox)
      const key = `image:${item.id}:crop:${crypto.randomUUID()}`
      await saveImages([[key, await (await fetch(cropped)).blob()]])
      onChange({ bbox, listingImageKey: key })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rebuild the photo')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="research-actions">
      {!item.sample && (
        <>
          <label>
            Listing writing provider
            <select
              aria-label={`Research provider for ${item.title}`}
              value={provider}
              disabled={locked}
              onChange={(e) =>
                setProvider(e.target.value as 'nebius' | 'pioneer')
              }
            >
              <option value="nebius">Nebius</option>
              <option value="pioneer">Pioneer</option>
            </select>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={locked}
            onClick={() => void recheck()}
          >
            {item.researchJobId ? 'Research in progress' : 'Recheck prices'}
          </button>
          {item.researchJobId && item.researchStatus === 'failed' && (
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                try {
                  const r = await fetch(
                      `/api/offload/jobs/${item.researchJobId}/retry`,
                      { method: 'POST' },
                    ),
                    data = await r.json()
                  if (!r.ok) throw new Error(data.error)
                  onChange({ researchStatus: 'running' })
                  setError('')
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : 'Could not resume research',
                  )
                }
              }}
            >
              Resume price research
            </button>
          )}
          {item.researchJobId && (
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                try {
                  const r = await fetch(
                    `/api/offload/jobs/${item.researchJobId}/stop`,
                    { method: 'POST' },
                  )
                  if (!r.ok) throw new Error('Could not stop price research')
                  onChange({ researchJobId: undefined, researchStatus: 'idle' })
                  setError('')
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : 'Could not stop research',
                  )
                }
              }}
            >
              Stop price research
            </button>
          )}
        </>
      )}
      <details>
        <summary>Adjust listing photo</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void recrop(e.currentTarget)
          }}
        >
          <div className="crop-fields">
            {(['x', 'y', 'width', 'height'] as const).map((name) => (
              <label key={name}>
                {name}
                <input
                  aria-label={`Crop ${name}`}
                  name={name}
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  defaultValue={item.bbox[name]}
                  required
                  disabled={locked}
                />
              </label>
            ))}
          </div>
          <small>Coordinates are fractions of the original photo (0–1).</small>
          <button type="submit" className="button secondary" disabled={locked}>
            Rebuild listing photo
          </button>
        </form>
      </details>
      {error && (
        <p role="alert" className="warning-note">
          {error}
        </p>
      )}
    </div>
  )
}
