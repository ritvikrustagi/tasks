import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, LoaderCircle, Upload } from 'lucide-react'
import { extractFrames } from '../lib/extract-frames'
import { cropImage } from '../lib/crop-image'
import {
  clearPendingScan,
  loadPendingScan,
  savePendingScan,
  type PendingScan,
} from '../lib/storage'
import {
  pipelineMetrics,
  toPipelineItem,
} from '../../../src/offload/pipeline-drafts'
import type {
  JobView,
  PipelineResult,
} from '../../../src/offload/pipeline-contract'
import type { ScanUploadProps } from '../../../src/offload/types'
import { PipelineStatus } from './pipeline-status'

export function ScanUpload({
  onItems,
  onError,
  onStage,
  scanId,
  onResearch,
}: ScanUploadProps & {
  scanId?: string | null
  onResearch: (result: PipelineResult) => void
}) {
  const [pending, setPending] = useState<PendingScan | null>(null),
    [job, setJob] = useState<JobView | null>(null),
    [busy, setBusy] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [notes, setNotes] = useState(''),
    [fail, setFail] = useState(false),
    [allowFail, setAllowFail] = useState(false),
    [provider, setProvider] = useState<'nebius' | 'pioneer'>('nebius'),
    [available, setAvailable] = useState({ nebius: false, pioneer: false }),
    [message, setMessage] = useState(''),
    [pollError, setPollError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null),
    mounted = useRef(true),
    callbacks = useRef({ onItems, onError, onStage }),
    operation = useRef(false)
  callbacks.current = { onItems, onError, onStage }
  useEffect(() => {
    mounted.current = true
    void loadPendingScan()
      .then((saved) => {
        if (saved && mounted.current && !scanId) setPending(saved)
      })
      .catch(() => undefined)
    void fetch('/api/offload/config')
      .then((r) => r.json())
      .then((data) => {
        if (mounted.current) {
          setAllowFail(data.allowControlledFailure === true)
          setAvailable(data.providers)
          if (!data.providers.nebius && data.providers.pioneer)
            setProvider('pioneer')
        }
      })
      .catch(() => undefined)
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (scanId) {
      setPending({ id: scanId })
      setJob(null)
    }
  }, [scanId])
  const readStatus = useCallback(
    async (scan: PendingScan, signal?: AbortSignal) => {
      const response = await fetch(`/api/offload/jobs/${scan.id}`, {
        cache: 'no-store',
        signal,
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Could not retrieve your scan.')
      if (mounted.current) {
        setJob(data)
        setPollError('')
        callbacks.current.onStage(
          data.status === 'completed'
            ? 'Listing drafts ready for your review'
            : `Processing: ${data.stage} · ${data.status}`,
        )
      }
      return data as JobView
    },
    [],
  )
  useEffect(() => {
    if (!pending) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const poll = async () => {
      let terminal = false
      try {
        const view = await readStatus(pending, controller.signal)
        terminal = ['completed', 'failed', 'paused', 'cancelled'].includes(
          view.status,
        )
      } catch (error) {
        if (!cancelled)
          setPollError(
            error instanceof Error
              ? error.message
              : 'Progress is temporarily unavailable.',
          )
      }
      if (!cancelled && !terminal) timer = setTimeout(poll, 2500)
    }
    void poll()
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [pending, readStatus])
  async function submit() {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setMessage('')
    try {
      let scan = pending
      if (!scan) {
        const frames = await extractFrames(files, (text) => {
          setMessage(text)
          callbacks.current.onStage(text)
        })
        scan = {
          id: crypto.randomUUID(),
          input: {
            frames,
            sellerNotes: notes,
            controlledFailure: fail,
            provider,
          },
        }
        if (JSON.stringify(scan.input!).length > 2_900_000)
          throw new Error(
            'These photos are too large together. Choose fewer photos.',
          )
        await savePendingScan(scan)
        setPending(scan)
      }
      if (!scan.input)
        throw new Error('Open this scan from history to resume it.')
      const response = await fetch('/api/offload/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: scan.id, input: scan.input }),
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Could not start processing.')
      setMessage('')
      await readStatus(scan)
    } catch (error) {
      const text =
        error instanceof Error ? error.message : 'Could not start the scan.'
      setMessage(text)
      callbacks.current.onStage('Scan could not start')
      callbacks.current.onError(text)
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function retry() {
    if (!pending || operation.current) return
    operation.current = true
    setBusy(true)
    try {
      const response = await fetch(`/api/offload/jobs/${pending.id}/retry`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Could not resume this scan.')
      setPending({ ...pending })
      setMessage('')
      await readStatus(pending)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Retry failed.')
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  async function review() {
    if (!job?.result || operation.current) return
    if (!job.frames) {
      onResearch(job.result)
      return
    }
    operation.current = true
    setBusy(true)
    try {
      const items = await Promise.all(
        job.result.drafts.map(async (draft) => {
          const frame = job.frames!.find((f) => f.id === draft.bestFrameId)
          if (!frame)
            throw new Error(
              'A source photo is missing. Refresh to retrieve the result again.',
            )
          const item = toPipelineItem(
            draft,
            frame,
            await cropImage(frame.dataUrl, draft.bbox),
          )
          const research = job.result!.research?.[draft.id]
          return {
            ...item,
            ...research,
            researchStatus: research
              ? ('completed' as const)
              : item.researchStatus,
          }
        }),
      )
      await callbacks.current.onItems(items, pipelineMetrics(job.result))
      await clearPendingScan()
    } catch (error) {
      callbacks.current.onError(
        error instanceof Error ? error.message : 'Could not import the drafts.',
      )
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <div className="live-upload">
      {!pending ? (
        <>
          <span className="icon-tile">
            <Camera size={25} />
          </span>
          <h3>What’s ready for a new home?</h3>
          <p>
            Upload a short video or up to six photos.
            <br />
            We’ll turn what we can see into editable drafts.
          </p>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/*,video/*"
            multiple
            aria-label="Photos or video"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <button
            className="button secondary"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} />
            Choose photos or video
          </button>
          {files.length > 0 && (
            <p className="upload-files">
              {files.map((f) => f.name).join(', ')}
            </p>
          )}
          <small>
            Video: up to 30 seconds / 50 MB. Photos: up to 20 MB each.
          </small>
          <label>
            Anything we should know? (optional)
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              placeholder="For example: three items, brand labels unclear"
            />
          </label>
          <label>
            Image analysis provider
            <select
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as 'nebius' | 'pioneer')
              }
            >
              <option value="nebius">
                Nebius{available.nebius ? '' : ' — setup needed'}
              </option>
              <option value="pioneer">
                Pioneer{available.pioneer ? '' : ' — setup needed'}
              </option>
            </select>
          </label>
          {allowFail && (
            <label className="failure-toggle">
              <input
                type="checkbox"
                checked={fail}
                onChange={(e) => setFail(e.target.checked)}
              />
              Demonstrate recovery: fail once after saving
            </label>
          )}
          <button
            className="button full"
            disabled={!files.length || busy}
            onClick={() => void submit()}
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={16} />
                Preparing…
              </>
            ) : (
              'Create my listing drafts'
            )}
          </button>
          <small>
            Compressed photos are sent for processing. Scans are saved in your
            workspace until you delete them. The original video stays on your
            device.
          </small>
        </>
      ) : (
        <>
          {job && <PipelineStatus job={job} />}
          <div className="scan-result-actions">
            {job?.status === 'completed' ? (
              <button
                className="button full"
                disabled={busy}
                onClick={() => void review()}
              >
                Review {job.result?.drafts.length} listing drafts
              </button>
            ) : ['failed', 'paused'].includes(job?.status ?? '') ? (
              <button
                className="button full"
                disabled={busy}
                onClick={() => void retry()}
              >
                Resume from saved steps
              </button>
            ) : !job ? (
              <button
                className="button full"
                disabled={busy}
                onClick={() => void submit()}
              >
                Retry sending this scan
              </button>
            ) : (
              <p className="small muted">
                {job.status === 'cancelled'
                  ? 'This scan has been stopped.'
                  : 'You can leave this page and return while your scan runs.'}
              </p>
            )}
            {job &&
              ['completed', 'failed', 'paused', 'cancelled'].includes(
                job.status,
              ) && (
                <button
                  className="text-button"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        'Delete this saved scan and its source photos from the server? Imported listings on this device are kept.',
                      )
                    )
                      return
                    try {
                      const response = await fetch(
                        `/api/offload/jobs/${job.id}`,
                        { method: 'DELETE' },
                      )
                      if (!response.ok)
                        throw new Error('Could not delete the saved scan')
                      await clearPendingScan()
                      setPending(null)
                      setJob(null)
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Could not delete scan',
                      )
                    }
                  }}
                >
                  Delete saved scan
                </button>
              )}
            {job && (
              <a
                href={`/api/offload/jobs/${job.id}/export`}
                className="text-button"
                download
              >
                Export scan evidence & measurements
              </a>
            )}
            {job && ['running', 'queued', 'retrying'].includes(job.status) && (
              <button
                className="text-button"
                onClick={async () => {
                  const response = await fetch(
                    `/api/offload/jobs/${job.id}/stop`,
                    { method: 'POST' },
                  )
                  if (!response.ok) {
                    setMessage('Could not stop this scan')
                    return
                  }
                  const data = await response.json()
                  if (data.warning) setMessage(data.warning)
                  await readStatus(pending!)
                }}
              >
                Stop scan
              </button>
            )}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                void clearPendingScan().then(() => {
                  setPending(null)
                  setJob(null)
                  setMessage('')
                  setPollError('')
                  callbacks.current.onStage('')
                })
              }}
            >
              Clear this scan from this device
            </button>
            <small>
              Clearing does not cancel a running workflow. Saved drafts already
              imported are kept.
            </small>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="warning-note">
          {message}
        </p>
      )}
      {pollError && (
        <p className="warning-note" role="status">
          {pollError}
        </p>
      )}
    </div>
  )
}
