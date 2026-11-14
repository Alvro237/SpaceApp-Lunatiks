/**
 * First-person horizon view: the camera stands on the chosen place (at the mast height of the horizon mask) and
 * looks around the real horizon. Opened by the Horizon section; it covers the map until the section closes.
 *
 * Drag to look around (360°) and up or down, wheel or +/− to zoom, arrow keys to turn, S / E to follow the Sun or
 * the Earth, F for free look, Escape to go back to the map. Following keeps the body in the centre while time
 * plays. The accessible name says where the camera faces and where the Sun and the Earth are.
 */
import { type KeyboardEvent, type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNow } from '../panels/useNow'
import { useInsets } from '../state/layout'
import { usePanels } from '../state/panels'
import { useHorizonCam } from '../state/horizon'
import { IconBack, IconMinus, IconPlus } from '../ui/icons'
import { ToolPortal } from '../ui/ToolSlot'
import { drawHorizon } from './draw'
import { cameraFor, compass16, wrap180 } from './project'
import { useEffectiveCamera } from './useEffectiveCamera'

const state = (f: number) => (f >= 0.999 ? 'fully visible' : f > 0 ? `${Math.round(f * 100)} percent visible` : 'hidden by the horizon')

export function HorizonView() {
  const { view, info, series } = useNow()
  const insets = useInsets()
  const cam = useEffectiveCamera()
  const { look, zoom, setMode } = useHorizonCam.getState()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

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
  const freeW = Math.max(120, size.w - free.left - free.right)
  const cx = free.left + freeW / 2
  const cy = free.top + Math.max(120, size.h - free.top - free.bottom) * 0.58
  const camera = useMemo(() => cameraFor(cam.yaw, cam.pitch, cam.fov, freeW, cx, cy), [cam.yaw, cam.pitch, cam.fov, freeW, cx, cy])

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
    drawHorizon(ctx, size.w, size.h, camera, {
      horizonAt: (az) => h.at(az),
      sun: view.sun,
      earth: view.earth,
      sunTrack: tracks.sun,
      earthTrack: tracks.earth,
      free,
    })
  }, [camera, view, info, size, tracks, free])

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
