/**
 * The map: a top-down view of the south pole that tilts into 3D relief over the same tiles (plan: "Vista
 * cenital y 3D son el mismo motor"). Keyboard: arrows move, + and − zoom, T tilts, Q and E rotate, R resets.
 * Every site on the map is also a real button, and everything the map shows is also given as text in the
 * panels, so the map is never the only way to reach information.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { type Selection, sameSelection, useApp } from '../state/store'
import { useInsets } from '../state/layout'
import { SUN_R_KM } from '../time/engine'
import { useEphemeris, useMasks, useSiteNames } from '../time/hooks'
import { pointName } from '../time/place'
import { CameraRig, FOV_DEG, TILT_3D } from './cameraRig'
import { Craters } from './Craters'
import { type LayerMode, TerrainEngine } from './engine'
import { type Exaggeration, LayersControl, LegendChip } from './Legend'
import { terrainRegistry } from './registry'
import { type Tileset, inExtent, polarLatLon, polarXY } from './tileset'

/** 24 px targets need about 34 px between centres so that no corner enters a neighbour's 24 px circle (WCAG 2.5.8). */
const MIN_MARKER_GAP_PX = 34
const TILES_BASE = `${import.meta.env.BASE_URL}tiles/`

async function loadTileset(): Promise<Tileset> {
  const res = await fetch(`${TILES_BASE}tileset.json`)
  if (!res.ok) throw new Error(`tileset.json: HTTP ${res.status}`)
  return (await res.json()) as Tileset
}

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface MarkerSite {
  key: string
  name: string
  x: number
  y: number
  sel: Selection
}

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
  const masks = useMasks().data
  const names = useSiteNames()
  const [rig] = useState(() => new CameraRig(tileset))
  const markerEls = useRef(new Map<string, HTMLButtonElement>())
  const drag = useRef<{ x: number; y: number; moved: boolean; rotate: boolean } | null>(null)
  const [stats, setStats] = useState('')
  const [craterError, setCraterError] = useState<unknown>(null)
  const [exaggeration, setExaggeration] = useState<Exaggeration>(2)
  const showCraters = useApp((s) => s.craters)
  const selection = useApp((s) => s.selection)
  const compare = useApp((s) => s.compare)
  const select = useApp((s) => s.select)
  const view = useApp((s) => s.view)
  const set = useApp((s) => s.set)
  const mode = useApp((s) => s.mode)

  // Catalogue sites on the map, plus the typed or clicked points that are selected or compared.
  const markers: MarkerSite[] = useMemo(() => {
    if (!masks) return []
    const out: MarkerSite[] = masks.doc.sites
      .filter((s) => inExtent(tileset, s.lat, s.lon))
      .map((s) => {
        const [x, y] = polarXY(s.lat, s.lon)
        return { key: s.id, name: names.get(s.id) ?? s.name, x, y, sel: { kind: 'site', id: s.id } }
      })
    for (const p of [selection, ...compare]) {
      if (p.kind !== 'point' || !inExtent(tileset, p.lat, p.lon) || out.some((m) => sameSelection(m.sel, p))) continue
      const [x, y] = polarXY(p.lat, p.lon)
      out.push({ key: `p:${p.lat},${p.lon}`, name: pointName(p.lat, p.lon), x, y, sel: p })
    }
    return out
  }, [masks, tileset, names, selection, compare])

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
    if (!d || d.moved || d.rotate || mode !== 'study') return
    const rect = e.currentTarget.getBoundingClientRect()
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
        <Canvas camera={{ fov: FOV_DEG, near: 1, far: 10_000, position: [0, 1500, 0] }} dpr={[1, 2]} flat linear gl={{ antialias: true }} aria-hidden="true">
          <Driver
            tileset={tileset}
            rig={rig}
            markers={markers}
            markerEls={markerEls}
            exaggeration={exaggeration}
            onStats={setStats}
            craters={showCraters}
            onCraterStatus={setCraterError}
          />
        </Canvas>
        <div className="markers">
          {markers.map((m) => {
            const current = sameSelection(m.sel, selection)
            const n = compare.findIndex((c) => sameSelection(c, m.sel))
            return (
              <button
                key={m.key}
                type="button"
                ref={(el) => {
                  if (el) markerEls.current.set(m.key, el)
                  else markerEls.current.delete(m.key)
                }}
                className={`site-marker${current ? ' is-selected' : ''}${n >= 0 ? ' is-compared' : ''}`}
                aria-pressed={current}
                aria-label={n >= 0 ? `${m.name}, compared as number ${n + 1}` : m.name}
                onClick={() => select(m.sel)}
                style={{ display: 'none' }}
              >
                <span className="site-dot" aria-hidden="true">
                  {n >= 0 ? n + 1 : ''}
                </span>
                <span className="site-label" aria-hidden="true">
                  {m.name}
                </span>
              </button>
            )
          })}
        </div>
        <p id="map-help" className="sr-only">
          Arrow keys move, plus and minus zoom, T tilts to 3D, Q and E rotate, R shows the whole pole, Space plays.
          {mode === 'study' && ' Activate a point on the terrain to analyse it.'}
        </p>
      </div>
      <div className="map-controls" role="group" aria-label="Map view">
        <button type="button" onClick={() => zoom(0.6)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(1 / 0.6)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => set({ scale: 'globe' })} title="The whole Moon">
          Globe
        </button>
        <button type="button" aria-pressed={view === '3d'} onClick={toggleView} title="Tilt (T)">
          3D
        </button>
        <button type="button" onClick={() => rig.reset()} aria-label="Whole pole" title="Whole pole (R)">
          ◎
        </button>
        <LayersControl tileset={tileset} exaggeration={exaggeration} onExaggeration={setExaggeration} craterError={showCraters ? craterError : null} />
      </div>
      <LegendChip tileset={tileset} />
      {stats && import.meta.env.DEV && <p className="map-stats">{stats}</p>}
    </>
  )
}

/** Selected and compared places win when markers would overlap. */
const priority = (el?: HTMLElement) => (!el ? 0 : el.classList.contains('is-selected') ? 2 : el.classList.contains('is-compared') ? 1 : 0)

interface DriverProps {
  tileset: Tileset
  rig: CameraRig
  markers: MarkerSite[]
  markerEls: { current: Map<string, HTMLButtonElement> }
  exaggeration: number
  onStats: (s: string) => void
  craters: boolean
  onCraterStatus: (e: unknown) => void
}

/** Runs inside the Canvas: camera, Sun, shadows, tile selection and marker placement, once per frame. */
function Driver({ tileset, rig, markers, markerEls, exaggeration, onStats, craters, onCraterStatus }: DriverProps) {
  const { gl, camera, size, scene, setDpr } = useThree()
  const eph = useEphemeris().data
  const [engine] = useState(() => new TerrainEngine(tileset, TILES_BASE, gl.extensions.has('OES_texture_float_linear')))
  const [reduced] = useState(prefersReducedMotion)
  const perf = useRef({ frames: 0, time: 0, degraded: false })

  useEffect(() => {
    scene.add(engine.group)
    terrainRegistry.engine = engine
    if (import.meta.env.DEV) (window as unknown as { __terrain?: TerrainEngine }).__terrain = engine // e2e and debugging
    engine.loadOverview().catch(() => {})
    return () => {
      scene.remove(engine.group)
      if (terrainRegistry.engine === engine) terrainRegistry.engine = null
      engine.dispose()
    }
  }, [engine, scene])

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
        const m = markers.find((k) => sameSelection(k.sel, sel))
        if (m) ll = polarLatLon(m.x, m.y)
      }
      if (ll && inExtent(tileset, ll[0], ll[1])) rig.flyTo(ll[0], ll[1])
    }
    fly()
    return useApp.subscribe(fly)
  }, [markers, rig, tileset])

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

  const v = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, dt) => {
    const insets = useInsets.getState()
    rig.fitHome(size.width, size.height, insets)
    rig.step(dt, reduced)
    const cam = camera as THREE.PerspectiveCamera
    rig.apply(cam, ((engine.heightAt(rig.now.tx * 1000, -rig.now.tz * 1000) ?? 0) / 1000) * exaggeration, size.width, size.height, insets)

    // The Sun at the active instant (Moon-centre vector; its parallax across the map is below 0.001°).
    const { tMs, mastM, selection, playing } = useApp.getState()
    if (eph?.table.covers(tMs)) {
      const p = eph.table.positions(tMs)
      const d = Math.hypot(p[0], p[1], p[2])
      engine.setSun([p[0] / d, p[1] / d, p[2] / d], THREE.MathUtils.radToDeg(Math.asin(SUN_R_KM / d)), mastM)
    }
    engine.renderShadows(gl, playing)
    engine.update(cam, size.height, [rig.now.tx, rig.now.tz])

    // Ring around the selected place.
    let at: [number, number] | null = null
    if (selection.kind === 'point') at = polarXY(selection.lat, selection.lon)
    else {
      const m = markers.find((q) => sameSelection(q.sel, selection))
      if (m) at = [m.x, m.y]
    }
    engine.setHighlight(at?.[0] ?? 0, at?.[1] ?? 0, at ? Math.max(1200, rig.now.dist * 14) : 0)

    // Marker buttons over the canvas. Markers closer than 34 px to one already placed are hidden (the selected and
    // compared ones are placed first): no overlapping targets, and the list still reaches every site.
    const showLabels = rig.now.dist < 450
    const placed: [number, number][] = []
    const ordered = [...markers].sort((a, b) => priority(markerEls.current.get(b.key)) - priority(markerEls.current.get(a.key)))
    for (const m of ordered) {
      const el = markerEls.current.get(m.key)
      if (!el) continue
      const h = ((engine.heightAt(m.x, m.y) ?? 0) / 1000) * exaggeration
      v.set(m.x / 1000, h, -m.y / 1000).project(cam)
      const sx = ((v.x + 1) / 2) * size.width
      const sy = ((1 - v.y) / 2) * size.height
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
      const crowded = placed.some(([px, py]) => Math.hypot(px - sx, py - sy) < MIN_MARKER_GAP_PX)
      const visible = onScreen && !crowded
      if (visible) placed.push([sx, sy])
      el.style.display = visible ? '' : 'none'
      el.style.transform = `translate(${sx}px, ${sy}px)`
      el.dataset.labels = showLabels || priority(el) > 0 ? 'on' : 'off'
    }

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
