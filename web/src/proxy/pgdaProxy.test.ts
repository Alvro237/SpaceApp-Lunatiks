// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LIVE_LEVELS } from '../terrain/live/config'
import { LIVE_LAYERS } from '../terrain/live/layers'
import { ALLOWED_FILES, MAX_RANGE_BYTES, UPSTREAM, handle } from './pgdaProxy'

const FILE = 'LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF'
const TOTAL = 5_116_709_568

/** Fake PGDA: answers ranges with bytes equal to (offset & 0xff); `truncate` cuts the body in half. */
function upstream(opts: { truncate?: boolean; status?: number } = {}) {
  const calls: { url: string; range: string | null }[] = []
  const fetcher = async (url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range')
    calls.push({ url, range })
    if (opts.status) return new Response('x', { status: opts.status })
    const [a, b] = range!.slice(6).split('-').map(Number)
    let body = new Uint8Array(b - a + 1).map((_, i) => (a + i) & 0xff)
    if (opts.truncate) body = body.slice(0, body.length >> 1)
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${TOTAL}` } })
  }
  return { fetcher, calls }
}

/** Minimal Cache API stand-in (match/put by URL). */
function memoryCache(): Cache {
  const m = new Map<string, Response>()
  return {
    match: async (r: RequestInfo | URL) => m.get(String(r instanceof Request ? r.url : r))?.clone(),
    put: async (r: RequestInfo | URL, res: Response) => {
      m.set(String(r instanceof Request ? r.url : r), res)
    },
  } as unknown as Cache
}

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://proxy.example/${path}`, { method, headers: { origin: 'https://team.github.io', ...headers } })

describe('PGDA CORS proxy', () => {
  it('answers the preflight with CORS headers', async () => {
    const res = await handle(get(FILE, {}, 'OPTIONS'), {}, upstream().fetcher)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-headers')).toBe('range')
  })

  it('forwards one range of an allowed file, adds CORS and serves the repeat from the edge cache', async () => {
    const up = upstream()
    const cache = memoryCache()
    const res = await handle(get(FILE, { range: 'bytes=1000-1099' }), {}, up.fetcher, cache)
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 1000-1099/${TOTAL}`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-expose-headers')).toContain('content-range')
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(1000 & 0xff)
    expect(up.calls).toEqual([{ url: UPSTREAM + FILE, range: 'bytes=1000-1099' }])
    const again = await handle(get(FILE, { range: 'bytes=1000-1099' }), {}, up.fetcher, cache)
    expect(again.status).toBe(206)
    expect(again.headers.get('x-proxy-cache')).toBe('hit')
    expect(again.headers.get('content-range')).toBe(`bytes 1000-1099/${TOTAL}`)
    expect((await again.arrayBuffer()).byteLength).toBe(100)
    expect(up.calls).toHaveLength(1)
  })

  it('refuses other files, full-file reads, huge ranges and other origins', async () => {
    const up = upstream()
    expect((await handle(get('LOLA_20mpp/other.TIF', { range: 'bytes=0-9' }), {}, up.fetcher)).status).toBe(404)
    expect((await handle(get('../secret', { range: 'bytes=0-9' }), {}, up.fetcher)).status).toBe(404)
    expect((await handle(get(FILE), {}, up.fetcher)).status).toBe(416)
    expect((await handle(get(FILE, { range: `bytes=0-${MAX_RANGE_BYTES}` }), {}, up.fetcher)).status).toBe(416)
    expect((await handle(get(FILE, { range: 'bytes=0-9' }, 'POST'), {}, up.fetcher)).status).toBe(405)
    const env = { ALLOWED_ORIGINS: 'https://other.github.io' }
    expect((await handle(get(FILE, { range: 'bytes=0-9' }), env, up.fetcher)).status).toBe(403)
    const ok = await handle(get(FILE, { range: 'bytes=0-9', origin: 'https://other.github.io' }), env, up.fetcher)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://other.github.io')
    expect(up.calls).toHaveLength(1)
  })

  it('turns a truncated or failed upstream answer into 502 and caches nothing', async () => {
    const cache = memoryCache()
    const bad = await handle(get(FILE, { range: 'bytes=0-999' }), {}, upstream({ truncate: true }).fetcher, cache)
    expect(bad.status).toBe(502)
    expect(await cache.match(new Request(`https://pgda-proxy.cache/${FILE}?bytes=0-999`))).toBeUndefined()
    expect((await handle(get(FILE, { range: 'bytes=0-999' }), {}, upstream({ status: 500 }).fetcher)).status).toBe(502)
  })
})

describe('allowed files', () => {
  it('lets through every PGDA file the web app reads, live DEMs and live layers', () => {
    const used = new Set<string>()
    for (const l of LIVE_LEVELS) for (const s of l.sources) if (s.kind === 'cog') used.add(s.file)
    for (const sources of Object.values(LIVE_LAYERS)) for (const s of sources) used.add(s.file)
    expect([...used].filter((f) => !ALLOWED_FILES.has(f))).toEqual([])
  })
})
