/**
 * The globe's detail tiles, end to end: which tiles the view wants (grid.ts), the requests to Moon Trek through the
 * decode workers (trekGeo.ts), and the texture layers and uniforms the fragment shader reads (slots.ts).
 *
 * Loading order, so that zooming in sharpens the view quickly:
 * - tiles are chosen for where the camera is going (the orbit's goal), not for the frames of the flight there, so
 *   no request is spent on levels the camera only passes through;
 * - the few coarse tiles (COARSE_STEP levels up) come first, then the view's level from the centre outward, then
 *   (photo) the 32 base tiles;
 * - a tile that failed is asked for again after RETRY_BASE_S, doubling, up to MAX_RETRIES times.
 */
import type * as THREE from 'three'
import { TileLoader } from '../../terrain/loader'
import { type DetailKind, MIN_HEIGHT_LEVEL, PHOTO_BASE_LEVEL, type View, allTiles, demSource, extraRows, keyOf, tileBox, trekTileUrl, wantedTiles } from './grid'
import { DetailSlots } from './slots'

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
      uBox: { value: this.slots.dem.boxes },
      uMaxLevel: { value: -1 },
      uPhotoMode: { value: 0 },
    }
  }

  /** Relief (LOLA heights) or photo (LROC WAC); the wanted tiles are worked out again at the next update. */
  setKind(material: THREE.ShaderMaterial, kind: DetailKind): void {
    this.kind = kind
    const u = material.uniforms
    u.uDetail.value = this.slots[kind].texture
    u.uBox.value = this.slots[kind].boxes
    u.uPhotoMode.value = kind === 'photo' ? 1 : 0
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
    const kind = this.kind
    const slots = this.slots[kind]
    const drawn = wantedTiles(now, MIN_HEIGHT_LEVEL)
    const w = wantedTiles(goal, MIN_HEIGHT_LEVEL)
    const level = Math.max(drawn.level, w.level)
    material.uniforms.uMaxLevel.value = kind === 'photo' ? Math.max(level, PHOTO_BASE_LEVEL) : level
    const tiles = [...w.coarse, ...w.tiles, ...(kind === 'photo' ? allTiles(PHOTO_BASE_LEVEL) : [])]
    slots.setWanted(tiles)
    const rank = new Map(tiles.map((t, i) => [keyOf(kind, t), i]))
    this.loader.prioritise((k) => rank.get(k) ?? null)
    for (const t of tiles) {
      const key = keyOf(kind, t)
      if (slots.has(t)) continue
      const f = this.failures.get(key)
      if (f) {
        if (f.count > MAX_RETRIES || this.clockS < f.retryAt) continue
        this.loader.forget(key)
      }
      if (this.loader.known(key)) continue
      this.loader
        .request(key, { url: trekTileUrl(kind, t), kind: 'globe', globe: { kind, box: tileBox(t), extraRows: extraRows(kind, t), scale: kind === 'dem' ? demSource(t).scale : 1 } })
        .then((r) => {
          this.failures.delete(key)
          slots.put(t, kind === 'dem' ? r.heights! : r.bytes!)
        })
        .catch((e: Error) => {
          if (e.message === 'cancelled') return // no longer in view; asked for again if it comes back
          const count = (this.failures.get(key)?.count ?? 0) + 1
          this.failures.set(key, { count, retryAt: this.clockS + RETRY_BASE_S * 2 ** (count - 1) })
        })
    }
  }

  /** Tiles loaded and requests in flight, for the status line. */
  get status(): { loaded: number; loading: number } {
    return { loaded: this.slots[this.kind].count, loading: this.loader.inFlight }
  }

  dispose(): void {
    this.loader.dispose()
    this.slots.dem.dispose()
    this.slots.photo.dispose()
  }
}
