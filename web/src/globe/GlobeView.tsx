/**
 * The whole Moon, from global LOLA topography, lit by the Sun at the chosen instant. Drag turns it, the wheel
 * brings it closer; a click on the south-polar cap (or zooming in over it) enters the detailed polar map there.
 * Catalogue sites are buttons over the globe; the panels hold the same information as text.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ToolPortal } from '../ui/ToolSlot'
import { IconMinus, IconPin, IconPlus, IconPole } from '../ui/icons'
import { useGlobe } from '../state/globe'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useInsets } from '../state/layout'
import { type MarkerStyle, useApp } from '../state/store'
import { MarkerSet } from '../map/markerSet'
import { type MapSite, useMapSites } from '../map/useMapSites'
import { TileLoader } from '../terrain/loader'
import { useEphemeris, useMasks } from '../time/hooks'
import { DATA_BASE } from '../time/staticData'
import { MOON_R_KM, type Orbit, OrbitRig, latLonToScene, raySphere, sceneToLatLon } from './orbit'
import { GLOBE_FRAG, GLOBE_VERT } from './shaders'

const FOV = 35
/** The polar map covers the disc south of this latitude (the LOLA polar grids). */
export const MAP_DISC_LAT = -60
/** Zooming in closer than this over the polar cap enters the map. */
const ENTER_MAP_DIST = MOON_R_KM * 1.18
const RELIEF_EXAGGERATION = 4

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

/** A first view of the whole Moon, turned so the south pole faces the viewer. */
const START: Orbit = { lat: -48, lon: 10, dist: MOON_R_KM * 3.4 }

export function GlobeView() {
  const globe = useQuery({ queryKey: ['static', 'globe'], queryFn: loadGlobe, staleTime: Infinity, gcTime: Infinity, retry: 1 })
  const masks = useMasks().data
  const sites = useMapSites()
  const markerStyle = useApp((s) => s.markerStyle)
  const select = useApp((s) => s.select)
  const enterMap = useApp((s) => s.enterMap)
  const [orbit] = useState(() => new OrbitRig(START))
  const anchored = useGlobe((s) => s.anchored)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const pickRef = useRef<((cx: number, cy: number) => [number, number] | null) | null>(null)

  // Picking a place in the panels turns the globe toward it.
  useEffect(() => {
    let seq = useApp.getState().focusSeq
    return useApp.subscribe((s) => {
      if (s.focusSeq === seq) return
      seq = s.focusSeq
      const sel = s.selection
      const site = sel.kind === 'site' ? masks?.site(sel.id) : null
      const ll = sel.kind === 'point' ? [sel.lat, sel.lon] : site ? [site.lat, site.lon] : null
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
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    orbit.drag(dx, dy, e.currentTarget.clientHeight, FOV, true)
    d.x = e.clientX
    d.y = e.clientY
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const rect = e.currentTarget.getBoundingClientRect()
    const site = orbit.markerAt(e.clientX - rect.left, e.clientY - rect.top) as MapSite | null
    if (site) {
      select(site.sel)
      return goTo(site.lat, site.lon)
    }
    const ll = pickRef.current?.((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
    if (ll) goTo(ll[0], ll[1])
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>) => orbit.zoom(Math.exp(e.deltaY * 0.0012))

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
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        {globe.data ? (
          <Canvas camera={{ fov: FOV, near: 10, far: 50_000, position: [0, 0, 6000] }} dpr={[1, 2]} flat linear gl={{ antialias: true }} aria-hidden="true">
            <GlobeScene
              data={globe.data}
              orbit={orbit}
              sites={sites}
              markerStyle={markerStyle}
              pickRef={pickRef}
              onEnter={(lat, lon) => enterMap(lat, lon)}
            />
          </Canvas>
        ) : (
          <p className="map-loading" role="status">
            {globe.isError ? 'Global LOLA topography not available.' : 'Loading the Moon…'}
          </p>
        )}
        <p id="globe-help" className="sr-only">
          Arrow keys turn the Moon, plus and minus zoom, Enter opens the detailed south-polar map. Sites are listed, with the same information, in the panels.
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
      </div>
      </ToolPortal>
      <p className="globe-caption">Global LOLA topography (relief ×{RELIEF_EXAGGERATION}) · lit by the Sun at the chosen time</p>
    </>
  )
}

/** Camera on the orbit, the Moon's centre in the middle of the space the panels leave free. */
function placeCamera(cam: THREE.PerspectiveCamera, n: Orbit, w: number, h: number) {
  const ins = useInsets.getState()
  const cx = ins.left + (w - ins.left - ins.right) / 2
  const cy = ins.top + (h - ins.top - ins.bottom) / 2
  cam.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h)
  const p = latLonToScene(n.lat, n.lon, n.dist)
  cam.position.set(p[0], p[1], p[2])
  cam.up.set(0, 1, 0)
  cam.lookAt(0, 0, 0)
  cam.near = Math.max(1, n.dist - MOON_R_KM * 1.05)
  cam.far = n.dist + MOON_R_KM * 2
  cam.updateProjectionMatrix()
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
  onEnter: (lat: number, lon: number) => void
}

/** Height (m) of the global grid at a point, nearest sample. */
function globeHeight(data: SceneProps['data'], lat: number, lon: number): number {
  const { width, height } = data.meta
  const col = Math.floor((((lon % 360) + 360) % 360) / 360 * width) % width
  const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)))
  return data.heights[row * width + col]
}

function GlobeScene({ data, orbit, sites, markerStyle, pickRef, onEnter }: SceneProps) {
  const { camera, size, scene } = useThree()
  const [markersSet] = useState(() => new MarkerSet())
  const eph = useEphemeris().data
  const [reduced] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
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
        uExag: { value: RELIEF_EXAGGERATION },
        uSun: { value: new THREE.Vector3(1, 0, 0) },
        uDiscLat: { value: MAP_DISC_LAT },
      },
    })
  })
  const [geometry] = useState(() => new THREE.SphereGeometry(MOON_R_KM, 512, 256))
  useEffect(
    () => () => {
      material.uniforms.uHeight.value.dispose()
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )

  useEffect(() => {
    scene.add(markersSet.group)
    return () => {
      scene.remove(markersSet.group)
      markersSet.dispose()
    }
  }, [scene, markersSet])

  // Places on the globe, just above the (exaggerated) relief; crater outlines as small circles on the sphere.
  useEffect(() => {
    const radius = (lat: number, lon: number) => MOON_R_KM + ((globeHeight(data, lat, lon) + 300) / 1000) * RELIEF_EXAGGERATION
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
  }, [markersSet, sites, markerStyle, data, camera, size, orbit])

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

  useFrame((_, dt) => {
    orbit.setAnchored(useGlobe.getState().anchored)
    orbit.fit(size.width, size.height, useInsets.getState(), FOV)
    orbit.step(dt, reduced)
    const n = orbit.now

    const cam = camera as THREE.PerspectiveCamera
    placeCamera(cam, n, size.width, size.height)

    // the Sun at the active instant
    const { tMs } = useApp.getState()
    if (eph?.table.covers(tMs)) {
      const s = eph.table.positions(tMs)
      const len = Math.hypot(s[0], s[1], s[2])
      setSun(material, s[0] / len, s[1] / len, s[2] / len)
    }

    // enter the polar map once the flight down has arrived, or when zoomed in over the cap
    const target = orbit.arrived()
    if (target) {
      onEnter(target[0], target[1])
      return
    }
    if (!orbit.isDiving && orbit.goal.dist < ENTER_MAP_DIST && n.lat <= MAP_DISC_LAT + 2) {
      onEnter(Math.min(n.lat, MAP_DISC_LAT - 1), n.lon)
      return
    }

    // places on the visible hemisphere only (a point is hidden when the sphere is between it and the camera)
    camDir.copy(cam.position)
    markersSet.update(cam, size.width, size.height, true, (p) => {
      toPoint.copy(camDir).sub(p)
      return p.dot(toPoint) > 0
    })
  })

  return <mesh geometry={geometry} material={material} />
}

