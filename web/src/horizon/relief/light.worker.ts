/// <reference lib="webworker" />
/**
 * Sunlight on the horizon view's rings off the main thread (light.ts). The rings arrive once ('rings', answered
 * with their normals); every 'sun' message is answered with the sunlight factor of every ring sample. Buffers are
 * transferred, not copied. Several workers share a pass by rows (light.ts ringSunlight, rowOffset and rowStride).
 */
import { GroundStack, ringNormals, ringSunlight, type RingGrid, type SunDir } from './light'
import type { PlaneFrame } from './rings'

export type LightRequest =
  | { type: 'rings'; frame: PlaneFrame; rings: RingGrid[] }
  | { type: 'sun'; id: number; sun: SunDir; rowOffset: number; rowStride: number }

export type LightResponse =
  | { type: 'normals'; normals: Float32Array[] }
  | { type: 'sunlight'; id: number; sunlight: Float32Array[]; ms: number }

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
  const sunlight = ringSunlight(stack, normals, m.sun, m.rowOffset, m.rowStride)
  ctx.postMessage({ type: 'sunlight', id: m.id, sunlight, ms: performance.now() - t0 } satisfies LightResponse, sunlight.map((s) => s.buffer))
}
