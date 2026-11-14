/**
 * Least-recently-used cache of GPU tile resources (plan: about 300 tiles in GPU memory). `touch` marks a tile
 * as used this frame; when the cache is over capacity the least recently used entries are disposed.
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>()
  readonly capacity: number
  private readonly dispose: (v: V, key: string) => void

  constructor(capacity: number, dispose: (v: V, key: string) => void) {
    this.capacity = capacity
    this.dispose = dispose
  }

  get size(): number {
    return this.map.size
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  get(key: string): V | undefined {
    return this.map.get(key)
  }

  /** Mark as most recently used. */
  touch(key: string): void {
    const v = this.map.get(key)
    if (v === undefined) return
    this.map.delete(key)
    this.map.set(key, v)
  }

  set(key: string, value: V, pinned: ReadonlySet<string> = new Set()): void {
    if (this.map.has(key)) {
      const old = this.map.get(key)!
      this.map.delete(key)
      if (old !== value) this.dispose(old, key)
    }
    this.map.set(key, value)
    this.evict(pinned)
  }

  /** Dispose the oldest entries until within capacity, never one in `pinned` (drawn this frame). */
  evict(pinned: ReadonlySet<string> = new Set()): void {
    for (const k of this.map.keys()) {
      if (this.map.size <= this.capacity) break
      if (pinned.has(k)) continue
      const v = this.map.get(k)!
      this.map.delete(k)
      this.dispose(v, k)
    }
  }

  clear(): void {
    for (const [k, v] of this.map) this.dispose(v, k)
    this.map.clear()
  }
}
