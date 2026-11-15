/**
 * The horizon view's real ground for one place: loads the rings (rings.ts), has the worker light them at the
 * active instant (light.worker.ts) and hands the renderer a scene (render.ts). The rings load once per place; the
 * sunlight is recomputed when the Sun has moved enough to move a shadow visibly (SUN_EPS), one job at a time.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { GroundStack, type SunDir } from './light'
import type { LightRequest, LightResponse } from './light.worker'
import { type Ring, loadRing, planeFrame, ringSpecs } from './rings'
import type { ReliefScene } from './render'
import { groundTexture } from '../groundTexture'

/** Eye height over the ground when the mask is for the bare surface (mast 0 m): a standing person's eyes. */
export const EYE_MIN_M = 1.7
/** Sun motion that triggers a new lighting pass, degrees (elevation, azimuth). */
const SUN_EPS = { el: 0.02, az: 0.15 }
/** Most workers that share a lighting pass. */
const MAX_WORKERS = 4

export type ReliefStatus = 'unavailable' | 'loading' | 'ready' | 'failed'

export interface Relief {
  status: ReliefStatus
  scene: ReliefScene | null
  /** Cell of the DEM read at the observer, metres, and the outermost ring's reach, km. */
  cellM: number | null
  reachKm: number | null
  /** Duration of the last lighting pass in the slowest worker, ms. */
  lightMs: number | null
}

const D = Math.PI / 180

/** Last lighting pass: workers, slowest worker ms and wall-clock ms (for the console and the tests). */
export const reliefLightStats = { workers: 0, ms: 0, wallMs: 0 }

export function useRelief(lat: number | undefined, lon: number | undefined, mastM: number, sun: SunDir | null): Relief {
  const specs = useMemo(() => (lat === undefined || lon === undefined ? null : ringSpecs(lat, lon)), [lat, lon])
  const [rings, setRings] = useState<{ key: string; rings: Ring[] } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const key = specs?.map((s) => s.url).join('|') ?? ''

  useEffect(() => {
    if (!specs || specs.length === 0) return
    let live = true
    Promise.all(specs.map((s) => loadRing(s))).then(
      (r) => live && setRings({ key, rings: r }),
      () => live && setFailed(key),
    )
    return () => {
      live = false
    }
  }, [specs, key])

  const current = rings && rings.key === key ? rings.rings : null
  const frame = useMemo(() => (lat === undefined || lon === undefined ? null : planeFrame(lat, lon)), [lat, lon])
  const stack = useMemo(() => (current && frame ? new GroundStack(current, frame) : null), [current, frame])

  // worker: normals once per stack, sunlight per Sun position
  const [normals, setNormals] = useState<{ stack: GroundStack; normals: Float32Array[] } | null>(null)
  const [light, setLight] = useState<{ stack: GroundStack; sunlight: Float32Array[]; ms: number; sun: SunDir | null } | null>(null)
  const kick = useRef<(() => void) | null>(null)
  const job = useRef<{ busy: boolean; sent: SunDir | null; want: SunDir | null; id: number }>({ busy: false, sent: null, want: null, id: 0 })

  useEffect(() => {
    if (!stack || typeof Worker === 'undefined') return
    // a small pool: each worker lights every n-th row (light.ts ringSunlight), the parts are summed
    const count = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1))
    const pool = Array.from({ length: count }, () => new Worker(new URL('./light.worker.ts', import.meta.url), { type: 'module' }))
    job.current = { busy: false, sent: null, want: job.current.want, id: 0 }
    let parts: Float32Array[][] = []
    let worst = 0
    let started = 0
    const send = () => {
      const j = job.current
      if (j.busy || !j.want) return
      j.busy = true
      j.sent = j.want
      j.id++
      parts = []
      worst = 0
      started = performance.now()
      pool.forEach((w, i) => w.postMessage({ type: 'sun', id: j.id, sun: j.want!, rowOffset: i, rowStride: count } satisfies LightRequest))
    }
    pool.forEach((w, wi) => {
      w.onmessage = (e: MessageEvent<LightResponse>) => {
        const m = e.data
        if (m.type === 'normals') {
          if (wi === 0) setNormals({ stack, normals: m.normals })
          return
        }
        if (m.id !== job.current.id) return
        parts.push(m.sunlight)
        worst = Math.max(worst, m.ms)
        if (parts.length < count) return
        // rows not computed by a worker are 0 in its part: the sum is the whole pass
        const sunlight = parts[0]
        for (let p = 1; p < parts.length; p++)
          for (let k = 0; k < sunlight.length; k++) {
            const a = sunlight[k]
            const b = parts[p][k]
            for (let i = 0; i < a.length; i++) a[i] += b[i]
          }
        Object.assign(reliefLightStats, { workers: count, ms: worst, wallMs: performance.now() - started })
        setLight({ stack, sunlight, ms: worst, sun: job.current.sent })
        job.current.busy = false
        if (moved(job.current.sent, job.current.want)) send()
      }
      // each worker gets its own copy of the heights; the renderer keeps these
      const rings = stack.rings.map((r) => ({ cellM: r.cellM, heights: r.heights.slice() }))
      w.postMessage({ type: 'rings', frame: stack.frame, rings } satisfies LightRequest, rings.map((r) => r.heights.buffer))
    })
    kick.current = send
    send()
    return () => {
      pool.forEach((w) => w.terminate())
      kick.current = null
    }
  }, [stack])

  useEffect(() => {
    if (!sun) return
    const j = job.current
    j.want = sun
    if (moved(j.sent, sun)) kick.current?.()
  }, [sun])

  return useMemo<Relief>(() => {
    if (!specs || specs.length === 0) return { status: 'unavailable', scene: null, cellM: null, reachKm: null, lightMs: null }
    const cellM = specs[0].source.demM
    const reachKm = (specs[specs.length - 1].cellM * 256) / 1000
    if (failed === key) return { status: 'failed', scene: null, cellM, reachKm, lightMs: null }
    if (!stack || !frame || !normals || normals.stack !== stack) return { status: 'loading', scene: null, cellM, reachKm, lightMs: null }
    const lit = light && light.stack === stack ? light : null
    const ground = stack.heightAt(0, (512 - 1) / 2, (512 - 1) / 2)
    const s = lit?.sun ?? sun
    const dir: [number, number, number] = s
      ? [Math.sin(s.az * D) * Math.cos(s.el * D), Math.cos(s.az * D) * Math.cos(s.el * D), Math.sin(s.el * D)]
      : [0, 0, 1]
    return {
      status: 'ready',
      scene: { stack, normals: normals.normals, sunlight: lit?.sunlight ?? null, eyeM: ground + Math.max(mastM, EYE_MIN_M), sun: dir, grain: groundTexture() },
      cellM,
      reachKm,
      lightMs: lit?.ms ?? null,
    }
  }, [specs, frame, failed, key, stack, normals, light, mastM, sun])
}

function moved(a: SunDir | null, b: SunDir | null): boolean {
  if (!b) return false
  if (!a) return true
  const daz = Math.abs(((b.az - a.az + 540) % 360) - 180)
  return Math.abs(b.el - a.el) > SUN_EPS.el || daz > SUN_EPS.az
}
