/**
 * Terrain engine: tileset, quadtree LOD, decode worker, GPU tile cache, colour layers and the shadow pass.
 * Imperative Three.js, driven once per frame by TerrainView (React Three Fiber). Plan sections "Calidad según
 * el zoom", "Play: sombras que se mueven con el Sol" and "Capas y paneles".
 */
import * as THREE from 'three'
import { LruCache } from './cache'
import { type LiveConfig, type LiveSource, liveConfigFromEnv, trekTileUrl, withLiveLevels } from './live/config'
import { lutBytes, type ColormapId } from './colormaps'
import { TileLoader } from './loader'
import { type LodOptions, byDistanceTo, renderable, selectTiles } from './lod'
import { GRID_VERTICES, TERRAIN_FRAG, TERRAIN_VERT } from './shaders'
import { SHADOW_FRAG, SHADOW_VERT } from './shadow'
import { type TileKey, type Tileset, keyOf, parent, tileBounds, tileUrl } from './tileset'

export const GPU_TILE_CAPACITY = 300
/** Shadow texture: one texel per 960 m cell of the preview over the 60 S disc. */
const SHADOW_SIZE = 2048
/** During playback the shadow pass runs at most this often (the panels update at 10 Hz). */
const SHADOW_MIN_INTERVAL_MS = 60

export type LayerMode = { kind: 'none' } | { kind: 'elevation' } | { kind: 'data'; id: string; colormap: ColormapId; levels: number }

/** One 65 × 65 grid with a skirt ring, shared by every tile. `skirt` = 1 on the ring (lowered in the shader). */
export function gridGeometry(n = GRID_VERTICES): THREE.BufferGeometry {
  const uv: number[] = []
  const skirt: number[] = []
  const idx: number[] = []
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    uv.push(i / (n - 1), j / (n - 1))
    skirt.push(0)
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i
    idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
  }
  // perimeter, clockwise from the top-left corner
  const ring: number[] = []
  for (let i = 0; i < n - 1; i++) ring.push(i)
  for (let j = 0; j < n - 1; j++) ring.push(j * n + n - 1)
  for (let i = n - 1; i > 0; i--) ring.push((n - 1) * n + i)
  for (let j = n - 1; j > 0; j--) ring.push(j * n)
  const base = n * n
  ring.forEach((v, k) => {
    uv.push(uv[2 * v], uv[2 * v + 1])
    skirt.push(1)
    const a = v
    const b = ring[(k + 1) % ring.length]
    const a2 = base + k
    const b2 = base + ((k + 1) % ring.length)
    idx.push(a, a2, b, b, a2, b2)
  })
  const g = new THREE.BufferGeometry()
  const count = uv.length / 2
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('skirt', new THREE.Float32BufferAttribute(skirt, 1))
  g.setIndex(idx)
  return g
}

interface GpuTile {
  key: string
  heights: THREE.DataTexture
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
}

function lutTexture(id: ColormapId): THREE.DataTexture {
  const t = new THREE.DataTexture(lutBytes(id), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

export class TerrainEngine {
  readonly tileset: Tileset
  readonly group = new THREE.Group()
  readonly stats = {
    drawn: 0,
    cached: 0,
    inFlight: 0,
    shadowPasses: 0,
    wanted: [] as string[],
    drawnKeys: [] as string[],
    /** Live tiles (z8+, read from the remote DEMs): loaded and failed this session. */
    live: { loaded: 0, failed: 0 },
  }
  /** Live tiles: "z/x/y" → source DEM (empty when the live levels are off). */
  readonly live: Map<string, LiveSource>
  private readonly liveBase: string
  lod: LodOptions = { splitPx: 2, mergePx: 1.5 }

  private readonly base: string
  private readonly loader = new TileLoader()
  private readonly geometry = gridGeometry()
  private readonly tiles: LruCache<GpuTile>
  private readonly layerTextures: LruCache<THREE.DataTexture>
  private readonly luts = new Map<ColormapId, THREE.DataTexture>()
  private readonly empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  private previouslySplit = new Set<string>()
  private layer: LayerMode = { kind: 'none' }
  private overviewHeights: Float32Array | null = null
  private overviewSamples = 0
  private exaggeration = 1
  /** Whether float textures can be filtered linearly (OES_texture_float_linear); nearest otherwise. */
  private readonly floatLinear: boolean

  // shadow pass
  private readonly shadowTarget: THREE.WebGLRenderTarget
  private readonly shadowScene = new THREE.Scene()
  private readonly shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly shadowMaterial: THREE.ShaderMaterial
  private shadowDirty = true
  private lastSun = new THREE.Vector3()

  /** Uniforms shared by every tile material (same objects, so one update reaches all tiles). */
  readonly shared = {
    uShadow: { value: null as THREE.Texture | null },
    uExtent: { value: new THREE.Vector4() },
    uShadowReady: { value: 0 },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uLighting: { value: 1 },
    uLayerMode: { value: 0 },
    uLut: { value: null as THREE.Texture | null },
    uElevRange: { value: new THREE.Vector2(-9000, 7000) },
    uHighlight: { value: new THREE.Vector3(0, 0, 0) },
    uDiscR: { value: 1e12 },
  }

  constructor(tileset: Tileset, baseUrl: string, floatLinear: boolean, live: LiveConfig | null = liveConfigFromEnv(import.meta.env)) {
    // the live levels extend a copy of the tileset (the caller's object is shared with other views)
    const withLive = withLiveLevels(tileset, live)
    this.tileset = withLive.tileset
    this.live = withLive.live
    this.liveBase = live?.proxyBase ?? ''
    this.base = baseUrl
    this.tiles = new LruCache<GpuTile>(GPU_TILE_CAPACITY, (t) => {
      t.heights.dispose()
      t.mesh.material.dispose()
      this.group.remove(t.mesh)
    })
    this.layerTextures = new LruCache<THREE.DataTexture>(GPU_TILE_CAPACITY, (t) => t.dispose())
    const [x0, , x1, y1] = tileset.extentM
    this.shared.uExtent.value.set(x0, y1, x1 - x0, 0)
    this.shared.uElevRange.value.set(tileset.overview.min, tileset.overview.max)
    if (tileset.discRadiusM) this.shared.uDiscR.value = tileset.discRadiusM

    this.shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    })
    this.shadowMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: {
        uHeight: { value: null },
        uExtent: { value: new THREE.Vector4(x0, y1, x1 - x0, 0) },
        uSun: this.shared.uSun,
        uSunR: { value: 0.267 },
        uMast: { value: 2 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.floatLinear = floatLinear
    this.shadowScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shadowMaterial))
    this.empty.needsUpdate = true
  }

  // ------------------------------------------------------------------------------------------- overview

  async loadOverview(): Promise<void> {
    const ov = this.tileset.overview
    const res = await this.loader.request('overview', {
      url: this.base + ov.path,
      kind: 'height',
      min: ov.min,
      max: ov.max,
    })
    this.overviewHeights = res.heights!
    this.overviewSamples = res.width
    const tex = new THREE.DataTexture(res.heights!, res.width, res.height, THREE.RedFormat, THREE.FloatType)
    tex.minFilter = tex.magFilter = this.floatLinear ? THREE.LinearFilter : THREE.NearestFilter
    tex.needsUpdate = true
    this.shadowMaterial.uniforms.uHeight.value = tex
    const [x0, , x1] = this.tileset.extentM
    this.shadowMaterial.uniforms.uExtent.value.w = (x1 - x0) / (res.width - 1)
    this.shadowDirty = true
  }

  /** Height (m) from the overview at a map point, bilinear; null outside the tileset or before it loads. */
  heightAt(x: number, y: number): number | null {
    const h = this.overviewHeights
    if (!h) return null
    const n = this.overviewSamples - 1
    const [x0, , x1, y1] = this.tileset.extentM
    const fx = ((x - x0) / (x1 - x0)) * n
    const fy = ((y1 - y) / (x1 - x0)) * n
    if (fx < 0 || fy < 0 || fx > n || fy > n) return null
    const c = Math.min(Math.floor(fx), n - 1)
    const r = Math.min(Math.floor(fy), n - 1)
    const u = fx - c
    const v = fy - r
    const s = n + 1
    return (
      h[r * s + c] * (1 - u) * (1 - v) + h[r * s + c + 1] * u * (1 - v) + h[(r + 1) * s + c] * (1 - u) * v + h[(r + 1) * s + c + 1] * u * v
    )
  }

  // ------------------------------------------------------------------------------------------- settings

  /** Adaptive quality (plan): a coarser screen-space error threshold when the frame rate drops below 45. */
  reduceQuality(): void {
    this.lod = { splitPx: 3, mergePx: 2.25 }
  }

  setExaggeration(x: number): void {
    if (x === this.exaggeration) return
    this.exaggeration = x
    for (const k of this.tilesKeys()) this.tiles.get(k)!.mesh.material.uniforms.uBounds.value.w = x
  }

  private *tilesKeys() {
    for (const child of this.group.children) yield (child.userData.key as string)
  }

  setLayer(layer: LayerMode): void {
    this.layer = layer
    if (layer.kind === 'none') {
      this.shared.uLayerMode.value = 0
      return
    }
    const cmap: ColormapId = layer.kind === 'elevation' ? 'cividis' : layer.colormap
    if (!this.luts.has(cmap)) this.luts.set(cmap, lutTexture(cmap))
    this.shared.uLut.value = this.luts.get(cmap)!
    this.shared.uLayerMode.value = layer.kind === 'elevation' ? 2 : 1
  }

  setLighting(sun: boolean): void {
    this.shared.uLighting.value = sun ? 1 : 0
  }

  /** Sun direction (unit, MOON_ME) and angular radius at the chosen instant. */
  setSun(unit: [number, number, number], radiusDeg: number, mastM: number): void {
    const v = new THREE.Vector3(...unit)
    if (v.angleTo(this.lastSun) > 2e-5 || this.shadowMaterial.uniforms.uMast.value !== mastM) this.shadowDirty = true
    this.lastSun.copy(v)
    this.shared.uSun.value.copy(v)
    this.shadowMaterial.uniforms.uSunR.value = radiusDeg
    this.shadowMaterial.uniforms.uMast.value = mastM
  }

  setHighlight(x: number, y: number, radiusM: number): void {
    this.shared.uHighlight.value.set(x, y, radiusM)
  }

  private lastShadowAt = 0

  /** Recompute the shadow texture if the Sun moved; call before rendering the frame. */
  renderShadows(renderer: THREE.WebGLRenderer, playing = false): void {
    if (!this.shadowDirty || !this.shadowMaterial.uniforms.uHeight.value) return
    const now = performance.now()
    if (playing && now - this.lastShadowAt < SHADOW_MIN_INTERVAL_MS) return
    this.lastShadowAt = now
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.shadowTarget)
    renderer.render(this.shadowScene, this.shadowCamera)
    renderer.setRenderTarget(prev)
    this.shared.uShadow.value = this.shadowTarget.texture
    this.shared.uShadowReady.value = 1
    this.shadowDirty = false
    this.stats.shadowPasses++
  }

  // ------------------------------------------------------------------------------------------- per frame

  update(camera: THREE.PerspectiveCamera, viewportHeightPx: number, targetKm: [number, number]): void {
    camera.updateMatrixWorld()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    const box = new THREE.Box3()
    const sel = selectTiles(
      this.tileset,
      {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        viewportHeightPx,
        fovYRad: THREE.MathUtils.degToRad(camera.fov),
        exaggeration: this.exaggeration,
      },
      {
        ...this.lod,
        previouslySplit: this.previouslySplit,
        visible: (min, max) => frustum.intersectsBox(box.set(new THREE.Vector3(...min), new THREE.Vector3(...max))),
      },
    )
    this.previouslySplit = sel.split
    const draw = renderable(sel.tiles, (k) => this.tiles.has(k))
    const drawKeys = new Set(draw.map(keyOf))

    // request what is wanted and not loaded, plus the ancestors that stand in while it loads
    const wanted = new Map<string, TileKey>()
    for (const t of sel.tiles) {
      let cur: TileKey | null = t
      while (cur) {
        const k = keyOf(cur)
        if (!this.tiles.has(k)) wanted.set(k, cur)
        cur = parent(cur)
      }
    }
    const order = byDistanceTo(this.tileset, targetKm, [...wanted.values()])
    const rank = new Map(order.map((t, i) => [keyOf(t), i]))
    // overview first, then height tiles nearest the centre; layer tiles keep their place (never cancelled)
    this.loader.prioritise((k) => (k === 'overview' ? -1 : k.startsWith('L:') ? order.length : (rank.get(k) ?? null)))
    for (const t of order) this.requestTile(t)

    // show exactly the drawable tiles
    for (const child of [...this.group.children]) if (!drawKeys.has(child.userData.key)) this.group.remove(child)
    for (const t of draw) {
      const k = keyOf(t)
      const tile = this.tiles.get(k)!
      this.tiles.touch(k)
      if (tile.mesh.parent !== this.group) this.group.add(tile.mesh)
      this.bindLayer(t, tile)
    }
    this.tiles.evict(drawKeys)
    this.stats.drawn = draw.length
    this.stats.wanted = sel.tiles.map(keyOf)
    this.stats.drawnKeys = [...drawKeys]
    this.stats.cached = this.tiles.size
    this.stats.inFlight = this.loader.inFlight
  }

  private requestTile(t: TileKey): void {
    const k = keyOf(t)
    if (this.tiles.has(k) || this.loader.known(k)) return
    const range = this.tileset.height.tiles[k]
    if (!range) return
    const source = this.live.get(k)
    const req = source
      ? {
          url: source.kind === 'trek' ? trekTileUrl(source, this.tileset, t) : this.liveBase + source.file,
          kind: 'live' as const,
          live: {
            file: source.file,
            source: source.kind,
            geometry: {
              i0: t.x * this.tileset.tileCells,
              j0: t.y * this.tileset.tileCells,
              extentX0: this.tileset.extentM[0],
              extentY1: this.tileset.extentM[3],
              cellM: this.tileset.levels[t.z].cellM,
              samples: this.tileset.tileSamples,
            },
          },
        }
      : { url: this.base + tileUrl(this.tileset.height.path, t), kind: 'height' as const, min: range[0], max: range[1] }
    this.loader
      .request(k, req)
      .then((res) => {
        const tex = new THREE.DataTexture(res.heights!, res.width, res.height, THREE.RedFormat, THREE.FloatType)
        tex.minFilter = tex.magFilter = THREE.NearestFilter
        tex.needsUpdate = true
        if (source) {
          // the measured range replaces the estimate used for culling before the tile loaded
          if (res.min !== undefined && res.max !== undefined) this.tileset.height.tiles[k] = [res.min, res.max]
          this.stats.live.loaded++
        }
        this.tiles.set(k, this.makeTile(t, tex))
      })
      .catch((e: Error) => {
        // cancelled or failed: the parent stays on screen
        if (source && e.message !== 'cancelled') this.stats.live.failed++
      })
  }

  private makeTile(t: TileKey, heights: THREE.DataTexture): GpuTile {
    const [xMin, , , yMax] = tileBounds(this.tileset, t)
    const size = (this.tileset.extentM[2] - this.tileset.extentM[0]) / 2 ** t.z
    const cellM = this.tileset.levels[t.z].cellM
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...this.shared,
        uHeight: { value: heights },
        uBounds: { value: new THREE.Vector4(xMin, yMax, size, this.exaggeration) },
        uCellM: { value: cellM },
        uSkirtKm: { value: Math.max(0.3, (cellM / 1000) * 3) },
        uLayer: { value: this.empty },
        uLayerXf: { value: new THREE.Vector4(0, 0, 1, 1) },
        uHasLayer: { value: 0 },
      },
    })
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.frustumCulled = false
    mesh.userData.key = keyOf(t)
    return { key: keyOf(t), heights, mesh }
  }

  /** Give the tile the layer texture of its own level, or of the deepest ancestor the layer has. */
  private bindLayer(t: TileKey, tile: GpuTile): void {
    const u = tile.mesh.material.uniforms
    if (this.layer.kind !== 'data') {
      u.uHasLayer.value = 0
      return
    }
    let src: TileKey = t
    while (src.z > this.layer.levels - 1) src = parent(src)!
    const lk = `L:${this.layer.id}|${keyOf(src)}`
    const tex = this.layerTextures.get(lk)
    if (!tex) {
      u.uHasLayer.value = 0
      this.requestLayer(this.layer.id, src, lk)
      return
    }
    this.layerTextures.touch(lk)
    const scale = 1 / 2 ** (t.z - src.z)
    u.uLayer.value = tex
    u.uLayerXf.value.set((t.x - src.x * 2 ** (t.z - src.z)) * scale, (t.y - src.y * 2 ** (t.z - src.z)) * scale, scale, scale)
    u.uHasLayer.value = 1
  }

  private requestLayer(id: string, t: TileKey, lk: string): void {
    if (this.loader.known(lk)) return
    this.loader
      .request(lk, { url: `${this.base}layers/${id}/${t.z}/${t.x}/${t.y}.png`, kind: 'layer' })
      .then((res) => {
        const tex = new THREE.DataTexture(res.bytes!, res.width, res.height, THREE.RGFormat, THREE.UnsignedByteType)
        // bilinear between cell centres (the shader divides by the filtered coverage), so 960 m cells read as a
        // smooth field instead of blocks when zoomed in
        tex.minFilter = tex.magFilter = THREE.LinearFilter
        tex.colorSpace = THREE.NoColorSpace
        tex.needsUpdate = true
        this.layerTextures.set(lk, tex)
      })
      .catch(() => {})
  }

  dispose(): void {
    this.loader.dispose()
    this.tiles.clear()
    this.layerTextures.clear()
    this.luts.forEach((t) => t.dispose())
    this.geometry.dispose()
    this.shadowTarget.dispose()
    this.shadowMaterial.dispose()
  }
}
