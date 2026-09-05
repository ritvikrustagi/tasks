import { ArrowUpRight, Check, ChevronDown, Loader2, Search } from 'lucide-react'
import {
  combinedSources,
  type Report,
  type Source,
  stepLabels,
  steps,
  type Task,
} from '../src/schema'

export function ResearchSteps({ task }: { task: Task }) {
  const results = task.events.flatMap((e) => (e.result ? [e.result] : []))
  const plan = results.find((r) => r.plan)?.plan
  const report = results.find((r) => r.report)?.report
  const sources = combinedSources(results)
  return (
    <section aria-labelledby="research-steps-heading">
      <div className="section-heading">
        <Search size={18} />
        <h2 id="research-steps-heading">Research steps</h2>
        <span className="tag">{sources.length} saved sources</span>
      </div>
      <p>
        Search results are saved before the next step uses them. Expand a source
        to inspect the saved text.
      </p>
      <ol className="research-steps">
        {steps.map((step, index) => {
          const event = task.events.find((e) => e.step === step)
          const result = event?.result
          const running = event?.state === 'running' && task.state === 'running'
          const state =
            event?.state === 'running' && !running
              ? task.state
              : (event?.state ??
                (['cancelled', 'failed'].includes(task.state)
                  ? 'Not run'
                  : 'Waiting'))
          const query =
            result?.query ??
            (step === 'search'
              ? task.question
              : step === 'followup'
                ? plan?.query
                : undefined)
          return (
            <li className="research-step" key={step}>
              <div
                className={`stage-marker ${event?.state === 'succeeded' ? 'done' : ''}`}
              >
                {event?.state === 'succeeded' ? (
                  <Check size={15} />
                ) : running ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  index + 1
                )}
              </div>
              <div className="step-body">
                <h3>
                  {index + 1}. {stepLabels[step]}
                </h3>
                <p className="step-status" role="status">
                  {state}
                  {event && event.attempts > 1
                    ? ` · attempt ${event.attempts}`
                    : ''}
                  {result && event?.state === 'succeeded' && (
                    <>
                      {' '}
                      · Saved{' '}
                      <time dateTime={new Date(event.updated).toISOString()}>
                        {new Date(event.updated).toLocaleString()}
                      </time>
                    </>
                  )}
                </p>
                {event?.error && <p className="error">{event.error}</p>}
                {query && (
                  <div className="search-query">
                    <Search size={15} />
                    <span>
                      <strong>
                        {result?.query ? 'Search query' : 'Planned search'}
                      </strong>
                      <br />
                      {query}
                    </span>
                  </div>
                )}
                {step === 'search' && (
                  <p>
                    Find initial evidence for your question, then save it for
                    review.
                  </p>
                )}
                {step === 'investigate' && plan && (
                  <>
                    <h4>What the saved evidence says</h4>
                    {plan.findings.map((finding) => (
                      <div className="step-finding" key={finding.text}>
                        <p>{finding.text}</p>
                        <div className="citations">
                          {finding.sources.map((id) => {
                            const source = sources.find((s) => s.id === id)
                            return source ? (
                              <a
                                key={id}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {source.title}
                                <ArrowUpRight size={12} />
                              </a>
                            ) : null
                          })}
                        </div>
                      </div>
                    ))}
                    <h4>Missing information</h4>
                    <ul>
                      {plan.gaps.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  </>
                )}
                {step === 'followup' && plan && (
                  <>
                    <h4>Why we searched again</h4>
                    <p>{plan.reason}</p>
                  </>
                )}
                {result?.sources && (
                  <SavedSources sources={result.sources} report={report} />
                )}
                {step === 'report' &&
                  (report ? (
                    <p>
                      The answer below uses {report.findings.length} cited
                      findings.{' '}
                      {report.uncertainties.length
                        ? `${report.uncertainties.length} unresolved item(s) are listed under “Could not confirm”.`
                        : 'The model reported no unresolved items; citation presence alone is not independent verification.'}
                    </p>
                  ) : (
                    <p>
                      Use both searches and your requirements to produce a cited
                      answer, with unresolved facts stated explicitly.
                    </p>
                  ))}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function SavedSources({
  sources,
  report,
}: {
  sources: Source[]
  report?: Report
}) {
  return (
    <>
      <h4>Saved evidence · {sources.length} sources</h4>
      <div className="sources">
        {sources.map((source) => {
          const findings =
            report?.findings.flatMap((finding, i) =>
              finding.sources.includes(source.id) ? [i + 1] : [],
            ) ?? []
          return (
            <details key={source.id}>
              <summary>
                <span>
                  {source.title}
                  <small>{new URL(source.url).hostname}</small>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <p>{source.content}</p>
              <a href={source.url} target="_blank" rel="noreferrer">
                Open source <ArrowUpRight size={13} />
              </a>
              {report && (
                <p className="source-impact">
                  {findings.length ? (
                    <>
                      Cited in final findings:{' '}
                      {findings.map((n, i) => (
                        <span key={n}>
                          {i ? ', ' : ''}
                          <a href={`#finding-${n}`}>{n}</a>
                        </span>
                      ))}
                      .
                    </>
                  ) : (
                    'Not cited in the final findings.'
                  )}
                </p>
              )}
            </details>
          )
        })}
      </div>
      {report && (
        <p>
          {report.findings.some((finding) =>
            finding.sources.some((id) =>
              sources.some((source) => source.id === id),
            ),
          )
            ? 'This search supplied sources cited in the final answer. Expand the evidence to see where each source was used.'
            : 'No final finding cites sources from this search. Its results remain saved for review.'}
        </p>
      )}
    </>
  )
}
