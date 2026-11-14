/**
 * Block Moon: the navigator's place and time drawn as a world of cubes, for learners.
 *
 * Two views. "Whole Moon": the global LOLA heights as a sphere of cubes, lit by the Sun at the chosen time.
 * "Ground": the LOLA polar DEM around the chosen place as columns of cubes, with the Sun and the Earth as cubes
 * in the sky where the engine puts them; the shadows are cast by the cubes. The panels hold the answers as text.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { loadGlobe } from '../globe/GlobeView'
import { latLonToScene, meToScene } from '../globe/orbit'
import type { BodyView } from '../panels/useNow'
import { useNow } from '../panels/useNow'
import { useInsets } from '../state/layout'
import { type BlockView, useApp } from '../state/store'
import { TileLoader } from '../terrain/loader'
import { TILES_BASE, loadTileset } from '../terrain/TerrainView'
import { type Tileset, polarXY } from '../terrain/tileset'
import { useEphemeris, useMasks } from '../time/hooks'
import { type Blocks, GROUND_EXAGGERATION, type GroundBlocks, groundBlocks, moonBlocks, sampleGround, skyVector } from './voxels'

const FOV = 40
/** Cubes per side of the ground world (odd, so the chosen place is the centre cube). */
const GROUND_N = 97
/** Cubes across the whole Moon, and how much its relief is stretched so it shows at that size. */
const MOON_SIZE = 84
const MOON_EXAGGERATION = 12
/** The Sun and Earth cubes stand beyond the edge of the ground world and beyond the farthest camera. */
const SKY_DIST = 150
/** The Earth cube is 3.6 times the Sun cube, as the Earth (1.9°) and the Sun (0.53°) look from the Moon. */
const SUN_CUBE = 3
const forever = { staleTime: Infinity, gcTime: Infinity, retry: 1 } as const

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

async function loadOverview(ts: Tileset): Promise<{ heights: Float32Array; samples: number }> {
  const loader = new TileLoader(1)
  try {
    const ov = ts.overview
    const res = await loader.request('overview', { url: TILES_BASE + ov.path, kind: 'height', min: ov.min, max: ov.max })
    return { heights: res.heights!, samples: res.width }
  } finally {
    loader.dispose()
  }
}

/** Bilinear height (m) from the overview grid at a map point, null off the grid. */
function overviewHeight(ts: Tileset, ov: { heights: Float32Array; samples: number }, x: number, y: number): number | null {
  const n = ov.samples - 1
  const [x0, , x1, y1] = ts.extentM
  const fx = ((x - x0) / (x1 - x0)) * n
  const fy = ((y1 - y) / (x1 - x0)) * n
  if (fx < 0 || fy < 0 || fx > n || fy > n) return null
  if (ts.discRadiusM !== undefined && Math.hypot(x, y) > ts.discRadiusM) return null
  const c = Math.min(Math.floor(fx), n - 1)
  const r = Math.min(Math.floor(fy), n - 1)
  const u = fx - c
  const v = fy - r
  const s = n + 1
  const h = ov.heights
  return h[r * s + c] * (1 - u) * (1 - v) + h[r * s + c + 1] * u * (1 - v) + h[(r + 1) * s + c] * (1 - u) * v + h[(r + 1) * s + c + 1] * u * v
}

/** Latitude and longitude of the selection, from the catalogue or the typed point. */
function useSelectedLatLon(): [number, number] | null {
  const sel = useApp((s) => s.selection)
  const masks = useMasks().data
  return useMemo(() => {
    if (sel.kind === 'point') return [sel.lat, sel.lon]
    const site = masks?.site(sel.id)
    return site ? [site.lat, site.lon] : null
  }, [sel, masks])
}

/** The ground world for the selection, or null while loading or where the polar map does not reach. */
function useGroundBlocks(): { blocks: GroundBlocks | null; available: boolean; loading: boolean } {
  const ll = useSelectedLatLon()
  const tileset = useQuery({ queryKey: ['static', 'tileset'], queryFn: loadTileset, ...forever })
  const overview = useQuery({
    queryKey: ['static', 'overview-heights'],
    queryFn: () => loadOverview(tileset.data!),
    enabled: !!tileset.data,
    ...forever,
  })
  return useMemo(() => {
    if (!ll || ll[0] > -60) return { blocks: null, available: false, loading: false }
    if (!tileset.data || !overview.data) return { blocks: null, available: true, loading: !tileset.isError && !overview.isError }
    const ts = tileset.data
    const ov = overview.data
    const cellM = (ts.extentM[2] - ts.extentM[0]) / (ov.samples - 1)
    const grid = sampleGround((x, y) => overviewHeight(ts, ov, x, y), polarXY, ll[0], ll[1], GROUND_N, cellM)
    return { blocks: grid ? groundBlocks(grid) : null, available: !!grid, loading: false }
  }, [ll, tileset.data, tileset.isError, overview.data, overview.isError])
}

/** Camera that circles a target: yaw is the azimuth it looks from (clockwise from north), pitch its height. */
class BlockCam {
  yaw: number
  pitch: number
  dist: number
  goal: { yaw: number; pitch: number; dist: number }
  readonly limits: { pitch: [number, number]; dist: [number, number] }
  constructor(yaw: number, pitch: number, dist: number, limits: { pitch: [number, number]; dist: [number, number] }) {
    this.limits = limits
    this.yaw = yaw
    this.pitch = pitch
    this.dist = dist
    this.goal = { yaw, pitch, dist }
  }
  drag(dx: number, dy: number) {
    this.goal.yaw -= dx * 0.3
    this.goal.pitch = Math.max(this.limits.pitch[0], Math.min(this.limits.pitch[1], this.goal.pitch + dy * 0.25))
  }
  zoom(f: number) {
    this.goal.dist = Math.max(this.limits.dist[0], Math.min(this.limits.dist[1], this.goal.dist * f))
  }
  step(dt: number, instant: boolean) {
    const k = instant ? 1 : 1 - Math.exp(-dt * 8)
    this.yaw += (this.goal.yaw - this.yaw) * k
    this.pitch += (this.goal.pitch - this.pitch) * k
    this.dist += (this.goal.dist - this.dist) * k
  }
}

/** Puts the camera at `pos` looking at `target`, with the target in the middle of the space the panels leave free. */
function aimCamera(cam: THREE.PerspectiveCamera, pos: [number, number, number], target: THREE.Vector3, far: number, w: number, h: number) {
  cam.position.set(pos[0], pos[1], pos[2])
  cam.up.set(0, 1, 0)
  cam.lookAt(target)
  cam.near = 0.5
  cam.far = far
  const ins = useInsets.getState()
  const cx = ins.left + (w - ins.left - ins.right) / 2
  const cy = ins.top + (h - ins.top - ins.bottom) / 2
  cam.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h)
  cam.updateProjectionMatrix()
}

/** One InstancedMesh of unit cubes; matrices are written by `buildIn`. */
function useCubes(b: Blocks): THREE.InstancedMesh {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    const m = new THREE.InstancedMesh(geo, mat, b.count)
    m.instanceColor = new THREE.InstancedBufferAttribute(b.rgb, 3)
    m.frustumCulled = false
    m.castShadow = true
    m.receiveShadow = true
    return m
  }, [b])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    },
    [mesh],
  )
  return mesh
}

/**
 * Writes every cube's matrix for time t (s) of the build-in: each cube drops into place and grows, starting at
 * its own delay. Returns true once every cube has landed.
 */
function buildIn(mesh: THREE.InstancedMesh, b: Blocks, t: number, drop: [number, number, number]): boolean {
  const a = mesh.instanceMatrix.array as Float32Array
  let done = true
  for (let k = 0; k < b.count; k++) {
    const p = Math.max(0, Math.min(1, (t - b.delay[k]) / 0.45))
    if (p < 1) done = false
    const e = 1 - (1 - p) ** 3
    const o = k * 16
    a[o] = e
    a[o + 5] = e
    a[o + 10] = e
    a[o + 15] = 1
    a[o + 12] = b.pos[k * 3] + (1 - e) * drop[0]
    a[o + 13] = b.pos[k * 3 + 1] + (1 - e) * drop[1]
    a[o + 14] = b.pos[k * 3 + 2] + (1 - e) * drop[2]
  }
  mesh.instanceMatrix.needsUpdate = true
  return done
}

/** Plays the build-in once per new set of cubes (skipped with reduced motion). `drop` is where cubes fall from. */
function useBuildIn(mesh: THREE.InstancedMesh, b: Blocks, drop: [number, number, number]) {
  const start = useRef<number | null>(null)
  const finished = useRef(false)
  useEffect(() => {
    start.current = null
    finished.current = false
  }, [mesh])
  useFrame((state) => {
    if (finished.current) return
    start.current ??= state.clock.elapsedTime
    const t = reducedMotion() ? 1e9 : state.clock.elapsedTime - start.current
    finished.current = buildIn(mesh, b, t, drop)
  })
}

function Stars({ radius }: { radius: number }) {
  const points = useMemo(() => {
    const n = 1400
    const p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = Math.sin(i * 12.9898) * 43758.5453
      const v = Math.sin(i * 78.233) * 12345.6789
      const z = (u - Math.floor(u)) * 2 - 1
      const a = (v - Math.floor(v)) * Math.PI * 2
      const r = Math.sqrt(1 - z * z)
      p.set([r * Math.cos(a) * radius, z * radius, r * Math.sin(a) * radius], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8ccd6, size: 2, sizeAttenuation: false }))
  }, [radius])
  useEffect(() => () => {
    points.geometry.dispose()
    ;(points.material as THREE.Material).dispose()
  }, [points])
  return <primitive object={points} />
}

/** An 8 × 8 picture of the Earth (oceans, land, clouds) for the Earth cube, drawn once. */
function earthTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')!
  const land = new Set(['1,2', '2,2', '2,3', '3,3', '5,1', '5,2', '6,2', '4,5', '5,5', '5,6', '1,6'])
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const cloud = (x * 3 + y * 5) % 11 === 0
      g.fillStyle = cloud ? '#f2f6fb' : land.has(`${x},${y}`) ? '#4f8a5c' : '#2f7fd8'
      g.fillRect(x, y, 1, 1)
    }
  const t = new THREE.CanvasTexture(c)
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// --------------------------------------------------------------------------------------------- ground world

function GroundScene({ blocks, sun, earth, cam }: { blocks: GroundBlocks; sun: BodyView | null; earth: BodyView | null; cam: BlockCam }) {
  const { camera, size } = useThree()
  const cubes = useCubes(blocks)
  useBuildIn(cubes, blocks, [0, 30, 0])
  const light = useRef<THREE.DirectionalLight>(null)
  const sunCube = useRef<THREE.Group>(null)
  const earthCube = useRef<THREE.Mesh>(null)
  const earthMap = useMemo(() => earthTexture(), [])
  useEffect(() => () => earthMap.dispose(), [earthMap])
  const top = blocks.centreTop
  const target = useMemo(() => new THREE.Vector3(0, top, 0), [top])
  const instant = useRef(true)

  useEffect(() => {
    const l = light.current
    if (!l) return
    l.shadow.mapSize.set(2048, 2048)
    const half = GROUND_N / 2 + 6
    Object.assign(l.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 600 })
    l.shadow.camera.updateProjectionMatrix()
    l.shadow.bias = -0.0008
    l.shadow.normalBias = 0.03
  }, [])

  useFrame((_, dt) => {
    cam.step(dt, reducedMotion() || instant.current)
    instant.current = false
    const yaw = (cam.yaw * Math.PI) / 180
    const pitch = (cam.pitch * Math.PI) / 180
    aimCamera(
      camera as THREE.PerspectiveCamera,
      [
        target.x + Math.sin(yaw) * Math.cos(pitch) * cam.dist,
        target.y + Math.sin(pitch) * cam.dist,
        target.z - Math.cos(yaw) * Math.cos(pitch) * cam.dist,
      ],
      target,
      2000,
      size.width,
      size.height,
    )

    if (sun && light.current && sunCube.current) {
      const d = skyVector(sun.az, sun.el)
      light.current.position.set(d[0] * 300, top + d[1] * 300, d[2] * 300)
      light.current.target.position.set(0, top, 0)
      light.current.target.updateMatrixWorld()
      // fades out as the Sun sinks below the horizontal (stretched angles)
      const elS = Math.asin(d[1]) * (180 / Math.PI)
      light.current.intensity = 3.2 * Math.max(0, Math.min(1, (elS + 4) / 4))
      sunCube.current.position.set(d[0] * SKY_DIST, top + d[1] * SKY_DIST, d[2] * SKY_DIST)
      sunCube.current.visible = elS > -6
    }
    if (earth && earthCube.current) {
      const d = skyVector(earth.az, earth.el)
      earthCube.current.position.set(d[0] * SKY_DIST, top + d[1] * SKY_DIST, d[2] * SKY_DIST)
      earthCube.current.lookAt(target)
    }
  })

  return (
    <>
      <color attach="background" args={['#05060a']} />
      <ambientLight intensity={0.5} color="#9aa6c4" />
      <directionalLight ref={light} castShadow color="#fff6e8" />
      <primitive object={cubes} />
      <Lander top={top} />
      <group ref={sunCube}>
        <mesh>
          <boxGeometry args={[SUN_CUBE, SUN_CUBE, SUN_CUBE]} />
          <meshBasicMaterial color="#ffd27a" toneMapped={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[SUN_CUBE * 1.8, SUN_CUBE * 1.8, SUN_CUBE * 1.8]} />
          <meshBasicMaterial color="#ffb547" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={earthCube}>
        <boxGeometry args={[SUN_CUBE * 3.6, SUN_CUBE * 3.6, SUN_CUBE * 3.6]} />
        <meshLambertMaterial map={earthMap} emissive="#0d2140" />
      </mesh>
      <Stars radius={900} />
    </>
  )
}

/** "You are here": a small lander made of cubes on the centre column, and a beam so it can be found. */
function Lander({ top }: { top: number }) {
  return (
    <group position={[0, top + 0.5, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.7, 0.6, 0.7]} />
        <meshLambertMaterial color="#d9a441" />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.38, 0.12, sz * 0.38]}>
            <boxGeometry args={[0.12, 0.3, 0.12]} />
            <meshLambertMaterial color="#cfccc4" />
          </mesh>
        )),
      )}
      <mesh position={[0, 7, 0]}>
        <boxGeometry args={[0.25, 13, 0.25]} />
        <meshBasicMaterial color="#ffb547" transparent opacity={0.5} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ----------------------------------------------------------------------------------------------- whole Moon

function MoonScene({ blocks, cam, site }: { blocks: Blocks & { radius: number }; cam: BlockCam; site: [number, number] | null }) {
  const { camera, size } = useThree()
  const cubes = useCubes(blocks)
  const eph = useEphemeris().data
  const light = useRef<THREE.DirectionalLight>(null)
  const instant = useRef(true)
  const origin = useMemo(() => new THREE.Vector3(), [])
  useBuildIn(cubes, blocks, [0, -20, 0])

  // the chosen place: a column of gold cubes standing out of the surface
  const marker = useMemo(() => {
    if (!site) return []
    const n = latLonToScene(site[0], site[1], 1)
    const len = Math.hypot(n[0], n[1], n[2])
    return [1, 2, 3, 4].map((k) => n.map((v) => Math.round((v / len) * (blocks.radius + k))) as [number, number, number])
  }, [site, blocks.radius])

  useFrame((_, dt) => {
    cam.step(dt, reducedMotion() || instant.current)
    instant.current = false
    aimCamera(camera as THREE.PerspectiveCamera, latLonToScene(cam.pitch, cam.yaw, cam.dist), origin, 4000, size.width, size.height)
    const { tMs } = useApp.getState()
    if (eph?.table.covers(tMs) && light.current) {
      const s = eph.table.positions(tMs)
      const v = meToScene(s[0], s[1], s[2])
      const len = Math.hypot(v[0], v[1], v[2])
      light.current.position.set((v[0] / len) * 300, (v[1] / len) * 300, (v[2] / len) * 300)
    }
  })

  return (
    <>
      <color attach="background" args={['#05060a']} />
      <ambientLight intensity={0.14} color="#9aa6c4" />
      <directionalLight ref={light} intensity={3.2} color="#fff6e8" />
      <primitive object={cubes} />
      {marker.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#ffb547" toneMapped={false} />
        </mesh>
      ))}
      <Stars radius={1500} />
    </>
  )
}

// ---------------------------------------------------------------------------------------------- the view

export function BlockWorld() {
  const view = useApp((s) => s.blockView)
  const set = useApp((s) => s.set)
  const { view: now } = useNow()
  const ll = useSelectedLatLon()
  const ground = useGroundBlocks()
  const globe = useQuery({ queryKey: ['static', 'globe'], queryFn: loadGlobe, ...forever })
  const moon = useMemo(
    () => (globe.data ? moonBlocks(globe.data.heights, globe.data.meta.width, globe.data.meta.height, MOON_SIZE, MOON_EXAGGERATION) : null),
    [globe.data],
  )
  const showGround = view === 'ground' && ground.available
  const sunAz = now?.sun.az ?? 0

  // a new camera for each world and each place, looking across the place toward the Sun
  const groundKey = `${ll?.[0]},${ll?.[1]}`
  const groundCam = useMemo(
    () => new BlockCam(sunAz + 180, 14, 120, { pitch: [2, 85], dist: [20, 140] }),
    // the Sun's azimuth only sets the first view of each place
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groundKey],
  )
  const moonCam = useMemo(() => new BlockCam(ll?.[1] ?? 0, -50, MOON_SIZE * 2.7, { pitch: [-85, 85], dist: [MOON_SIZE * 0.75, MOON_SIZE * 5] }), [ll])
  const cam = showGround ? groundCam : moonCam
  const drag = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    drag.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    cam.drag(e.clientX - drag.current.x, e.clientY - drag.current.y)
    drag.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>) => cam.zoom(Math.exp(e.deltaY * 0.0012))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const keys: Record<string, () => void> = {
      ArrowLeft: () => cam.drag(40, 0),
      ArrowRight: () => cam.drag(-40, 0),
      ArrowUp: () => cam.drag(0, 30),
      ArrowDown: () => cam.drag(0, -30),
      '+': () => cam.zoom(0.8),
      '=': () => cam.zoom(0.8),
      '-': () => cam.zoom(1.25),
    }
    const fn = keys[e.key]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }
  const pick = (v: BlockView) => set({ blockView: v })

  const status = showGround
    ? ground.blocks
      ? null
      : ground.loading
        ? 'Building the ground out of cubes…'
        : 'The ground map could not be loaded.'
    : moon
      ? null
      : globe.isError
        ? 'Global LOLA topography not available.'
        : 'Building the Moon out of cubes…'

  return (
    <>
      <div
        className="map-view block-view"
        tabIndex={0}
        role="application"
        aria-roledescription="world of cubes"
        aria-label={showGround ? 'The ground around the chosen place, made of cubes' : 'The Moon made of cubes'}
        aria-describedby="block-help"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        {status ? (
          <p className="map-loading" role="status">
            {status}
          </p>
        ) : (
          <Canvas key={showGround ? `g${groundKey}` : 'moon'} shadows camera={{ fov: FOV, position: [0, 40, 120] }} dpr={[1, 2]} flat gl={{ antialias: true }} aria-hidden="true">
            {showGround && ground.blocks ? (
              <GroundScene blocks={ground.blocks} sun={now?.sun ?? null} earth={now?.earth ?? null} cam={groundCam} />
            ) : moon ? (
              <MoonScene blocks={moon} cam={moonCam} site={ll} />
            ) : null}
          </Canvas>
        )}
        <p id="block-help" className="sr-only">
          Arrow keys turn the view, plus and minus zoom. The panels say, in words, whether the Sun and the Earth can be seen from the chosen place.
        </p>
      </div>
      <div className="map-controls block-controls" role="group" aria-label="Block world view">
        <div className="block-seg" role="radiogroup" aria-label="What to show">
          <button type="button" role="radio" aria-checked={!showGround} onClick={() => pick('moon')}>
            Whole Moon
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={showGround}
            disabled={!ground.available}
            title={ground.available ? undefined : 'The ground view covers the south pole, south of 60° S'}
            onClick={() => pick('ground')}
          >
            Stand here
          </button>
        </div>
        <button type="button" onClick={() => cam.zoom(0.75)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => cam.zoom(1 / 0.75)} aria-label="Zoom out">
          −
        </button>
      </div>
      <p className="globe-caption block-caption">
        {showGround
          ? `Each cube is 960 m wide and ${960 / GROUND_EXAGGERATION} m tall: heights and sky angles are stretched ×${GROUND_EXAGGERATION}, so the cubes' shadows fall as on the real ground. LOLA polar DEM (NASA PGDA).`
          : `Global LOLA heights (NASA LRO), relief stretched ×${MOON_EXAGGERATION}, lit by the Sun at the chosen time. The gold column is your place.`}
      </p>
    </>
  )
}
