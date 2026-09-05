import type { ScanInput } from '../../../src/offload/pipeline-contract'
import { defaultPolicy } from '../../../src/offload/negotiation'
import type {
  Item,
  PipelineItem,
  RunMetrics,
  Session,
} from '../../../src/offload/types'

let databaseName = 'deeptrail-offload'
let database: Promise<IDBDatabase> | undefined
export function configureStorage(key: string) {
  const name = `deeptrail-offload-${key}`
  if (databaseName !== name) {
    void database?.then((db) => db.close())
    databaseName = name
    database = undefined
  }
}
function store() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('session')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}
async function get<T>(
  key: string,
  db: Promise<IDBDatabase>,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    void db
      .then((database) => {
        const request = database
          .transaction('session')
          .objectStore('session')
          .get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      .catch(reject)
  })
}
async function write(
  operation: (store: IDBObjectStore) => void,
  db: Promise<IDBDatabase>,
): Promise<void> {
  const database = await db
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('session', 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Storage write aborted'))
    operation(transaction.objectStore('session'))
  })
}
const set = (key: string, value: unknown, db: Promise<IDBDatabase>) =>
  write((s) => {
    s.put(value, key)
  }, db)
const setMany = (rows: [string, Blob][], db: Promise<IDBDatabase>) =>
  write((s) => {
    for (const [k, v] of rows) s.put(v, k)
  }, db)
const clear = (db: Promise<IDBDatabase>) =>
  write((s) => {
    s.clear()
  }, db)
const del = (key: string, db: Promise<IDBDatabase>) =>
  write((s) => {
    s.delete(key)
  }, db)
let writes: Promise<unknown> = Promise.resolve()
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => undefined).then(operation)
  writes = next
  return next
}
export const emptySession = (): Session => ({
  version: 1,
  items: [],
  policies: {},
  offers: [],
  messages: [],
  step: 'scan',
  selectedId: null,
  metrics: [],
  confirmedOfferId: null,
})
export async function loadSession(): Promise<Session> {
  const value = await get<Session>('session', store())
  if (!value) return emptySession()
  if (
    value.version !== 1 ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.offers) ||
    !Array.isArray(value.messages) ||
    !value.policies
  )
    throw new Error(
      'The saved session could not be opened. Reset this session to start again.',
    )
  return value
}
export function saveSession(session: Session): Promise<void> {
  return enqueue(() => set('session', session, store()))
}
export function resetStorage(): Promise<void> {
  return enqueue(() => clear(store()))
}
export function getImage(key: string): Promise<Blob | undefined> {
  return get<Blob>(key, store())
}
export function saveImages(images: [string, Blob][]): Promise<void> {
  return enqueue(() => setMany(images, store()))
}
export type PendingScan = { id: string; input?: ScanInput }
export const loadPendingScan = () => get<PendingScan>('pending-scan', store())
export const savePendingScan = (scan: PendingScan) =>
  enqueue(() => set('pending-scan', scan, store()))
export const clearPendingScan = () =>
  enqueue(() => del('pending-scan', store()))
export async function importPipeline(
  items: PipelineItem[],
  metrics: RunMetrics,
  previous: Session,
): Promise<Session> {
  const blobs: [string, Blob][] = []
  const converted = await Promise.all(
    items
      .filter(
        (pipeline) => !previous.items.some((item) => item.id === pipeline.id),
      )
      .map(async (pipeline) => {
        const { listingDataUrl, sourceDataUrl, ...fields } = pipeline
        if (!sourceDataUrl.startsWith('data:image/'))
          throw new Error('A source photo is missing. Please retry the scan.')
        const source = await (await fetch(sourceDataUrl)).blob()
        const listing = listingDataUrl?.startsWith('data:image/')
          ? await (await fetch(listingDataUrl)).blob()
          : source
        const id = pipeline.id
        const listingImageKey = `image:${id}:listing`,
          sourceImageKey = `image:${id}:source`
        blobs.push([listingImageKey, listing], [sourceImageKey, source])
        return {
          ...fields,
          id,
          listingImageKey,
          sourceImageKey,
          conditionConfirmed: false,
          status: 'draft',
          selected: true,
          sample: false,
        } satisfies Item
      }),
  )
  await saveImages(blobs)
  return {
    ...previous,
    step: 'listings',
    items: [...previous.items, ...converted],
    selectedId: converted[0]?.id ?? previous.selectedId,
    policies: {
      ...previous.policies,
      ...Object.fromEntries(converted.map((i) => [i.id, defaultPolicy(i)])),
    },
    metrics:
      metrics.jobId && previous.metrics.some((m) => m.jobId === metrics.jobId)
        ? previous.metrics
        : [...previous.metrics, metrics],
  }
}
