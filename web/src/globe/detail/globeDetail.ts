/**
 * The globe's detail tiles, end to end: which tiles the view wants (grid.ts), the requests to Moon Trek through the
 * decode workers (trekGeo.ts), and the texture layers and uniforms the fragment shader reads (slots.ts).
 *
 * Loading order, so that zooming in sharpens the view quickly:
 * - tiles are chosen for where the camera is going (the orbit's goal), not for the frames of the flight there, so
 *   no request is spent on levels the camera only passes through;
 * - the few coarse tiles (COARSE_STEP levels up) come first, then the view's level from the centre outward, then
 *   (photo) the 32 base tiles;
 * - the heights are always loaded (they shape and light the ground); photo mode loads the photo tiles as well, its
 *   requests taking turns with the height requests so that colour and relief sharpen together;
 * - DEM tiles from QUAD_MIN_LEVEL on come four per request (grid.ts, Quad);
 * - a tile that failed is asked for again after RETRY_BASE_S, doubling, up to MAX_RETRIES times.
 */
import type * as THREE from 'three'
import type { DecodeRequest } from '../../terrain/decode.worker'
import { TileLoader } from '../../terrain/loader'
import {
  type DetailKind,
  type DetailTile,
  MIN_HEIGHT_LEVEL,
  PHOTO_BASE_LEVEL,
  QUAD_MIN_LEVEL,
  TILE_CELLS,
  type View,
  allTiles,
  demSource,
  extraRows,
  keyOf,
  quadBox,
  quadExtraRows,
  quadKey,
  quadOf,
  quadTiles,
  quadUrl,
  tileBox,
  trekTileUrl,
  wantedTiles,
} from './grid'
import { DetailSlots } from './slots'
import { splitQuad } from './trekGeo'

/** One request: a single tile, or (DEM, level QUAD_MIN_LEVEL and finer) the four tiles of a quad. */
interface Job {
  key: string
  tiles: DetailTile[]
  req: Omit<DecodeRequest, 'id'>
}

/** How often the wanted tiles are worked out, seconds. */
const INTERVAL_S = 0.15
const RETRY_BASE_S = 10
const MAX_RETRIES = 3

export class GlobeDetail {
  private readonly slots: Record<DetailKind, DetailSlots> = { dem: new DetailSlots('dem'), photo: new DetailSlots('photo') }
  private readonly loader = new TileLoader(2)
  private kind: DetailKind = 'dem'
  private since = Infinity
  private clockS = 0
  /** Failed tiles: how many times, and when they may be asked for again (seconds on clockS). */
  private readonly failures = new Map<string, { count: number; retryAt: number }>()

  /** The uniforms the shader needs, to spread into the material's uniforms. */
  uniforms(): Record<string, THREE.IUniform> {
    return {
      uDetail: { value: this.slots.dem.texture },
      uIndex: { value: this.slots.dem.index },
      uPhoto: { value: this.slots.photo.texture },
      uPhotoIndex: { value: this.slots.photo.index },
      uMaxLevel: { value: -1 },
      uPhotoMode: { value: 0 },
    }
  }

  /**
   * Relief (LOLA heights alone) or photo (LROC WAC draped over the LOLA heights); the wanted tiles are worked out
   * again at the next update.
   */
  setKind(material: THREE.ShaderMaterial, kind: DetailKind): void {
    this.kind = kind
    material.uniforms.uPhotoMode.value = kind === 'photo' ? 1 : 0
    this.since = Infinity
  }

  /**
   * Called every frame. `goal` is where the camera is heading: it sets the tiles asked for. The shader may use the
   * finer of the two views' levels, so zooming in uses each finer tile as soon as it arrives and zooming out keeps
   * the fine tiles until the camera has left.
   */
  update(dt: number, now: View, goal: View, material: THREE.ShaderMaterial): void {
    this.clockS += dt
    this.since += dt
    if (this.since < INTERVAL_S) return
    this.since = 0
    const photo = this.kind === 'photo'
    const drawn = wantedTiles(now, MIN_HEIGHT_LEVEL)
    const w = wantedTiles(goal, MIN_HEIGHT_LEVEL)
    const level = Math.max(drawn.level, w.level)
    material.uniforms.uMaxLevel.value = photo ? Math.max(level, PHOTO_BASE_LEVEL) : level
    const demTiles = [...w.coarse, ...w.tiles]
    this.slots.dem.setWanted(demTiles)
    let jobs = this.jobsFor('dem', demTiles)
    if (photo) {
      const photoTiles = [...demTiles, ...allTiles(PHOTO_BASE_LEVEL)]
      this.slots.photo.setWanted(photoTiles)
      jobs = interleave(jobs, this.jobsFor('photo', photoTiles))
    }
    const rank = new Map(jobs.map((j, i) => [j.key, i]))
    this.loader.prioritise((k) => rank.get(k) ?? null)
    for (const job of jobs) {
      const f = this.failures.get(job.key)
      if (f) {
        if (f.count > MAX_RETRIES || this.clockS < f.retryAt) continue
        this.loader.forget(job.key)
      }
      if (this.loader.known(job.key)) continue
      const kind = job.req.globe!.kind
      const slots = this.slots[kind]
      this.loader
        .request(job.key, job.req)
        .then((r) => {
          this.failures.delete(job.key)
          if (kind === 'photo') slots.put(job.tiles[0], r.bytes!)
          else if (job.tiles.length === 1) slots.put(job.tiles[0], r.heights!)
          else splitQuad(r.heights!).forEach((h, i) => slots.put(job.tiles[i], h))
        })
        .catch((e: Error) => {
          if (e.message === 'cancelled') return // no longer in view; asked for again if it comes back
          const count = (this.failures.get(job.key)?.count ?? 0) + 1
          this.failures.set(job.key, { count, retryAt: this.clockS + RETRY_BASE_S * 2 ** (count - 1) })
        })
    }
  }

  /** The requests for the wanted tiles not loaded yet, in the tiles' order (a quad ranks with its first tile). */
  private jobsFor(kind: DetailKind, tiles: DetailTile[]): Job[] {
    const slots = this.slots[kind]
    const jobs: Job[] = []
    const seen = new Set<string>()
    for (const t of tiles) {
      if (slots.has(t)) continue
      if (kind === 'dem' && t.z >= QUAD_MIN_LEVEL) {
        const q = quadOf(t)
        const key = quadKey(q)
        if (seen.has(key)) continue
        seen.add(key)
        const parent = { z: q.z - 1, x: q.x, y: q.y }
        jobs.push({
          key,
          tiles: quadTiles(q),
          req: {
            url: quadUrl(q),
            kind: 'globe',
            globe: { kind, box: quadBox(q), extraRows: quadExtraRows(q), scale: demSource(parent).scale, cells: 2 * TILE_CELLS },
          },
        })
      } else {
        const key = keyOf(kind, t)
        if (seen.has(key)) continue
        seen.add(key)
        jobs.push({
          key,
          tiles: [t],
          req: {
            url: trekTileUrl(kind, t),
            kind: 'globe',
            globe: { kind, box: tileBox(t), extraRows: extraRows(kind, t), scale: kind === 'dem' ? demSource(t).scale : 1 },
          },
        })
      }
    }
    return jobs
  }

  /** Tiles loaded and requests in flight, for the status line. */
  get status(): { loaded: number; loading: number } {
    const loaded = this.slots.dem.count + (this.kind === 'photo' ? this.slots.photo.count : 0)
    return { loaded, loading: this.loader.inFlight }
  }

  dispose(): void {
    this.loader.dispose()
    this.slots.dem.dispose()
    this.slots.photo.dispose()
  }
}

/** a[0], b[0], a[1], b[1] …, then the rest of the longer list. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}
