/**
 * One shared load of the Learn mode chunk: the switch prefetches it when the pointer or the focus reaches it, and
 * the navigator's lazy() uses the same promise, so the code is fetched once. A failed load is forgotten, so the
 * next attempt retries instead of replaying the error.
 */
let chunk: Promise<typeof import('./BlockMode')> | null = null

export function loadBlockMode(): Promise<typeof import('./BlockMode')> {
  chunk ??= import('./BlockMode').catch((e: unknown) => {
    chunk = null
    throw e
  })
  return chunk
}
