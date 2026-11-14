/**
 * Persistent cache of the DEM blocks the browser has downloaded (IndexedDB), so a place visited before loads
 * from disk and PGDA is asked only once. Each record is one aligned block of a source file (BLOCK_BYTES).
 *
 * Eviction: after writes, at most every EVICT_CHECK_MS, the cache asks the browser how much of this site's storage
 * quota is in use (navigator.storage.estimate()). Above `high` (45 % by default) it deletes the least recently
 * used blocks until about `low` (35 %) would remain. The quota is the browser's own (it differs between browsers
 * and machines), so the rule is a share of it, never a fixed number of megabytes.
 */

export const BLOCK_BYTES = 65_536
export const EVICT_HIGH = 0.45
export const EVICT_LOW = 0.35
const EVICT_CHECK_MS = 5_000

export interface BlockStore {
  /** Blocks found, in the order asked (undefined where missing); marks the found ones as used now. */
  getMany(keys: string[]): Promise<(ArrayBuffer | undefined)[]>
  putMany(entries: [string, ArrayBuffer][]): Promise<void>
  /** Small values (file sizes). */
  getMeta(key: string): Promise<number | undefined>
  putMeta(key: string, value: number): Promise<void>
}

/** Bytes to delete so that usage falls to `low` × quota, or 0 while usage is at most `high` × quota. */
export function bytesToFree(usage: number, quota: number, high = EVICT_HIGH, low = EVICT_LOW): number {
  if (!(quota > 0) || usage <= high * quota) return 0
  return Math.max(0, usage - low * quota)
}

/** Least recently used first, until their sizes add up to `bytes`. */
export function pickVictims(entries: { key: string; size: number; lastUsed: number }[], bytes: number): string[] {
  const out: string[] = []
  let freed = 0
  for (const e of [...entries].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (freed >= bytes) break
    out.push(e.key)
    freed += e.size
  }
  return out
}

/** In-memory store with the same behaviour (tests, and browsers without IndexedDB). */
export class MemoryBlockStore implements BlockStore {
  readonly blocks = new Map<string, ArrayBuffer>()
  readonly meta = new Map<string, number>()
  async getMany(keys: string[]) {
    return keys.map((k) => this.blocks.get(k))
  }
  async putMany(entries: [string, ArrayBuffer][]) {
    for (const [k, v] of entries) this.blocks.set(k, v)
  }
  async getMeta(key: string) {
    return this.meta.get(key)
  }
  async putMeta(key: string, value: number) {
    this.meta.set(key, value)
  }
}

const DB_NAME = 'lunatiks-dem-blocks'
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })

/** IndexedDB store: 'blocks' holds the bytes, 'used' holds { key, size, lastUsed } indexed by lastUsed. */
export class IdbBlockStore implements BlockStore {
  private lastCheck = 0
  private evicting = false
  private readonly db: IDBDatabase
  private readonly estimate: () => Promise<{ usage?: number; quota?: number }>

  private constructor(db: IDBDatabase, estimate: () => Promise<{ usage?: number; quota?: number }>) {
    this.db = db
    this.estimate = estimate
  }

  static async open(
    estimate: (() => Promise<{ usage?: number; quota?: number }>) | null = typeof navigator !== 'undefined' && navigator.storage?.estimate
      ? () => navigator.storage.estimate()
      : null,
  ): Promise<IdbBlockStore | null> {
    if (typeof indexedDB === 'undefined' || !estimate) return null
    try {
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => {
        const db = open.result
        db.createObjectStore('blocks')
        db.createObjectStore('meta')
        db.createObjectStore('used', { keyPath: 'key' }).createIndex('lastUsed', 'lastUsed')
      }
      return new IdbBlockStore(await req(open), estimate)
    } catch {
      return null // private browsing or storage blocked: the caller falls back to the network only
    }
  }

  async getMany(keys: string[]) {
    const tx = this.db.transaction(['blocks', 'used'], 'readwrite')
    const blocks = tx.objectStore('blocks')
    const used = tx.objectStore('used')
    const now = Date.now()
    const out: (ArrayBuffer | undefined)[] = new Array(keys.length)
    keys.forEach((k, i) => {
      const r = blocks.get(k) as IDBRequest<ArrayBuffer | undefined>
      r.onsuccess = () => {
        out[i] = r.result
        if (r.result) used.put({ key: k, size: r.result.byteLength, lastUsed: now }) // still inside the transaction
      }
    })
    await done(tx)
    return out
  }

  async putMany(entries: [string, ArrayBuffer][]) {
    if (entries.length === 0) return
    const tx = this.db.transaction(['blocks', 'used'], 'readwrite')
    const now = Date.now()
    for (const [k, v] of entries) {
      tx.objectStore('blocks').put(v, k)
      tx.objectStore('used').put({ key: k, size: v.byteLength, lastUsed: now })
    }
    await done(tx)
    void this.maybeEvict()
  }

  async getMeta(key: string) {
    return req(this.db.transaction('meta').objectStore('meta').get(key) as IDBRequest<number | undefined>)
  }

  async putMeta(key: string, value: number) {
    const tx = this.db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put(value, key)
    await done(tx)
  }

  /** Delete least recently used blocks when this site uses more than EVICT_HIGH of its storage quota. */
  async maybeEvict(): Promise<number> {
    const now = Date.now()
    if (this.evicting || now - this.lastCheck < EVICT_CHECK_MS) return 0
    this.lastCheck = now
    this.evicting = true
    try {
      const { usage = 0, quota = 0 } = await this.estimate()
      const bytes = bytesToFree(usage, quota)
      if (bytes === 0) return 0
      const entries = await req(
        this.db.transaction('used').objectStore('used').getAll() as IDBRequest<{ key: string; size: number; lastUsed: number }[]>,
      )
      const victims = pickVictims(entries, bytes)
      const tx = this.db.transaction(['blocks', 'used'], 'readwrite')
      for (const k of victims) {
        tx.objectStore('blocks').delete(k)
        tx.objectStore('used').delete(k)
      }
      await done(tx)
      return victims.length
    } finally {
      this.evicting = false
    }
  }
}
