/**
 * Gradual loading, nearest ground first. The horizon view reads its ground in pieces from Moon Trek (rings,
 * photo tiles, far patches); fired all at once they share the bandwidth and arrive in whatever order the server
 * answers, so the ground at the observer's feet can be the last to sharpen. Here the pieces wait in a queue sorted
 * by distance from the observer and only a few are read at a time: the nearest arrive first and go on screen while
 * the farther ones are still on their way.
 */

/** Most pieces read at the same time, per kind. */
export const NEAR_FIRST_CONCURRENCY = { rings: 3, tiles: 6, patches: 4 } as const

/**
 * Read `items` nearest first (smallest `distOf`), at most `concurrency` at a time. `onDone` is called for each one
 * as it arrives (null when its load failed). Returns a cancel function: pieces not started yet are dropped (the ones
 * on their way still finish, into the loaders' caches, but `onDone` is no longer called).
 */
export function loadNearFirst<T, R>(
  items: readonly T[],
  distOf: (item: T) => number,
  load: (item: T) => Promise<R>,
  onDone: (item: T, result: R | null) => void,
  concurrency: number,
): () => void {
  const queue = items
    .map((item, i) => ({ item, d: distOf(item), i }))
    // stable on equal distances: the caller's order (heaviest first) breaks the tie
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((q) => q.item)
  let next = 0
  let live = true
  const start = () => {
    if (!live || next >= queue.length) return
    const item = queue[next++]
    load(item).then(
      (r) => {
        if (!live) return
        onDone(item, r)
        start()
      },
      () => {
        if (!live) return
        onDone(item, null)
        start()
      },
    )
  }
  for (let k = 0; k < Math.max(1, concurrency); k++) start()
  return () => {
    live = false
  }
}
