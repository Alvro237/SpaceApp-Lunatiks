/**
 * Tile requests: at most MAX_IN_FLIGHT in flight per server (plan: 6), the rest wait in a queue that the scene
 * re-orders every frame so the tiles nearest to the centre of the view go first. Decoding runs in a pool of workers.
 *
 * The limit is per server, not shared: our static tiles, NASA Moon Trek and the PGDA proxy are three hosts, and a
 * browser opens up to six HTTP/1.1 connections to each (Moon Trek answers over HTTP/1.1, the proxy over HTTP/2;
 * checked 2026-11-14). One shared limit of six let slow Moon Trek answers (about 1.1 s each) hold every slot while the
 * PGDA blocks waited behind them.
 */
import type { DecodeRequest, DecodeResponse } from './decode.worker'

export const MAX_IN_FLIGHT = 6
/** Requests in flight per server. PGDA ranges go through an HTTP/2 proxy, so they may run a few more at once. */
export const HOST_LIMITS = { static: MAX_IN_FLIGHT, trek: MAX_IN_FLIGHT, pgda: 8 } as const
export type Host = keyof typeof HOST_LIMITS

/** The server a request goes to: Moon Trek (live trek tiles, globe detail), the PGDA proxy (live COG reads) or ours. */
export function hostOf(req: Pick<DecodeRequest, 'kind' | 'live'>): Host {
  if (req.kind === 'globe') return 'trek'
  if (req.kind === 'live') return req.live?.source === 'trek' ? 'trek' : 'pgda'
  return 'static'
}

/**
 * Worker for a request. Reads of one remote GeoTIFF always go to the same worker, so they share its open file and its
 * in-memory block cache; different files spread over the pool (decoding deflate blocks is the costly part). Other
 * requests take turns.
 */
export function workerIndex(req: Pick<DecodeRequest, 'kind' | 'live'>, poolSize: number, turn: number): number {
  if (req.kind === 'live' && req.live?.source === 'cog') {
    let h = 0
    for (const ch of req.live.file) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return h % poolSize
  }
  return turn % poolSize
}

type Ok = Extract<DecodeResponse, { ok: true }>

interface Job {
  key: string
  req: Omit<DecodeRequest, 'id'>
  resolve: (r: Ok) => void
  reject: (e: Error) => void
}

export class TileLoader {
  private readonly workers: Worker[]
  private next = 0
  private seq = 0
  private readonly pending = new Map<number, Job>()
  private queue: Job[] = []
  private readonly keys = new Set<string>()
  private readonly failed = new Set<string>()
  private readonly active: Record<Host, number> = { static: 0, trek: 0, pgda: 0 }

  constructor(poolSize = 3) {
    this.workers = Array.from({ length: poolSize }, () => {
      const w = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<DecodeResponse>) => this.done(e.data)
      return w
    })
  }

  get inFlight(): number {
    return this.pending.size
  }

  /** True when this key is queued, in flight, or failed (failed keys are not retried this session). */
  known(key: string): boolean {
    return this.keys.has(key) || this.failed.has(key)
  }

  /** Let a failed key be asked for again (the globe's detail tiles retry after a pause). */
  forget(key: string): void {
    this.failed.delete(key)
  }

  request(key: string, req: Omit<DecodeRequest, 'id'>): Promise<Ok> {
    return new Promise<Ok>((resolve, reject) => {
      this.keys.add(key)
      this.queue.push({ key, req, resolve, reject })
      this.pump()
    })
  }

  /** Re-order waiting requests (lower rank first) and drop the ones no longer wanted. */
  prioritise(rank: (key: string) => number | null): void {
    const keep: Job[] = []
    for (const j of this.queue) {
      if (rank(j.key) === null) {
        this.keys.delete(j.key)
        j.reject(new Error('cancelled'))
      } else keep.push(j)
    }
    this.queue = keep.sort((a, b) => (rank(a.key) ?? 0) - (rank(b.key) ?? 0))
  }

  private pump(): void {
    // in queue order, start every job whose server has a free slot (a busy server does not hold up the others)
    for (let i = 0; i < this.queue.length; ) {
      const job = this.queue[i]
      const host = hostOf(job.req)
      if (this.active[host] >= HOST_LIMITS[host]) {
        i++
        continue
      }
      this.queue.splice(i, 1)
      const id = ++this.seq
      this.pending.set(id, job)
      this.active[host]++
      const w = this.workers[workerIndex(job.req, this.workers.length, this.next++)]
      w.postMessage({ ...job.req, id } satisfies DecodeRequest)
    }
  }

  private done(msg: DecodeResponse): void {
    const job = this.pending.get(msg.id)
    if (!job) return
    this.pending.delete(msg.id)
    this.active[hostOf(job.req)]--
    this.keys.delete(job.key)
    if (msg.ok) job.resolve(msg)
    else {
      this.failed.add(job.key)
      job.reject(new Error(msg.error))
    }
    this.pump()
  }

  dispose(): void {
    this.workers.forEach((w) => w.terminate())
    this.queue = []
    this.pending.clear()
    this.active.static = this.active.trek = this.active.pgda = 0
  }
}
