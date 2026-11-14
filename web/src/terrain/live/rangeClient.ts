/**
 * HTTP client for geotiff.js that reads byte ranges of a remote file through the persistent block cache.
 *
 * geotiff.js asks for single ranges aligned to 64 KiB blocks (its BlockedSource). This client splits each range
 * into blocks of BLOCK_BYTES, takes the cached ones from the store, fetches each run of missing blocks with one
 * Range request, checks the answer (PGDA sometimes truncates range responses: a short or misplaced body is
 * retried), stores the new blocks and returns the requested bytes as a 206 response. It never accepts a full-file
 * answer: the DEMs are gigabytes.
 */
import { BaseClient, BaseResponse } from 'geotiff'
import { BLOCK_BYTES, type BlockStore } from './blockStore'

class BytesResponse extends BaseResponse {
  private readonly code: number
  private readonly headers: Record<string, string>
  private readonly data: ArrayBuffer

  constructor(code: number, headers: Record<string, string>, data: ArrayBuffer) {
    super()
    this.code = code
    this.headers = headers
    this.data = data
  }
  get status(): number {
    return this.code
  }
  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()]
  }
  async getData(): Promise<ArrayBuffer> {
    return this.data
  }
}

/** "bytes=a-b" → [a, b]; null for anything else (multi-range, open-ended). */
export function parseRange(h: string | undefined): [number, number] | null {
  const m = /^bytes=(\d+)-(\d+)$/.exec(h?.trim() ?? '')
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** "bytes s-e/total" → { start, end, total }; null when absent or malformed. */
export function parseContentRange(h: string | null | undefined): { start: number; end: number; total: number } | null {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(h?.trim() ?? '')
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export class CachedRangeClient extends BaseClient {
  private total: number | undefined
  /** Network requests made and bytes received (for the dev stats and tests). */
  readonly counters = { requests: 0, bytes: 0, cachedBlocks: 0, retries: 0 }

  /** Stable name of the file in the cache (the PGDA path), independent of the proxy URL. */
  private readonly cacheKey: string
  private readonly store: BlockStore | null
  private readonly fetchFn: FetchFn
  private readonly attempts: number

  constructor(url: string, cacheKey: string, store: BlockStore | null, fetchFn: FetchFn = (u, i) => fetch(u, i), attempts = 3) {
    super(url)
    this.cacheKey = cacheKey
    this.store = store
    this.fetchFn = fetchFn
    this.attempts = attempts
  }

  private blockKey(id: number): string {
    return `${this.cacheKey}#${id}`
  }

  private async fetchRange(start: number, end: number, signal?: AbortSignal | null): Promise<{ data: Uint8Array; total: number }> {
    let last = ''
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (attempt > 0) this.counters.retries++
      this.counters.requests++
      const res = await this.fetchFn(this.url, { headers: { Range: `bytes=${start}-${end}` }, signal: signal ?? undefined })
      if (res.status !== 206) {
        last = `HTTP ${res.status} for a range of ${this.cacheKey}`
        if (res.status === 200) {
          await res.body?.cancel()
          throw new Error(`${last}: the server ignored the Range header`)
        }
        continue
      }
      const cr = parseContentRange(res.headers.get('content-range'))
      const data = new Uint8Array(await res.arrayBuffer())
      this.counters.bytes += data.byteLength
      const expectedEnd = cr ? Math.min(end, cr.total - 1) : -1
      if (cr && cr.start === start && cr.end === expectedEnd && data.byteLength === expectedEnd - start + 1) {
        return { data, total: cr.total }
      }
      last = `truncated or misplaced range from ${this.cacheKey} (asked ${start}-${end}, got ${res.headers.get('content-range')}, ${data.byteLength} bytes)`
    }
    throw new Error(last)
  }

  async request({ headers = {}, signal }: RequestInit = {}): Promise<BaseResponse> {
    const h = headers as Record<string, string>
    const range = parseRange(h.Range ?? h.range)
    if (!range) throw new Error('CachedRangeClient: only single byte ranges are supported')
    if (this.total === undefined && this.store) this.total = await this.store.getMeta(`${this.cacheKey}#size`)
    const [a, askedEnd] = range
    const B = BLOCK_BYTES
    const first = Math.floor(a / B)
    let lastBlock = Math.floor((this.total !== undefined ? Math.min(askedEnd, this.total - 1) : askedEnd) / B)
    const ids = Array.from({ length: lastBlock - first + 1 }, (_, i) => first + i)
    const blocks = new Map<number, Uint8Array>()
    if (this.store) {
      const found = await this.store.getMany(ids.map((id) => this.blockKey(id)))
      found.forEach((v, i) => {
        if (v) {
          blocks.set(ids[i], new Uint8Array(v))
          this.counters.cachedBlocks++
        }
      })
    }
    // runs of consecutive missing blocks, one request each, all at once (one after another, a read that the cache
    // had cut into several runs paid one round trip per run)
    const runs: [number, number][] = []
    let i = 0
    while (i < ids.length) {
      if (blocks.has(ids[i])) {
        i++
        continue
      }
      let j = i
      while (j + 1 < ids.length && !blocks.has(ids[j + 1])) j++
      runs.push([ids[i], ids[j]])
      i = j + 1
    }
    const fetched = await Promise.all(runs.map(([r0, r1]) => this.fetchRange(r0 * B, (r1 + 1) * B - 1, signal)))
    const fresh: [string, ArrayBuffer][] = []
    for (let r = 0; r < runs.length; r++) {
      const [r0, r1] = runs[r]
      const { data, total } = fetched[r]
      if (this.total === undefined) {
        this.total = total
        await this.store?.putMeta(`${this.cacheKey}#size`, total)
      }
      for (let id = r0; id <= r1; id++) {
        const off = (id - r0) * B
        if (off >= data.byteLength) break
        const block = data.slice(off, Math.min(off + B, data.byteLength))
        blocks.set(id, block)
        fresh.push([this.blockKey(id), block.buffer])
      }
    }
    if (fresh.length) await this.store?.putMany(fresh)
    const total = this.total!
    lastBlock = Math.floor(Math.min(askedEnd, total - 1) / B)
    const end = Math.min(askedEnd, total - 1)
    const out = new Uint8Array(end - a + 1)
    for (let id = first; id <= lastBlock; id++) {
      const block = blocks.get(id)
      if (!block) throw new Error(`block ${id} of ${this.cacheKey} missing after fetch`)
      const blockStart = id * B
      const from = Math.max(a, blockStart)
      const to = Math.min(end, blockStart + block.byteLength - 1)
      out.set(block.subarray(from - blockStart, to - blockStart + 1), from - a)
    }
    return new BytesResponse(
      206,
      { 'content-range': `bytes ${a}-${end}/${total}`, 'content-type': 'application/octet-stream' },
      out.buffer,
    )
  }
}
