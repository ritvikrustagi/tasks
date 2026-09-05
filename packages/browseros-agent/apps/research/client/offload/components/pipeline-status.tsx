import type { JobView } from '../../../src/offload/pipeline-contract'
const baseSteps = [
  { id: 'identify', label: 'Find your items' },
  { id: 'validate', label: 'Check listing drafts' },
  { id: 'publish', label: 'Save your listing package' },
]
export function PipelineStatus({ job }: { job: JobView }) {
  const steps = [
    ...baseSteps.slice(0, 2),
    ...[...new Set(job.events.map((e) => e.step))]
      .filter((s) => s.startsWith('search-') || s.startsWith('ground-'))
      .map((id) => ({
        id,
        label: id.startsWith('ground-')
          ? `Write listing ${Number(id.split('-')[1]) + 1}`
          : `Research item ${Number(id.split('-')[1]) + 1} · pass ${id.split('-')[2]}`,
      })),
    baseSteps[2],
  ]
  return (
    <div className="pipeline-progress">
      <div className="row between">
        <b>
          {job.status === 'completed'
            ? 'Your drafts are ready'
            : job.status === 'failed'
              ? 'This scan needs attention'
              : 'Working on your listings'}
        </b>
        <span className="badge neutral">{job.status}</span>
      </div>
      <ol>
        {steps.map((step) => {
          const events = job.events.filter((e) => e.step === step.id),
            last = events.at(-1)
          return (
            <li key={step.id}>
              <span className={`pipeline-dot ${last?.status ?? 'queued'}`} />
              <span>{step.label}</span>
              <small>{last?.status ?? 'queued'}</small>
            </li>
          )
        })}
      </ol>
      {job.error && (
        <p className="warning-note" role="status">
          {job.error}
        </p>
      )}
      <p className="small muted">
        You can refresh this page. Your scan keeps running in the background.
      </p>
      <details className="execution-details">
        <summary>Execution details & measurements</summary>
        <p>
          {job.execution === 'render'
            ? 'Render Workflows'
            : 'Local background task'}
          <br />
          Run: {job.runId ?? 'Waiting for dispatch'}
          <br />
          Job: {job.id}
        </p>
        {job.result && (
          <p>
            Model: {job.result.identification.model}
            <br />
            Inference:{' '}
            {(job.result.identification.inferenceMs / 1000).toFixed(2)}s ·
            Total: {(job.result.totalMs / 1000).toFixed(2)}s<br />
            Saved items: {job.listingCount} / {job.result.drafts.length}
            <br />
            Controlled failure:{' '}
            {job.failureInjected ? 'injected and recovered' : 'not injected'}
          </p>
        )}
        <ul>
          {job.events.map((event) => (
            <li key={event.id}>
              <time>{new Date(event.at).toLocaleTimeString()}</time>{' '}
              {event.step}: {event.message}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
