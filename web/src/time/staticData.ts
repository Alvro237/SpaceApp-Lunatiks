/**
 * Static files the browser engine reads (copied from data/ by scripts/copy_static_data.mjs):
 * ephemeris.json + ephemeris_*.f32 (Sun/Earth tables) and sites.json + horizons.i16 (terrain masks).
 * They are fetched once and cached; nothing here computes geometry.
 */
import {
  EphemerisTable,
  Horizon,
  type EphemerisSegmentMeta,
  type Segment,
  flatHorizon,
  sphericalHorizonDeg,
} from './engine'

export const DATA_BASE = `${import.meta.env.BASE_URL}data/`

export interface EphemerisIndex {
  frame: string
  correction: string
  segments: (EphemerisSegmentMeta & { startUtc: string })[]
}

/** The subset of a sites.json record the browser needs (camelCase, as stored). */
export interface StaticSite {
  id: string
  name: string
  group: string
  lat: number
  lon: number
  terrain: {
    available: boolean
    groundHeightM?: number
    horizonOffset?: number
    slopeDeg?: number
  }
}

export interface SitesDoc {
  azimuthCount: number
  mastsM: number[]
  sites: StaticSite[]
}

export function parseSegments(index: EphemerisIndex, buffers: ArrayBuffer[]): Segment[] {
  return index.segments.map((meta, i) => {
    const data = new Float32Array(buffers[i])
    if (data.length !== meta.count * 6) {
      throw new Error(`${meta.file}: expected ${meta.count * 6} floats, got ${data.length}`)
    }
    return { id: meta.id, startMs: meta.startUnixMs, stepS: meta.stepSeconds, data }
  })
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res
}

/**
 * Start of the present-day tables (2025-2035). Segments that end before it (the Apollo tables, 1969-1972, 0.8 MB) are
 * only fetched when the chosen date is before it, so the navigator's first load does not wait for them.
 */
export const PRESENT_TABLES_MS = Date.UTC(2025, 0, 1)

/** Which segments a table holds: the present-day ones, or every segment in ephemeris.json. */
export type EphemerisScope = 'present' | 'all'

let indexPromise: Promise<EphemerisIndex> | null = null
const bufferPromises = new Map<string, Promise<ArrayBuffer>>()
const tablePromises = new Map<string, Promise<{ table: EphemerisTable; index: EphemerisIndex }>>()

/** Each file is fetched once, whichever table asks for it first; a failed fetch is tried again next time. */
function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key)
  if (!p) {
    p = load()
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

function loadIndex(): Promise<EphemerisIndex> {
  indexPromise ??= fetchOk(`${DATA_BASE}ephemeris.json`).then((r) => r.json() as Promise<EphemerisIndex>)
  indexPromise.catch(() => {
    indexPromise = null
  })
  return indexPromise
}

/**
 * The Sun and Earth table. `index` always lists every segment (the date picker names the full coverage); `table`
 * holds the segments of the scope, so `table.covers()` is false for an Apollo date in a 'present' table.
 */
export function loadEphemeris(scope: EphemerisScope = 'all'): Promise<{ table: EphemerisTable; index: EphemerisIndex }> {
  return cached(tablePromises, scope, async () => {
    const full = await loadIndex()
    const end = (s: EphemerisIndex['segments'][number]) => s.startUnixMs + (s.count - 1) * s.stepSeconds * 1000
    const segments = scope === 'all' ? full.segments : full.segments.filter((s) => end(s) >= PRESENT_TABLES_MS)
    const buffers = await Promise.all(segments.map((s) => cached(bufferPromises, s.file, async () => (await fetchOk(DATA_BASE + s.file)).arrayBuffer())))
    return { table: new EphemerisTable(parseSegments({ ...full, segments }, buffers)), index: full }
  })
}

export class HorizonMasks {
  readonly doc: SitesDoc
  private readonly raw: Int16Array

  constructor(doc: SitesDoc, raw: Int16Array) {
    this.doc = doc
    this.raw = raw
  }

  nearestMast(mastM: number): number {
    return this.doc.mastsM.reduce((best, m) => (Math.abs(m - mastM) < Math.abs(best - mastM) ? m : best))
  }

  site(id: string): StaticSite | undefined {
    return this.doc.sites.find((s) => s.id === id)
  }

  /** Same rule as the API (db/horizons.py): terrain mask for the nearest mast, or the smooth-sphere dip. */
  forSite(site: StaticSite, mastM: number): { horizon: Horizon; mastUsedM: number } {
    const n = this.doc.azimuthCount
    if (!site.terrain.available || site.terrain.horizonOffset === undefined) {
      return { horizon: flatHorizon(sphericalHorizonDeg(mastM), n), mastUsedM: mastM }
    }
    const mast = this.nearestMast(mastM)
    const mi = this.doc.mastsM.indexOf(mast)
    const start = (site.terrain.horizonOffset * this.doc.mastsM.length + mi) * n
    const values = Array.from(this.raw.subarray(start, start + n), (v) => v / 100)
    return { horizon: new Horizon(values, 'terrain'), mastUsedM: mast }
  }

  /** Manual coordinates: no terrain mask exists, smooth-sphere horizon (as api services.model_for_point). */
  forPoint(mastM: number, groundM = 0): Horizon {
    return flatHorizon(sphericalHorizonDeg(mastM, groundM), this.doc.azimuthCount)
  }
}

let masksPromise: Promise<HorizonMasks> | null = null

export function loadHorizonMasks(): Promise<HorizonMasks> {
  masksPromise ??= (async () => {
    const [doc, buf] = await Promise.all([
      fetchOk(`${DATA_BASE}sites.json`).then((r) => r.json() as Promise<SitesDoc>),
      fetchOk(`${DATA_BASE}horizons.i16`).then((r) => r.arrayBuffer()),
    ])
    return new HorizonMasks(doc, new Int16Array(buf))
  })()
  masksPromise.catch(() => {
    masksPromise = null
  })
  return masksPromise
}
