/// <reference lib="webworker" />
/**
 * Light on the horizon view's rings off the main thread (light.ts). The rings arrive once ('rings', answered with
 * their normals); every 'sun' message is answered with the direct-light factor of every ring sample for the Sun
 * and, at night, for the Earth (earthshine: the same computation with the Earth's direction and disc). Buffers are
 * transferred, not copied. Several workers share a pass by rows (light.ts ringLightHorizon, rowOffset and rowStride).
 */
import { GroundStack, ringNormals, ringLightHorizon, type RingGrid, type SunDir } from './light'
import type { PlaneFrame } from './rings'

export type LightRequest =
  | { type: 'rings'; frame: PlaneFrame; rings: RingGrid[] }
  | { type: 'sun'; id: number; sun: SunDir; earth: SunDir | null; rowOffset: number; rowStride: number; quick: boolean }

export type LightResponse =
  | { type: 'normals'; normals: Float32Array[] }
  | { type: 'sunlight'; id: number; sunlight: Float32Array[]; earthlight: Float32Array[] | null; ms: number }

const ctx = self as unknown as DedicatedWorkerGlobalScope
let stack: GroundStack | null = null
let normals: Float32Array[] = []

ctx.onmessage = (e: MessageEvent<LightRequest>) => {
  const m = e.data
  if (m.type === 'rings') {
    stack = new GroundStack(m.rings, m.frame)
    normals = m.rings.map((r) => ringNormals(r, m.frame))
    const copies = normals.map((n) => n.slice())
    ctx.postMessage({ type: 'normals', normals: copies } satisfies LightResponse, copies.map((n) => n.buffer))
    return
  }
  if (!stack) return
  const t0 = performance.now()
  const sunlight = ringLightHorizon(stack, normals, m.sun, m.rowOffset, m.rowStride, m.quick)
  const earthlight = m.earth ? ringLightHorizon(stack, normals, m.earth, m.rowOffset, m.rowStride, m.quick) : null
  const buffers = [...sunlight, ...(earthlight ?? [])].map((s) => s.buffer)
  ctx.postMessage({ type: 'sunlight', id: m.id, sunlight, earthlight, ms: performance.now() - t0 } satisfies LightResponse, buffers)
}
