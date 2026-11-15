/**
 * First-person horizon view: the camera stands on the chosen place (at the mast height of the horizon mask) and
 * looks around the real horizon. Opened by the Horizon section; it covers the map until the section closes.
 *
 * Drag to look around (360°) and up or down, wheel or +/− to zoom, arrow keys to turn, S / E to follow the Sun or
 * the Earth, F for free look, Escape to go back to the map. Following keeps the body in the centre while time
 * plays. The accessible name says where the camera faces and where the Sun and the Earth are.
 *
 * Arrival: the map's camera has already flown to the place (NavigatorPage, state/horizon); this view finishes the
 * descent from where that flight ended: about 2.5 km up and 14° down from the polar map, about 100 km up and
 * looking further down from the globe. At altitude h the horizon of the curved Moon lies below the level by
 * acos(R / (R + h)) (3° at 2.5 km, 19° at 100 km) and the relief is flat; as the camera comes down the horizon
 * rises and the real relief grows into the LOLA mask, the camera turns to the horizon and the field narrows. The
 * Sun and the Earth do not move (they are far away). The last frame is the exact view. Skipped with reduced motion.
 */
import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNow } from '../panels/useNow'
import { useInsets } from '../state/layout'
import { usePanels } from '../state/panels'
import { useHorizonCam } from '../state/horizon'
import { useApp } from '../state/store'
import { IconBack, IconMinus, IconPlus } from '../ui/icons'
import { ToolPortal } from '../ui/ToolSlot'
import { drawHorizon } from './draw'
import { loadGroundTexture } from './groundTexture'
import { starDirections } from './stars'
import { cameraFor, compass16, wrap180 } from './project'
import { MOON_R_KM } from '../globe/orbit'
import { useEffectiveCamera } from './useEffectiveCamera'
import { type SceneLights, useRelief } from './relief/useRelief'
import { earthPhaseAngle, earthshineRatio } from './relief/light'

const state = (f: number) => (f >= 0.999 ? 'fully visible' : f > 0 ? `${Math.round(f * 100)} percent visible` : 'hidden by the horizon')

/** Length of the arrival descent, ms. */
const DESCENT_MS = 1100
/** Where the descent starts: where the map camera's flight ended (altitude km, pitch and field in degrees). */
const DESCENT_FROM = {
  map: { km: 2.5, pitch: -14, fov: 70 },
  globe: { km: 100, pitch: -24, fov: 110 },
} as const
const easeOut = (p: number) => 1 - (1 - p) ** 3
/** How far below the level the horizon of a smooth Moon lies from an altitude, degrees. */
const dipDeg = (hKm: number) => (Math.acos(MOON_R_KM / (MOON_R_KM + hKm)) * 180) / Math.PI

export function HorizonView({ animate = false }: { animate?: boolean }) {
  const { view, info, series } = useNow()
  const insets = useInsets()
  const cam = useEffectiveCamera()
  // read once: where the map camera was when the view opened
  const [from] = useState(() => DESCENT_FROM[useApp.getState().scale === 'globe' ? 'globe' : 'map'])
  const { look, zoom, setMode } = useHorizonCam.getState()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // 0 → 1 over the arrival descent (1 at once without animation)
  const [arrival, setArrival] = useState(animate ? 0 : 1)
  useEffect(() => {
    if (!animate) return
    const t0 = performance.now()
    let raf = 0
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / DESCENT_MS)
      setArrival(p)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate])

  // focus the view when it opens, so the keyboard drives it at once
  useEffect(() => wrap.current?.focus(), [])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  const free = useMemo(
    () => ({ left: insets.left, right: insets.right, top: insets.top, bottom: insets.bottom }),
    [insets.left, insets.right, insets.top, insets.bottom],
  )
  // the on-screen notice sits just above the time bar (the bar is drawn by the navigator over this view)
  const [noticeBottom, setNoticeBottom] = useState(0)
  useEffect(() => {
    const view = wrap.current
    const bar = document.querySelector<HTMLElement>('.timeline')
    if (!view || !bar) return
    const place = () => setNoticeBottom(Math.max(0, view.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 8))
    place()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    ro?.observe(bar)
    ro?.observe(view)
    return () => ro?.disconnect()
  }, [])

  const freeW = Math.max(120, size.w - free.left - free.right)
  const cx = free.left + freeW / 2
  const cy = free.top + Math.max(120, size.h - free.top - free.bottom) * 0.58
  const e = easeOut(arrival)
  const pitch = arrival < 1 ? from.pitch + (cam.pitch - from.pitch) * e : cam.pitch
  const fov = arrival < 1 ? from.fov + (cam.fov - from.fov) * e : cam.fov
  const camera = useMemo(() => cameraFor(cam.yaw, pitch, fov, freeW, cx, cy), [cam.yaw, pitch, fov, freeW, cx, cy])

  // the real stars over this horizon at the active instant (the Moon turns under them once a month)
  const frame = info?.model.frame
  const tMs = view?.tMs
  const stars = useMemo(() => (frame && tMs !== undefined ? starDirections(tMs, frame) : null), [frame, tMs])

  // the real lunar surface texture of the ground (LROC WAC patch); the illustration is drawn until it arrives
  const [groundReady, setGroundReady] = useState(false)
  useEffect(() => {
    let live = true
    void loadGroundTexture().then((t) => live && setGroundReady(t !== null))
    return () => {
      live = false
    }
  }, [])

  // the real ground around the place: LOLA rings lit by the Sun of the active instant, and at night by the Earth (relief/)
  const sunAz = view?.sun.az
  const sunEl = view?.sun.el
  const sunR = view?.sun.radiusDeg
  const sunUp = (view?.sun.fraction ?? 0) > 0
  const earthAz = view?.earth.az
  const earthEl = view?.earth.el
  const earthR = view?.earth.radiusDeg
  const earthKm = view?.earth.distKm
  const lights = useMemo<SceneLights | null>(() => {
    if (sunAz === undefined || sunEl === undefined || sunR === undefined) return null
    const sun = { az: sunAz, el: sunEl, radiusDeg: sunR }
    // the Earth lights the ground only while some of its disc is above the level (terrain may still hide it)
    const earthUp = earthAz !== undefined && earthEl !== undefined && earthR !== undefined && earthKm !== undefined && earthEl > -earthR - 2
    const earth = earthUp ? { az: earthAz, el: earthEl, radiusDeg: earthR } : null
    const earthRatio = earth ? earthshineRatio(earthPhaseAngle(sun, earth), earthKm!) : 0
    return { sun, sunVisible: sunUp, earth, earthRatio }
  }, [sunAz, sunEl, sunR, sunUp, earthAz, earthEl, earthR, earthKm])
  const relief = useRelief(info?.model.lat, info?.model.lon, info?.mastUsedM ?? 0, lights)
  // full resolution once the camera and the instant have been still for a moment, a lighter pass while they move
  const change = useMemo(() => ({ camera, tMs, arrival, scene: relief.scene }), [camera, tMs, arrival, relief.scene])
  const [still, setStill] = useState<typeof change | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setStill(change), 160)
    return () => clearTimeout(id)
  }, [change])
  const fine = still === change

  const tracks = useMemo(() => {
    const samples = series?.samples ?? []
    return {
      sun: samples.map((s) => ({ az: s.sun.az, el: s.sun.el })),
      earth: samples.map((s) => ({ az: s.earth.az, el: s.earth.el })),
    }
  }, [series])

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !view || !info || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const h = info.model.horizon
    // during the descent: the smooth-Moon horizon of the current altitude, blending into the real mask
    const k = easeOut(arrival)
    const dip = -dipDeg(from.km * (1 - k))
    drawHorizon(ctx, size.w, size.h, camera, {
      horizonAt: arrival < 1 ? (az) => dip * (1 - k) + h.at(az) * k : (az) => h.at(az),
      sun: view.sun,
      earth: view.earth,
      sunTrack: tracks.sun,
      earthTrack: tracks.earth,
      free,
      showLabels: arrival >= 1,
      stars,
      // during the descent the eye comes down over the same ground
      relief: relief.scene ? { scene: arrival < 1 ? { ...relief.scene, eyeM: relief.scene.eyeM + from.km * 1000 * (1 - k) } : relief.scene, fine: fine && arrival >= 1 } : null,
    })
  }, [camera, view, info, size, tracks, free, arrival, stars, groundReady, relief.scene, fine, from.km])

  const turn = (dYaw: number, dPitch: number) => look(cam.yaw + dYaw, cam.pitch + dPitch)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    // the ground follows the pointer: dragging right turns the camera left
    look(d.yaw - (e.clientX - d.x) * camera.degPerPx, d.pitch + (e.clientY - d.y) * camera.degPerPx)
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>) => zoom(Math.exp(e.deltaY * 0.0012))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = Math.max(1, cam.fov / 8)
    const keys: Record<string, () => void> = {
      ArrowLeft: () => turn(-step, 0),
      ArrowRight: () => turn(step, 0),
      ArrowUp: () => turn(0, step / 2),
      ArrowDown: () => turn(0, -step / 2),
      '+': () => zoom(0.8),
      '=': () => zoom(0.8),
      '-': () => zoom(1.25),
      s: () => setMode('sun'),
      e: () => setMode('earth'),
      f: () => look(cam.yaw, cam.pitch),
      Escape: () => usePanels.getState().setSection(null),
    }
    const fn = keys[e.key] ?? keys[e.key.toLowerCase()]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }

  const label =
    view && info
      ? `Horizon view from ${info.name}, facing ${compass16(cam.yaw)} (${cam.yaw.toFixed(0)}°) at ${cam.pitch.toFixed(1)}° up, field of view ${cam.fov.toFixed(0)}°. ` +
        `Sun at azimuth ${view.sun.az.toFixed(0)}°, elevation ${view.sun.el.toFixed(1)}°, ${state(view.sun.fraction)}, ${describe(view.sun.az, cam)}. ` +
        `Earth at azimuth ${view.earth.az.toFixed(0)}°, elevation ${view.earth.el.toFixed(1)}°, ${state(view.earth.fraction)}, ${describe(view.earth.az, cam)}.`
      : 'Horizon view, loading'

  return (
    <>
      <div
        ref={wrap}
        className="horizon-view"
        tabIndex={0}
        role="application"
        aria-roledescription="horizon view"
        aria-label={label}
        aria-describedby="horizon-help"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvas} aria-hidden="true" style={{ width: '100%', height: '100%' }} />
        <p className="horizon-notice" style={{ left: free.left + 14, bottom: Math.max(free.bottom + 44, noticeBottom), maxWidth: `calc(100% - ${free.left + 28}px)` }}>
          {relief.status === 'ready'
            ? `Rendered from LOLA heights, not footage · Relief: ${relief.sourceLabel ?? `LOLA ${relief.cellM?.toFixed(0)} m DEM`} to ${(relief.reachKm ?? 0) < 10 ? (relief.reachKm ?? 0).toFixed(1) : (relief.reachKm ?? 0).toFixed(0)} km, ${relief.night === 'earthshine' ? 'night, lit by earthshine (exposure raised)' : relief.night === 'dark' ? 'night, neither the Sun nor the Earth up' : 'lit by the Sun at this instant'} · Skyline: horizon mask`
            : 'Not real moon footage · Real moon horizon line'}
          {relief.status === 'loading' && ' · Loading the LOLA relief around this place…'}
          {relief.status !== 'ready' && groundReady && ' · Ground texture: LROC WAC mosaic, another place on the Moon'}
        </p>
        <p id="horizon-help" className="sr-only">
          Drag or use the arrow keys to look around, plus and minus to zoom, S to follow the Sun, E to follow the Earth, F for free look, Escape to go back to
          the map.
        </p>
      </div>
      <ToolPortal>
        <div className="horizon-tools" role="group" aria-label="Horizon view">
          <div className="tool-group">
            <button type="button" className="tool-btn" onClick={() => zoom(0.8)} aria-label="Zoom in" title="Zoom in (+)">
              <IconPlus />
            </button>
            <button type="button" className="tool-btn" onClick={() => zoom(1.25)} aria-label="Zoom out" title="Zoom out (−)">
              <IconMinus />
            </button>
          </div>
          <button type="button" className="tool-btn" onClick={() => usePanels.getState().setSection(null)} aria-label="Back to the map" title="Back to the map (Esc)">
            <IconBack size={18} /> Map
          </button>
        </div>
      </ToolPortal>
    </>
  )
}

function describe(az: number, cam: { yaw: number; fov: number }): string {
  const off = wrap180(az - cam.yaw)
  if (Math.abs(off) <= cam.fov / 2) return 'in view'
  return `${Math.abs(off).toFixed(0)}° to the ${off > 0 ? 'right' : 'left'}`
}
