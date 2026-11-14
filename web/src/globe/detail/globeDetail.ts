/**
 * The globe's detail tiles, end to end: which tiles the view wants (grid.ts), the requests to Moon Trek through the
 * decode workers (trekGeo.ts), and the texture layers and uniforms the fragment shader reads (slots.ts).
 */
import type * as THREE from 'three'
import { TileLoader } from '../../terrain/loader'
import { type DetailKind, MIN_HEIGHT_LEVEL, PHOTO_BASE_LEVEL, type View, allTiles, extraRows, keyOf, tileBox, trekTileUrl, wantedTiles } from './grid'
import { DetailSlots } from './slots'

/** How often the wanted tiles are worked out, seconds. */
const INTERVAL_S = 0.25

export class GlobeDetail {
  private readonly slots: Record<DetailKind, DetailSlots> = { dem: new DetailSlots('dem'), photo: new DetailSlots('photo') }
  private readonly loader = new TileLoader(2)
  private kind: DetailKind = 'dem'
  private since = Infinity

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

  /** Called every frame; a few times a second it asks for the tiles of the view, nearest to its centre first. */
  update(dt: number, view: View, material: THREE.ShaderMaterial): void {
    this.since += dt
    if (this.since < INTERVAL_S) return
    this.since = 0
    const kind = this.kind
    const slots = this.slots[kind]
    const w = wantedTiles(view, MIN_HEIGHT_LEVEL)
    const tiles = kind === 'photo' ? [...w.tiles, ...allTiles(PHOTO_BASE_LEVEL)] : w.tiles
    material.uniforms.uMaxLevel.value = kind === 'photo' ? Math.max(w.level, PHOTO_BASE_LEVEL) : w.level
    slots.setWanted(tiles)
    const rank = new Map(tiles.map((t, i) => [keyOf(kind, t), i]))
    this.loader.prioritise((k) => rank.get(k) ?? null)
    for (const t of tiles) {
      const key = keyOf(kind, t)
      if (slots.has(t) || this.loader.known(key)) continue
      this.loader
        .request(key, { url: trekTileUrl(kind, t), kind: 'globe', globe: { kind, box: tileBox(t), extraRows: extraRows(t) } })
        .then((r) => slots.put(t, kind === 'dem' ? r.heights! : r.bytes!))
        .catch(() => {}) // cancelled, or Moon Trek failed: the shipped globe stays there
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
