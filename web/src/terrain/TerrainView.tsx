/**
 * The map: a top-down view of the south pole that tilts into 3D relief over the same tiles (plan: "Vista
 * cenital y 3D son el mismo motor"). Keyboard: arrows move, + and − zoom, T tilts, Q and E rotate, R resets.
 * Every site on the map is also a real button, and everything the map shows is also given as text in the
 * panels, so the map is never the only way to reach information.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ToolPortal } from '../ui/ToolSlot'
import { usePanels } from '../state/panels'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { type MarkerStyle, useApp } from '../state/store'
import { MarkerSet } from '../map/markerSet'
import { type MapSite, useMapSites } from '../map/useMapSites'
import { useInsets } from '../state/layout'
import { SUN_R_KM } from '../time/engine'
import { useEphemeris, useMasks } from '../time/hooks'
import { CameraRig, FOV_DEG, TILT_3D } from './cameraRig'
import { Craters } from './Craters'
import { type LayerMode, TerrainEngine } from './engine'
import { type Exaggeration, LayersControl, LegendChip } from './Legend'
import { IconCube, IconFit, IconGlobe, IconMinus, IconPlus } from '../ui/icons'
import { terrainRegistry } from './registry'
import { type Tileset, inExtent, polarLatLon, polarXY, scaleFactor } from './tileset'

const TILES_BASE = `${import.meta.env.BASE_URL}tiles/`

async function loadTileset(): Promise<Tileset> {
  const res = await fetch(`${TILES_BASE}tileset.json`)
  if (!res.ok) throw new Error(`tileset.json: HTTP ${res.status}`)
  return (await res.json()) as Tileset
}

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
  const [stats, setStats] = useState('')
  const [craterError, setCraterError] = useState<unknown>(null)
  const [exaggeration, setExaggeration] = useState<Exaggeration>(2)
  const showCraters = useApp((s) => s.craters)
  const select = useApp((s) => s.select)
  const view = useApp((s) => s.view)
  const set = useApp((s) => s.set)
  const mode = useApp((s) => s.mode)
  // paused while the horizon view covers the map
  const covered = usePanels((s) => s.section === 'horizon')

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

  // Pointer: drag to pan, shift- or right-drag to rotate and tilt, wheel to zoom, click to pick a point.
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
    if (!d || d.moved || d.rotate) return
    const rect = e.currentTarget.getBoundingClientRect()
    // a place drawn on the map wins; otherwise (study mode) the terrain point under the pointer
    const site = rig.markerAt(e.clientX - rect.left, e.clientY - rect.top) as MapSite | null
    if (site) return select(site.sel)
    if (mode !== 'study') return
    const ll = rig.pick((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    if (ll) select({ kind: 'point', lat: Math.round(ll[0] * 1e4) / 1e4, lon: Math.round(ll[1] * 1e4) / 1e4 })
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
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Canvas camera={{ fov: FOV_DEG, near: 1, far: 10_000, position: [0, 1500, 0] }} dpr={[1, 2]} flat linear gl={{ antialias: true }} aria-hidden="true" frameloop={covered ? 'never' : 'always'}>
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
          Arrow keys move, plus and minus zoom, T tilts to 3D, Q and E rotate, R shows the whole pole, Space plays.
          {mode === 'study' && ' Activate a point on the terrain to analyse it.'} Sites are listed, with the same information, in the panels.
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
  const { gl, camera, size, scene, setDpr } = useThree()
  const eph = useEphemeris().data
  const [engine] = useState(() => new TerrainEngine(tileset, TILES_BASE, gl.extensions.has('OES_texture_float_linear')))
  const [reduced] = useState(prefersReducedMotion)
  const perf = useRef({ frames: 0, time: 0, degraded: false })
  const masks = useMasks().data
  const [markersSet] = useState(() => new MarkerSet())
  const [heightsReady, setHeightsReady] = useState(false)

  useEffect(() => {
    scene.add(engine.group)
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
  }, [engine, scene, markersSet])

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
  }, [markersSet, sites, markerStyle, exaggeration, heightsReady, engine, tileset, camera, size, rig])

  useEffect(() => engine.setExaggeration(exaggeration), [engine, exaggeration])

  // Layer and lighting follow the store.
  useEffect(() => {
    const apply = () => {
      const { layer, lighting } = useApp.getState()
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
    engine.update(cam, size.height, [rig.now.tx, rig.now.tz])

    markersSet.update(cam, size.width, size.height, true)

    // Adaptive quality: below 45 fps raise the error threshold and cap the pixel ratio at 1.5.
    // Not measured while the page is hidden or after a stall (the browser pauses animation frames then).
    const p = perf.current
    if (document.visibilityState !== 'visible' || dt > 0.25) {
      p.frames = 0
      p.time = 0
      return
    }
    p.frames++
    p.time += dt
    if (p.time > 2) {
      const fps = p.frames / p.time
      if (fps < 45 && !p.degraded) {
        p.degraded = true
        engine.reduceQuality()
        setDpr(Math.min(1.5, window.devicePixelRatio))
      }
      onStats(`${engine.stats.drawn} tiles drawn · ${engine.stats.cached} in GPU memory · ${Math.round(fps)} fps${p.degraded ? ' · reduced quality' : ''}`)
      p.frames = 0
      p.time = 0
    }
  })

  return craters ? <Craters rig={rig} engine={engine} exaggeration={exaggeration} onStatus={onCraterStatus} /> : null
}
