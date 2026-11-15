/**
 * The whole Moon, from global LOLA topography, lit by the Sun at the chosen instant. Drag turns it, the wheel
 * brings it closer toward the place under the pointer, the south pole included: south of 60° S the globe draws the
 * polar map's own LOLA tiles and WAC polar mosaic (detail/polar.ts) on a mesh laid out in polar coordinates, so it
 * stays sharp and movable over the pole without switching to another view. A click on the surface marks that point
 * (study mode, as on the map) and turns the Moon toward it; a click on a place selects it. In mission mode, a search
 * region centre still flies down into the polar map, where the areas are painted.
 * Catalogue sites are buttons over the globe; the panels hold the same information as text.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { SkyMap } from './skyMap'
import { StarField } from './starField'
import { ToolPortal } from '../ui/ToolSlot'
import { useGraphics } from '../state/graphics'
import { usePlaceStyles } from '../state/placeStyle'
import { IconCube, IconMinus, IconPin, IconPlus, IconPole } from '../ui/icons'
import { useCinematic } from '../state/cinematic'
import { useGlobe } from '../state/globe'
import { useHorizonTransition } from '../state/horizon'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useInsets } from '../state/layout'
import { useAreas } from '../state/areas'
import { type MarkerStyle, type ViewMode, useApp } from '../state/store'
import { MarkerSet } from '../map/markerSet'
import { type MapSite, useMapSites } from '../map/useMapSites'
import { TileLoader } from '../terrain/loader'
import { prefetchMap } from '../terrain/prefetch'
import { useEphemeris, useMasks } from '../time/hooks'
import { DATA_BASE } from '../time/staticData'
import { GlobeDetail } from './detail/globeDetail'
import { type PhotoBase, loadPhotoBase } from './detail/photoBase'
import { MIN_DIST, MOON_R_KM, type Orbit, OrbitRig, RELIEF_MAX, TILT_3D, cameraPose, isNearView, latLonToScene, missionPickOutcome, nearPlaneKm, raySphere, reliefExaggeration, sceneToLatLon } from './orbit'
import { PATCH_LEVELS, POLAR_PATCH_LAT, type PolarPatchWindow, holeOf, patchGeometry, patchWindows, polarHoleOf, polarPatchWindows } from './patch'
import { GLOBE_FRAG, GLOBE_VERT, PATCH_VERT, POLAR_PATCH_VERT } from './shaders'
import { OVERVIEW_DELAY_S, PolarDetail } from './detail/polar'
import { TILES_BASE, loadTileset } from '../terrain/TerrainView'
import { polarXY } from '../terrain/tileset'
import { IconCrosshair } from '../ui/icons'
import { WebGLGuard } from '../ui/WebGLGuard'
import { useOnScreen } from '../ui/useOnScreen'

const FOV = 35
/** The polar map covers the disc south of this latitude (the LOLA polar grids). */
export const MAP_DISC_LAT = -60
/**
 * Zooming in closer than this over the polar cap enters the map: about 1 400 km above the surface, where the view
 * spans roughly the polar cap (the map's disc to 60 S is about 1 800 km across) and the map's 20 m to 240 m tiles
 * beat the globe's. The map then flies on down to 450 km over the place (TerrainView).
 */
const ENTER_MAP_DIST = MOON_R_KM * 1.8
/**
 * The south-pole button (and Enter) flies the globe down to this height over the pole, km: under NEAR_ENTER_KM
 * (orbit.ts), so the view tilts to 3D and the polar tiles sharpen on the way.
 */
const POLE_VIEW_ALT_KM = 400
/** Slope exaggeration of the shading where 118 m detail heights are loaded (the shipped 7.6 km grid uses 3). */
const DETAIL_SHADE_EXAGGERATION = 1.5

/**
 * What the globe's surface shows: LOLA heights lit by the Sun at the chosen time, or the same lit relief with the
 * LROC WAC photo mosaic as its colour.
 */
export type GlobeSurface = 'relief' | 'photo'

export interface GlobeMeta {
  file: string
  width: number
  height: number
  min: number
  max: number
}

/** The global heights and, alongside, the shipped photo base: the globe opens in photo mode with both in place. */
export async function loadGlobe(): Promise<{ meta: GlobeMeta; heights: Float32Array; photoBase: PhotoBase | null }> {
  const photoBase = loadPhotoBase()
  const meta = (await (await fetch(`${DATA_BASE}globe/globe.json`)).json()) as GlobeMeta
  const loader = new TileLoader(1)
  try {
    const res = await loader.request('globe', { url: `${DATA_BASE}globe/${meta.file}`, kind: 'height', min: meta.min, max: meta.max })
    return { meta, heights: res.heights!, photoBase: await photoBase }
  } finally {
    loader.dispose()
  }
}

/** A second click within this time (ms) is a double click: the first one waits that long before it marks a point. */
const DOUBLE_CLICK_MS = 260
/** A double click comes this much closer (the height above the ground is multiplied by it). */
const DOUBLE_CLICK_ZOOM = 0.4

const NO_HOLE = [0, 0, 0, 0]

/** With nothing changing, a frame is still drawn this often (s). */
const IDLE_REDRAW_S = 0.5
const WINDOW_S = 2
const SLOW_FPS = 45
/**
 * Low graphics (state/graphics.ts) while the Moon turns by itself: drawn at most this many times a second (the turn is
 * slow, so 30 steady frames look smoother than 60 the GPU cannot hold), with no new detail tiles asked for meanwhile
 * (each one is decoded and uploaded to the GPU, which is what makes a slow machine stutter).
 */
const LOW_SPIN_FPS = 30
/**
 * While the camera moves on a slow GPU the globe is drawn with fewer pixels: the pixel ratio is multiplied by a
 * factor that drops by MOVING_STEP (to MOVING_MIN) each MOVING_WINDOW_S of moving frames slower than SLOW_FPS. The
 * full ratio comes back MOVING_SETTLE_S after the camera stops. A fast GPU never lowers it, nor does the Moon turning
 * by itself.
 */
const MOVING_STEP = 0.75
const MOVING_MIN = 0.5
const MOVING_WINDOW_S = 0.5
const MOVING_SETTLE_S = 0.15
const GRACE_S = 3

/** A first view of the whole Moon, turned so the south pole faces the viewer. */
const START: Orbit = { lat: -48, lon: 10, dist: MOON_R_KM * 3.4 }

export function GlobeView() {
  const globe = useQuery({ queryKey: ['static', 'globe'], queryFn: loadGlobe, staleTime: Infinity, gcTime: Infinity, retry: 1 })
  const masks = useMasks().data
  const queryClient = useQueryClient()
  // once the globe has its own data and its opening view has had the network (the photo, the ephemeris), bring in
  // what the polar map opens with (terrain/prefetch.ts; its overview heights are about 8 MB)
  const globeReady = !!globe.data
  useEffect(() => {
    if (!globeReady) return
    const t = setTimeout(() => prefetchMap(queryClient), OVERVIEW_DELAY_S * 1000)
    return () => clearTimeout(t)
  }, [globeReady, queryClient])
  const sites = useMapSites()
  const markerStyle = useApp((s) => s.markerStyle)
  const select = useApp((s) => s.select)
  const mode = useApp((s) => s.mode)
  const openMenu = usePlaceStyles((s) => s.openMenu)
  const enterMap = useApp((s) => s.enterMap)
  const [orbit] = useState(() => new OrbitRig(START))
  const [chosenSurface, setSurface] = useState<GlobeSurface>('photo')
  // low graphics (state/graphics.ts): the lit relief only, no photo tiles
  const lowGraphics = useGraphics((s) => s.low)
  const surface: GlobeSurface = lowGraphics ? 'relief' : chosenSurface
  /** The mesh's relief exaggeration, to half a unit (for the caption and the markers' height). */
  const [exag, setExag] = useState(RELIEF_MAX)
  const anchored = useGlobe((s) => s.anchored)
  const regionCenter = useAreas((s) => s.center)
  const regionRadiusKm = useAreas((s) => s.radiusKm)
  const [regionToast, setRegionToast] = useState<string | null>(null)
  useEffect(() => {
    if (!regionToast) return
    const t = setTimeout(() => setRegionToast(null), 3000)
    return () => clearTimeout(t)
  }, [regionToast])
  // 2D or 3D: the app's view, shared with the polar map and kept in the address (the camera lives in the orbit rig).
  // 3D tilts the view; 2D sets it straight down with north up again, whatever turn it had.
  const view = useApp((s) => s.view)
  const setApp = useApp((s) => s.set)
  /** The view the orbit already shows: a change made on the orbit itself (a tilting drag) is not applied again. */
  const shownView = useRef<ViewMode | null>(null)
  useEffect(() => {
    if (shownView.current === view) return
    shownView.current = view
    if (view === '3d') orbit.setTilt(TILT_3D)
    else orbit.resetView()
  }, [view, orbit])
  const toggleTilt = () => setApp({ view: useApp.getState().view === '3d' ? '2d' : '3d' })
  /** A click on the surface waits to see whether it is the first half of a double click. */
  const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (pendingClick.current && clearTimeout(pendingClick.current)), [])
  // In the horizon view the globe is hidden and paused: it must not start turning there, nor right after.
  // paused (no frames drawn) while the horizon view or Educational mode covers the map; it keeps its camera and tiles
  const underHorizon = useHorizonTransition((s) => s.phase === 'horizon')
  const underBlocks = useApp((s) => s.blocks)
  // and while it is scrolled out of the window (a phone's column, with a panel being read under it)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const offScreen = !useOnScreen(root)
  const covered = underHorizon || underBlocks || offScreen
  useEffect(() => orbit.touch(), [covered, orbit])

  // Opening the horizon view: turn to the place and come down over it; back to the previous view when it closes.
  useEffect(() => {
    let before: Orbit | null = null
    let phase = useHorizonTransition.getState().phase
    return useHorizonTransition.subscribe((t) => {
      if (t.phase === phase) return
      phase = t.phase
      if (phase === 'diving') {
        const sel = useApp.getState().selection
        const site = sel?.kind === 'site' ? masks?.site(sel.id) : null
        const ll = sel?.kind === 'point' ? [sel.lat, sel.lon] : site ? [site.lat, site.lon] : null
        if (!ll) return
        before = { ...orbit.goal }
        orbit.turnTo(ll[0], ll[1])
        orbit.goal.dist = MIN_DIST
      } else if ((phase === 'returning' || phase === 'map') && before) {
        orbit.touch()
        Object.assign(orbit.goal, before)
        before = null
      }
    })
  }, [masks, orbit])
  const drag = useRef<{ x: number; y: number; moved: boolean; rotate: boolean } | null>(null)
  const pickRef = useRef<((cx: number, cy: number) => [number, number] | null) | null>(null)

  // Picking a place in the panels turns the globe toward it.
  useEffect(() => {
    let seq = useApp.getState().focusSeq
    return useApp.subscribe((s) => {
      if (s.focusSeq === seq) return
      seq = s.focusSeq
      const sel = s.selection
      const site = sel?.kind === 'site' ? masks?.site(sel.id) : null
      const ll = sel?.kind === 'point' ? [sel.lat, sel.lon] : site ? [site.lat, site.lon] : null
      if (ll) orbit.turnTo(ll[0], ll[1])
    })
  }, [masks, orbit])

  /**
   * Turn toward a point. In mission mode a point of the polar cap flies down into the polar map instead, where the
   * search's areas are painted.
   */
  const goTo = (lat: number, lon: number) => {
    if (mode === 'mission' && lat <= MAP_DISC_LAT) orbit.dive(lat, lon, ENTER_MAP_DIST * 0.98)
    else orbit.turnTo(lat, lon)
  }
  /** Fly down over the south pole along the meridian in view (no turn round the Moon on the way), staying on the globe. */
  const flyToPole = () => orbit.flyTo(-90, orbit.goal.lon, MOON_R_KM + POLE_VIEW_ALT_KM)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    orbit.touch()
    const h = e.currentTarget.clientHeight || 600
    const keys: Record<string, () => void> = {
      ArrowLeft: () => orbit.drag(h * 0.08, 0, h, FOV),
      ArrowRight: () => orbit.drag(-h * 0.08, 0, h, FOV),
      ArrowUp: () => orbit.drag(0, h * 0.08, h, FOV),
      ArrowDown: () => orbit.drag(0, -h * 0.08, h, FOV),
      '+': () => orbit.zoom(0.7),
      '=': () => orbit.zoom(0.7),
      '-': () => orbit.zoom(1 / 0.7),
      t: toggleTilt,
      T: toggleTilt,
      q: () => orbit.rotate(-15),
      e: () => orbit.rotate(15),
      r: () => {
        orbit.resetView()
        setApp({ view: '2d' })
      },
      Enter: flyToPole,
      ...(mode === 'mission' && useAreas.getState().center ? { c: centreOnRegion, C: centreOnRegion } : {}),
    }
    const fn = keys[e.key]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    orbit.touch()
    if ((e.target as HTMLElement).closest('button, select, input, a')) return
    // shift- or right-drag turns and tilts the view, as on the polar map
    drag.current = { x: e.clientX, y: e.clientY, moved: false, rotate: e.button === 2 || e.shiftKey }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.rotate) {
      if (d.moved) {
        orbit.rotate(-dx * 0.3, dy * 0.3, true)
        // the button follows the tilt, without snapping the turn or the tilt the drag just set
        const v: ViewMode = orbit.viewGoal.tilt >= 1 ? '3d' : '2d'
        if (v !== useApp.getState().view) {
          shownView.current = v
          setApp({ view: v })
        }
      }
    } else orbit.drag(dx, dy, e.currentTarget.clientHeight, FOV, true)
    d.x = e.clientX
    d.y = e.clientY
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const rect = e.currentTarget.getBoundingClientRect()
    const site = orbit.markerAt(e.clientX - rect.left, e.clientY - rect.top) as MapSite | null
    // right click on a place opens its menu (rename, pointer colour, remove)
    if (e.button === 2) {
      if (site) openMenu({ sel: site.sel, name: site.name, x: e.clientX, y: e.clientY, returnTo: e.currentTarget })
      return
    }
    if (site) {
      select(site.sel)
      return goTo(site.lat, site.lon)
    }
    // the surface under the pointer: mark it as the chosen point (study mode, like the map) and turn toward it,
    // unless a second click follows (a double click only comes closer)
    const ll = pickRef.current?.((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    if (!ll) return
    if (pendingClick.current) clearTimeout(pendingClick.current)
    pendingClick.current = setTimeout(() => {
      pendingClick.current = null
      if (mode === 'study') select({ kind: 'point', lat: Math.round(ll[0] * 1e4) / 1e4, lon: Math.round(ll[1] * 1e4) / 1e4 })
      else if (mode === 'mission') {
        if (missionPickOutcome(ll[0]) === 'centre') {
          const lat = Math.round(ll[0] * 1e4) / 1e4
          const lon = Math.round(ll[1] * 1e4) / 1e4
          useAreas.getState().set({ center: { lat, lon }, pickArmed: false })
          goTo(lat, lon)
        } else setRegionToast('The search covers south of 60° S')
      } else orbit.turnTo(ll[0], ll[1])
    }, DOUBLE_CLICK_MS)
  }
  // A centre typed or chosen in the planner panel (not only a click here) flies down into the map, which then
  // frames the whole region (TerrainView). A click already flew there itself.
  useEffect(() => {
    let prev = useAreas.getState().center
    return useAreas.subscribe((a) => {
      if (a.center === prev) return
      prev = a.center
      if (!a.center || useApp.getState().mode !== 'mission' || orbit.isDiving) return
      if (a.center.lat <= MAP_DISC_LAT) orbit.dive(a.center.lat, a.center.lon, ENTER_MAP_DIST * 0.98)
    })
  }, [orbit])
  /** Repeats the fly-to of the last region centre ("Centre on region", 3.8). */
  const centreOnRegion = () => {
    const c = useAreas.getState().center
    if (c) goTo(c.lat, c.lon)
  }
  // a double click comes closer to the place under the pointer, anywhere on the Moon
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, select, input, a')) return
    if (pendingClick.current) clearTimeout(pendingClick.current)
    pendingClick.current = null
    const rect = e.currentTarget.getBoundingClientRect()
    const ll = pickRef.current?.((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    if (!ll) return
    orbit.turnTo(ll[0], ll[1])
    orbit.zoom(DOUBLE_CLICK_ZOOM)
  }
  // zooming in goes toward the place under the pointer, so zooming over the pole reaches the polar map there
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const factor = Math.exp(e.deltaY * 0.0012)
    const rect = e.currentTarget.getBoundingClientRect()
    const ll = factor < 1 ? pickRef.current?.((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height) : null
    if (!ll) return orbit.zoom(factor)
    orbit.zoomToward(factor, ll[0], ll[1])
  }

  return (
    <>
      <div
        ref={setRoot}
        className="map-view globe-view"
        tabIndex={0}
        role="application"
        aria-roledescription="globe"
        aria-label="The Moon"
        aria-describedby="globe-help"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      >
        {globe.data ? (
          <WebGLGuard what="3D globe">
          <Canvas camera={{ fov: FOV, near: 10, far: 50_000, position: [0, 0, 6000] }} dpr={[1, 2]} flat linear gl={{ antialias: true }} aria-hidden="true" frameloop={covered ? 'never' : 'always'}>
            <GlobeScene
              data={globe.data}
              orbit={orbit}
              sites={sites}
              markerStyle={markerStyle}
              pickRef={pickRef}
              surface={surface}
              exag={exag}
              onExag={setExag}
              onEnter={(lat, lon) => enterMap(lat, lon)}
              region={mode === 'mission' && regionCenter ? { lat: regionCenter.lat, lon: regionCenter.lon, radiusKm: regionRadiusKm } : null}
            />
          </Canvas>
          </WebGLGuard>
        ) : (
          <p className="map-loading" role="status">
            {globe.isError ? 'Global LOLA topography not available.' : 'Loading the Moon…'}
          </p>
        )}
        <p id="globe-help" className="sr-only">
          Arrow keys turn the Moon, plus and minus zoom, T tilts the view to 3D, Q and E turn it, R sets it straight
          again, Enter flies down to the south pole. Zooming in close anywhere, the south pole included, tilts the view
          to 3D and loads the finest detail; zooming back out sets it straight. A click on
          the surface marks that point; a double click comes closer to it. Right click a place for its options: rename, pointer colour, remove. Sites are listed, with the same information, in the panels.
        </p>
      </div>
      <ToolPortal>
      <div className="map-controls" role="group" aria-label="Globe view">
        <div className="tool-group">
          <button type="button" onClick={() => orbit.zoom(0.6)} aria-label="Zoom in" title="Zoom in (+)">
            <IconPlus />
          </button>
          <button type="button" onClick={() => orbit.zoom(1 / 0.6)} aria-label="Zoom out" title="Zoom out (−)">
            <IconMinus />
          </button>
        </div>
        <button
          type="button"
          aria-pressed={view === '3d'}
          onClick={toggleTilt}
          aria-label="3D tilt"
          title="3D tilt (T); off sets the view straight down, north up. Zooming in close turns it on. Shift-drag or right-drag turns and tilts"
        >
          <IconCube />
        </button>
        <button type="button" onClick={flyToPole} aria-label="Fly to the south pole" title="Fly down to the south pole (Enter)">
          <IconPole />
        </button>
        <button
          type="button"
          aria-pressed={anchored}
          aria-label="Pin the Moon"
          title={anchored ? 'Pinned: the Moon stays still. Press to let it turn when idle' : 'Pin the Moon: stop it turning by itself when idle'}
          onClick={() => {
            orbit.touch()
            useGlobe.getState().setAnchored(!anchored)
          }}
        >
          <IconPin />
        </button>
        {mode === 'mission' && (
          <button type="button" disabled={!regionCenter} onClick={centreOnRegion} aria-label="Centre on region" title="Centre on region (C)">
            <IconCrosshair />
          </button>
        )}
        <button
          type="button"
          aria-pressed={surface === 'photo'}
          aria-disabled={lowGraphics || undefined}
          onClick={() => !lowGraphics && setSurface(surface === 'photo' ? 'relief' : 'photo')}
          title={lowGraphics ? 'The photo is off in Low graphics (top bar)' : 'Drape the LROC WAC photo mosaic over the 3D relief lit by the Sun'}
        >
          Photo
        </button>
      </div>
      </ToolPortal>
      <p className="globe-caption">
        {surface === 'photo'
          ? `LROC WAC photo mosaic, 100 m, from NASA Moon Trek, over global LOLA topography (relief ×${exag}; 118 m detail as you zoom)`
          : `Global LOLA topography (relief ×${exag}; 118 m detail from NASA Moon Trek as you zoom)`}
        {' · lit by the Sun at the chosen time'}
      </p>
      {regionToast && (
        <p className="toast" role="alert">
          {regionToast}
        </p>
      )}
    </>
  )
}

/** Camera on the orbit, the Moon's centre in the middle of the space the panels leave free. */
function placeCamera(cam: THREE.PerspectiveCamera, n: Orbit, tiltDeg: number, headingDeg: number, w: number, h: number) {
  const ins = useInsets.getState()
  const cx = ins.left + (w - ins.left - ins.right) / 2
  const cy = ins.top + (h - ins.top - ins.bottom) / 2
  cam.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h)
  // straight above the place with north up, or tilted and turned around it (orbit.ts, cameraPose)
  const pose = cameraPose(n, tiltDeg, headingDeg)
  cam.position.set(...pose.position)
  cam.up.set(...pose.up)
  cam.lookAt(...pose.target)
  // the near plane clips by depth along the view axis: bound it by the widest corner of the view (orbit.ts,
  // nearPlaneKm), or a tilted view from far out loses the ground below the camera
  const fromCentre = cam.position.length()
  cam.far = fromCentre + MOON_R_KM * 2
  cam.updateProjectionMatrix()
  let cosMax = 1
  for (const [x, y] of CORNERS) {
    const v = corner.set(x, y, -1).applyMatrix4(cam.projectionMatrixInverse)
    cosMax = Math.min(cosMax, -v.z / v.length())
  }
  cam.getWorldDirection(axis)
  cam.near = nearPlaneKm([cam.position.x, cam.position.y, cam.position.z], [axis.x, axis.y, axis.z], cosMax)
  cam.updateProjectionMatrix()
}
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const
const corner = new THREE.Vector3()
const axis = new THREE.Vector3()

/** The square a polar grid draws (patch.ts, polarHoleOf), left out by the mesh around it; w = 0 when there is none. */
function setPolarHole(v: THREE.Vector4, w: PolarPatchWindow | undefined) {
  if (!w) return void v.set(0, 0, 0, 0)
  const [x, y, half] = polarHoleOf(w)
  v.set(x, y, half, 1)
}

function setExaggeration(m: THREE.ShaderMaterial, e: number) {
  m.uniforms.uExag.value = e
}

/** Unit vector to the Sun, Moon Mean-Earth axes. */
function setSun(m: THREE.ShaderMaterial, x: number, y: number, z: number) {
  ;(m.uniforms.uSun.value as THREE.Vector3).set(x, y, z)
}

interface SceneProps {
  data: { meta: GlobeMeta; heights: Float32Array; photoBase: PhotoBase | null }
  orbit: OrbitRig
  sites: MapSite[]
  markerStyle: MarkerStyle
  pickRef: { current: ((cx: number, cy: number) => [number, number] | null) | null }
  surface: GlobeSurface
  /** Relief exaggeration to half a unit, as the caption shows it. */
  exag: number
  onExag: (exag: number) => void
  onEnter: (lat: number, lon: number) => void
  /** Mission mode's search region, drawn as a ring on the sphere (3.8); null hides it. */
  region: { lat: number; lon: number; radiusKm: number } | null
}

/** 128-point ring on the sphere at the given latitude/longitude and angular radius, 0.2 % above the surface. */
function regionRingPoints(lat: number, lon: number, radiusKm: number): Float32Array {
  const n = 128
  const out = new Float32Array((n + 1) * 3)
  const r = MOON_R_KM * 1.002
  const theta = radiusKm / MOON_R_KM
  const c = new THREE.Vector3(...latLonToScene(lat, lon, 1))
  const up = new THREE.Vector3(0, 1, 0)
  const e1 = up.clone().cross(c)
  if (e1.lengthSq() < 1e-9) e1.set(1, 0, 0)
  e1.normalize()
  const e2 = c.clone().cross(e1)
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const p = c
      .clone()
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(e1, Math.sin(theta) * Math.cos(a))
      .addScaledVector(e2, Math.sin(theta) * Math.sin(a))
      .multiplyScalar(r)
    out.set([p.x, p.y, p.z], i * 3)
  }
  return out
}

/** Height (m) of the global grid at a point, nearest sample. */
function globeHeight(data: SceneProps['data'], lat: number, lon: number): number {
  const { width, height } = data.meta
  const col = Math.floor((((lon % 360) + 360) % 360) / 360 * width) % width
  const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)))
  return data.heights[row * width + col]
}

function GlobeScene({ data, orbit, sites, markerStyle, pickRef, surface, exag, onExag, onEnter, region }: SceneProps) {
  const { camera, size, scene, gl, setDpr, viewport } = useThree()
  const [markersSet] = useState(() => new MarkerSet())
  const [regionRing] = useState(() => {
    const g = new LineGeometry()
    g.setPositions(new Float32Array(3 * 129))
    const m = new LineMaterial({ color: '#fadb73', linewidth: 2, depthTest: false, transparent: true })
    const line = new Line2(g, m)
    line.visible = false
    line.renderOrder = 22
    return line
  })
  useEffect(() => {
    scene.add(regionRing)
    return () => {
      scene.remove(regionRing)
      regionRing.geometry.dispose()
      ;(regionRing.material as LineMaterial).dispose()
    }
  }, [scene, regionRing])
  useEffect(() => {
    if (!region) {
      regionRing.visible = false
      return
    }
    regionRing.geometry.setPositions(regionRingPoints(region.lat, region.lon, region.radiusKm))
    regionRing.computeLineDistances()
    regionRing.visible = true
  }, [region, regionRing])
  /** What the last drawn frame showed (camera, canvas, Sun, relief, detail tiles): a frame is drawn when it differs. */
  const drawn = useRef({ sig: new Float64Array(64), at: Infinity, was: false })
  const sceneVersion = useRef(0)
  /** Frame rate over continuous drawing, to lower the pixel ratio on a slow GPU (the pixel ratio the canvas started with first). */
  const perf = useRef({ frames: 0, time: 0, age: 0, dpr: viewport.dpr })
  /** The camera's motion: seconds since it last moved, the moving frames' timing and the factor on the pixel ratio. */
  const motion = useRef({ last: new Float64Array(16), still: Infinity, frames: 0, time: 0, factor: 1 })
  const eph = useEphemeris().data
  const [reduced] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [detail] = useState(() => new GlobeDetail(data.photoBase))
  // south of 60 S: the polar map's tiles (detail/polar.ts), once its tileset is known
  const [polar] = useState(() => new PolarDetail())
  const tileset = useQuery({ queryKey: ['static', 'tileset'], queryFn: loadTileset, staleTime: Infinity, retry: 1 }).data
  const [material] = useState(() => {
    const tex = new THREE.DataTexture(data.heights, data.meta.width, data.meta.height, THREE.RedFormat, THREE.FloatType)
    tex.minFilter = tex.magFilter = THREE.NearestFilter
    tex.needsUpdate = true
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: GLOBE_VERT,
      fragmentShader: GLOBE_FRAG,
      uniforms: {
        uHeight: { value: tex },
        uExag: { value: RELIEF_MAX },
        uSun: { value: new THREE.Vector3(1, 0, 0) },
        uDiscLat: { value: MAP_DISC_LAT },
        ...detail.uniforms(),
        ...polar.uniforms(),
        uDetailShade: { value: DETAIL_SHADE_EXAGGERATION },
        uHole: { value: new THREE.Vector4() },
        uPolarHole: { value: new THREE.Vector4() },
      },
    })
  })
  // Dense grids around the place the camera looks at, finest first (patch.ts). They share the globe's uniforms (the
  // same objects), so the Sun, the relief and the detail tiles reach them too; each has its own window and hole.
  const [patches] = useState(() => {
    const grid = patchGeometry()
    return Array.from({ length: PATCH_LEVELS }, () => {
      const m = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: PATCH_VERT,
        fragmentShader: GLOBE_FRAG,
        side: THREE.DoubleSide,
        uniforms: { ...material.uniforms, uWin: { value: new THREE.Vector4() }, uSkirtKm: { value: 1 }, uHole: { value: new THREE.Vector4() }, uPolarHole: { value: new THREE.Vector4() } },
      })
      const mesh = new THREE.Mesh(grid, m)
      mesh.frustumCulled = false // its vertices are placed by the shader
      mesh.visible = false
      return mesh
    })
  })
  // The same grids laid out in polar stereographic metres, used instead when the view is poleward of
  // POLAR_PATCH_LAT (patch.ts, polarPatchWindows): a latitude/longitude grid folds up at the pole.
  const [polarPatches] = useState(() =>
    patches.map((p) => {
      const m = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: POLAR_PATCH_VERT,
        fragmentShader: GLOBE_FRAG,
        side: THREE.DoubleSide,
        uniforms: { ...material.uniforms, uPWin: { value: new THREE.Vector4() }, uSkirtKm: { value: 1 }, uHole: { value: new THREE.Vector4() }, uPolarHole: { value: new THREE.Vector4() } },
      })
      const mesh = new THREE.Mesh(p.geometry, m)
      mesh.frustumCulled = false
      mesh.visible = false
      return mesh
    }),
  )
  useEffect(() => {
    if (tileset) polar.setTileset(tileset, TILES_BASE, material, gl.extensions.has('OES_texture_float_linear'))
  }, [tileset, polar, material, gl])
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const projView = useMemo(() => new THREE.Matrix4(), [])
  const sphere = useMemo(() => new THREE.Sphere(), [])
  const [geometry] = useState(() => new THREE.SphereGeometry(MOON_R_KM, 512, 256))
  useEffect(
    () => () => {
      material.uniforms.uHeight.value.dispose()
      material.dispose()
      geometry.dispose()
      detail.dispose()
      polar.dispose()
      patches[0].geometry.dispose()
      patches.forEach((p) => p.material.dispose())
      polarPatches.forEach((p) => p.material.dispose())
    },
    [material, geometry, detail, polar, patches, polarPatches],
  )

  // the surface shown picks which detail tiles the shader reads; work out the wanted tiles again at once
  useEffect(() => detail.setKind(material, surface === 'photo' ? 'photo' : 'dem'), [surface, material, detail])
  /** Whether the polar photo tiles are asked for (set in the frame loop, in photo mode). */
  const polarPhoto = useRef<boolean | null>(null)

  useEffect(() => {
    scene.add(markersSet.group)
    patches.forEach((p) => scene.add(p))
    polarPatches.forEach((p) => scene.add(p))
    return () => {
      scene.remove(markersSet.group)
      patches.forEach((p) => scene.remove(p))
      polarPatches.forEach((p) => scene.remove(p))
      markersSet.dispose()
    }
  }, [scene, markersSet, patches, polarPatches])

  // the real stars behind the Moon (starField.ts), over the NASA SVS star map with the Milky Way (skyMap.ts)
  const [stars] = useState(() => new StarField(gl.getPixelRatio()))
  const [sky] = useState(() => new SkyMap(gl))
  useEffect(() => {
    scene.add(sky.mesh)
    scene.add(stars.points)
    return () => {
      scene.remove(sky.mesh)
      scene.remove(stars.points)
      sky.dispose()
      stars.dispose()
    }
  }, [scene, stars, sky])

  // Places on the globe, just above the (exaggerated) relief; crater outlines as small circles on the sphere. `exag`
  // is the mesh's exaggeration to half a unit (the mesh's own is within ±0.25 of it, and the places are rebuilt only
  // when the half unit changes), so places above the sphere use the most the mesh can have and places below it the
  // least: they never sink under the surface between rebuilds.
  useEffect(() => {
    const radius = (lat: number, lon: number) => {
      const h = globeHeight(data, lat, lon)
      return MOON_R_KM + ((h + 300) / 1000) * (h >= 0 ? exag + 0.25 : exag - 0.25)
    }
    markersSet.set(sites, markerStyle, {
      anchor: (s) => new THREE.Vector3(...latLonToScene(s.lat, s.lon, radius(s.lat, s.lon))),
      ring: (s) => {
        if (!s.diameterKm) return null
        const c = new THREE.Vector3(...latLonToScene(s.lat, s.lon, 1)).normalize()
        const e1 = new THREE.Vector3(0, 1, 0).cross(c)
        if (e1.lengthSq() < 1e-9) e1.set(1, 0, 0)
        e1.normalize()
        const e2 = c.clone().cross(e1)
        const theta = s.diameterKm / 2 / MOON_R_KM
        const r = radius(s.lat, s.lon)
        const n = 64
        const out = new Float32Array((n + 1) * 3)
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2
          const p = c.clone().multiplyScalar(Math.cos(theta))
            .addScaledVector(e1, Math.sin(theta) * Math.cos(a))
            .addScaledVector(e2, Math.sin(theta) * Math.sin(a))
            .multiplyScalar(r)
          out.set([p.x, p.y, p.z], i * 3)
        }
        return out
      },
    })
    orbit.setMarkerPicker((px, py) => markersSet.pick(px, py, camera as THREE.PerspectiveCamera, size.width, size.height))
    sceneVersion.current++
  }, [markersSet, sites, markerStyle, data, camera, size, orbit, exag])

  useEffect(() => {
    pickRef.current = (cx, cy) => {
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(cx * 2 - 1, -(cy * 2 - 1)), camera)
      const o = ray.ray.origin
      const d = ray.ray.direction
      const hit = raySphere([o.x, o.y, o.z], [d.x, d.y, d.z])
      return hit ? sceneToLatLon(hit) : null
    }
  }, [camera, pickRef])

  const camDir = useMemo(() => new THREE.Vector3(), [])
  const toPoint = useMemo(() => new THREE.Vector3(), [])
  /** Whether the view is the close-up one (orbit.ts, isNearView); null before the first frame. */
  const near = useRef<boolean | null>(null)

  useFrame((_, dt) => {
    // no idle rotation in mission mode (P4): forced anchored, without touching the user's own pin, restored on leaving
    orbit.setAnchored(useGlobe.getState().anchored || useApp.getState().mode === 'mission')
    orbit.fit(size.width, size.height, useInsets.getState(), FOV)
    // cinematic mode: the whole Moon, turning by itself whatever the pin (app/Cinematic.tsx)
    orbit.setCinematic(useCinematic.getState().on, window.innerWidth, window.innerHeight, FOV)
    orbit.step(dt, reduced)
    const n = orbit.now

    // Close-up view, judged where the camera is going so the tilt starts with the zoom: crossing into it tilts the
    // view to 3D, crossing out of it sets it straight (2D); between crossings the 3D button decides. The first frame
    // is a crossing too, so the globe opens on the whole Moon in 2D even if the polar map was left in 3D. Not while
    // the horizon view opens or closes: the camera comes down over the place on purpose then.
    const isNear = isNearView(near.current, orbit.goal.dist - MOON_R_KM)
    if (isNear !== near.current) {
      near.current = isNear
      const app = useApp.getState()
      const want = isNear ? '3d' : '2d'
      if (useHorizonTransition.getState().phase === 'map' && app.view !== want) app.set({ view: want })
    }

    const cam = camera as THREE.PerspectiveCamera
    placeCamera(cam, n, orbit.view.tilt, orbit.view.heading, size.width, size.height)
    if (regionRing.visible) (regionRing.material as LineMaterial).resolution.set(size.width, size.height)

    // the Sun at the active instant
    const { tMs } = useApp.getState()
    // low graphics: no stars, no Milky Way, no shadows cast by the terrain; and while the Moon turns by itself no new
    // detail tiles and fewer frames (LOW_SPIN_FPS)
    const low = useGraphics.getState().low
    const lean = low && orbit.isSpinning()
    stars.points.visible = !low
    sky.mesh.visible = !low
    if (!low) {
      stars.update(tMs, gl.getPixelRatio())
      sky.update(tMs)
    }
    material.uniforms.uPolarShadow.value = !low && polar.shadowReady ? 1 : 0
    if (eph?.table.covers(tMs)) {
      const s = eph.table.positions(tMs)
      const len = Math.hypot(s[0], s[1], s[2])
      setSun(material, s[0] / len, s[1] / len, s[2] / len)
    }

    // photo mode drapes the photo over the whole Moon, polar cap included, at every height
    const wantPolarPhoto = surface === 'photo'
    if (polarPhoto.current !== wantPolarPhoto) {
      polarPhoto.current = wantPolarPhoto
      polar.setPhoto(wantPolarPhoto)
    }

    // detail tiles for the part of the Moon in view
    const e = reliefExaggeration(n.dist)
    setExaggeration(material, e)

    // the grids of relief around the place in view; the globe leaves out what the outermost one draws. Near the south
    // pole they are laid out in polar metres instead (and the latitude/longitude ones are not drawn).
    const polarView = n.lat < POLAR_PATCH_LAT
    const [px, py] = polarXY(n.lat, n.lon)
    const pWindows = polarView ? polarPatchWindows(px, py, n.dist - MOON_R_KM) : []
    polarPatches.forEach((mesh, l) => {
      const w = pWindows[l]
      mesh.visible = !!w
      if (!w) return
      const u = mesh.material.uniforms
      ;(u.uPWin.value as THREE.Vector4).set(w.x, w.y, w.cellM, l === pWindows.length - 1 ? 1 : 0)
      u.uSkirtKm.value = Math.max(0.5, (2 * w.cellM) / 1000)
      const inner = pWindows[l - 1]
      setPolarHole(u.uPolarHole.value as THREE.Vector4, inner)
    })
    const pOuter = pWindows[pWindows.length - 1]
    setPolarHole(material.uniforms.uPolarHole.value as THREE.Vector4, pOuter)
    const windows = polarView ? [] : patchWindows(n.lat, n.lon, n.dist - MOON_R_KM)
    patches.forEach((mesh, l) => {
      const w = windows[l]
      mesh.visible = !!w
      if (!w) return
      const u = mesh.material.uniforms
      ;(u.uWin.value as THREE.Vector4).set(w.lon, w.lat, w.cellLon, w.cellLat)
      u.uSkirtKm.value = Math.max(0.5, 2 * w.cellKm)
      const inner = windows[l - 1]
      ;(u.uHole.value as THREE.Vector4).fromArray(inner ? holeOf(inner) : NO_HOLE)
    })
    const outer = windows[windows.length - 1]
    ;(material.uniforms.uHole.value as THREE.Vector4).fromArray(outer ? holeOf(outer) : NO_HOLE)
    const half = Math.round(e * 2) / 2
    if (half !== exag) onExag(half)
    const g = orbit.goal
    const dpr = gl.getPixelRatio()
    const view = { fovDeg: FOV, widthPx: size.width * dpr, heightPx: size.height * dpr }
    // over the pole the latitude/longitude tiles are not needed (the polar ones are drawn there) and would squeeze
    // into hundreds of slivers; elsewhere they load as before
    if (!polarView && !lean) detail.update(dt, { ...view, lat: n.lat, lon: n.lon, distKm: n.dist }, { ...view, lat: g.lat, lon: g.lon, distKm: g.dist }, material, isNear)
    // the polar tiles for what the camera sees (culled to the view, finer nearer the camera)
    cam.updateMatrixWorld()
    frustum.setFromProjectionMatrix(projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
    if (!lean) polar.update(dt, {
      position: [cam.position.x, cam.position.y, cam.position.z],
      pixelRad: ((FOV * Math.PI) / 180) / Math.max(1, size.height),
      visible: (c, r) => frustum.intersectsSphere(sphere.set(sphere.center.set(c[0], c[1], c[2]), r)),
    })

    // mission mode: enter the polar map once the flight down to a region centre has arrived (not while the horizon
    // view opens or closes: then the camera comes down over the place on purpose)
    if (useHorizonTransition.getState().phase === 'map') {
      const target = orbit.arrived()
      if (target) {
        onEnter(target[0], target[1])
        return
      }
    }

    // places on the visible hemisphere only (a point is hidden when the sphere is between it and the camera)
    camDir.copy(cam.position)
    markersSet.update(cam, size.width, size.height, true, (p) => {
      toPoint.copy(camDir).sub(p)
      return p.dot(toPoint) > 0
    })

    // Fewer pixels while the camera moves on a slow GPU (MOVING_*): the shader's cost goes with the pixel count
    const m = motion.current
    cam.updateMatrixWorld()
    let moved = false
    cam.matrixWorld.elements.forEach((v, k) => {
      if (m.last[k] !== v) {
        m.last[k] = v
        moved = true
      }
    })
    // the Moon turning by itself (idle, cinematic) keeps its full pixels: that is a view to look at, not a drag
    const driven = moved && !orbit.isSpinning()
    m.still = driven ? 0 : m.still + dt
    const moving = m.still < MOVING_SETTLE_S
    if (moving && driven && dt < 0.25) {
      m.frames++
      m.time += dt
      if (m.time >= MOVING_WINDOW_S) {
        if (m.frames / m.time < SLOW_FPS) m.factor = Math.max(MOVING_MIN, m.factor * MOVING_STEP)
        m.frames = 0
        m.time = 0
      }
    } else if (!moving) {
      m.frames = 0
      m.time = 0
    }
    // low graphics: a pixel ratio of at most 1
    const base = useGraphics.getState().low ? Math.min(1, perf.current.dpr) : perf.current.dpr
    const wantDpr = moving ? base * m.factor : base
    if (Math.abs(wantDpr - gl.getPixelRatio()) > 1e-3) setDpr(wantDpr)

    // Draw only when the picture changed (this callback has a priority, so React Three Fiber leaves the drawing to
    // it): the camera, the canvas, the Sun, the relief, the detail tiles or the places. A pinned or just-touched
    // Moon costs the GPU two frames a second instead of sixty; a frame is still drawn every IDLE_REDRAW_S in case a
    // change went uncounted.
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
    const pm = cam.projectionMatrix.elements
    put(pm[0]); put(pm[5]); put(pm[8]); put(pm[9]); put(pm[10]); put(pm[14])
    put(size.width); put(size.height); put(gl.getPixelRatio())
    const u = material.uniforms
    const sun = u.uSun.value as THREE.Vector3
    put(sun.x); put(sun.y); put(sun.z)
    put(u.uExag.value as number); put(u.uMaxLevel.value as number); put(u.uPhotoMode.value as number)
    put(u.uPolarMaxZ.value as number); put(u.uPolarShadow.value as number)
    // a detail tile that arrives is written into these textures, which raises their version
    for (const name of ['uDetail', 'uIndex', 'uPhoto', 'uPhotoIndex', 'uPolarH', 'uPolarHIndex', 'uPolarP', 'uPolarPIndex']) {
      const t = u[name].value as THREE.Texture
      put(t.id); put(t.version)
    }
    put(sceneVersion.current)
    put(low ? 1 : 0)
    d.at += dt
    // a frame skipped for LOW_SPIN_FPS is still owed: the signature is spoilt so the next frame draws
    const held = changed && lean && d.at < 1 / LOW_SPIN_FPS - 0.002
    if (held) sig[0] = NaN
    const draw = (changed && !held) || d.at >= IDLE_REDRAW_S
    if (draw) {
      gl.render(scene, cam)
      d.at = 0
    }

    // A slow GPU gets fewer pixels: below SLOW_FPS over WINDOW_S of continuous drawing the pixel ratio goes down a
    // step (to 1.5, then 1). Not judged in the first GRACE_S, on a hidden page or after a stall.
    const p = perf.current
    const streak = draw && d.was
    d.was = draw
    p.age += dt
    if (document.visibilityState !== 'visible' || dt > 0.25 || !streak) {
      p.frames = 0
      p.time = 0
      return
    }
    p.frames++
    p.time += dt
    if (p.time < WINDOW_S) return
    const fps = p.frames / p.time
    p.frames = 0
    p.time = 0
    if (p.age > GRACE_S && fps < SLOW_FPS && p.dpr > 1) {
      p.dpr = p.dpr > 1.5 ? 1.5 : 1
      // resizing the canvas clears it: draw again at once, so no empty frame is shown
      setDpr(p.dpr)
      gl.render(scene, cam)
    }
  }, 1)

  return <mesh geometry={geometry} material={material} />
}

