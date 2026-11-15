/**
 * Terrain engine: tileset, quadtree LOD, decode worker, GPU tile cache, colour layers and the shadow pass.
 * Imperative Three.js, driven once per frame by TerrainView (React Three Fiber). Plan sections "Calidad según
 * el zoom", "Play: sombras que se mueven con el Sol" and "Capas y paneles".
 */
import * as THREE from 'three'
import { LruCache } from './cache'
import { type LiveConfig, type LiveSource, cachedLiveLevels, descendantRanges, liveConfigFromEnv, trekTileUrl } from './live/config'
import { LIVE_LAYERS, layerCellGeometry, liveLayerMaxZ, liveLayerSource } from './live/layers'
import { lutBytes, type ColormapId } from './colormaps'
import { TileLoader } from './loader'
import { PHOTO_EAGER_Z, photoMaxZ, photoTileUrl } from './live/photo'
import { type LodOptions, byDistanceTo, renderable, selectTiles } from './lod'
import { GRID_VERTICES, TERRAIN_FRAG, TERRAIN_VERT } from './shaders'
import { SHADOW_FRAG, SHADOW_VERT } from './shadow'
import { BANDS, ShadowSchedule } from './shadowSchedule'
import { type TileKey, type Tileset, keyOf, parent, tileBounds, tileUrl } from './tileset'

export const GPU_TILE_CAPACITY = 300
/** Shadow texture at rest: one texel per 960 m cell of the preview over the 60 S disc (the overview is 2049²). */
export const SHADOW_SIZE = 2048
/**
 * Shadow texture while the Sun moves (time playing or the slider dragged): one texel per 1 920 m. The pass costs one
 * 72-step ray per texel, so halving the side divides its cost by about four; measured on an Intel UHD (integrated)
 * GPU, 25-44 ms per pass at 2048² against 8-16 ms at 1024², with a whole frame budget of 16.7 ms at 60 fps. Once the
 * Sun is still the full-size texture is computed again, in strips (shadowSchedule.ts says when each pass runs).
 */
export const SHADOW_FAST_SIZE = 1024

/**
 * Detail against speed. `splitPx` is the size a height cell may reach on screen, in CSS pixels, before its tile is
 * replaced by its four children; a slow frame rate steps down (TerrainView). A sharper step for dense screens
 * (1.5 px) was tried on 2026-11-14 and dropped: it asked the remote servers for up to twice the tiles while zooming
 * (41 against 65-82 requests for the same moves), which is what the map waits for, for a gain not seen in the
 * screenshots compared.
 */
export const QUALITY = {
  standard: { splitPx: 2, mergePx: 1.5 },
  reduced: { splitPx: 3, mergePx: 2.25 },
} as const satisfies Record<string, LodOptions>
export type Quality = keyof typeof QUALITY

/** A tile that failed to load is asked for again after these pauses (s), then left alone for the session. */
export const RETRY_AFTER_S = [10, 30, 90]

export type LayerMode =
  | { kind: 'none' }
  | { kind: 'elevation' }
  | { kind: 'data'; id: string; colormap: ColormapId; levels: number }
  /** The LROC WAC south polar mosaic as the ground's brightness, under the same relief and light (live/photo.ts). */
  | { kind: 'photo' }

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
  /**
   * Live tiles not loaded yet whose height range is an estimate: key → level of the loaded ancestor it came from
   * (−1: the padded guess of withLiveLevels). A finer loaded ancestor replaces it (live/config.ts, descendantRanges).
   */
  private readonly estimatedFrom = new Map<string, number>()
  private readonly liveBase: string
  lod: LodOptions = QUALITY.standard
  /**
   * Counts every change to what the map shows that the camera does not explain: a tile or layer texture arrived,
   * the tiles drawn changed, the Sun moved, the shadow texture was renewed, a setting changed. The view draws a frame
   * only when this number or the camera changed (TerrainView), so anything that changes the picture must count here.
   */
  version = 0
  private disposed = false
  private readonly retries = new Map<string, number>()
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()
  /** One material per shader variant, never drawn: they keep both compiled programs alive (prepare). */
  private readonly keptPrograms: THREE.ShaderMaterial[] = []
  // scratch objects of the per-frame tile selection
  private readonly frustum = new THREE.Frustum()
  private readonly viewProjection = new THREE.Matrix4()
  private readonly box = new THREE.Box3()

  private readonly base: string
  private readonly loader = new TileLoader()
  private readonly geometry = gridGeometry()
  private readonly tiles: LruCache<GpuTile>
  private readonly layerTextures: LruCache<THREE.DataTexture>
  private readonly luts = new Map<ColormapId, THREE.DataTexture>()
  private readonly empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  private previouslySplit = new Set<string>()
  private goalPreviouslySplit = new Set<string>()
  /** The camera is still moving toward its goal: live layer tiles from PGDA wait (bindLayer). */
  private moving = false
  /** Live layer tiles queued or in flight, and those the drawn tiles wanted last frame (the others are cancelled). */
  private readonly liveLayerKeys = new Set<string>()
  private wantedLayerKeys = new Set<string>()
  private nextWantedLayerKeys = new Set<string>()
  private layer: LayerMode = { kind: 'none' }
  private overviewHeights: Float32Array | null = null
  private overviewSamples = 0
  private exaggeration = 1
  /** Whether float textures can be filtered linearly (OES_texture_float_linear); nearest otherwise. */
  private readonly floatLinear: boolean

  // shadow pass
  private readonly shadowTarget: THREE.WebGLRenderTarget
  private readonly shadowTargetFast: THREE.WebGLRenderTarget
  private readonly shadowSchedule = new ShadowSchedule()
  private readonly shadowScene = new THREE.Scene()
  private readonly shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly shadowMaterial: THREE.ShaderMaterial
  private lastSun = new THREE.Vector3()
  private readonly sunScratch = new THREE.Vector3()

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
    // mission mode: the area search raster (r: code, g: score) and the ring of the search region
    uArea: { value: null as THREE.Texture | null },
    uAreaXf: { value: new THREE.Vector4(0, 0, 1, 1) },
    uHasArea: { value: 0 },
    uRegion: { value: new THREE.Vector3(0, 0, 0) },
  }
  private areaTexture: THREE.DataTexture | null = null

  constructor(tileset: Tileset, baseUrl: string, floatLinear: boolean, live: LiveConfig | null = liveConfigFromEnv(import.meta.env)) {
    // the live levels extend a copy of the tileset (the caller's object is shared with other views); the table
    // is built once per tileset, not on every entry into the map
    const withLive = cachedLiveLevels(tileset, live)
    this.tileset = withLive.tileset
    this.live = withLive.live
    for (const k of this.live.keys()) this.estimatedFrom.set(k, -1)
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

    const shadowTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    }
    this.shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, shadowTargetOptions)
    this.shadowTargetFast = new THREE.WebGLRenderTarget(SHADOW_FAST_SIZE, SHADOW_FAST_SIZE, shadowTargetOptions)
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
    this.shadowSchedule.changed(performance.now())
    // open the live DEMs now, so the first zoom past the static levels does not wait for it
    for (const s of new Set([...this.live.values()].filter((s) => s.kind === 'cog').map((s) => s.file))) this.warm(s)
  }

  /** Open a PGDA GeoTIFF in its worker ahead of the first tile (live/cog.ts, `warm`); failures are left to the tiles. */
  private warm(file: string): void {
    const k = `warm:${file}`
    if (!this.liveBase || this.loader.known(k)) return
    const geometry = { i0: 0, j0: 0, extentX0: 0, extentY1: 0, cellM: 1, samples: 0 }
    this.loader.request(k, { url: this.liveBase + file, kind: 'live', live: { file, source: 'cog', geometry, warm: true } }).catch(() => {})
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

  /** Adaptive quality (plan): the screen-space error threshold follows the frame rate (QUALITY). */
  setQuality(q: Quality): void {
    this.lod = QUALITY[q]
  }

  setExaggeration(x: number): void {
    if (x === this.exaggeration) return
    this.exaggeration = x
    this.version++
    for (const k of this.tilesKeys()) this.tiles.get(k)!.mesh.material.uniforms.uBounds.value.w = x
  }

  private *tilesKeys() {
    for (const child of this.group.children) yield (child.userData.key as string)
  }

  setLayer(layer: LayerMode): void {
    this.layer = layer
    this.version++
    if (layer.kind === 'none') {
      this.shared.uLayerMode.value = 0
      return
    }
    if (layer.kind === 'photo') {
      this.shared.uLayerMode.value = 3
      return
    }
    if (layer.kind === 'data') for (const s of LIVE_LAYERS[layer.id] ?? []) this.warm(s.file)
    const cmap: ColormapId = layer.kind === 'elevation' ? 'cividis' : layer.colormap
    if (!this.luts.has(cmap)) this.luts.set(cmap, lutTexture(cmap))
    this.shared.uLut.value = this.luts.get(cmap)!
    this.shared.uLayerMode.value = layer.kind === 'elevation' ? 2 : 1
  }

  setLighting(sun: boolean): void {
    const v = sun ? 1 : 0
    if (this.shared.uLighting.value === v) return
    this.shared.uLighting.value = v
    this.version++
  }

  /** Sun direction (unit, MOON_ME) and angular radius at the chosen instant. */
  setSun(unit: [number, number, number], radiusDeg: number, mastM: number): void {
    const v = this.sunScratch.set(unit[0], unit[1], unit[2])
    const u = this.shadowMaterial.uniforms
    if (v.equals(this.lastSun) && u.uMast.value === mastM && u.uSunR.value === radiusDeg) return
    if (v.angleTo(this.lastSun) > 2e-5 || u.uMast.value !== mastM) this.shadowSchedule.changed(performance.now())
    this.lastSun.copy(v)
    this.shared.uSun.value.copy(v)
    u.uSunR.value = radiusDeg
    u.uMast.value = mastM
    this.version++
  }

  /**
   * Paint the answer of the area search over the terrain (mission mode), or clear it. One texel per search cell,
   * nearest filtering: the cells are the result, so they are drawn as cells, never blurred into each other.
   */
  setAreas(a: { xLeftM: number; yTopM: number; cellM: number; nx: number; ny: number; codes: Uint8Array; score: Uint8Array } | null): void {
    this.areaTexture?.dispose()
    this.areaTexture = null
    this.version++
    if (!a) {
      this.shared.uHasArea.value = 0
      this.shared.uArea.value = null
      return
    }
    const rg = new Uint8Array(a.nx * a.ny * 2)
    for (let i = 0; i < a.nx * a.ny; i++) {
      rg[2 * i] = a.codes[i]
      rg[2 * i + 1] = a.score[i]
    }
    const tex = new THREE.DataTexture(rg, a.nx, a.ny, THREE.RGFormat, THREE.UnsignedByteType)
    tex.minFilter = tex.magFilter = THREE.NearestFilter
    tex.colorSpace = THREE.NoColorSpace
    tex.unpackAlignment = 1
    tex.needsUpdate = true
    this.areaTexture = tex
    this.shared.uArea.value = tex
    this.shared.uAreaXf.value.set(a.xLeftM, a.yTopM, a.cellM * a.nx, a.cellM * a.ny)
    this.shared.uHasArea.value = 1
  }

  /** Ring of the search region (projected centre and radius, m); radius 0 hides it. */
  setRegion(x: number, y: number, radiusM: number): void {
    const r = this.shared.uRegion.value
    if (r.x === x && r.y === y && r.z === radiusM) return
    r.set(x, y, radiusM)
    this.version++
  }

  setHighlight(x: number, y: number, radiusM: number): void {
    const h = this.shared.uHighlight.value
    if (h.x === x && h.y === y && h.z === radiusM) return
    h.set(x, y, radiusM)
    this.version++
  }

  /**
   * Recompute the shadow texture when the Sun moved; call before rendering the frame. A fast (1024) pass answers at
   * once; the full (2048) pass follows in strips, one per frame, once the Sun is still (shadowSchedule.ts).
   */
  renderShadows(renderer: THREE.WebGLRenderer, playing = false): void {
    if (!this.shadowMaterial.uniforms.uHeight.value) return
    const step = this.shadowSchedule.next(performance.now(), playing)
    if (!step) return
    const target = step.kind === 'fast' ? this.shadowTargetFast : this.shadowTarget
    if (step.kind === 'full') {
      const h = SHADOW_SIZE / BANDS
      target.scissor.set(0, step.band * h, SHADOW_SIZE, h)
      target.scissorTest = true
    }
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(target)
    renderer.render(this.shadowScene, this.shadowCamera)
    renderer.setRenderTarget(prev)
    if (step.kind === 'full' && !step.last) return
    this.shared.uShadow.value = target.texture
    this.shared.uShadowReady.value = 1
    this.stats.shadowPasses++
    this.version++
  }

  // ------------------------------------------------------------------------------------------- per frame

  private select(camera: THREE.PerspectiveCamera, viewportHeightPx: number, previouslySplit: ReadonlySet<string>) {
    camera.updateMatrixWorld()
    const frustum = this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const box = this.box
    return selectTiles(
      this.tileset,
      {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        viewportHeightPx,
        fovYRad: THREE.MathUtils.degToRad(camera.fov),
        exaggeration: this.exaggeration,
      },
      {
        ...this.lod,
        previouslySplit,
        visible: (min, max) => {
          box.min.set(min[0], min[1], min[2])
          box.max.set(max[0], max[1], max[2])
          return frustum.intersectsBox(box)
        },
      },
    )
  }

  /**
   * Choose, request and show the tiles for this frame. `goal` is the camera where the current motion ends (the
   * camera rig's goal) and `moving` says whether it is still on its way. Tiles read from PGDA (seconds and megabytes
   * each) are asked for only for the goal's view, and live layer tiles only once the camera has stopped, so a zoom
   * does not spend the bandwidth on the levels it passes through: a request in flight cannot be called back, because
   * the blocks it reads are shared with other tiles. Static and Moon Trek tiles are asked for as they are seen.
   */
  update(
    camera: THREE.PerspectiveCamera,
    viewportHeightPx: number,
    targetKm: [number, number],
    goal: THREE.PerspectiveCamera | null = null,
    moving = false,
  ): void {
    this.moving = moving
    const sel = this.select(camera, viewportHeightPx, this.previouslySplit)
    this.previouslySplit = sel.split
    const goalSel = goal ? this.select(goal, viewportHeightPx, this.goalPreviouslySplit) : sel
    if (goal) this.goalPreviouslySplit = goalSel.split
    // the PGDA tiles the goal's view wants, and their parents (the stand-ins asked for below)
    const goalKeys = new Set<string>()
    for (const t of goalSel.tiles) {
      goalKeys.add(keyOf(t))
      const p = parent(t)
      if (p) goalKeys.add(keyOf(p))
    }
    const draw = renderable(sel.tiles, (k) => this.tiles.has(k))
    const drawKeys = new Set(draw.map(keyOf))

    // request what is wanted and not loaded, plus the ancestors that stand in while it loads: the parent always, and
    // farther ancestors only when they are one small request each (our static tiles, Moon Trek). A PGDA ancestor two
    // or more levels up reads another, coarser file over a far larger area than the view: measured 2026-11-14 at
    // Shackleton, the z8 stand-ins took 10 MB and 10 s from the 20 m DEM before the z10 tiles of the view (5 MB,
    // the 10 m DEM) could start, and were replaced at once. Until the parent loads, the nearest loaded ancestor stays.
    const wanted = new Map<string, TileKey>()
    const want = (tiles: TileKey[], fromGoal: boolean) => {
      for (const t of tiles) {
        let cur: TileKey | null = t
        while (cur) {
          const k = keyOf(cur)
          const cog = this.live.get(k)?.kind === 'cog'
          if (!this.tiles.has(k) && (cur.z >= t.z - 1 || !cog) && (!cog || fromGoal || goalKeys.has(k))) wanted.set(k, cur)
          cur = parent(cur)
        }
      }
    }
    want(sel.tiles, goalSel === sel)
    if (goalSel !== sel) want(goalSel.tiles, true)
    const order = byDistanceTo(this.tileset, targetKm, [...wanted.values()])
    const rank = new Map(order.map((t, i) => [keyOf(t), i]))
    // overview first, then height tiles nearest the centre; static layer tiles of the layer shown keep their place,
    // those of another layer (the user switched) and live layer tiles no tile wanted last frame are dropped
    this.wantedLayerKeys = this.nextWantedLayerKeys
    this.nextWantedLayerKeys = new Set()
    const layerPrefix = this.layer.kind === 'data' ? `L:${this.layer.id}|` : this.layer.kind === 'photo' ? 'L:photo|' : null
    this.loader.prioritise((k) => {
      if (k === 'overview' || k.startsWith('warm:')) return -1
      if (!k.startsWith('L:')) return rank.get(k) ?? null
      if (!layerPrefix || !k.startsWith(layerPrefix)) return null
      if (this.liveLayerKeys.has(k) && !this.wantedLayerKeys.has(k)) return null
      return order.length
    })
    for (const t of order) this.requestTile(t)

    // show exactly the drawable tiles, nearest to the camera first (each tile has its own material, so without a
    // render order three.js would draw them in material order and shade terrain that nearer tiles then cover)
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i]
      if (drawKeys.has(child.userData.key)) continue
      this.group.remove(child)
      this.version++
    }
    const camKm = camera.position
    const nearFirst = draw
      .map((t) => {
        const [a, b, c, d] = tileBounds(this.tileset, t)
        const cx = Math.max(a / 1000, Math.min(c / 1000, camKm.x))
        const cz = Math.max(-d / 1000, Math.min(-b / 1000, camKm.z))
        return { t, d: Math.hypot(cx - camKm.x, cz - camKm.z) }
      })
      .sort((p, q) => p.d - q.d)
    for (let i = 0; i < nearFirst.length; i++) {
      const t = nearFirst[i].t
      const k = keyOf(t)
      const tile = this.tiles.get(k)!
      this.tiles.touch(k)
      tile.mesh.renderOrder = -10_000 + i
      if (tile.mesh.parent !== this.group) {
        this.group.add(tile.mesh)
        this.version++
      }
      this.bindLayer(t, tile)
    }
    this.tiles.evict(drawKeys)
    this.stats.drawn = draw.length
    if (import.meta.env.DEV) {
      // for the tests and debugging only
      this.stats.wanted = sel.tiles.map(keyOf)
      this.stats.drawnKeys = [...drawKeys]
    }
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
        // the vertex shader reads exact samples (texelFetch); the fragment shader's slopes use the filtering
        tex.minFilter = tex.magFilter = this.floatLinear ? THREE.LinearFilter : THREE.NearestFilter
        tex.needsUpdate = true
        if (source) {
          // the measured range replaces the estimate used for culling before the tile loaded
          if (res.min !== undefined && res.max !== undefined) this.tileset.height.tiles[k] = [res.min, res.max]
          this.estimatedFrom.delete(k)
          this.stats.live.loaded++
        }
        this.refineDescendants(t, res.heights!, res.width)
        this.tiles.set(k, this.makeTile(t, tex))
        this.retries.delete(k)
        this.version++
      })
      .catch((e: Error) => {
        // cancelled or failed: the parent stays on screen
        if (e.message === 'cancelled') return
        if (source) this.stats.live.failed++
        this.retryLater(k)
      })
  }

  /**
   * A failed request is not asked for again by itself (TileLoader), and one missing tile keeps its parent, a tile
   * of half the detail, on screen for the whole quad. So let it be asked for again after a pause, a few times: the
   * remote DEM servers answer most failed reads on a second try.
   */
  private retryLater(key: string): void {
    const n = this.retries.get(key) ?? 0
    if (n >= RETRY_AFTER_S.length || this.disposed) return
    this.retries.set(key, n + 1)
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer)
      if (!this.disposed) this.loader.forget(key)
    }, RETRY_AFTER_S[n] * 1000)
    this.retryTimers.add(timer)
  }

  /** Tighten the estimated ranges of the live tiles below a loaded tile from its samples (descendantRanges). */
  private refineDescendants(t: TileKey, heights: Float32Array, samples: number): void {
    if (this.estimatedFrom.size === 0) return
    for (const [k, range] of descendantRanges(t, heights, samples, this.tileset.levels[t.z].cellM)) {
      const from = this.estimatedFrom.get(k)
      if (from === undefined || from >= t.z) continue
      this.tileset.height.tiles[k] = range
      this.estimatedFrom.set(k, t.z)
    }
  }

  private makeTile(t: TileKey, heights: THREE.DataTexture): GpuTile {
    const [xMin, , , yMax] = tileBounds(this.tileset, t)
    const size = (this.tileset.extentM[2] - this.tileset.extentM[0]) / 2 ** t.z
    const cellM = this.tileset.levels[t.z].cellM
    // only tiles reaching past the map's disc need the discard (shaders.ts, DISC_EDGE)
    const reach = Math.max(...[xMin, xMin + size].flatMap((x) => [yMax, yMax - size].map((y) => Math.hypot(x, y))))
    const material = this.tileMaterial(reach > this.shared.uDiscR.value, heights, new THREE.Vector4(xMin, yMax, size, this.exaggeration), cellM)
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.frustumCulled = false
    mesh.userData.key = keyOf(t)
    return { key: keyOf(t), heights, mesh }
  }

  /** A tile's material. The shader has two variants: with the disc-edge discard (tiles on the rim) and without. */
  private tileMaterial(discEdge: boolean, heights: THREE.Texture, bounds: THREE.Vector4, cellM: number): THREE.ShaderMaterial {
    const defines: Record<string, string> = {}
    if (this.floatLinear) defines.FLOAT_LINEAR = ''
    if (discEdge) defines.DISC_EDGE = ''
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      defines,
      side: THREE.DoubleSide,
      uniforms: {
        ...this.shared,
        uHeight: { value: heights },
        uBounds: { value: bounds },
        uCellM: { value: cellM },
        uSkirtKm: { value: Math.max(0.3, (cellM / 1000) * 3) },
        uLayer: { value: this.empty },
        uLayerXf: { value: new THREE.Vector4(0, 0, 1, 1) },
        uHasLayer: { value: 0 },
      },
    })
  }

  /**
   * Compile both variants of the terrain shader now, off the drawing path, and keep them for the engine's life.
   * Otherwise the variant without the disc edge is compiled when its first tile is drawn, in the middle of the
   * first zoom, and the GPU stops for as long as that takes (a frame of 383 ms measured on an Apple M2); and a
   * variant whose tiles had all left the cache would be thrown away and compiled again later.
   */
  prepare(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.keptPrograms.length) return
    const scene = new THREE.Scene()
    for (const discEdge of [false, true]) {
      const m = this.tileMaterial(discEdge, this.empty, new THREE.Vector4(0, 0, 1, 1), 1)
      this.keptPrograms.push(m)
      scene.add(new THREE.Mesh(this.geometry, m))
    }
    renderer.compileAsync(scene, camera).catch(() => {})
  }

  /**
   * Give the tile the layer texture of its own level, or of the deepest ancestor the layer has: static levels
   * everywhere, live levels (live/layers.ts) where a source covers the tile and the PGDA proxy is configured. While
   * the finest one loads, the nearest loaded ancestor is shown.
   */
  private bindLayer(t: TileKey, tile: GpuTile): void {
    const u = tile.mesh.material.uniforms
    if (this.layer.kind === 'photo') {
      this.bindPhoto(t, u)
      return
    }
    if (this.layer.kind !== 'data') {
      u.uHasLayer.value = 0
      return
    }
    const id = this.layer.id
    const staticMax = this.layer.levels - 1
    const liveMax = this.liveBase ? liveLayerMaxZ(id) : -1
    let finest: TileKey = t
    while (finest.z > staticMax && !(finest.z <= liveMax && liveLayerSource(id, this.tileset, finest))) finest = parent(finest)!
    let src: TileKey | null = finest
    let tex: THREE.DataTexture | undefined
    let lk = ''
    while (src) {
      lk = `L:${id}|${keyOf(src)}`
      tex = this.layerTextures.get(lk)
      if (tex) break
      if (src.z <= staticMax || (src === finest && !this.moving)) this.requestLayer(id, src, lk)
      if (src.z > staticMax) this.nextWantedLayerKeys.add(lk)
      src = parent(src)
    }
    if (!tex || !src) {
      u.uHasLayer.value = 0
      return
    }
    this.layerTextures.touch(lk)
    const scale = 1 / 2 ** (t.z - src.z)
    u.uLayer.value = tex
    u.uLayerXf.value.set((t.x - src.x * 2 ** (t.z - src.z)) * scale, (t.y - src.y * 2 ** (t.z - src.z)) * scale, scale, scale)
    u.uHasLayer.value = 1
  }

  /**
   * Photo layer: the tile's own photo tile down to photoMaxZ (about the mosaic's 100 m), else the deepest ancestor
   * loaded. Coarse tiles (PHOTO_EAGER_Z and up) are asked for as they are seen; finer ones once the camera has
   * stopped, like the live data layers, and dropped when no tile wants them any more.
   */
  private bindPhoto(t: TileKey, u: Record<string, THREE.IUniform>): void {
    const maxZ = photoMaxZ(this.tileset)
    let finest: TileKey = t
    while (finest.z > maxZ) finest = parent(finest)!
    let src: TileKey | null = finest
    let tex: THREE.DataTexture | undefined
    let lk = ''
    while (src) {
      lk = `L:photo|${keyOf(src)}`
      tex = this.layerTextures.get(lk)
      if (tex) break
      if (src.z <= PHOTO_EAGER_Z || (src === finest && !this.moving)) this.requestPhoto(src, lk)
      if (src.z > PHOTO_EAGER_Z) this.nextWantedLayerKeys.add(lk)
      src = parent(src)
    }
    if (!tex || !src) {
      u.uHasLayer.value = 0
      return
    }
    this.layerTextures.touch(lk)
    const scale = 1 / 2 ** (t.z - src.z)
    u.uLayer.value = tex
    ;(u.uLayerXf.value as THREE.Vector4).set((t.x - src.x * 2 ** (t.z - src.z)) * scale, (t.y - src.y * 2 ** (t.z - src.z)) * scale, scale, scale)
    u.uHasLayer.value = 1
  }

  private requestPhoto(t: TileKey, lk: string): void {
    if (this.loader.known(lk)) return
    if (t.z > PHOTO_EAGER_Z) this.liveLayerKeys.add(lk)
    // decoded by the globe's photo path (a 256 x 256 grey JPEG, cached in the browser): the box is not used for photos
    const req = { url: photoTileUrl(this.tileset, t), kind: 'globe' as const, globe: { kind: 'photo' as const, box: { lon0: 0, lat0: 0, size: 0 }, extraRows: 0 } }
    this.loader
      .request(lk, req)
      .then((res) => {
        const tex = new THREE.DataTexture(res.bytes!, res.width, res.height, THREE.RedFormat, THREE.UnsignedByteType)
        tex.minFilter = tex.magFilter = THREE.LinearFilter
        tex.unpackAlignment = 1
        tex.colorSpace = THREE.NoColorSpace
        tex.needsUpdate = true
        this.layerTextures.set(lk, tex)
        this.retries.delete(lk)
        this.version++
      })
      .catch((e: Error) => {
        if (e.message !== 'cancelled') this.retryLater(lk)
      })
      .finally(() => this.liveLayerKeys.delete(lk))
  }

  private requestLayer(id: string, t: TileKey, lk: string): void {
    if (this.loader.known(lk)) return
    const meta = this.tileset.layers[id]
    const live = this.layer.kind === 'data' && t.z > this.layer.levels - 1 ? liveLayerSource(id, this.tileset, t) : null
    if (live) this.liveLayerKeys.add(lk)
    const req = live
      ? {
          url: this.liveBase + live.file,
          kind: 'live' as const,
          live: {
            file: live.file,
            source: 'cog' as const,
            geometry: layerCellGeometry(this.tileset, t),
            layer: { scale: live.scale, offset: live.offset, min: meta.min, max: meta.max },
          },
        }
      : { url: `${this.base}layers/${id}/${t.z}/${t.x}/${t.y}.png`, kind: 'layer' as const }
    this.loader
      .request(lk, req)
      .then((res) => {
        const tex = new THREE.DataTexture(res.bytes!, res.width, res.height, THREE.RGFormat, THREE.UnsignedByteType)
        // bilinear between cell centres (the shader divides by the filtered coverage), so 960 m cells read as a
        // smooth field instead of blocks when zoomed in
        tex.minFilter = tex.magFilter = THREE.LinearFilter
        tex.colorSpace = THREE.NoColorSpace
        tex.needsUpdate = true
        this.layerTextures.set(lk, tex)
        this.retries.delete(lk)
        this.version++
      })
      .catch((e: Error) => {
        if (e.message !== 'cancelled') this.retryLater(lk)
      })
      .finally(() => this.liveLayerKeys.delete(lk))
  }

  dispose(): void {
    this.disposed = true
    this.retryTimers.forEach((t) => clearTimeout(t))
    this.retryTimers.clear()
    this.loader.dispose()
    this.keptPrograms.forEach((m) => m.dispose())
    this.tiles.clear()
    this.layerTextures.clear()
    this.luts.forEach((t) => t.dispose())
    this.areaTexture?.dispose()
    this.geometry.dispose()
    this.shadowTarget.dispose()
    this.shadowTargetFast.dispose()
    this.shadowMaterial.dispose()
  }
}
