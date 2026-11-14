import { isMissing } from '../api/client'

/**
 * Says plainly why a number is not coming from the API: the route is not deployed yet (being built in
 * parallel) or the server did not answer, and what is shown instead.
 */
export function ApiStatus({ error, what, fallback }: { error: unknown; what: string; fallback?: string }) {
  if (!error) return null
  const msg = isMissing(error)
    ? `${what}: not available yet.`
    : (error as Error)?.message === 'The API did not answer'
      ? `${what}: the API did not answer.`
      : `${what}: ${(error as Error)?.message ?? 'error'}.`
  return (
    <p className="note note-warn" role="status">
      {msg} {fallback}
    </p>
  )
}

/** Where a value comes from, shown next to it. */
export function SourceTag({ source }: { source: 'api' | 'browser' }) {
  return source === 'api' ? (
    <span className="source source-api" title="Computed by the API engine">
      API
    </span>
  ) : (
    <span className="source source-browser" title="Computed in this browser with the API's validated method (same tables, same horizon masks)">
      Browser engine
    </span>
  )
}
