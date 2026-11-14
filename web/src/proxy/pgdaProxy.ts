/**
 * CORS proxy for the live terrain levels: a Cloudflare Worker (web/proxy/wrangler.toml) that forwards byte-range
 * reads of the LOLA DEMs and layer products to NASA PGDA and adds the CORS headers PGDA does not send, so the browser can read the
 * Cloud Optimized GeoTIFFs directly. It stores nothing of its own beyond the edge cache.
 *
 * Deliberately narrow, so it is not an open proxy:
 * - only the files in ALLOWED_FILES, only GET, HEAD and the CORS preflight;
 * - a GET must carry one byte range of at most MAX_RANGE_BYTES (the DEMs are gigabytes: no full-file download);
 * - the answer must be a 206 whose Content-Range matches the request, else 502 (PGDA sometimes truncates ranges;
 *   the browser client retries).
 * Each answered range is kept in the edge cache under a key made of the file and the range, so repeated reads
 * (the same blocks for every visitor) do not reach PGDA again.
 */

export const UPSTREAM = 'https://pgda.gsfc.nasa.gov/data/'
/**
 * Every PGDA file the web app reads: the live terrain DEMs (src/terrain/live/config.ts) and the live colour layers
 * (src/terrain/live/layers.ts). pgdaProxy.test.ts checks that the app asks for nothing outside this list: the first
 * deployment listed only the two DEMs, so every live layer tile got a 404 and the layers stayed at 960 m.
 */
export const ALLOWED_FILES = new Set([
  'LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF',
  'LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF',
  'LOLA_20mpp/LDSM_83S_10MPP_ADJ.TIF',
  'LOLA_20mpp/LDSM_80S_80MPP_ADJ.TIF',
  'LOLA_20mpp/LDSM_60S_240MPP_ADJ.TIF',
  'MoonIllumination/AVGVISIB_65S_240M_201608.TIF',
  'MoonIllumination/AVGVISIB_65S_240M_201608_EARTH.TIF',
  'MoonIllumination/LPSR_65S_240M_201608.TIF',
])
export const MAX_RANGE_BYTES = 16 * 1024 * 1024
const EDGE_MAX_AGE_S = 30 * 24 * 3600

export interface ProxyEnv {
  /** Comma-separated origins allowed to read, or '*' (default). */
  ALLOWED_ORIGINS?: string
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

function corsHeaders(req: Request, env: ProxyEnv): Record<string, string> | null {
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim())
  const origin = req.headers.get('origin')
  let allow: string
  if (allowed.includes('*')) allow = '*'
  else if (origin && allowed.includes(origin)) allow = origin
  else if (!origin) allow = allowed[0] ?? '*' // not a browser cross-origin request
  else return null
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'range',
    'access-control-expose-headers': 'content-range, content-length, accept-ranges',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } })

export async function handle(req: Request, env: ProxyEnv, fetcher: Fetcher, cache?: Cache, ctx?: Ctx): Promise<Response> {
  const cors = corsHeaders(req, env)
  if (!cors) return text(403, 'origin not allowed')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'method not allowed', cors)

  const file = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '')
  if (!ALLOWED_FILES.has(file)) return text(404, 'not a proxied file', cors)
  if (req.method === 'HEAD') {
    const up = await fetcher(UPSTREAM + file, { method: 'HEAD' })
    const h: Record<string, string> = { ...cors, 'accept-ranges': 'bytes' }
    const len = up.headers.get('content-length')
    if (len) h['content-length'] = len
    return new Response(null, { status: up.ok ? 200 : 502, headers: h })
  }

  const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range')?.trim() ?? '')
  if (!m) return text(416, 'one byte range required (bytes=start-end)', cors)
  const start = Number(m[1])
  const end = Number(m[2])
  if (end < start || end - start + 1 > MAX_RANGE_BYTES) return text(416, `range must be 1..${MAX_RANGE_BYTES} bytes`, cors)

  const key = new Request(`https://pgda-proxy.cache/${file}?bytes=${start}-${end}`)
  const hit = await cache?.match(key)
  if (hit) {
    const h = new Headers(cors)
    h.set('content-range', hit.headers.get('x-content-range') ?? '')
    h.set('accept-ranges', 'bytes')
    h.set('content-type', 'application/octet-stream')
    h.set('x-proxy-cache', 'hit')
    return new Response(hit.body, { status: 206, headers: h })
  }

  const up = await fetcher(UPSTREAM + file, { headers: { range: `bytes=${start}-${end}` } })
  if (up.status !== 206) {
    await up.body?.cancel()
    return text(502, `upstream answered HTTP ${up.status}`, cors)
  }
  const contentRange = up.headers.get('content-range') ?? ''
  const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange)
  const body = await up.arrayBuffer()
  const expectedEnd = cr ? Math.min(end, Number(cr[3]) - 1) : -1
  if (!cr || Number(cr[1]) !== start || Number(cr[2]) !== expectedEnd || body.byteLength !== expectedEnd - start + 1) {
    return text(502, `upstream returned ${contentRange || 'no Content-Range'} with ${body.byteLength} bytes`, cors)
  }
  if (cache) {
    const stored = new Response(body.slice(0), {
      status: 200, // the Cache API does not store 206 answers; the range is kept in a header
      headers: { 'x-content-range': contentRange, 'cache-control': `public, max-age=${EDGE_MAX_AGE_S}` },
    })
    const put = cache.put(key, stored)
    if (ctx) ctx.waitUntil(put)
    else await put
  }
  return new Response(body, {
    status: 206,
    headers: { ...cors, 'content-range': contentRange, 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream', 'x-proxy-cache': 'miss' },
  })
}

/** Cloudflare Worker entry point (`caches.default` is the Workers edge cache). */
export default {
  fetch(req: Request, env: ProxyEnv, ctx: Ctx): Promise<Response> {
    const edge = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default
    return handle(req, env, (u, i) => fetch(u, i), edge, ctx)
  },
}
