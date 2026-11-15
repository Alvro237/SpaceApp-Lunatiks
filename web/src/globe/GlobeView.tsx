/**
 * The whole Moon, from global LOLA topography, lit by the Sun at the chosen instant. Drag turns it, the wheel
 * brings it closer toward the place under the pointer; zooming in over the south-polar cap hands over to the
 * detailed polar map there (finer tiles, top-down, with its 3D tilt). A click on the surface marks that point
 * (study mode, as on the map) and turns the Moon toward it; a click on a place selects it.
 * Catalogue sites are buttons over the globe; the panels hold the same information as text.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { SkyMap } from './skyMap'
import { StarField } from './starField'
import { ToolPortal } from '../ui/ToolSlot'
import { usePlaceStyles } from '../state/placeStyle'
import { IconCube, IconMinus, IconPin, IconPlus, IconPole } from '../ui/icons'
import { useGlobe } from '../state/globe'
import { useHorizonTransition } from '../state/horizon'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, type MouseEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useInsets } from '../state/layout'
import { type MarkerStyle, type ViewMode, useApp } from '../state/store'
import { MarkerSet } from '../map/markerSet'
import { type MapSite, useMapSites } from '../map/useMapSites'
import { TileLoader } from '../terrain/loader'
import { prefetchMap } from '../terrain/prefetch'
import { useEphemeris, useMasks } from '../time/hooks'
import { DATA_BASE } from '../time/staticData'
import { GlobeDetail } from './detail/globeDetail'
import { MIN_DIST, MOON_R_KM, type Orbit, OrbitRig, RELIEF_MAX, TILT_3D, cameraPose, isNearView, latLonToScene, nearPlaneKm, raySphere, reliefExaggeration, sceneToLatLon } from './orbit'
import { PATCH_LEVELS, holeOf, patchGeometry, patchWindows } from './patch'
import { GLOBE_FRAG, GLOBE_VERT, PATCH_VERT } from './shaders'

const FOV = 35
/** The polar map covers the disc south of this latitude (the LOLA polar grids). */
export const MAP_DISC_LAT = -60
/**
 * Zooming in closer than this over the polar cap enters the map: about 1 400 km above the surface, where the view
 * spans roughly the polar cap (the map's disc to 60 S is about 1 800 km across) and the map's 20 m to 240 m tiles
 * beat the globe's. The map then flies on down to 450 km over the place (TerrainView).
 */
const ENTER_MAP_DIST = MOON_R_KM * 1.8
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

export async function loadGlobe(): Promise<{ meta: GlobeMeta; heights: Float32Array }> {
  const meta = (await (await fetch(`${DATA_BASE}globe/globe.json`)).json()) as GlobeMeta
  const loader = new TileLoader(1)
  try {
    const res = await loader.request('globe', { url: `${DATA_BASE}globe/${meta.file}`, kind: 'height', min: meta.min, max: meta.max })
    return { meta, heights: res.heights! }
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
const GRACE_S = 3

/** A first view of the whole Moon, turned so the south pole faces the viewer. */
const START: Orbit = { lat: -48, lon: 10, dist: MOON_R_KM * 3.4 }

export function GlobeView() {
  const globe = useQuery({ queryKey: ['static', 'globe'], queryFn: loadGlobe, staleTime: Infinity, gcTime: Infinity, retry: 1 })
  const masks = useMasks().data
  const queryClient = useQueryClient()
  // once the globe has its own data, bring in what the polar map opens with (terrain/prefetch.ts)
  const globeReady = !!globe.data
  useEffect(() => {
    if (!globeReady) return
    const t = setTimeout(() => prefetchMap(queryClient), 1500)
    return () => clearTimeout(t)
  }, [globeReady, queryClient])
  const sites = useMapSites()
  const markerStyle = useApp((s) => s.markerStyle)
  const select = useApp((s) => s.select)
  const mode = useApp((s) => s.mode)
  const openMenu = usePlaceStyles((s) => s.openMenu)
  const enterMap = useApp((s) => s.enterMap)
  const [orbit] = useState(() => new OrbitRig(START))
  const [surface, setSurface] = useState<GlobeSurface>('photo')
  /** The mesh's relief exaggeration, to half a unit (for the caption and the markers' height). */
  const [exag, setExag] = useState(RELIEF_MAX)
  const anchored = useGlobe((s) => s.anchored)
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
  const covered = underHorizon || underBlocks
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

  /** Fly down to a point and open the map there (polar cap), or just turn toward it (elsewhere). */
  const goTo = (lat: number, lon: number) => {
    if (lat <= MAP_DISC_LAT) orbit.dive(lat, lon, ENTER_MAP_DIST * 0.98)
    else orbit.turnTo(lat, lon)
  }

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
      Enter: () => goTo(orbit.goal.lat <= MAP_DISC_LAT ? orbit.goal.lat : -90, orbit.goal.lat <= MAP_DISC_LAT ? orbit.goal.lon : 0),
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
      else orbit.turnTo(ll[0], ll[1])
    }, DOUBLE_CLICK_MS)
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
    // close enough over the polar cap: hand over to the map there, as the wheel does
    if (!orbit.isDiving && orbit.goal.dist < ENTER_MAP_DIST && ll[0] <= MAP_DISC_LAT && useHorizonTransition.getState().phase === 'map') goTo(ll[0], ll[1])
  }
  // zooming in goes toward the place under the pointer, so zooming over the pole reaches the polar map there
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const factor = Math.exp(e.deltaY * 0.0012)
    const rect = e.currentTarget.getBoundingClientRect()
    const ll = factor < 1 ? pickRef.current?.((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height) : null
    if (!ll) return orbit.zoom(factor)
    orbit.zoomToward(factor, ll[0], ll[1])
    // close enough over the polar cap: fly down to the place under the pointer and hand over to the map there
    if (!orbit.isDiving && orbit.goal.dist < ENTER_MAP_DIST && ll[0] <= MAP_DISC_LAT && useHorizonTransition.getState().phase === 'map') goTo(ll[0], ll[1])
  }

  return (
    <>
      <div
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
            />
          </Canvas>
        ) : (
          <p className="map-loading" role="status">
            {globe.isError ? 'Global LOLA topography not available.' : 'Loading the Moon…'}
          </p>
        )}
        <p id="globe-help" className="sr-only">
          Arrow keys turn the Moon, plus and minus zoom, T tilts the view to 3D, Q and E turn it, R sets it straight
          again, Enter opens the detailed south-polar map; zooming in over the south pole opens it too. Zooming in
          close anywhere else tilts the view to 3D and loads the finest detail; zooming back out sets it straight. A click on
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
        <button type="button" onClick={() => enterMap()} aria-label="South pole map" title="Detailed south-polar map">
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
        <button
          type="button"
          aria-pressed={surface === 'photo'}
          onClick={() => setSurface(surface === 'photo' ? 'relief' : 'photo')}
          title="Drape the LROC WAC photo mosaic over the 3D relief lit by the Sun"
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

function setExaggeration(m: THREE.ShaderMaterial, e: number) {
  m.uniforms.uExag.value = e
}

/** Unit vector to the Sun, Moon Mean-Earth axes. */
function setSun(m: THREE.ShaderMaterial, x: number, y: number, z: number) {
  ;(m.uniforms.uSun.value as THREE.Vector3).set(x, y, z)
}

interface SceneProps {
  data: { meta: GlobeMeta; heights: Float32Array }
  orbit: OrbitRig
  sites: MapSite[]
  markerStyle: MarkerStyle
  pickRef: { current: ((cx: number, cy: number) => [number, number] | null) | null }
  surface: GlobeSurface
  /** Relief exaggeration to half a unit, as the caption shows it. */
  exag: number
  onExag: (exag: number) => void
  onEnter: (lat: number, lon: number) => void
}

/** Height (m) of the global grid at a point, nearest sample. */
function globeHeight(data: SceneProps['data'], lat: number, lon: number): number {
  const { width, height } = data.meta
  const col = Math.floor((((lon % 360) + 360) % 360) / 360 * width) % width
  const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)))
  return data.heights[row * width + col]
}

function GlobeScene({ data, orbit, sites, markerStyle, pickRef, surface, exag, onExag, onEnter }: SceneProps) {
  const { camera, size, scene, gl, setDpr, viewport } = useThree()
  const [markersSet] = useState(() => new MarkerSet())
  /** What the last drawn frame showed (camera, canvas, Sun, relief, detail tiles): a frame is drawn when it differs. */
  const drawn = useRef({ sig: new Float64Array(40), at: Infinity, was: false })
  const sceneVersion = useRef(0)
  /** Frame rate over continuous drawing, to lower the pixel ratio on a slow GPU (the pixel ratio the canvas started with first). */
  const perf = useRef({ frames: 0, time: 0, age: 0, dpr: viewport.dpr })
  const eph = useEphemeris().data
  const [reduced] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [detail] = useState(() => new GlobeDetail())
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
        uDetailShade: { value: DETAIL_SHADE_EXAGGERATION },
        uHole: { value: new THREE.Vector4() },
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
        uniforms: { ...material.uniforms, uWin: { value: new THREE.Vector4() }, uSkirtKm: { value: 1 }, uHole: { value: new THREE.Vector4() } },
      })
      const mesh = new THREE.Mesh(grid, m)
      mesh.frustumCulled = false // its vertices are placed by the shader
      mesh.visible = false
      return mesh
    })
  })
  const [geometry] = useState(() => new THREE.SphereGeometry(MOON_R_KM, 512, 256))
  useEffect(
    () => () => {
      material.uniforms.uHeight.value.dispose()
      material.dispose()
      geometry.dispose()
      detail.dispose()
      patches[0].geometry.dispose()
      patches.forEach((p) => p.material.dispose())
    },
    [material, geometry, detail, patches],
  )

  // the surface shown picks which detail tiles the shader reads; work out the wanted tiles again at once
  useEffect(() => detail.setKind(material, surface === 'photo' ? 'photo' : 'dem'), [surface, material, detail])

  useEffect(() => {
    scene.add(markersSet.group)
    patches.forEach((p) => scene.add(p))
    return () => {
      scene.remove(markersSet.group)
      patches.forEach((p) => scene.remove(p))
      markersSet.dispose()
    }
  }, [scene, markersSet, patches])

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
    orbit.setAnchored(useGlobe.getState().anchored)
    orbit.fit(size.width, size.height, useInsets.getState(), FOV)
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

    // the Sun at the active instant
    const { tMs } = useApp.getState()
    stars.update(tMs, gl.getPixelRatio())
    sky.update(tMs)
    if (eph?.table.covers(tMs)) {
      const s = eph.table.positions(tMs)
      const len = Math.hypot(s[0], s[1], s[2])
      setSun(material, s[0] / len, s[1] / len, s[2] / len)
    }

    // detail tiles for the part of the Moon in view
    const e = reliefExaggeration(n.dist)
    setExaggeration(material, e)

    // the grids of relief around the place in view; the globe leaves out what the outermost one draws
    const windows = patchWindows(n.lat, n.lon, n.dist - MOON_R_KM)
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
    detail.update(dt, { ...view, lat: n.lat, lon: n.lon, distKm: n.dist }, { ...view, lat: g.lat, lon: g.lon, distKm: g.dist }, material, isNear)

    // enter the polar map once the flight down has arrived, or when zoomed in over the cap
    // (not while the horizon view opens or closes: then the camera comes down over the place on purpose)
    if (useHorizonTransition.getState().phase === 'map') {
      const target = orbit.arrived()
      if (target) {
        onEnter(target[0], target[1])
        return
      }
      if (!orbit.isDiving && orbit.goal.dist < ENTER_MAP_DIST && n.lat <= MAP_DISC_LAT + 2) {
        onEnter(Math.min(n.lat, MAP_DISC_LAT - 1), n.lon)
        return
      }
    }

    // places on the visible hemisphere only (a point is hidden when the sphere is between it and the camera)
    camDir.copy(cam.position)
    markersSet.update(cam, size.width, size.height, true, (p) => {
      toPoint.copy(camDir).sub(p)
      return p.dot(toPoint) > 0
    })

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
    // a detail tile that arrives is written into these textures, which raises their version
    for (const name of ['uDetail', 'uIndex', 'uPhoto', 'uPhotoIndex']) {
      const t = u[name].value as THREE.Texture
      put(t.id); put(t.version)
    }
    put(sceneVersion.current)
    d.at += dt
    const draw = changed || d.at >= IDLE_REDRAW_S
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

