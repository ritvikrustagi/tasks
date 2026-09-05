import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Circle,
  Clock3,
  Download,
  FileText,
  FlaskConical,
  Globe2,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { combinedSources, type Task } from '../src/schema'
import { IntegrationActivity } from './IntegrationActivity'
import { ResearchSteps } from './ResearchSteps'

const keys = {
  health: ['health'],
  config: ['config'],
  tasks: ['tasks'],
  brief: ['brief'],
} as const
async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(
      'The research backend is not connected yet. Research will be available once it is deployed.',
    )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Request failed')
  return data
}
type Config = {
  executor: string
  ready: boolean
  allowFailure: boolean
  connections: { name: string; purpose: string; configured: boolean }[]
}

export function App() {
  const client = useQueryClient()
  const [signedIn, setSignedIn] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState<'research' | 'connections'>('research')
  const [notice, setNotice] = useState('')
  const health = useQuery({
    queryKey: keys.health,
    queryFn: () => api<{ ok: boolean; accessCodeRequired: boolean }>('health'),
  })
  const login = useMutation({
    mutationFn: (code: string) => api('session', 'POST', { code }),
    onSuccess: () => {
      setSignedIn(true)
      void client.invalidateQueries()
    },
  })
  const config = useQuery({
    queryKey: keys.config,
    queryFn: () => api<Config>('config'),
    enabled: signedIn,
  })
  const tasks = useQuery({
    queryKey: keys.tasks,
    queryFn: () => api<Task[]>('tasks'),
    enabled: signedIn,
    refetchInterval: signedIn ? 2000 : false,
  })
  const brief = useQuery({
    queryKey: keys.brief,
    queryFn: () => api<{ text: string }>('brief'),
    enabled: signedIn,
  })
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api<{ warning?: string }>(
        `tasks/${id}${action === 'delete' ? '' : `/${action}`}`,
        action === 'delete' ? 'DELETE' : 'POST',
      ),
    onSuccess: (data) => {
      setNotice(data.warning ?? '')
      void client.invalidateQueries({ queryKey: keys.tasks })
    },
  })
  const current = tasks.data?.find((t) => t.id === selected)
  return (
    <div className="shell">
      <aside className="rail">
        <a className="brand" href="/" aria-label="Bloom Search research home">
          <Globe2 />
          <span>
            Bloom Search<span className="brand-sub">RESEARCH WORKSPACE</span>
          </span>
        </a>
        <button
          type="button"
          className="new-task"
          onClick={() => {
            setSelected(null)
            setView('research')
          }}
        >
          <Plus size={17} /> New research
        </button>
        <nav>
          <button
            type="button"
            className={view === 'research' ? 'nav active' : 'nav'}
            onClick={() => setView('research')}
          >
            <Search size={17} /> Research
          </button>
          <button
            type="button"
            className={view === 'connections' ? 'nav active' : 'nav'}
            onClick={() => setView('connections')}
          >
            <Settings2 size={17} /> Connections
          </button>
        </nav>
        <div className="section-label">
          RECENT TASKS <span>{tasks.data?.length ?? 0}</span>
        </div>
        <div className="task-list">
          {tasks.data?.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`task-item ${selected === t.id ? 'selected' : ''}`}
              onClick={() => {
                setSelected(t.id)
                setView('research')
              }}
            >
              <StatusIcon state={t.state} />
              <span>{t.question}</span>
            </button>
          ))}
          {signedIn && !tasks.data?.length && (
            <p className="empty-small">No research yet</p>
          )}
        </div>
        <footer>
          <span className="connection-dot" />{' '}
          {config.data?.executor === 'render'
            ? 'Render Workflows'
            : 'Local workspace'}
          <span className="version">ALPHA</span>
        </footer>
      </aside>
      <main>
        <header className="topbar">
          <span>
            <Globe2 size={15} /> Workspace <span className="slash">/</span>{' '}
            {view === 'connections' ? 'Connections' : 'Research'}
          </span>
          <span className="tag">Open source</span>
        </header>
        {!signedIn ? (
          <div className="login">
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h1>Research, with evidence.</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                login.mutate(
                  String(new FormData(e.currentTarget).get('code') ?? ''),
                )
              }}
            >
              {health.data?.accessCodeRequired && (
                <label>
                  Access code
                  <input
                    name="code"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </label>
              )}
              <button
                type="submit"
                className="primary"
                disabled={!health.data || login.isPending}
              >
                Open workspace <ArrowUpRight size={16} />
              </button>
              <ErrorText error={login.error ?? health.error} />
            </form>
          </div>
        ) : view === 'connections' ? (
          <div className="content">
            <div className="eyebrow">WORKSPACE SETTINGS</div>
            <h1>Connections</h1>
            <p className="subtitle">
              Research uses Linkup, Nebius, and Render settings configured for
              this workspace. Browser chat providers remain separate.
            </p>
            <div className="connections">
              {config.data?.connections.map((c) => (
                <div className="connection-row" key={c.name}>
                  <Globe2 size={22} />
                  <div>
                    <h3>{c.name}</h3>
                    <p>{c.purpose}</p>
                  </div>
                  <span className={`tag ${c.configured ? 'green' : 'amber'}`}>
                    {c.configured
                      ? 'Configured, not verified'
                      : 'Not configured'}
                  </span>
                </div>
              ))}
            </div>
            <section>
              <h2>Set up Linkup</h2>
              <p>
                <a
                  href="https://app.linkup.so"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create an account and API key
                </a>
                , then configure it on the research server.{' '}
                <a
                  href="https://docs.linkup.so/pages/documentation/get-started/quickstart"
                  target="_blank"
                  rel="noreferrer"
                >
                  Setup guide
                </a>
              </p>
              <p>
                Research uses two standard searches with raw results: $0.005
                each, or $0.01 per completed run before retries and model or
                hosting costs. The paid Research API is not required.
              </p>
              <p>
                Linkup lists $20 in signup credits for professional email
                addresses, with eligible accounts topped back up to $20 monthly.
                Eligibility is not guaranteed, and this public allowance is
                separate from event credits.{' '}
                <a
                  href="https://docs.linkup.so/pages/documentation/platform/pricing"
                  target="_blank"
                  rel="noreferrer"
                >
                  Check current pricing and conditions
                </a>{' '}
                (checked September 5, 2026).
              </p>
            </section>
            <p className="privacy">
              Only the question and context you approve are sent for research.
              Linkup receives search queries; Nebius receives the brief and
              retrieved evidence. With Render selected, the workflow and saved
              research also run on the configured cloud services. Website
              passwords and cookies are not attached.
            </p>
            <ErrorText error={config.error} />
          </div>
        ) : current ? (
          <div className="content task-content">
            <div className="detail-heading">
              <div>
                <div className="eyebrow">RESEARCH TASK</div>
                <h1>{current.question}</h1>
              </div>
              <div className="actions">
                <a
                  className="icon-button"
                  href={`/api/tasks/${current.id}/evidence`}
                  title="Download saved research steps and evidence"
                  aria-label="Download saved research steps and evidence"
                >
                  <Download size={18} /> Evidence
                </a>
                {['running', 'queued'].includes(current.state) && (
                  <button
                    type="button"
                    title="Stop task"
                    aria-label="Stop task"
                    onClick={() =>
                      action.mutate({ id: current.id, action: 'stop' })
                    }
                    disabled={action.isPending}
                  >
                    <Square size={17} />
                  </button>
                )}
                {['failed', 'paused'].includes(current.state) && (
                  <button
                    type="button"
                    title="Resume from saved evidence"
                    onClick={() =>
                      action.mutate({ id: current.id, action: 'resume' })
                    }
                    disabled={action.isPending}
                  >
                    <RotateCcw size={17} /> Resume
                  </button>
                )}
                {current.state === 'succeeded' && (
                  <a
                    className="icon-button"
                    title="Download report"
                    aria-label="Download report"
                    href={`/api/tasks/${current.id}/export`}
                  >
                    <Download size={18} />
                  </a>
                )}
                {!['queued', 'running'].includes(current.state) && (
                  <button
                    type="button"
                    title="Delete task"
                    aria-label="Delete task"
                    onClick={() => {
                      if (
                        confirm(
                          'Delete this research, its evidence, and report?',
                        )
                      )
                        action.mutate({ id: current.id, action: 'delete' })
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </div>
            <div className="task-meta">
              <span
                className={`tag ${current.state === 'succeeded' ? 'green' : ''}`}
              >
                <StatusIcon state={current.state} />
                {current.state.replaceAll('_', ' ')}
              </span>
              <span>{new Date(current.created).toLocaleString()}</span>
              <span>
                {current.executor === 'render'
                  ? 'Render Workflows'
                  : 'Local execution'}
              </span>
            </div>
            {(current.error || notice) && (
              <div className="notice" role="status">
                {current.error || notice}
              </div>
            )}
            <ErrorText error={action.error} />
            <TaskDetail task={current} />
          </div>
        ) : (
          <div className="content compose">
            <div className="eyebrow">
              <span className="tiny-line" /> RESEARCH
            </div>
            <h1>What are you investigating?</h1>
            <p className="subtitle">
              Use Linkup to search the web, Nebius to reason over the saved
              evidence, and Render Workflows to run recoverable background
              steps.
            </p>
            <Composer
              key={brief.data?.text === undefined ? 'loading' : 'loaded'}
              initialBrief={brief.data?.text ?? ''}
              config={config.data}
              onCreated={(id) => {
                setSelected(id)
                void client.invalidateQueries({ queryKey: keys.tasks })
              }}
            />
            <div className="workflow-strip">
              <span>
                <Search /> Evidence
              </span>
              <span className="line" />
              <span>
                <FlaskConical /> Follow-up
              </span>
              <span className="line" />
              <span>
                <FileText /> Cited report
              </span>
            </div>
            <ErrorText error={tasks.error ?? config.error} />
          </div>
        )}
      </main>
    </div>
  )
}

function Composer({
  initialBrief,
  config,
  onCreated,
}: {
  initialBrief: string
  config?: Config
  onCreated: (id: string) => void
}) {
  const client = useQueryClient(),
    id = useRef(crypto.randomUUID())
  const [brief, setBrief] = useState(initialBrief),
    [question, setQuestion] = useState(''),
    [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => api('brief', 'PUT', { text: brief }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.brief }),
  })
  const create = useMutation({
    mutationFn: (input: unknown) => api<Task>('tasks', 'POST', input),
    onSuccess: (t) => {
      id.current = crypto.randomUUID()
      onCreated(t.id)
    },
  })
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    create.mutate({
      id: id.current,
      question,
      brief,
      consent: data.get('consent') === 'on',
      failOnce: data.get('failOnce') === 'on',
    })
  }
  return (
    <form onSubmit={submit} className="composer">
      <label htmlFor="question">Research question</label>
      <textarea
        id="question"
        name="question"
        className="question"
        placeholder="Compare customer support platforms for our 12-person team..."
        minLength={8}
        maxLength={2000}
        required
        value={question}
        onChange={(e) => {
          id.current = crypto.randomUUID()
          setQuestion(e.target.value)
        }}
      />
      <div className="brief-heading">
        <label htmlFor="brief">
          <FileText size={16} /> Context and requirements
        </label>
        <div>
          <label className="file-label" title="Attach a text or Markdown file">
            <Plus size={14} /> Add file
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (f.size > 24000) {
                  setError('Choose a text file smaller than 24 KB')
                  return
                }
                const text = await f.text()
                if (brief.length + text.length + 2 > 24000) {
                  setError('Combined context must be under 24,000 characters')
                  return
                }
                id.current = crypto.randomUUID()
                setBrief((v) => `${v}\n\n${text}`.trim())
                setError('')
              }}
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isSuccess ? <Check size={14} /> : null} Save context
          </button>
        </div>
      </div>
      <textarea
        id="brief"
        name="brief"
        placeholder="Budget, must-have features, existing tools, previous findings..."
        value={brief}
        onChange={(e) => {
          id.current = crypto.randomUUID()
          setBrief(e.target.value)
        }}
        maxLength={24000}
        rows={5}
      />
      <label className="consent">
        <input name="consent" type="checkbox" required /> Share this question
        and context with Linkup and Nebius
        {config?.executor === 'render'
          ? ', and process it through Render Workflows'
          : ''}
        .
      </label>
      {config?.allowFailure && (
        <label className="consent">
          <input name="failOnce" type="checkbox" /> Demonstrate recovery: fail
          once after evidence is saved.
        </label>
      )}
      <div className="composer-bottom">
        <span>
          <span
            className={`connection-dot ${config?.ready ? '' : 'missing'}`}
          />
          {config?.ready ? 'Connections configured' : 'Connections required'}
        </span>
        <button
          type="submit"
          className="primary"
          disabled={!config?.ready || create.isPending}
        >
          {create.isPending ? (
            <Loader2 className="spin" size={17} />
          ) : (
            <ArrowUp size={17} />
          )}{' '}
          Start research
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ErrorText error={create.error ?? save.error} />
    </form>
  )
}

function TaskDetail({ task }: { task: Task }) {
  const results = task.events.flatMap((e) => (e.result ? [e.result] : [])),
    sources = combinedSources(results),
    report = results.find((r) => r.report)?.report
  const usage = results.flatMap((r) => (r.usage ? [r.usage] : []))
  return (
    <div className="research-layout">
      <div className="research-result">
        <ResearchSteps task={task} />
        {report && (
          <section className="report" id="research-report">
            <div className="eyebrow">NEBIUS REPORT</div>
            <div className="section-heading">
              <FileText size={18} />
              <h2>{report.title}</h2>
            </div>
            <p>{report.summary}</p>
            {report.findings.map((f, i) => (
              <div className="finding" id={`finding-${i + 1}`} key={f.text}>
                <span className="finding-number">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <p>{f.text}</p>
                  <div className="citations">
                    {f.sources.map((id) => {
                      const s = sources.find((s) => s.id === id)
                      return s ? (
                        <a
                          key={id}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {new URL(s.url).hostname}
                          <ArrowUpRight size={12} />
                        </a>
                      ) : null
                    })}
                  </div>
                </div>
              </div>
            ))}
            <h3>Could not confirm</h3>
            {report.uncertainties.length ? (
              <ul>
                {report.uncertainties.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            ) : (
              <p>
                No additional uncertainty reported by the model. Check cited
                sources before acting.
              </p>
            )}
            <h3>Next actions</h3>
            <ul>
              {report.nextActions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        )}
        <section className="metrics">
          <span>
            <Clock3 size={15} />{' '}
            {Math.round(
              ((task.state === 'running' ? Date.now() : task.updated) -
                task.created) /
                1000,
            )}
            s since task created
          </span>
          <span>
            {usage
              .reduce((n, u) => n + u.inputTokens + u.outputTokens, 0)
              .toLocaleString()}{' '}
            recorded tokens
          </span>
          <span>{usage[0]?.model ?? 'No inference recorded'}</span>
        </section>
        <details className="original-brief">
          <summary>Original context</summary>
          <p>{task.brief || 'No additional context attached.'}</p>
        </details>
      </div>
      <IntegrationActivity task={task} />
    </div>
  )
}
function StatusIcon({ state }: { state: string }) {
  return state === 'succeeded' ? (
    <Check size={15} className="success" />
  ) : ['running', 'queued'].includes(state) ? (
    <Loader2 size={15} className="spin" />
  ) : state === 'failed' ? (
    <X size={15} className="error" />
  ) : (
    <Circle size={13} />
  )
}
function ErrorText({ error }: { error: Error | null | undefined }) {
  return error ? (
    <p role="alert" className="error">
      {error.message}
    </p>
  ) : null
}
