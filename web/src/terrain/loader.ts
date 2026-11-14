/**
 * Tile requests: at most 6 in flight (plan), the rest wait in a queue that the scene re-orders every frame so
 * the tiles nearest to the centre of the view go first. Decoding runs in a pool of two workers.
 */
import type { DecodeRequest, DecodeResponse } from './decode.worker'

export const MAX_IN_FLIGHT = 6

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

  constructor(poolSize = 2) {
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
    while (this.pending.size < MAX_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift()!
      const id = ++this.seq
      this.pending.set(id, job)
      // live tiles all go to the first worker, so they share its open DEM files and in-memory block cache
      const w = job.req.kind === 'live' ? this.workers[0] : this.workers[this.next++ % this.workers.length]
      w.postMessage({ ...job.req, id } satisfies DecodeRequest)
    }
  }

  private done(msg: DecodeResponse): void {
    const job = this.pending.get(msg.id)
    if (!job) return
    this.pending.delete(msg.id)
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
  }
}
