import { serveStatic } from 'hono/bun'
import { type AppConfig, createResearchApp } from './app'
import { createProviders } from './providers'
import { ResearchStore } from './store'

const port = Number(process.env.PORT ?? 4318)
const origin = process.env.RESEARCH_ORIGIN ?? `http://127.0.0.1:${port}`
const local = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
if (
  !local &&
  (!process.env.RESEARCH_ACCESS_CODE || !process.env.RESEARCH_WORKER_SECRET)
)
  throw new Error('Public deployment requires access code and worker secret')
const executor = process.env.RESEARCH_EXECUTOR ?? 'local'
if (!['local', 'render'].includes(executor))
  throw new Error('RESEARCH_EXECUTOR must be local or render')
const config: AppConfig = {
  origin,
  accessCode: process.env.RESEARCH_ACCESS_CODE ?? '',
  workerSecret: process.env.RESEARCH_WORKER_SECRET ?? '',
  executor: executor as 'local' | 'render',
  renderKey: process.env.RENDER_API_KEY ?? '',
  workflowSlug: process.env.RENDER_WORKFLOW_SLUG ?? '',
  allowFailure: process.env.RESEARCH_ALLOW_FAILURE_DEMO === 'true',
  linkup: !!process.env.LINKUP_API_KEY,
  nebius: !!process.env.NEBIUS_API_KEY,
  model: process.env.NEBIUS_MODEL ?? '',
}
const store = new ResearchStore(
  process.env.RESEARCH_DB ?? './data/research.sqlite',
)
const providers = createProviders({
  linkupKey: process.env.LINKUP_API_KEY ?? '',
  nebiusKey: process.env.NEBIUS_API_KEY ?? '',
  model: config.model,
})
const { app } = createResearchApp(store, providers, config)
app.use('*', async (c, next) => {
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  )
  await next()
})
app.use('/assets/*', serveStatic({ root: './dist' }))
app.get('/favicon.ico', (c) => c.body(null, 204))
app.get('/', serveStatic({ path: './dist/index.html' }))
const server = Bun.serve({
  hostname: local ? '127.0.0.1' : '0.0.0.0',
  port,
  fetch: app.fetch,
  idleTimeout: 120,
})
console.log(`Research workspace: ${origin} (executor: ${executor})`)
process.on('SIGTERM', () => {
  server.stop()
  store.close()
  process.exit(0)
})
