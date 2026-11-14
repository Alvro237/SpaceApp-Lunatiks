/**
 * GPU side of the globe's detail tiles: one texture array (256 × 256 × CAPACITY layers) per kind and, for each
 * layer, the tile's box as a vec4 uniform (west longitude, south latitude, side in degrees, level; level −1 = empty).
 * The fragment shader uses the finest layer that holds the point and is not finer than the view's level.
 *
 * When every layer is taken, a new tile replaces the one wanted least recently; tiles the view still wants are
 * never replaced.
 */
import * as THREE from 'three'
import { type DetailKind, type DetailTile, TILE_CELLS, keyOf, tileBox } from './grid'

/**
 * Layers per kind: up to 48 view tiles, the coarse tiles asked for first (about a dozen at most), the siblings that
 * come with DEM quads, and the 32 photo-base tiles (128 × 256 KB = 34 MB of float heights).
 */
export const CAPACITY = 128

export class DetailSlots {
  readonly texture: THREE.DataArrayTexture
  /** Uniform value: one box per layer. */
  readonly boxes: THREE.Vector4[]
  private readonly keys: (string | null)[] = new Array(CAPACITY).fill(null)
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
    this.boxes = Array.from({ length: CAPACITY }, () => new THREE.Vector4(0, 0, 0, -1))
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
    }
    const layer = TILE_CELLS * TILE_CELLS
    ;(this.texture.image.data as Float32Array | Uint8Array).set(data, slot * layer)
    this.texture.addLayerUpdate(slot)
    this.texture.needsUpdate = true
    const b = tileBox(t)
    this.boxes[slot].set(b.lon0, b.lat0, b.size, t.z)
    this.keys[slot] = key
    this.byKey.set(key, slot)
    this.lastWanted[slot] = this.clock
    return true
  }

  dispose(): void {
    this.texture.dispose()
  }
}
