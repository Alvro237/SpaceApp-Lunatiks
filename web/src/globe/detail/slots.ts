/**
 * GPU side of the globe's detail tiles: one texture array (256 × 256 × CAPACITY layers) per kind and an index
 * texture that says, for every tile of every level, which layer holds it. The fragment shader walks down from the
 * view's level and takes the first level whose tile under the point is loaded: one texel read per level (at most
 * MAX_LEVEL + 1), where a list of the layers' boxes cost a loop over all CAPACITY layers for every pixel.
 *
 * Index layout (INDEX_WIDTH × INDEX_HEIGHT bytes, R8): level z takes rows indexRow(z, 0) .. indexRow(z, rows(z) − 1),
 * column x of row y holds the layer + 1 of tile (z, x, y), 0 when it is not loaded.
 *
 * When every layer is taken, a new tile replaces the one wanted least recently; tiles the view still wants are
 * never replaced.
 */
import * as THREE from 'three'
import { type DetailKind, type DetailTile, MAX_LEVEL, TILE_CELLS, columns, keyOf, rows, tileSize } from './grid'

/**
 * Layers per kind: up to 48 view tiles, the coarse tiles asked for first (about a dozen at most), the siblings that
 * come with DEM quads, and the 32 photo-base tiles (128 × 256 KB = 34 MB of float heights).
 */
export const CAPACITY = 128

/** Index texture: as wide as the finest level has columns, and the rows of every level stacked. */
export const INDEX_WIDTH = columns(MAX_LEVEL)
export const INDEX_HEIGHT = 2 * (2 ** (MAX_LEVEL + 1) - 1)
/** Row of the index texture for row y of level z (levels 0, 1, 2 … stacked from the top: 2, 4, 8 … rows). */
export const indexRow = (z: number, y: number): number => 2 * (2 ** z - 1) + y

/**
 * What the shader does (globe/shaders.ts, findTile), for tests: the layer holding the finest loaded tile of level
 * at most maxLevel under the point, or −1.
 */
export function findSlot(index: Uint8Array, maxLevel: number, lat: number, lon: number): number {
  for (let z = Math.min(maxLevel, MAX_LEVEL); z >= 0; z--) {
    const s = tileSize(z)
    const x = Math.max(0, Math.min(columns(z) - 1, Math.floor((lon + 180) / s)))
    const y = Math.max(0, Math.min(rows(z) - 1, Math.floor((90 - lat) / s)))
    const v = index[indexRow(z, y) * INDEX_WIDTH + x]
    if (v > 0) return v - 1
  }
  return -1
}

export class DetailSlots {
  readonly texture: THREE.DataArrayTexture
  /** Layer + 1 of every loaded tile (layout above). */
  readonly index: THREE.DataTexture
  private readonly keys: (string | null)[] = new Array(CAPACITY).fill(null)
  private readonly tiles: (DetailTile | null)[] = new Array(CAPACITY).fill(null)
  private readonly lastWanted = new Float64Array(CAPACITY)
  private readonly byKey = new Map<string, number>()
  private wanted = new Set<string>()
  private clock = 0
  readonly kind: DetailKind

  constructor(kind: DetailKind) {
    this.kind = kind
    const n = TILE_CELLS * TILE_CELLS * CAPACITY
    this.texture =
      kind === 'dem'
        ? new THREE.DataArrayTexture(new Float32Array(n), TILE_CELLS, TILE_CELLS, CAPACITY)
        : new THREE.DataArrayTexture(new Uint8Array(n), TILE_CELLS, TILE_CELLS, CAPACITY)
    this.texture.format = THREE.RedFormat
    this.texture.type = kind === 'dem' ? THREE.FloatType : THREE.UnsignedByteType
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter
    this.texture.unpackAlignment = 1
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
    this.index = new THREE.DataTexture(new Uint8Array(INDEX_WIDTH * INDEX_HEIGHT), INDEX_WIDTH, INDEX_HEIGHT, THREE.RedFormat, THREE.UnsignedByteType)
    this.index.minFilter = this.index.magFilter = THREE.NearestFilter
    this.index.unpackAlignment = 1
    this.index.generateMipmaps = false
    this.index.needsUpdate = true
  }

  private setIndex(t: DetailTile, value: number): void {
    ;(this.index.image.data as Uint8Array)[indexRow(t.z, t.y) * INDEX_WIDTH + t.x] = value
    this.index.needsUpdate = true
  }

  has(t: DetailTile): boolean {
    return this.byKey.has(keyOf(this.kind, t))
  }

  get count(): number {
    return this.byKey.size
  }

  /** The tiles the view wants now (protected from replacement). */
  setWanted(tiles: DetailTile[]): void {
    this.clock++
    this.wanted = new Set(tiles.map((t) => keyOf(this.kind, t)))
    for (const k of this.wanted) {
      const i = this.byKey.get(k)
      if (i !== undefined) this.lastWanted[i] = this.clock
    }
  }

  /** Store a decoded tile; false when every layer holds a tile the view still wants. */
  put(t: DetailTile, data: Float32Array | Uint8Array): boolean {
    const key = keyOf(this.kind, t)
    if (this.byKey.has(key)) return true
    let slot = this.keys.indexOf(null)
    if (slot < 0) {
      let oldest = Infinity
      for (let i = 0; i < CAPACITY; i++) {
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
    const layer = TILE_CELLS * TILE_CELLS
    ;(this.texture.image.data as Float32Array | Uint8Array).set(data, slot * layer)
    this.texture.addLayerUpdate(slot)
    this.texture.needsUpdate = true
    this.setIndex(t, slot + 1)
    this.tiles[slot] = t
    this.keys[slot] = key
    this.byKey.set(key, slot)
    this.lastWanted[slot] = this.clock
    return true
  }

  dispose(): void {
    this.texture.dispose()
    this.index.dispose()
  }
}
