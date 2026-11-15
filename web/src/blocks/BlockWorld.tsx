/**
 * Educational mode: the navigator's place and time drawn as a world of cubes, for learners.
 *
 * Two views. "Whole Moon": the global LOLA heights as a sphere of cubes, lit by the Sun at the chosen time.
 * "Ground": the LOLA polar DEM around the chosen place as columns of cubes, with the Sun and the Earth as cubes
 * in the sky where the engine puts them; the shadows are cast by the cubes. The panels hold the answers as text.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { loadGlobe } from '../globe/GlobeView'
import { latLonToScene, meToScene, raySphere, sceneToLatLon } from '../globe/orbit'
import type { BodyView } from '../panels/useNow'
import { useNow } from '../panels/useNow'
import { useInsets } from '../state/layout'
import { type BlockView, useApp } from '../state/store'
import { TileLoader } from '../terrain/loader'
import { TILES_BASE, loadTileset } from '../terrain/TerrainView'
import { type Tileset, polarXY } from '../terrain/tileset'
import { useEphemeris, useMasks } from '../time/hooks'
import { IconGlobe, IconInfo, IconMinus, IconMountain, IconPlus } from '../ui/icons'
import { Popover } from '../ui/Popover'
import { ToolPortal } from '../ui/ToolSlot'
import { useHud } from './useStory'
import { voxelBodyMaterial } from './voxelMaterial'
import {
  type Blocks,
  GROUND_EXAGGERATION,
  type GroundBlocks,
  earthBlocks,
  gridHeightBilinear,
  groundBlocks,
  moonBlocks,
  sampleGlobal,
  groundTopNear,
  sampleGround,
  skyVector,
  sunBlocks,
} from './voxels'

const FOV = 40
/**
 * Looking up in the ground view: the camera tips up by at most this many degrees, and its field of view widens by
 * one degree per degree of tilt, so the ground stays in the picture while a body high in the (stretched) sky comes in.
 */
const MAX_TILT = 40
/** The ground camera stays at least this many cubes above the columns under it. */
const CAMERA_CLEARANCE = 2.5
/** Cubes per side of the ground world (odd, so the chosen place is the centre cube). */
const GROUND_N = 161
/** Cubes across the whole Moon, and how much its relief is stretched so it shows at that size. */
const MOON_SIZE = 180
const MOON_EXAGGERATION = 12
const MOON_R = MOON_SIZE / 2 - 1
/** The Sun and Earth balls stand beyond the edge of the ground world and beyond the farthest camera. */
const SKY_DIST = 420
/**
 * Sizes on screen. The Earth looks 3.6 times as wide as the Sun from the Moon (1.9° against 0.53°); both are drawn
 * larger than that so their cubes show, keeping that ratio.
 */
const SUN_D = 30
const EARTH_D = SUN_D * 3.6
/** Cubes across the Sun and the Earth balls. */
const SUN_CELLS = 14
const EARTH_CELLS = 36
const SIDEREAL_DAY_MS = 86_164_091
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

/** Cell of the ground world away from the polar map, as the polar map's (the global grid's 7.6 km pixels are interpolated). */
const GLOBAL_CELL_M = 960

export interface GroundWorld {
  blocks: GroundBlocks | null
  loading: boolean
  /** Which heights the cubes come from: the 960 m polar map, or the 7.6 km global grid (anywhere else). */
  source: 'polar' | 'global' | null
  cellM: number
}

/**
 * The ground world for the selection, anywhere on the Moon: from the LOLA polar map (960 m) where it reaches, and
 * from the global LOLA grid (7.6 km pixels, sampled every 960 m) everywhere else.
 */
function useGroundBlocks(): GroundWorld {
  const ll = useSelectedLatLon()
  const polar = !!ll && ll[0] <= -60
  const tileset = useQuery({ queryKey: ['static', 'tileset'], queryFn: loadTileset, enabled: polar, ...forever })
  const overview = useQuery({
    queryKey: ['static', 'overview-heights'],
    queryFn: () => loadOverview(tileset.data!),
    enabled: polar && !!tileset.data,
    ...forever,
  })
  const globe = useQuery({ queryKey: ['static', 'globe'], queryFn: loadGlobe, ...forever })
  return useMemo(() => {
    const none: GroundWorld = { blocks: null, loading: false, source: null, cellM: 0 }
    if (!ll) return { ...none, loading: true }
    if (polar && tileset.data && overview.data) {
      const ts = tileset.data
      const ov = overview.data
      const cellM = (ts.extentM[2] - ts.extentM[0]) / (ov.samples - 1)
      const grid = sampleGround((x, y) => overviewHeight(ts, ov, x, y), polarXY, ll[0], ll[1], GROUND_N, cellM, 1 / GROUND_EXAGGERATION)
      if (grid) return { blocks: groundBlocks(grid), loading: false, source: 'polar', cellM }
    } else if (polar && !tileset.isError && !overview.isError) return { ...none, loading: true }
    // the global grid: anywhere the polar map does not reach (or could not load)
    if (!globe.data) return { ...none, loading: !globe.isError }
    const g = globe.data
    const grid = sampleGlobal((la, lo) => gridHeightBilinear(g.heights, g.meta.width, g.meta.height, la, lo), ll[0], ll[1], GROUND_N, GLOBAL_CELL_M, 1 / GROUND_EXAGGERATION)
    return { blocks: groundBlocks(grid), loading: false, source: 'global', cellM: GLOBAL_CELL_M }
  }, [ll, polar, tileset.data, tileset.isError, overview.data, overview.isError, globe.data, globe.isError])
}

/** Camera that circles a target: yaw is the azimuth it looks from (clockwise from north), pitch its height. */
class BlockCam {
  yaw: number
  pitch: number
  dist: number
  /** Degrees the camera looks up from the line to its target (0 unless `maxTilt` allows it). */
  tilt = 0
  goal: { yaw: number; pitch: number; dist: number; tilt: number }
  readonly limits: { pitch: [number, number]; dist: [number, number] }
  readonly maxTilt: number
  constructor(yaw: number, pitch: number, dist: number, limits: { pitch: [number, number]; dist: [number, number] }, maxTilt = 0) {
    this.limits = limits
    this.maxTilt = maxTilt
    this.yaw = yaw
    this.pitch = pitch
    this.dist = dist
    this.goal = { yaw, pitch, dist, tilt: 0 }
  }
  /** Dragging up lowers the camera and, once it is as low as it goes, tips it up toward the sky; dragging down undoes that first. */
  drag(dx: number, dy: number) {
    this.goal.yaw -= dx * 0.3
    let d = dy * 0.25
    if (d > 0 && this.goal.tilt > 0) {
      const back = Math.min(d, this.goal.tilt)
      this.goal.tilt -= back
      d -= back
    }
    const pitch = Math.max(this.limits.pitch[0], Math.min(this.limits.pitch[1], this.goal.pitch + d))
    const left = this.goal.pitch + d - pitch
    this.goal.pitch = pitch
    if (left < 0) this.goal.tilt = Math.min(this.maxTilt, this.goal.tilt - left)
  }
  /**
   * Tips the camera so a body `elDeg` above the horizontal (as drawn, seen from the target) at `skyDist` sits in the
   * upper half of the picture once the camera faces it. With the field of view FOV + tilt, a body e degrees above the
   * camera's horizontal is half-way up the top half when e + pitch − tilt = (FOV + tilt) / 4.
   */
  lookUpTo(elDeg: number, skyDist: number) {
    const e = (elDeg * Math.PI) / 180
    const p = (this.goal.pitch * Math.PI) / 180
    const fromCam = (Math.atan2(skyDist * Math.sin(e) - this.goal.dist * Math.sin(p), skyDist * Math.cos(e) + this.goal.dist * Math.cos(p)) * 180) / Math.PI
    this.goal.tilt = Math.max(0, Math.min(this.maxTilt, (fromCam + this.goal.pitch - FOV / 4) / 1.25))
  }
  zoom(f: number) {
    this.goal.dist = Math.max(this.limits.dist[0], Math.min(this.limits.dist[1], this.goal.dist * f))
  }
  step(dt: number, instant: boolean) {
    const k = instant ? 1 : 1 - Math.exp(-dt * 8)
    this.yaw += (this.goal.yaw - this.yaw) * k
    this.pitch += (this.goal.pitch - this.pitch) * k
    this.dist += (this.goal.dist - this.dist) * k
    this.tilt += (this.goal.tilt - this.tilt) * k
  }
}

/** The panels' insets, plus the story card when it sits on the left: the world is centred in what is left. */
function freeInsets(w: number) {
  const ins = { ...useInsets.getState() }
  const card = typeof document === 'undefined' ? null : document.querySelector('.blk-story')?.getBoundingClientRect()
  if (card && card.width > 0 && card.left < w / 2 && card.width < w * 0.6) ins.left = Math.max(ins.left, card.right)
  return ins
}

/** Puts the camera at `pos` looking at `target`, with the target in the middle of the space the panels leave free. */
function aimCamera(cam: THREE.PerspectiveCamera, pos: [number, number, number], target: THREE.Vector3, far: number, w: number, h: number, tiltDeg = 0) {
  cam.position.set(pos[0], pos[1], pos[2])
  cam.up.set(0, 1, 0)
  cam.lookAt(target)
  cam.rotateX((tiltDeg * Math.PI) / 180)
  cam.fov = FOV + tiltDeg
  cam.near = 0.5
  cam.far = far
  const ins = freeInsets(w)
  const cx = ins.left + (w - ins.left - ins.right) / 2
  const cy = ins.top + (h - ins.top - ins.bottom) / 2
  cam.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h)
  cam.updateProjectionMatrix()
}

/** One InstancedMesh of unit cubes; matrices are written by `buildIn`. */
function useCubes(b: Blocks, material: 'lambert' | 'body' | 'glow' = 'lambert'): THREE.InstancedMesh {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat =
      material === 'body'
        ? voxelBodyMaterial()
        : material === 'glow'
          ? new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
          : new THREE.MeshLambertMaterial({ color: 0xffffff })
    const m = new THREE.InstancedMesh(geo, mat, b.count)
    m.instanceColor = new THREE.InstancedBufferAttribute(b.rgb, 3)
    m.frustumCulled = false
    m.castShadow = material === 'lambert'
    m.receiveShadow = material === 'lambert'
    // bodies that do not build in are placed at once
    if (material !== 'lambert' || b.delay.every((d) => d === 0)) buildIn(m, b, 1e9, [0, 0, 0])
    return m
  }, [b, material])
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

/** A soft round glow behind the Sun ball (a canvas gradient on a sprite). */
function useGlow(): THREE.SpriteMaterial {
  const mat = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
      grad.addColorStop(0, 'rgba(255, 210, 122, 0.55)')
      grad.addColorStop(1, 'rgba(255, 181, 71, 0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
    }
    const tex = new THREE.CanvasTexture(c)
    return new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  }, [])
  useEffect(() => () => {
    mat.map?.dispose()
    mat.dispose()
  }, [mat])
  return mat
}

/** The Sun as a ball of glowing cubes, `diameter` scene units wide, with a glow around it. */
function SunBall({ diameter, ballRef }: { diameter: number; ballRef: { current: THREE.Group | null } }) {
  const blocks = useMemo(() => sunBlocks(SUN_CELLS), [])
  const cubes = useCubes(blocks, 'glow')
  const glow = useGlow()
  const cell = diameter / (2 * blocks.radius + 1)
  return (
    <group ref={ballRef}>
      <primitive object={cubes} scale={cell} />
      <sprite material={glow} scale={diameter * 3.2} />
    </group>
  )
}

/**
 * The Earth as a ball of cubes, lit by the Sun so it shows its real phase from the Moon, turning once a sidereal
 * day. Its continents are hand-drawn (voxels.ts, LAND); the phase is computed.
 */
function EarthBall({ diameter, ballRef, sunDir }: { diameter: number; ballRef: { current: THREE.Group | null }; sunDir: () => THREE.Vector3 | null }) {
  const blocks = useMemo(() => earthBlocks(EARTH_CELLS), [])
  const cubes = useCubes(blocks, 'body')
  const cell = diameter / (2 * blocks.radius + 1)
  const spin = useRef<THREE.Group>(null)
  useFrame(() => {
    const d = sunDir()
    if (d) (cubes.material as THREE.ShaderMaterial).uniforms.uSun.value.copy(d)
    if (spin.current) spin.current.rotation.y = ((useApp.getState().tMs % SIDEREAL_DAY_MS) / SIDEREAL_DAY_MS) * Math.PI * 2
  })
  return (
    <group ref={ballRef}>
      <group ref={spin}>
        <primitive object={cubes} scale={cell} />
      </group>
    </group>
  )
}

// --------------------------------------------------------------------------------------------- ground world

/** True when a ball is drawn inside the part of the window the panels leave free. */
function inFreeArea(obj: THREE.Object3D | null, camera: THREE.Camera, w: number, h: number, tmp: THREE.Vector3): boolean {
  if (!obj?.visible) return false
  obj.getWorldPosition(tmp).project(camera)
  if (tmp.z > 1) return false
  const x = ((tmp.x + 1) / 2) * w
  const y = ((1 - tmp.y) / 2) * h
  const ins = useInsets.getState()
  if (!(x > ins.left && x < w - ins.right && y > ins.top && y < h - ins.bottom)) return false
  // the story card floats over the map too
  const card = typeof document === 'undefined' ? null : document.querySelector('.blk-story')?.getBoundingClientRect()
  return !card || !(x > card.left && x < card.right && y > card.top && y < card.bottom)
}

function GroundScene({ blocks, sun, earth, eclipse, cam }: { blocks: GroundBlocks; sun: BodyView | null; earth: BodyView | null; eclipse: number; cam: BlockCam }) {
  const { camera, size } = useThree()
  const cubes = useCubes(blocks)
  useBuildIn(cubes, blocks, [0, 30, 0])
  const light = useRef<THREE.DirectionalLight>(null)
  const earthLight = useRef<THREE.DirectionalLight>(null)
  const sunBall = useRef<THREE.Group>(null)
  const earthBall = useRef<THREE.Group>(null)
  // the Sun's true direction (not stretched) lights the Earth's phase
  const sunTrue = useMemo(() => new THREE.Vector3(), [])
  const sunDir = () => (sun ? sunTrue.set(...skyVector(sun.az, sun.el, 1)) : null)
  const top = blocks.centreTop
  const target = useMemo(() => new THREE.Vector3(0, top, 0), [top])
  const instant = useRef(true)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => () => useHud.setState({ sunOnScreen: false, earthOnScreen: false }), [])

  useEffect(() => {
    const l = light.current
    if (!l) return
    l.shadow.mapSize.set(2048, 2048)
    const half = GROUND_N / 2 + 6
    Object.assign(l.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 1400 })
    l.shadow.camera.updateProjectionMatrix()
    l.shadow.bias = -0.0008
    l.shadow.normalBias = 0.03
  }, [])

  useFrame((_, dt) => {
    cam.step(dt, reducedMotion() || instant.current)
    instant.current = false
    const yaw = (cam.yaw * Math.PI) / 180
    const pitch = (cam.pitch * Math.PI) / 180
    const cx = target.x + Math.sin(yaw) * Math.cos(pitch) * cam.dist
    const cz = target.z - Math.cos(yaw) * Math.cos(pitch) * cam.dist
    // a low camera over a hill or a crater wall rides over it rather than going inside the cubes
    const groundTop = groundTopNear(blocks.columns, cx, cz)
    aimCamera(
      camera as THREE.PerspectiveCamera,
      [cx, Math.max(target.y + Math.sin(pitch) * cam.dist, groundTop === null ? -Infinity : groundTop + CAMERA_CLEARANCE), cz],
      target,
      2000,
      size.width,
      size.height,
      cam.tilt,
    )

    if (sun && light.current && sunBall.current) {
      const d = skyVector(sun.az, sun.el)
      light.current.position.set(d[0] * 600, top + d[1] * 600, d[2] * 600)
      light.current.target.position.set(0, top, 0)
      light.current.target.updateMatrixWorld()
      // fades out as the Sun sinks below the horizontal (stretched angles)
      const elS = Math.asin(d[1]) * (180 / Math.PI)
      // and when the Earth covers it (engine: 1 part of the disc, 2 all of it)
      const shade = eclipse === 2 ? 0.03 : eclipse === 1 ? 0.5 : 1
      light.current.intensity = 3.2 * shade * Math.max(0, Math.min(1, (elS + 4) / 4))
      sunBall.current.position.set(d[0] * SKY_DIST, top + d[1] * SKY_DIST, d[2] * SKY_DIST)
      sunBall.current.visible = elS > -6
    }
    if (earth && earthBall.current) {
      const d = skyVector(earth.az, earth.el)
      earthBall.current.position.set(d[0] * SKY_DIST, top + d[1] * SKY_DIST, d[2] * SKY_DIST)
      if (earthLight.current) {
        // an Earth that covers the Sun shows the Moon its night side
        earthLight.current.intensity = earth.fraction > 0 ? (eclipse === 2 ? 0.1 : 0.8) : 0
        // from the Earth's side, but never from below the ground (a low Earth still grazes the slopes facing it)
        earthLight.current.position.set(d[0] * 300, top + Math.max(d[1], 0.25) * 300, d[2] * 300)
        earthLight.current.target.position.set(0, top, 0)
        earthLight.current.target.updateMatrixWorld()
      }
    }
    // tell the story whether the Sun and the Earth are on screen (only when that changes)
    const hud = {
      sunOnScreen: inFreeArea(sunBall.current, camera, size.width, size.height, tmp),
      earthOnScreen: inFreeArea(earthBall.current, camera, size.width, size.height, tmp),
    }
    const was = useHud.getState()
    if (was.sunOnScreen !== hud.sunOnScreen || was.earthOnScreen !== hud.earthOnScreen) useHud.setState(hud)
  })

  return (
    <>
      <color attach="background" args={['#05060a']} />
      {/* a dim sky-above, ground-below fill so tops and sides of the cubes differ even with no light in the sky */}
      <hemisphereLight args={['#aab4cc', '#1a1c22', 0.7]} />
      {/* earthshine: sunlight reflected by the Earth, so the relief still reads during the long night */}
      <directionalLight ref={earthLight} color="#8fb8ff" intensity={0.75} />
      <directionalLight ref={light} castShadow color="#fff6e8" />
      <primitive object={cubes} />
      <Lander top={top} />
      <SunBall diameter={SUN_D} ballRef={sunBall} />
      <EarthBall diameter={EARTH_D} ballRef={earthBall} sunDir={sunDir} />
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

type Picker = (ndcX: number, ndcY: number) => [number, number] | null

function MoonScene({ blocks, cam, site, pickRef }: { blocks: Blocks & { radius: number }; cam: BlockCam; site: [number, number] | null; pickRef: { current: Picker | null } }) {
  const { camera, size } = useThree()
  const cubes = useCubes(blocks, 'body')
  const eph = useEphemeris().data
  const sunBall = useRef<THREE.Group>(null)
  const earthBall = useRef<THREE.Group>(null)
  const sun = useMemo(() => new THREE.Vector3(1, 0, 0), [])
  const instant = useRef(true)
  const origin = useMemo(() => new THREE.Vector3(), [])
  useBuildIn(cubes, blocks, [0, -20, 0])

  // a click on the Moon: the point where the view ray meets the sphere (relief ignored, a fraction of a degree)
  useEffect(() => {
    const ray = new THREE.Raycaster()
    pickRef.current = (x, y) => {
      ray.setFromCamera(new THREE.Vector2(x, y), camera)
      const o = ray.ray.origin
      const d = ray.ray.direction
      const hit = raySphere([o.x, o.y, o.z], [d.x, d.y, d.z], blocks.radius)
      return hit ? sceneToLatLon(hit) : null
    }
    return () => {
      pickRef.current = null
    }
  }, [camera, pickRef, blocks.radius])

  // the chosen place: a column of gold cubes standing out of the surface
  const marker = useMemo(() => {
    if (!site) return []
    const n = latLonToScene(site[0], site[1], 1)
    const len = Math.hypot(n[0], n[1], n[2])
    return [1, 2, 3, 4, 5, 6].map((k) => n.map((v) => (v / len) * (blocks.radius + k * 1.6)) as [number, number, number])
  }, [site, blocks.radius])

  useFrame((_, dt) => {
    cam.step(dt, reducedMotion() || instant.current)
    instant.current = false
    aimCamera(camera as THREE.PerspectiveCamera, latLonToScene(cam.pitch, cam.yaw, cam.dist), origin, 8000, size.width, size.height)
    const { tMs } = useApp.getState()
    if (eph?.table.covers(tMs)) {
      const p = eph.table.positions(tMs)
      sun.set(...meToScene(p[0], p[1], p[2])).normalize()
      ;(cubes.material as THREE.ShaderMaterial).uniforms.uSun.value.copy(sun)
      // real directions, not real distances: the Sun 20 and the Earth 12 Moon radii out
      sunBall.current?.position.copy(sun).multiplyScalar(MOON_R * 20)
      const e = meToScene(p[3], p[4], p[5])
      const el = Math.hypot(e[0], e[1], e[2])
      earthBall.current?.position.set((e[0] / el) * MOON_R * 12, (e[1] / el) * MOON_R * 12, (e[2] / el) * MOON_R * 12)
    }
  })

  return (
    <>
      <color attach="background" args={['#05060a']} />
      <primitive object={cubes} />
      {/* as seen from the Moon's centre: Sun about 2°, Earth about 7° (3.6 times wider, as in the real sky) */}
      <SunBall diameter={MOON_R * 20 * 0.035} ballRef={sunBall} />
      <EarthBall diameter={MOON_R * 12 * 0.035 * 3.6} ballRef={earthBall} sunDir={() => sun} />
      {marker.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[1.6, 1.6, 1.6]} />
          <meshBasicMaterial color="#ffb547" toneMapped={false} />
        </mesh>
      ))}
      <Stars radius={MOON_R * 40} />
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
  const showGround = view === 'ground'
  const sunAz = now?.sun.az ?? 0

  // a new camera for each world and each place, looking across the place toward the Sun
  const groundKey = `${ll?.[0]},${ll?.[1]}`
  const groundCam = useMemo(
    () => new BlockCam(sunAz + 180, 16, 85, { pitch: [2, 85], dist: [6, 260] }, MAX_TILT),
    // the Sun's azimuth only sets the first view of each place
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groundKey],
  )
  // the story can ask the ground camera to look from a given azimuth, and to tip up to a body in the sky
  useEffect(() => {
    const tip = (el: number | null) => {
      if (el === null) groundCam.goal.tilt = 0
      else groundCam.lookUpTo(Math.asin(skyVector(0, el)[1]) * (180 / Math.PI), SKY_DIST)
    }
    // a camera made after the request (a new place) still gets it
    tip(useHud.getState().lookEl)
    return useHud.subscribe((h, was) => {
      if (h.lookSeq === was.lookSeq) return
      if (h.lookFromAz !== null) groundCam.yaw = groundCam.goal.yaw = h.lookFromAz
      tip(h.lookEl)
    })
  }, [groundCam])
  const [moonCam] = useState(() => new BlockCam(ll?.[1] ?? 0, -50, MOON_R * 4.2, { pitch: [-85, 85], dist: [MOON_R * 1.6, MOON_R * 9] }))
  const cam = showGround ? groundCam : moonCam
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const pickRef = useRef<Picker | null>(null)
  const clicked = useRef(false)

  // a place picked in the panels turns the Moon toward it (a click on the Moon is already in view)
  useEffect(() => {
    if (!ll) return
    if (clicked.current) clicked.current = false
    else moonCam.goal.yaw = ll[1]
  }, [ll, moonCam])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    cam.drag(dx, dy)
    d.x = e.clientX
    d.y = e.clientY
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved || showGround || !pickRef.current) return
    // a click (not a drag) on the Moon chooses that spot
    const r = e.currentTarget.getBoundingClientRect()
    const ll2 = pickRef.current(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
    if (!ll2) return
    clicked.current = true
    useApp.getState().select({ kind: 'point', lat: Math.round(ll2[0] * 1000) / 1000, lon: Math.round(ll2[1] * 1000) / 1000 })
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
        : 'The LOLA heights could not be loaded.'
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
              <GroundScene blocks={ground.blocks} sun={now?.sun ?? null} earth={now?.earth ?? null} eclipse={now?.eclipse ?? 0} cam={groundCam} />
            ) : moon ? (
              <MoonScene blocks={moon} cam={moonCam} site={ll} pickRef={pickRef} />
            ) : null}
          </Canvas>
        )}
        <p id="block-help" className="sr-only">
          Arrow keys turn the view, plus and minus zoom. On the whole Moon, a click chooses that spot. The panels say, in words, whether the Sun and the
          Earth can be seen from the chosen place.
        </p>
      </div>
      <ToolPortal>
        <div className="map-controls block-controls" role="group" aria-label="Block world view">
          <div className="blk-seg" role="radiogroup" aria-label="What to show">
            <button type="button" role="radio" aria-checked={!showGround} onClick={() => pick('moon')}>
              <IconGlobe size={18} /> Whole Moon
            </button>
            <button type="button" role="radio" aria-checked={showGround} onClick={() => pick('ground')}>
              <IconMountain size={18} /> Stand here
            </button>
          </div>
          <div className="tool-group">
            <button type="button" onClick={() => cam.zoom(0.75)} aria-label="Zoom in" title="Zoom in (+)">
              <IconPlus />
            </button>
            <button type="button" onClick={() => cam.zoom(1 / 0.75)} aria-label="Zoom out" title="Zoom out (−)">
              <IconMinus />
            </button>
          </div>
          <Popover label="What am I looking at?" button={<IconInfo size={18} />} buttonClass="tool-btn" align="left">
            <p className="block-about">
              {showGround
                ? `Each cube is ${Math.round(ground.cellM)} m wide and ${Math.round(ground.cellM / GROUND_EXAGGERATION)} m tall: heights and sky angles are both stretched ×${GROUND_EXAGGERATION}, so the shadows fall as on the real ground. Heights: ${ground.source === 'global' ? 'the global LOLA grid (NASA LRO), whose 7.6 km pixels smooth out small hills' : 'the LOLA polar map (NASA PGDA)'}. When the Earth is up, a faint blue light comes from it (earthshine). Sun and Earth: where the engine puts them, drawn larger than life.`
                : `Global LOLA heights (NASA LRO), relief stretched ×${MOON_EXAGGERATION}, lit by the Sun at the chosen time. The gold column is your place; click anywhere to choose a spot of your own. Sun and Earth: real directions, not real distances.`}
            </p>
            <p className="block-about">Drag to turn the view, scroll or use + and − to zoom. The answers in the panels come from the engine, not from the cubes.</p>
          </Popover>
        </div>
      </ToolPortal>
    </>
  )
}
