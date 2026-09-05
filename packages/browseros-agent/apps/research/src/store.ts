import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  type Result,
  type Step,
  steps,
  type Task,
  type TaskInput,
} from './schema'

type Row = {
  id: string
  owner: string
  question: string
  brief: string
  state: Task['state']
  executor: string
  created: number
  updated: number
  error: string | null
  run_id: string | null
  fail_once: number
}
type StepRow = {
  step: Step
  state: string
  attempts: number
  result: string | null
  error: string | null
  updated: number
  lease: string | null
}

export class ResearchStore {
  db: Database
  constructor(path: string) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new Database(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS research_tasks (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, question TEXT NOT NULL, brief TEXT NOT NULL,
        state TEXT NOT NULL, executor TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
        error TEXT, run_id TEXT, fail_once INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS research_steps (
        task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE, step TEXT NOT NULL,
        state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT,
        updated INTEGER NOT NULL, lease TEXT, PRIMARY KEY(task_id, step));
      CREATE TABLE IF NOT EXISTS research_briefs(owner TEXT PRIMARY KEY, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_sessions(id TEXT PRIMARY KEY, expires INTEGER NOT NULL);`)
    this.db
      .query(
        "UPDATE research_tasks SET state='paused', error='Service restarted; resume to reconcile saved steps' WHERE executor='local' AND state IN ('running','queued')",
      )
      .run()
  }
  close() {
    this.db.close()
  }
  newSession() {
    const id = randomUUID()
    this.db
      .query('DELETE FROM research_sessions WHERE expires < ?')
      .run(Date.now())
    this.db
      .query('INSERT INTO research_sessions VALUES (?, ?)')
      .run(id, Date.now() + 30 * 86400000)
    return id
  }
  session(id: string) {
    return !!this.db
      .query('SELECT id FROM research_sessions WHERE id=? AND expires>?')
      .get(id, Date.now())
  }
  brief(owner: string) {
    return (
      (
        this.db
          .query('SELECT text FROM research_briefs WHERE owner=?')
          .get(owner) as { text: string } | null
      )?.text ?? ''
    )
  }
  saveBrief(owner: string, text: string) {
    this.db
      .query(
        'INSERT INTO research_briefs VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET text=excluded.text',
      )
      .run(owner, text)
  }
  row(id: string) {
    return this.db
      .query('SELECT * FROM research_tasks WHERE id=?')
      .get(id) as Row | null
  }
  owned(id: string, owner: string) {
    const row = this.row(id)
    return row?.owner === owner ? this.get(id) : null
  }
  get(id: string): Task | null {
    const r = this.row(id)
    if (!r) return null
    const events = this.db
      .query('SELECT * FROM research_steps WHERE task_id=?')
      .all(id) as StepRow[]
    return {
      id: r.id,
      question: r.question,
      brief: r.brief,
      state: r.state,
      executor: r.executor,
      created: r.created,
      updated: r.updated,
      error: r.error,
      runId: r.run_id,
      events: steps.flatMap((step) =>
        events
          .filter((e) => e.step === step)
          .map((e) => ({
            step: e.step,
            state: e.state,
            attempts: e.attempts,
            result: e.result ? (JSON.parse(e.result) as Result) : null,
            error: e.error,
            updated: e.updated,
          })),
      ),
    }
  }
  list(owner: string) {
    return (
      this.db
        .query(
          'SELECT id FROM research_tasks WHERE owner=? ORDER BY created DESC LIMIT 50',
        )
        .all(owner) as { id: string }[]
    ).map((r) => this.get(r.id) as Task)
  }
  create(owner: string, input: TaskInput, executor: string) {
    return this.db.transaction(() => {
      const prior = this.row(input.id)
      if (prior) {
        if (
          prior.owner !== owner ||
          prior.question !== input.question ||
          prior.brief !== input.brief
        )
          throw new Error('Task ID already used for different input')
        return { task: this.get(input.id) as Task, created: false }
      }
      const count = this.db
        .query(
          "SELECT count(*) AS n FROM research_tasks WHERE owner=? AND state IN ('running','queued')",
        )
        .get(owner) as { n: number }
      if (count.n >= 3)
        throw new Error('Finish or stop an active task before starting another')
      this.db
        .query(
          'INSERT INTO research_tasks(id,owner,question,brief,state,executor,created,updated,fail_once) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          input.id,
          owner,
          input.question,
          input.brief,
          'queued',
          executor,
          Date.now(),
          Date.now(),
          Number(input.failOnce),
        )
      return { task: this.get(input.id) as Task, created: true }
    })()
  }
  attachRun(id: string, run: string) {
    this.db
      .query('UPDATE research_tasks SET run_id=?,updated=? WHERE id=?')
      .run(run, Date.now(), id)
  }
  resume(id: string) {
    const change = this.db
      .query(
        "UPDATE research_tasks SET state='queued',error=NULL,updated=? WHERE id=? AND state IN ('failed','paused')",
      )
      .run(Date.now(), id)
    return change.changes === 1
  }
  cancel(id: string) {
    this.db
      .query(
        "UPDATE research_tasks SET state='cancelled',updated=? WHERE id=? AND state IN ('queued','running','paused','failed')",
      )
      .run(Date.now(), id)
  }
  fail(id: string, error: string) {
    this.db
      .query(
        "UPDATE research_tasks SET state='failed',error=?,updated=? WHERE id=? AND state IN ('running','queued')",
      )
      .run(error.slice(0, 1000), Date.now(), id)
  }
  remove(id: string) {
    const task = this.get(id)
    if (task && ['queued', 'running'].includes(task.state))
      throw new Error('Stop the task before deleting it')
    this.db.query('DELETE FROM research_tasks WHERE id=?').run(id)
  }
  claim(id: string, step: Step) {
    return this.db.transaction(() => {
      const task = this.get(id)
      if (!task || ['cancelled', 'paused', 'failed'].includes(task.state))
        throw new Error('Task is not running')
      const prior = this.db
        .query('SELECT * FROM research_steps WHERE task_id=? AND step=?')
        .get(id, step) as StepRow | null
      if (prior?.state === 'succeeded')
        return { cached: JSON.parse(prior.result!) as Result }
      if (prior?.state === 'running' && prior.updated > Date.now() - 180000)
        throw new Error('Step already running; retry after its lease expires')
      for (const required of steps.slice(0, steps.indexOf(step))) {
        if (
          !task.events.some(
            (e) => e.step === required && e.state === 'succeeded',
          )
        )
          throw new Error('Previous step is incomplete')
      }
      const lease = randomUUID()
      this.db
        .query(
          "INSERT INTO research_steps(task_id,step,state,attempts,updated,lease) VALUES (?,?,'running',1,?,?) ON CONFLICT(task_id,step) DO UPDATE SET state='running',attempts=attempts+1,error=NULL,updated=excluded.updated,lease=excluded.lease",
        )
        .run(id, step, Date.now(), lease)
      this.db
        .query("UPDATE research_tasks SET state='running',updated=? WHERE id=?")
        .run(Date.now(), id)
      return { lease, task }
    })()
  }
  consumeFailure(id: string, step: Step) {
    if (step !== 'investigate') return false
    return (
      this.db
        .query(
          'UPDATE research_tasks SET fail_once=0 WHERE id=? AND fail_once=1',
        )
        .run(id).changes === 1
    )
  }
  finish(
    id: string,
    step: Step,
    lease: string,
    result: Result | null,
    error: string | null,
  ) {
    return this.db.transaction(() => {
      const task = this.get(id)
      if (!task || task.state !== 'running')
        throw new Error('Task stopped before this step completed')
      const changed = this.db
        .query(
          'UPDATE research_steps SET state=?,result=?,error=?,updated=?,lease=NULL WHERE task_id=? AND step=? AND lease=?',
        )
        .run(
          error ? 'failed' : 'succeeded',
          result ? JSON.stringify(result) : null,
          error,
          Date.now(),
          id,
          step,
          lease,
        )
      if (changed.changes !== 1) throw new Error('Step lease is stale')
      if (step === 'report' && !error)
        this.db
          .query(
            "UPDATE research_tasks SET state='succeeded',error=NULL,updated=? WHERE id=?",
          )
          .run(Date.now(), id)
      else
        this.db
          .query('UPDATE research_tasks SET updated=? WHERE id=?')
          .run(Date.now(), id)
    })()
  }
}
