/**
 * The globe's south-polar detail: the polar map's own tiles, drawn on the globe. Latitude/longitude tiles
 * (grid.ts) squeeze toward a pole until a view of the pole needs hundreds of them, so south of 60° S the globe reads
 * the tiles the polar map reads, in the map's south polar stereographic quadtree (terrain/tileset.ts), which has no
 * trouble at the pole:
 *   - heights: the shipped tiles (z0-z3, 7.7 km to 960 m cells, from LOLA) and Moon Trek's LOLA south-pole DEMs cut
 *     per tile (z4-z6 from the 100 m DEM, z7-z8 from the 30 m DEM to 75° S: 120 m to 30 m cells), exactly as the map
 *     asks for them (terrain/live/config.ts, LIVE_LEVELS; the PGDA levels and the 5 m DEM are left to the map);
 *   - photo: the LROC WAC south polar mosaic, 100 m, also stereographic (terrain/live/photo.ts), down to z7.
 * Tiles are chosen like the map's level of detail: from the root, a tile splits while its cells would span more
 * than SPLIT_PX pixels at its distance from the camera, within a budget, culled to the view. Coarse tiles come
 * first, so the view sharpens from the shipped tiles down. The fragment and patch shaders (shaders.ts,
 * POLAR_LOOKUP) take the finest loaded tile under a point, as for the other detail tiles (slots.ts).
 */
import * as THREE from 'three'
import type { DecodeRequest } from '../../terrain/decode.worker'
import { LIVE_LEVELS, type LiveSource, cachedLiveLevels, trekTileUrl } from '../../terrain/live/config'
import { PHOTO_CELLS, photoTileUrl } from '../../terrain/live/photo'
import { TileLoader } from '../../terrain/loader'
import { type TileKey, type Tileset, children, keyOf, parent, polarLatLon, polarXY, scaleFactor, tileBounds, tileUrl } from '../../terrain/tileset'
import { lutBytes } from '../../terrain/colormaps'
import { MOON_R_KM, latLonToScene, sceneToLatLon } from '../orbit'

/** Finest height level: 30 m cells, Moon Trek's 30 m DEM (to 75° S; elsewhere the 100 m DEM's 120 m at z6). */
export const POLAR_MAX_Z = 8
/** Finest photo level: 60 m cells for the 100 m mosaic (photoMaxZ). */
export const POLAR_PHOTO_MAX_Z = 7
/** Height tiles are 257 × 257 vertices (the map's tileSamples). */
export const POLAR_SAMPLES = 257
/**
 * Layers per kind: the view's tiles and their ancestors, and some kept from before (176 height tiles of 257 × 257
 * float32 are 46 MB).
 */
export const POLAR_CAPACITY = 176
/** Colour layer tiles kept: the shipped levels z0-z3 are 1 + 4 + 16 + 64 tiles. */
export const LAYER_CAPACITY = 96
/** Index texture: the finest level's columns, every level's rows stacked (1 + 2 + … + 256 = 511). */
export const POLAR_INDEX_W = 2 ** POLAR_MAX_Z
export const POLAR_INDEX_H = 2 ** (POLAR_MAX_Z + 1) - 1
export const polarIndexRow = (z: number, y: number): number => 2 ** z - 1 + y
/** A tile splits while its cells would be wider than this many pixels. */
export const SPLIT_PX = 1
/**
 * Tiles drawn at most (the leaves of the selection). Close over the pole the four quadrants meet under the camera at
 * every level, so the finest level needs four chains of tiles there: about 4 × 3 a level.
 */
export const MAX_TILES = 120
/** Relief allowance of a tile's bounding sphere for culling, km (LOLA spans about −9 to +11 km, exaggerated). */
const RELIEF_KM = 25
const INTERVAL_S = 0.15
const RETRY_BASE_S = 8
const MAX_RETRIES = 3
/**
 * The overview heights (about 8 MB) only feed the shadows the polar terrain casts, so they wait until the first
 * view has had the network: this many seconds of drawn frames, or sooner once the camera comes within this distance
 * of the south pole.
 */
export const OVERVIEW_DELAY_S = 6
export const OVERVIEW_NEAR_KM = MOON_R_KM
const SOUTH_POLE = latLonToScene(-90, 0, MOON_R_KM)

/** Whether the overview heights are due: after OVERVIEW_DELAY_S of frames, or with the camera near the south pole. */
export function overviewDue(clockS: number, cam: Pick<PolarCamera, 'position'>): boolean {
  if (clockS >= OVERVIEW_DELAY_S) return true
  const [x, y, z] = cam.position
  return Math.hypot(x - SOUTH_POLE[0], y - SOUTH_POLE[1], z - SOUTH_POLE[2]) <= OVERVIEW_NEAR_KM
}

/** The live levels the globe uses: Moon Trek's DEMs only (no proxy), to POLAR_MAX_Z. */
const GLOBE_LIVE = {
  proxyBase: null,
  levels: LIVE_LEVELS.filter((l) => l.z <= POLAR_MAX_Z).map((l) => ({ z: l.z, sources: l.sources.filter((s) => s.kind === 'trek') })),
}

/** What the selection needs to know about the camera. */
export interface PolarCamera {
  /** Camera position, scene km (orbit.ts axes). */
  position: [number, number, number]
  /** Radians a pixel spans at the centre of the view. */
  pixelRad: number
  /** Whether a sphere (scene km) is in the view. */
  visible: (centre: [number, number, number], radiusKm: number) => boolean
}

/** Centre of a tile on the sphere (scene km), its latitude, and a radius that holds the tile on the ground (km). */
function tileSphere(ts: Pick<Tileset, 'extentM'>, t: TileKey): { centre: [number, number, number]; lat: number; radiusKm: number } {
  const [x0, y0, x1, y1] = tileBounds(ts, t)
  const [lat, lon] = polarLatLon((x0 + x1) / 2, (y0 + y1) / 2)
  // map metres are ground metres × the scale factor (>= 1), so the map's half diagonal bounds the ground's
  return { centre: latLonToScene(lat, lon, MOON_R_KM), lat, radiusKm: ((x1 - x0) * Math.SQRT1_2) / 1000 }
}

/**
 * The tiles to draw and their ancestors, coarse to fine and nearest first. From the root, the drawn tile whose cells
 * are widest in pixels (ground cell over its nearest distance from the camera) splits next, while that exceeds
 * SPLIT_PX, it has children and the drawn tiles stay within `budget`: the ground under the camera reaches the finest
 * level before the far ground uses the budget. Children wholly outside the disc (no data there) or out of view are
 * left out. Pure, for the tests.
 */
export function polarWanted(
  ts: Pick<Tileset, 'extentM' | 'discRadiusM' | 'tileCells'>,
  exists: (t: TileKey) => boolean,
  cam: PolarCamera,
  maxZ = POLAR_MAX_Z,
  budget = MAX_TILES,
): TileKey[] {
  const disc = ts.discRadiusM ?? Infinity
  interface Node {
    t: TileKey
    near: number
    /** Ground cell over the pixel's footprint at the tile's nearest point (> SPLIT_PX: wants splitting). */
    px: number
  }
  // the ground point under the camera, in map metres: a tile's nearest point is that point clamped into its square
  const [camLat, camLon] = sceneToLatLon(cam.position)
  const [cx, cy] = polarXY(camLat, camLon)
  const node = (t: TileKey): Node => {
    const [x0, y0, x1, y1] = tileBounds(ts, t)
    const [lat, lon] = polarLatLon(Math.max(x0, Math.min(x1, cx)), Math.max(y0, Math.min(y1, cy)))
    const p = latLonToScene(lat, lon, MOON_R_KM)
    const near = Math.max(0.05, Math.hypot(cam.position[0] - p[0], cam.position[1] - p[1], cam.position[2] - p[2]))
    const cellKm = (x1 - x0) / ts.tileCells / 1000 / scaleFactor(lat)
    return { t, near, px: cellKm / (near * cam.pixelRad) }
  }
  const inner: Node[] = []
  let leaves: Node[] = [node({ z: 0, x: 0, y: 0 })]
  const done = new Set<string>()
  for (;;) {
    let best: Node | null = null
    for (const l of leaves) if (l.t.z < maxZ && l.px > SPLIT_PX && !done.has(keyOf(l.t)) && (!best || l.px > best.px)) best = l
    if (!best) break
    done.add(keyOf(best.t))
    const kids = children(best.t).filter((c) => {
      if (!exists(c)) return false
      const [x0, y0, x1, y1] = tileBounds(ts, c)
      // nearest point of the tile's square to the pole, against the disc
      if (Math.hypot(Math.max(x0, Math.min(0, x1)), Math.max(y0, Math.min(0, y1))) > disc) return false
      const cs = tileSphere(ts, c)
      return cam.visible(cs.centre, cs.radiusKm + RELIEF_KM)
    })
    if (kids.length === 0 || leaves.length - 1 + kids.length > budget) continue
    inner.push(best)
    leaves = leaves.filter((l) => l !== best).concat(kids.map(node))
  }
  return [...inner, ...leaves].sort((a, b) => a.t.z - b.t.z || a.near - b.near).map((n) => n.t)
}

/** GPU side of one kind of polar tile: a texture array and its index (layer + 1 of each loaded tile, 0 = none). */
class PolarSlots {
  readonly texture: THREE.DataArrayTexture
  readonly index: THREE.DataTexture
  private readonly cells: number
  private readonly channels: number
  private readonly capacity: number
  private readonly keys: (string | null)[]
  private readonly tiles: (TileKey | null)[]
  private readonly lastWanted: Float64Array
  private readonly byKey = new Map<string, number>()
  private wanted = new Set<string>()
  private clock = 0

  constructor(cells: number, float: boolean, channels = 1, capacity = POLAR_CAPACITY) {
    this.cells = cells
    this.channels = channels
    this.capacity = capacity
    this.keys = new Array(capacity).fill(null)
    this.tiles = new Array(capacity).fill(null)
    this.lastWanted = new Float64Array(capacity)
    const n = cells * cells * channels * capacity
    this.texture = new THREE.DataArrayTexture(float ? new Float32Array(n) : new Uint8Array(n), cells, cells, capacity)
    this.texture.format = channels === 2 ? THREE.RGFormat : THREE.RedFormat
    this.texture.type = float ? THREE.FloatType : THREE.UnsignedByteType
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter
    this.texture.unpackAlignment = 1
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
    this.index = new THREE.DataTexture(new Uint8Array(POLAR_INDEX_W * POLAR_INDEX_H), POLAR_INDEX_W, POLAR_INDEX_H, THREE.RedFormat, THREE.UnsignedByteType)
    this.index.minFilter = this.index.magFilter = THREE.NearestFilter
    this.index.unpackAlignment = 1
    this.index.generateMipmaps = false
    this.index.needsUpdate = true
  }

  has(t: TileKey): boolean {
    return this.byKey.has(keyOf(t))
  }

  setWanted(tiles: TileKey[]): void {
    this.clock++
    this.wanted = new Set(tiles.map(keyOf))
    for (const k of this.wanted) {
      const i = this.byKey.get(k)
      if (i !== undefined) this.lastWanted[i] = this.clock
    }
  }

  /** Store a decoded tile, replacing the one wanted least recently; false when every layer is still wanted. */
  put(t: TileKey, data: Float32Array | Uint8Array): boolean {
    const key = keyOf(t)
    if (this.byKey.has(key)) return true
    if (data.length !== this.cells * this.cells * this.channels) return false
    let slot = this.keys.indexOf(null)
    if (slot < 0) {
      let oldest = Infinity
      for (let i = 0; i < this.capacity; i++) {
        if (this.wanted.has(this.keys[i]!)) continue
        if (this.lastWanted[i] < oldest) {
          oldest = this.lastWanted[i]
          slot = i
        }
      }
      if (slot < 0) return false
      this.byKey.delete(this.keys[slot]!)
      this.setIndex(this.tiles[slot]!, 0)
    }
    ;(this.texture.image.data as Float32Array | Uint8Array).set(data, slot * this.cells * this.cells * this.channels)
    this.texture.addLayerUpdate(slot)
    this.texture.needsUpdate = true
    this.setIndex(t, slot + 1)
    this.tiles[slot] = t
    this.keys[slot] = key
    this.byKey.set(key, slot)
    this.lastWanted[slot] = this.clock
    return true
  }

  /** Forget every tile (another layer is shown): the index goes back to "none". */
  clear(): void {
    this.keys.fill(null)
    this.tiles.fill(null)
    this.byKey.clear()
    this.wanted = new Set()
    ;(this.index.image.data as Uint8Array).fill(0)
    this.index.needsUpdate = true
  }

  private setIndex(t: TileKey, v: number): void {
    ;(this.index.image.data as Uint8Array)[polarIndexRow(t.z, t.y) * POLAR_INDEX_W + t.x] = v
    this.index.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
    this.index.dispose()
  }
}

interface Job {
  key: string
  tile: TileKey
  kind: 'h' | 'p' | 'd'
  req: Omit<DecodeRequest, 'id'>
}

export class PolarDetail {
  private readonly heights = new PolarSlots(POLAR_SAMPLES, true)
  private readonly photos = new PolarSlots(PHOTO_CELLS, false)
  /** The colour layer's tiles (value, coverage) of the polar map: 256 x 256 cells, shipped levels only. */
  private readonly layerTiles = new PolarSlots(256, false, 2, LAYER_CAPACITY)
  private readonly lut = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  private layerId: string | null = null
  /** What the layers menu asked for (a tile layer, 'elevation' or null), to notice a change. */
  private shown: string | null = null
  private layerMaxZ = -1
  private readonly loader = new TileLoader(2)
  /** The overview heights for the shadows; a 1 × 1 placeholder until they load. */
  private overview: THREE.DataTexture = new THREE.DataTexture(new Float32Array(1), 1, 1, THREE.RedFormat, THREE.FloatType)
  private ts: Tileset | null = null
  /** True once the overview heights are loaded, so the terrain can cast its shadows (uPolarShadow). */
  shadowReady = false
  /** Starts the overview download once it is due (overviewDue); null when started or before the tileset. */
  private startOverview: (() => void) | null = null
  private live = new Map<string, LiveSource>()
  private base = ''
  private photo = true
  private since = Infinity
  private clockS = 0
  private readonly failures = new Map<string, { count: number; retryAt: number }>()

  /** The uniforms the shaders need (shaders.ts, POLAR_LOOKUP). */
  uniforms(): Record<string, THREE.IUniform> {
    return {
      uPolarH: { value: this.heights.texture },
      uPolarHIndex: { value: this.heights.index },
      uPolarP: { value: this.photos.texture },
      uPolarPIndex: { value: this.photos.index },
      uPolarD: { value: this.layerTiles.texture },
      uPolarDIndex: { value: this.layerTiles.index },
      uLut: { value: this.lut },
      // 1 while a colour layer (slope, illumination, ...) is drawn over the polar cap
      uDataMode: { value: 0 },
      // the layers drawn over the whole Moon from the heights themselves: 0 none, 1 slope, 2 elevation
      uGlobalKind: { value: 0 },
      // value range of that colour scale: degrees of slope, metres of height
      uGlobalRange: { value: new THREE.Vector2(0, 1) },
      // -1 until the tileset is known
      uPolarMaxZ: { value: -1 },
      uPolarExtent: { value: 983_040 },
      uPolarOverview: { value: this.overview },
      // 1 once the overview heights (the shadows' terrain) are loaded
      uPolarShadow: { value: 0 },
    }
  }

  /** The polar map's tileset (tiles/tileset.json) and the base URL of its files; detail starts once it is known. */
  setTileset(ts: Tileset, base: string, material: THREE.ShaderMaterial, floatLinear: boolean): void {
    if (this.ts) return
    this.startOverview = () => this.loadOverview(ts, base, material, floatLinear)
    const live = cachedLiveLevels(ts, GLOBE_LIVE)
    this.ts = live.tileset
    this.live = live.live
    this.base = base
    material.uniforms.uPolarExtent.value = ts.extentM[2]
    material.uniforms.uPolarMaxZ.value = Math.min(POLAR_MAX_Z, live.tileset.levels.length - 1)
    this.since = Infinity
  }

  /**
   * The polar map's overview: the heights of the whole disc as one 2049 × 2049 image (960 m cells, about 6 MB; the
   * map's shadow pass reads it too, so it is usually in the browser's cache already). The fragment shader marches
   * toward the Sun over it for the shadows the terrain casts (shaders.ts, polarSunVisible).
   */
  private loadOverview(ts: Tileset, base: string, material: THREE.ShaderMaterial, floatLinear: boolean): void {
    const ov = ts.overview
    this.loader
      .request('overview', { url: base + ov.path, kind: 'height', min: ov.min, max: ov.max })
      .then((r) => {
        const tex = new THREE.DataTexture(r.heights!, r.width, r.height, THREE.RedFormat, THREE.FloatType)
        tex.minFilter = tex.magFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter
        tex.generateMipmaps = false
        tex.needsUpdate = true
        this.overview.dispose()
        this.overview = tex
        material.uniforms.uPolarOverview.value = tex
        material.uniforms.uPolarShadow.value = 1
        this.shadowReady = true
      })
      .catch(() => {}) // no overview: no cast shadows, the slopes are still shaded
  }

  /** Photo mode loads the polar photo tiles as well. */
  setPhoto(on: boolean): void {
    this.photo = on
    this.since = Infinity
  }

  /**
   * Show a colour layer of the polar map (tileset.layers) over the polar cap, or none (null). The tiles are the
   * map's own (value in 8 bits, coverage), at the levels the tileset ships; the colour scale is a 256 x 1 lookup.
   */
  setLayer(id: string | null, material: THREE.ShaderMaterial, elevation: readonly [number, number]): void {
    const ts = this.ts
    const meta = id && ts ? ts.layers[id] : undefined
    const next = meta ? id : id === 'elevation' && ts ? id : null
    if (next === this.shown) return
    this.shown = next
    this.layerId = meta ? id : null
    this.layerTiles.clear()
    const u = material.uniforms
    u.uDataMode.value = meta ? 1 : 0
    // slope and elevation are also drawn outside the polar tiles, from the heights loaded (the shader derives them)
    u.uGlobalKind.value = next === 'slope' ? 1 : next === 'elevation' ? 2 : 0
    const scale = meta ? { cmap: meta.colormap, min: meta.min, max: meta.max } : next ? { cmap: 'cividis' as const, min: elevation[0], max: elevation[1] } : null
    if (scale) {
      this.layerMaxZ = meta ? Math.min(meta.levels - 1, POLAR_MAX_Z) : -1
      ;(this.lut.image.data as Uint8Array).set(lutBytes(scale.cmap))
      this.lut.needsUpdate = true
      ;(u.uGlobalRange.value as THREE.Vector2).set(scale.min, scale.max)
    }
    this.since = Infinity
  }

  private exists = (t: TileKey): boolean => !!this.ts && keyOf(t) in this.ts.height.tiles

  /** Called every frame; works out the wanted tiles every INTERVAL_S and asks for the missing ones. */
  update(dt: number, cam: PolarCamera): void {
    this.clockS += dt
    this.since += dt
    if (this.startOverview && overviewDue(this.clockS, cam)) {
      this.startOverview()
      this.startOverview = null
    }
    const ts = this.ts
    if (!ts || this.since < INTERVAL_S) return
    this.since = 0
    const wanted = polarWanted(ts, this.exists, cam)
    this.heights.setWanted(wanted)
    const jobs: Job[] = []
    for (const t of wanted) if (!this.heights.has(t)) jobs.push(this.heightJob(ts, t))
    if (this.photo) {
      const seen = new Set<string>()
      const photoTiles: TileKey[] = []
      for (let t of wanted) {
        while (t.z > POLAR_PHOTO_MAX_Z) t = parent(t)!
        const k = keyOf(t)
        if (!seen.has(k)) {
          seen.add(k)
          photoTiles.push(t)
        }
      }
      this.photos.setWanted(photoTiles)
      for (const t of photoTiles) if (!this.photos.has(t)) jobs.push(this.photoJob(ts, t))
      // coarse first across both kinds, so colour and relief sharpen together
      jobs.sort((a, b) => a.tile.z - b.tile.z)
    }
    if (this.layerId) {
      const seen = new Set<string>()
      const layerWanted: TileKey[] = []
      for (let t of wanted) {
        while (t.z > this.layerMaxZ) t = parent(t)!
        const k = keyOf(t)
        if (!seen.has(k)) {
          seen.add(k)
          layerWanted.push(t)
        }
      }
      this.layerTiles.setWanted(layerWanted)
      for (const t of layerWanted) if (!this.layerTiles.has(t)) jobs.push(this.layerJob(t))
      jobs.sort((a, b) => a.tile.z - b.tile.z)
    }
    const rank = new Map(jobs.map((j, i) => [j.key, i]))
    // the overview is not a wanted tile: keep it (first) rather than cancel it as unwanted
    this.loader.prioritise((k) => (k === 'overview' ? -1 : (rank.get(k) ?? null)))
    for (const job of jobs) {
      const f = this.failures.get(job.key)
      if (f) {
        if (f.count > MAX_RETRIES || this.clockS < f.retryAt) continue
        this.loader.forget(job.key)
      }
      if (this.loader.known(job.key)) continue
      this.loader
        .request(job.key, job.req)
        .then((r) => {
          this.failures.delete(job.key)
          if (job.kind === 'h') this.heights.put(job.tile, r.heights!)
          else if (job.kind === 'p') this.photos.put(job.tile, r.bytes!)
          else if (job.key.startsWith(`d|${this.layerId}|`)) this.layerTiles.put(job.tile, r.bytes!)
        })
        .catch((e: Error) => {
          if (e.message === 'cancelled') return
          const count = (this.failures.get(job.key)?.count ?? 0) + 1
          this.failures.set(job.key, { count, retryAt: this.clockS + RETRY_BASE_S * 2 ** (count - 1) })
        })
    }
  }

  private heightJob(ts: Tileset, t: TileKey): Job {
    const k = keyOf(t)
    const source = this.live.get(k)
    if (!source) {
      const [min, max] = ts.height.tiles[k]
      return { key: `h|${k}`, tile: t, kind: 'h', req: { url: this.base + tileUrl(ts.height.path, t), kind: 'height', min, max } }
    }
    return {
      key: `h|${k}`,
      tile: t,
      kind: 'h',
      req: {
        url: trekTileUrl(source, ts, t),
        kind: 'live',
        live: {
          file: source.file,
          source: source.kind,
          geometry: {
            i0: t.x * ts.tileCells,
            j0: t.y * ts.tileCells,
            extentX0: ts.extentM[0],
            extentY1: ts.extentM[3],
            cellM: ts.levels[t.z].cellM,
            samples: ts.tileSamples,
          },
        },
      },
    }
  }

  private layerJob(t: TileKey): Job {
    const id = this.layerId!
    return { key: `d|${id}|${keyOf(t)}`, tile: t, kind: 'd', req: { url: `${this.base}layers/${id}/${t.z}/${t.x}/${t.y}.png`, kind: 'layer' } }
  }

  private photoJob(ts: Tileset, t: TileKey): Job {
    // a 256 × 256 grey JPEG decoded by the globe's photo path (the box is not used for photos)
    return {
      key: `p|${keyOf(t)}`,
      tile: t,
      kind: 'p',
      req: { url: photoTileUrl(ts, t), kind: 'globe', globe: { kind: 'photo', box: { lon0: 0, lat0: 0, size: 0 }, extraRows: 0 } },
    }
  }

  dispose(): void {
    this.loader.dispose()
    this.heights.dispose()
    this.photos.dispose()
    this.layerTiles.dispose()
    this.lut.dispose()
    this.overview.dispose()
  }
}
