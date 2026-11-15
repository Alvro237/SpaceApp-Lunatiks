/**
 * The map: a top-down view of the south pole that tilts into 3D relief over the same tiles (plan: "Vista
 * cenital y 3D son el mismo motor"). Keyboard: arrows move, + and − zoom, T tilts, Q and E rotate, R resets.
 * Every site on the map is also a real button, and everything the map shows is also given as text in the
 * panels, so the map is never the only way to reach information.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ToolPortal } from '../ui/ToolSlot'
import { useHorizonTransition } from '../state/horizon'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent, useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { type MarkerStyle, useApp } from '../state/store'
import { type AreaRaster, useAreas } from '../state/areas'
import { MarkerSet } from '../map/markerSet'
import { usePlaceStyles } from '../state/placeStyle'
import { type MapSite, useMapSites } from '../map/useMapSites'
import { useInsets } from '../state/layout'
import { SUN_R_KM } from '../time/engine'
import { useEphemeris, useMasks } from '../time/hooks'
import { CameraRig, FOV_DEG, TILT_3D } from './cameraRig'
import { Craters } from './Craters'
import { type LayerMode, type Quality, TerrainEngine } from './engine'
import { type Exaggeration, LayersControl, LegendChip } from './Legend'
import { IconCube, IconFit, IconGlobe, IconMinus, IconPlus } from '../ui/icons'
import { terrainRegistry } from './registry'
import { type Tileset, inExtent, polarLatLon, polarXY, scaleFactor } from './tileset'

export const TILES_BASE = `${import.meta.env.BASE_URL}tiles/`

export async function loadTileset(): Promise<Tileset> {
  const res = await fetch(`${TILES_BASE}tileset.json`)
  if (!res.ok) throw new Error(`tileset.json: HTTP ${res.status}`)
  return (await res.json()) as Tileset
}

/**
 * Adaptive quality. The frame rate is judged over windows of WINDOW_S of continuous drawing: below SLOW_FPS the
 * quality goes down a step (coarser tiles and a pixel ratio of at most 1.5). After
 * GOOD_WINDOWS fast windows in a row it goes back up, once per visit to the map, so a slow start (shaders
 * compiling, the first tiles decoding) does not leave a fast machine on a soft map, and a machine at its limit
 * does not swing between the two. Nothing is judged in the first GRACE_S.
 */
const STEPS: Quality[] = ['reduced', 'standard']
const WINDOW_S = 2
const SLOW_FPS = 45
const FAST_FPS = 55
const GOOD_WINDOWS = 5
const GRACE_S = 3
/** With nothing changing, a frame is still drawn this often (s), in case a change went uncounted. */
const IDLE_REDRAW_S = 0.5

/** A second click within this time (ms) is a double click: the first one waits that long before it marks a point. */
const DOUBLE_CLICK_MS = 260
/** A double click comes this much closer (the distance to the ground is multiplied by it). */
const DOUBLE_CLICK_ZOOM = 0.4

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function TerrainView() {
  const tileset = useQuery({ queryKey: ['static', 'tileset'], queryFn: loadTileset, staleTime: Infinity, retry: 1 })
  if (tileset.isError) {
    return (
      <div className="map-view map-empty" role="status">
        <p>
          Terrain tiles not built: run <code>npm run tiles</code> in <code>web/</code>.
        </p>
      </div>
    )
  }
  if (!tileset.data) {
    return (
      <div className="map-view">
        <p className="map-loading" role="status">
          Loading LOLA terrain…
        </p>
      </div>
    )
  }
  return <MapView tileset={tileset.data} />
}

function MapView({ tileset }: { tileset: Tileset }) {
  const sites = useMapSites()
  const markerStyle = useApp((s) => s.markerStyle)
  const [rig] = useState(() => new CameraRig(tileset))
  const drag = useRef<{ x: number; y: number; moved: boolean; rotate: boolean } | null>(null)
  /** A click on the terrain waiting to see whether a second one follows (a double click). */
  const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (pendingClick.current && clearTimeout(pendingClick.current)), [])
  const [stats, setStats] = useState('')
  const [craterError, setCraterError] = useState<unknown>(null)
  const [exaggeration, setExaggeration] = useState<Exaggeration>(2)
  const showCraters = useApp((s) => s.craters)
  const select = useApp((s) => s.select)
  const openMenu = usePlaceStyles((s) => s.openMenu)
  const view = useApp((s) => s.view)
  const set = useApp((s) => s.set)
  const mode = useApp((s) => s.mode)
  // paused while the horizon view covers the map
  // paused (no frames drawn) while the horizon view or Learn mode covers the map; it keeps its camera and tiles
  const underHorizon = useHorizonTransition((s) => s.phase === 'horizon')
  const underBlocks = useApp((s) => s.blocks)
  const covered = underHorizon || underBlocks

  useEffect(() => rig.setTilt(view === '3d' ? TILT_3D : 0), [rig, view])

  // Zooming out past the whole pole goes back to the globe.
  const zoom = (factor: number) => {
    rig.zoom(factor)
    if (factor > 1 && rig.goal.dist > rig.homeDist * 1.6) set({ scale: 'globe' })
  }

  const toggleView = () => set({ view: view === '3d' ? '2d' : '3d' })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const h = e.currentTarget.clientHeight || 600
    const step = h * 0.1
    const keys: Record<string, () => void> = {
      ArrowLeft: () => rig.pan(step, 0, h),
      ArrowRight: () => rig.pan(-step, 0, h),
      ArrowUp: () => rig.pan(0, step, h),
      ArrowDown: () => rig.pan(0, -step, h),
      '+': () => zoom(0.7),
      '=': () => zoom(0.7),
      '-': () => zoom(1 / 0.7),
      t: toggleView,
      T: toggleView,
      q: () => rig.rotate(-Math.PI / 12),
      e: () => rig.rotate(Math.PI / 12),
      r: () => rig.reset(),
    }
    const fn = keys[e.key]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }

  // Pointer: drag to pan, shift- or right-drag to rotate and tilt, wheel to zoom, click to pick a point,
  // right click (without dragging) on a place for its menu (rename, pointer colour, remove).
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, select, input, a')) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false, rotate: e.button === 2 || e.shiftKey }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.rotate) rig.rotate(-dx * 0.005, dy * 0.005, true)
    else rig.pan(dx, dy, e.currentTarget.clientHeight, true)
    d.x = e.clientX
    d.y = e.clientY
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.button === 2 && !d.moved) {
      const hit = rig.markerAt(e.clientX - rect.left, e.clientY - rect.top) as MapSite | null
      if (hit) openMenu({ sel: hit.sel, name: hit.name, x: e.clientX, y: e.clientY, returnTo: e.currentTarget })
      return
    }
    if (d.moved || d.rotate) return
    // a place drawn on the map wins; otherwise (study mode) the terrain point under the pointer
    const site = rig.markerAt(e.clientX - rect.left, e.clientY - rect.top) as MapSite | null
    // mission mode: a click places the centre of the area search (on a site or anywhere on the terrain)
    if (mode === 'mission' && site) {
      useAreas.getState().set({ center: { lat: Math.round(site.lat * 1e4) / 1e4, lon: Math.round(site.lon * 1e4) / 1e4 } })
      return select(site.sel)
    }
    if (site) return select(site.sel)
    if (mode !== 'study' && mode !== 'mission') return
    const ll = rig.pick((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    if (!ll) return
    const lat = Math.round(ll[0] * 1e4) / 1e4
    const lon = Math.round(ll[1] * 1e4) / 1e4
    // a click on the terrain waits to see whether it is the first half of a double click (which only comes closer)
    if (pendingClick.current) clearTimeout(pendingClick.current)
    pendingClick.current = setTimeout(() => {
      pendingClick.current = null
      if (mode === 'mission') useAreas.getState().set({ center: { lat, lon } })
      else select({ kind: 'point', lat, lon })
    }, DOUBLE_CLICK_MS)
  }
  // a double click comes closer to the place under the pointer
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, select, input, a')) return
    if (pendingClick.current) clearTimeout(pendingClick.current)
    pendingClick.current = null
    const rect = e.currentTarget.getBoundingClientRect()
    const ll = rig.pick((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    if (ll) rig.flyTo(ll[0], ll[1], rig.goal.dist * DOUBLE_CLICK_ZOOM)
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>) => zoom(Math.exp(e.deltaY * 0.0012))

  return (
    <>
      <div
        className="map-view"
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label="South polar terrain map"
        aria-describedby="map-help"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Multisampling only where a CSS pixel is one device pixel. On a denser screen the edges are already drawn
            at twice the detail and it made no visible difference, while a frame of the tilted map took 7.2 ms of an
            Apple M2 with it and 4.2 ms without (2880 x 1800, time playing; measured 2026-11-14). */}
        <Canvas camera={{ fov: FOV_DEG, near: 1, far: 10_000, position: [0, 1500, 0] }} dpr={[1, 2]} flat linear gl={{ antialias: window.devicePixelRatio < 2 }} aria-hidden="true" frameloop={covered ? 'never' : 'always'}>
          <Driver
            tileset={tileset}
            rig={rig}
            sites={sites}
            markerStyle={markerStyle}
            exaggeration={exaggeration}
            onStats={setStats}
            craters={showCraters}
            onCraterStatus={setCraterError}
          />
        </Canvas>
        <p id="map-help" className="sr-only">
          Arrow keys move, plus and minus zoom, T tilts to 3D, Q and E rotate, R shows the whole pole, Space plays. A
          double click comes closer to the place under the pointer.
          {mode === 'study' && ' Activate a point on the terrain to analyse it.'}
          {mode === 'mission' && ' Activate a point on the terrain to centre the area search there; the areas found are listed in the Mission filters panel.'}{' '}
          Right click a place for its options: rename, pointer colour, remove. Sites are listed, with the same information, in the panels.
        </p>
      </div>
      <ToolPortal>
      <div className="map-controls" role="group" aria-label="Map view">
        <div className="tool-group">
          <button type="button" onClick={() => zoom(0.6)} aria-label="Zoom in" title="Zoom in (+)">
            <IconPlus />
          </button>
          <button type="button" onClick={() => zoom(1 / 0.6)} aria-label="Zoom out" title="Zoom out (−)">
            <IconMinus />
          </button>
        </div>
        <button type="button" onClick={() => rig.reset()} aria-label="Whole pole" title="Whole pole (R)">
          <IconFit />
        </button>
        <button type="button" aria-pressed={view === '3d'} onClick={toggleView} aria-label="3D tilt" title="3D tilt (T)">
          <IconCube />
        </button>
        <button type="button" onClick={() => set({ scale: 'globe' })} aria-label="Globe" title="The whole Moon">
          <IconGlobe />
        </button>
        <LayersControl tileset={tileset} exaggeration={exaggeration} onExaggeration={setExaggeration} craterError={showCraters ? craterError : null} />
      </div>
      </ToolPortal>
      <LegendChip tileset={tileset} />
      {stats && import.meta.env.DEV && <p className="map-stats">{stats}</p>}
    </>
  )
}

interface DriverProps {
  tileset: Tileset
  rig: CameraRig
  sites: MapSite[]
  markerStyle: MarkerStyle
  exaggeration: number
  onStats: (s: string) => void
  craters: boolean
  onCraterStatus: (e: unknown) => void
}

/** Runs inside the Canvas: camera, Sun, shadows, tile selection and marker placement, once per frame. */
function Driver({ tileset, rig, sites, markerStyle, exaggeration, onStats, craters, onCraterStatus }: DriverProps) {
  const { gl, camera, size, scene, setDpr, viewport } = useThree()
  const eph = useEphemeris().data
  const [engine] = useState(() => new TerrainEngine(tileset, TILES_BASE, gl.extensions.has('OES_texture_float_linear')))
  const [reduced] = useState(prefersReducedMotion)
  /** The pixel ratio the canvas started with (its `dpr` range applied to the screen's). */
  const [fullDpr] = useState(() => viewport.dpr)
  const perf = useRef({ frames: 0, time: 0, age: 0, step: 1, good: 0, recovered: false, statsAt: 0, fps: null as number | null })
  /** What the last drawn frame showed: camera, canvas size and the change counters. A frame is drawn when it differs. */
  const drawn = useRef({ sig: new Float64Array(28), at: Infinity, was: false })
  /** Changes to the scene made outside the engine (places, crater outlines). */
  const sceneVersion = useRef(0)
  const touch = useCallback(() => {
    sceneVersion.current++
  }, [])
  const masks = useMasks().data
  const [markersSet] = useState(() => new MarkerSet())
  /** The camera where the current motion ends (the rig's goal): what the engine loads ahead for. */
  const [goalCam] = useState(() => new THREE.PerspectiveCamera())
  const [heightsReady, setHeightsReady] = useState(false)

  useEffect(() => {
    scene.add(engine.group)
    engine.setQuality(STEPS[perf.current.step])
    engine.prepare(gl, camera)
    terrainRegistry.engine = engine
    if (import.meta.env.DEV) (window as unknown as { __terrain?: TerrainEngine }).__terrain = engine // e2e and debugging
    engine.loadOverview().then(() => setHeightsReady(true), () => {})
    scene.add(markersSet.group)
    return () => {
      scene.remove(markersSet.group)
      markersSet.dispose()
      scene.remove(engine.group)
      if (terrainRegistry.engine === engine) terrainRegistry.engine = null
      engine.dispose()
    }
  }, [engine, scene, markersSet, gl, camera])

  // Places drawn in the scene: rebuilt when the list, the style, the relief or the heights change.
  useEffect(() => {
    const lift = (x: number, y: number) => (((engine.heightAt(x, y) ?? 0) + 40) / 1000) * exaggeration
    markersSet.set(
      sites.filter((s) => inExtent(tileset, s.lat, s.lon)),
      markerStyle,
      {
        anchor: (s) => {
          const [x, y] = polarXY(s.lat, s.lon)
          return new THREE.Vector3(x / 1000, lift(x, y), -y / 1000)
        },
        ring: (s) => {
          if (!s.diameterKm) return null
          const [cx, cy] = polarXY(s.lat, s.lon)
          const r = ((s.diameterKm * 1000) / 2) * scaleFactor(s.lat)
          const n = 96
          const out = new Float32Array((n + 1) * 3)
          for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2
            const x = cx + r * Math.cos(a)
            const y = cy + r * Math.sin(a)
            out.set([x / 1000, lift(x, y), -y / 1000], i * 3)
          }
          return out
        },
      },
    )
    rig.setMarkerPicker((px, py) => markersSet.pick(px, py, camera as THREE.PerspectiveCamera, size.width, size.height))
    touch()
  }, [markersSet, sites, markerStyle, exaggeration, heightsReady, engine, tileset, camera, size, rig, touch])

  useEffect(() => engine.setExaggeration(exaggeration), [engine, exaggeration])

  // Layer and lighting follow the store.
  useEffect(() => {
    let last: { layer: string; lighting: string } | null = null
    const apply = () => {
      const { layer, lighting } = useApp.getState()
      // the store changes every frame during playback: only a new layer or lighting needs the engine
      if (last && last.layer === layer && last.lighting === lighting) return
      last = { layer, lighting }
      let mode: LayerMode = { kind: 'none' }
      if (layer === 'elevation') mode = { kind: 'elevation' }
      else if (layer !== 'none' && tileset.layers[layer]) {
        const m = tileset.layers[layer]
        mode = { kind: 'data', id: layer, colormap: m.colormap, levels: m.levels }
      }
      engine.setLayer(mode)
      engine.setLighting(lighting === 'sun')
    }
    apply()
    return useApp.subscribe(apply)
  }, [engine, tileset])

  // Fly to a place when the user picks one or opens a shared link (focusSeq changes).
  useEffect(() => {
    let seq = -1
    const fly = () => {
      const s = useApp.getState()
      // focusSeq 0: nothing picked yet, so the first view stays on the whole pole
      if (s.focusSeq === seq || s.focusSeq === 0) return
      seq = s.focusSeq
      // while comparing, the view stays put so the numbered places accumulate on screen
      if (s.compareMode) return
      const sel = s.selection
      let ll: [number, number] | null = null
      if (sel.kind === 'point') ll = [sel.lat, sel.lon]
      else {
        const site = masks?.site(sel.id)
        if (site) ll = [site.lat, site.lon]
      }
      if (ll && inExtent(tileset, ll[0], ll[1])) rig.flyTo(ll[0], ll[1])
    }
    fly()
    return useApp.subscribe(fly)
  }, [masks, rig, tileset])

  // Opening the horizon view: fly down to the place, facing where the view opens; back again when it closes.
  useEffect(() => {
    let before: ReturnType<CameraRig['approach']> | null = null
    let phase = useHorizonTransition.getState().phase
    return useHorizonTransition.subscribe((t) => {
      if (t.phase === phase) return
      phase = t.phase
      if (phase === 'diving') {
        const sel = useApp.getState().selection
        const site = sel.kind === 'site' ? masks?.site(sel.id) : null
        const ll = sel.kind === 'point' ? [sel.lat, sel.lon] : site ? [site.lat, site.lon] : null
        if (ll && inExtent(tileset, ll[0], ll[1])) before = rig.approach(ll[0], ll[1], t.yaw)
      } else if ((phase === 'returning' || phase === 'map') && before) {
        rig.restore(before)
        before = null
      }
    })
  }, [masks, rig, tileset])

  // Mission mode: paint the area search, draw the ring of the search region, fly where the panel asks.
  useEffect(() => {
    let painted: AreaRaster | null | undefined
    const apply = () => {
      const a = useAreas.getState()
      const mission = useApp.getState().mode === 'mission'
      const want = mission && a.show ? a.raster : null
      if (want !== painted) {
        engine.setAreas(want)
        painted = want
      }
      if (mission && a.center) {
        const [x, y] = polarXY(a.center.lat, a.center.lon)
        engine.setRegion(x, y, a.radiusKm * 1000)
      } else engine.setRegion(0, 0, 0)
    }
    apply()
    const offAreas = useAreas.subscribe(apply)
    const offApp = useApp.subscribe(apply)
    return () => {
      offAreas()
      offApp()
      engine.setAreas(null)
    }
  }, [engine])

  useEffect(() => {
    let seq = useAreas.getState().goTo?.seq ?? 0
    return useAreas.subscribe((a) => {
      if (!a.goTo || a.goTo.seq === seq) return
      seq = a.goTo.seq
      if (inExtent(tileset, a.goTo.lat, a.goTo.lon)) rig.frameAt(a.goTo.lat, a.goTo.lon, a.goTo.km)
    })
  }, [rig, tileset])

  // Open where the user clicked on the globe (a navigation target; the selection does not change).
  useEffect(() => {
    let seq = -1
    const go = () => {
      const e = useApp.getState().mapEntry
      if (!e || e.seq === seq) return
      seq = e.seq
      if (inExtent(tileset, e.lat, e.lon)) rig.flyTo(e.lat, e.lon, 450)
    }
    go()
    return useApp.subscribe(go)
  }, [rig, tileset])

  // Screen point → lat/lon: intersect the plane at the terrain height under the hit, refined twice.
  useEffect(() => {
    rig.setPicker((cx, cy) => {
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(cx * 2 - 1, -(cy * 2 - 1)), camera)
      let planeY = ((engine.heightAt(rig.now.tx * 1000, -rig.now.tz * 1000) ?? 0) / 1000) * exaggeration
      let hit: THREE.Vector3 | null = null
      for (let i = 0; i < 3; i++) {
        hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), new THREE.Vector3())
        if (!hit) return null
        planeY = ((engine.heightAt(hit.x * 1000, -hit.z * 1000) ?? 0) / 1000) * exaggeration
      }
      if (!hit) return null
      const [lat, lon] = polarLatLon(hit.x * 1000, -hit.z * 1000)
      return inExtent(tileset, lat, lon) ? [lat, lon] : null
    })
  }, [rig, camera, engine, exaggeration, tileset])

  useFrame((_, dt) => {
    const insets = useInsets.getState()
    rig.fitHome(size.width, size.height, insets)
    rig.step(dt, reduced)
    const cam = camera as THREE.PerspectiveCamera
    rig.apply(cam, ((engine.heightAt(rig.now.tx * 1000, -rig.now.tz * 1000) ?? 0) / 1000) * exaggeration, size.width, size.height, insets)

    // The Sun at the active instant (Moon-centre vector; its parallax across the map is below 0.001°).
    const { tMs, mastM, playing } = useApp.getState()
    if (eph?.table.covers(tMs)) {
      const p = eph.table.positions(tMs)
      const d = Math.hypot(p[0], p[1], p[2])
      engine.setSun([p[0] / d, p[1] / d, p[2] / d], THREE.MathUtils.radToDeg(Math.asin(SUN_R_KM / d)), mastM)
    }
    engine.renderShadows(gl, playing)
    goalCam.fov = cam.fov
    goalCam.aspect = cam.aspect
    rig.apply(goalCam, ((engine.heightAt(rig.goal.tx * 1000, -rig.goal.tz * 1000) ?? 0) / 1000) * exaggeration, size.width, size.height, insets, rig.goal)
    engine.update(cam, size.height, [rig.now.tx, rig.now.tz], goalCam, !rig.settled)

    markersSet.update(cam, size.width, size.height, true)

    // Draw only when the picture changed: the camera, the canvas, or anything the engine or the scene counted.
    // (This callback has a priority, so React Three Fiber leaves the drawing to it.) An idle map costs the GPU
    // two frames a second instead of sixty.
    const d = drawn.current
    const sig = d.sig
    let i = 0
    let changed = false
    const put = (v: number) => {
      if (sig[i] !== v) {
        sig[i] = v
        changed = true
      }
      i++
    }
    cam.updateMatrixWorld()
    for (const v of cam.matrixWorld.elements) put(v)
    // the projection has six free terms (field of view, aspect, depth range and the view offset of the panels)
    const pm = cam.projectionMatrix.elements
    put(pm[0]); put(pm[5]); put(pm[8]); put(pm[9]); put(pm[10]); put(pm[14])
    put(size.width); put(size.height); put(gl.getPixelRatio())
    put(engine.version); put(sceneVersion.current)
    d.at += dt
    const draw = changed || d.at >= IDLE_REDRAW_S
    if (draw) {
      gl.render(scene, cam)
      d.at = 0
    }

    // Adaptive quality (see STEPS). Judged on frames drawn one after another only: a lone frame after a pause says
    // nothing about speed, nor does a hidden page or a stall (the browser pauses animation frames then).
    const p = perf.current
    const streak = draw && d.was
    d.was = draw
    p.age += dt
    p.statsAt += dt
    if (document.visibilityState !== 'visible' || dt > 0.25 || !streak) {
      p.frames = 0
      p.time = 0
    } else {
      p.frames++
      p.time += dt
      if (p.time > WINDOW_S) {
        const fps = p.frames / p.time
        p.fps = fps
        p.frames = 0
        p.time = 0
        if (p.age > GRACE_S) {
          let step = p.step
          if (fps < SLOW_FPS && step > 0) {
            step--
            p.good = 0
          } else if (fps >= FAST_FPS && step < 1 && !p.recovered && ++p.good >= GOOD_WINDOWS) {
            step++
            p.recovered = true
            p.good = 0
          } else if (fps < FAST_FPS) p.good = 0
          if (step !== p.step) {
            p.step = step
            engine.setQuality(STEPS[step])
            const dpr = step === 0 ? Math.min(1.5, fullDpr) : fullDpr
            if (dpr !== gl.getPixelRatio()) {
              // resizing the canvas clears it: draw again at once, so no empty frame is shown
              setDpr(dpr)
              gl.render(scene, cam)
            }
          }
        }
      }
    }
    // shown in development only (MapView); the tests wait for it
    if (import.meta.env.DEV && p.statsAt > 2) {
      p.statsAt = 0
      onStats(`${engine.stats.drawn} tiles drawn · ${engine.stats.cached} in GPU memory · ${p.fps === null ? 'idle' : `${Math.round(p.fps)} fps`} · ${STEPS[p.step]} quality`)
      p.fps = null
    }
  }, 1)

  return craters ? <Craters rig={rig} engine={engine} exaggeration={exaggeration} onStatus={onCraterStatus} onChange={touch} /> : null
}
