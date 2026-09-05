import { stepLabels, steps, type Task } from '../src/schema'

export function IntegrationActivity({
  task,
  config,
}: {
  task?: Task
  config?: {
    executor: string
    connections: { name: string; configured: boolean }[]
  }
}) {
  if (!task)
    return (
      <aside className="integration-activity" aria-label="Integration activity">
        <details open>
          <summary>
            Integration activity <span className="tag">Testing</span>
          </summary>
          <p>
            No task started. This panel will show activity as research runs.
          </p>
          {[
            ['Linkup', 'Searches the web and saves sources.'],
            ['Nebius Token Factory', 'Reviews evidence and writes the report.'],
            ['Render Workflows', 'Runs background steps and retries.'],
          ].map(([name, purpose]) => (
            <div className="integration-executor" key={name}>
              <h3>{name}</h3>
              <p>{purpose}</p>
              <p role="status">
                {!config
                  ? 'Loading configuration…'
                  : name === 'Render Workflows' && config.executor !== 'render'
                    ? 'Not used — local execution selected.'
                    : config.connections.find((c) => c.name === name)
                          ?.configured
                      ? 'Configured; no run yet.'
                      : 'Not configured.'}
              </p>
            </div>
          ))}
          <p>
            Open Connections in the left sidebar for setup details. After
            starting a task, the panel shows responses, model usage, workflow
            status, and a link to the report.
          </p>
        </details>
      </aside>
    )
  const report = task.events.find((event) => event.step === 'report')?.result
    ?.report
  return (
    <aside className="integration-activity" aria-label="Integration activity">
      <details open>
        <summary>
          Integration activity <span className="tag">Testing</span>
        </summary>
        <p>
          Updates every 2 seconds while this page is active. Shows this research
          task, not browser chat.
        </p>
        <div className="integration-executor">
          <h3>Render Workflows</h3>
          <p role="status">
            {task.executor !== 'render'
              ? 'Not used — this task runs locally.'
              : task.runId
                ? 'Dispatch recorded. Step status below comes from saved worker checkpoints.'
                : 'Render selected; no dispatch confirmation recorded.'}
          </p>
          {task.executor === 'render' && task.runId && (
            <p>
              Run ID: <code>{task.runId}</code>
            </p>
          )}
          <p>Task status: {task.state}</p>
          {task.error && <p className="error">{task.error}</p>}
        </div>
        <ol>
          {steps.map((step) => {
            const event = task.events.find((e) => e.step === step)
            const result = event?.result
            const provider =
              step === 'search' || step === 'followup' ? 'linkup' : 'nebius'
            const response =
              result?.providerResponse?.provider === provider
                ? result.providerResponse
                : undefined
            const status =
              event?.state === 'running' && task.state !== 'running'
                ? task.state
                : (event?.state ??
                  (['failed', 'cancelled', 'paused'].includes(task.state)
                    ? 'Not run'
                    : 'Waiting'))
            return (
              <li key={step}>
                <h3>{stepLabels[step]}</h3>
                <p role="status">
                  {status}
                  {event ? ` · attempt ${event.attempts}` : ''}
                </p>
                {event?.error && <p className="error">{event.error}</p>}
                {response ? (
                  <p className="success">
                    Live response recorded ·{' '}
                    {(response.elapsedMs / 1000).toFixed(2)}s<br />
                    <time
                      dateTime={new Date(response.completedAt).toISOString()}
                    >
                      {new Date(response.completedAt).toLocaleString()}
                    </time>
                  </p>
                ) : (
                  <p>
                    {result
                      ? 'No live response metadata (fixture or older run).'
                      : 'No completed provider response recorded.'}
                  </p>
                )}
                {result?.query && (
                  <p>
                    <strong>Query:</strong> {result.query}
                  </p>
                )}
                {result?.sources && (
                  <p>{result.sources.length} sources saved</p>
                )}
                {result?.usage && (
                  <p>
                    Model: <code>{result.usage.model}</code>
                    <br />
                    {result.usage.inputTokens.toLocaleString()} input /{' '}
                    {result.usage.outputTokens.toLocaleString()} output tokens
                  </p>
                )}
              </li>
            )
          })}
        </ol>
        <p>
          Durations and tokens cover saved successful responses; failed or
          interrupted calls can add usage.
        </p>
        <div className="integration-links">
          {report ? (
            <a href="#research-report">View Nebius report ↓</a>
          ) : (
            <span>Report appears after the final step succeeds.</span>
          )}
          <a href={`/api/tasks/${task.id}/evidence`}>
            Download activity and evidence (JSON)
          </a>
        </div>
      </details>
    </aside>
  )
}
