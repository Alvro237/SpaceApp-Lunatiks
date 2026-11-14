/// <reference lib="webworker" />
/**
 * Decodes tiles off the main thread (plan: "Fuera del hilo principal"): fetch the PNG, inflate it and turn it
 * into heights in metres (Float32Array) or a layer's value + alpha bytes. The buffers are transferred back.
 */
import { decodePng, heightsFromRgb } from './png'

export interface DecodeRequest {
  id: number
  url: string
  kind: 'height' | 'layer'
  min?: number
  max?: number
}

export type DecodeResponse =
  | { id: number; ok: true; width: number; height: number; heights?: Float32Array; bytes?: Uint8Array }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, url, kind, min = 0, max = 1 } = e.data
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    const png = await decodePng(await res.arrayBuffer())
    if (kind === 'height') {
      const heights = heightsFromRgb(png, min, max)
      ctx.postMessage({ id, ok: true, width: png.width, height: png.height, heights } satisfies DecodeResponse, [heights.buffer])
    } else {
      // keep two channels (value, alpha) whatever the source layout
      const n = png.width * png.height
      const bytes = new Uint8Array(n * 2)
      for (let i = 0; i < n; i++) {
        bytes[2 * i] = png.data[i * png.channels]
        bytes[2 * i + 1] = png.channels === 2 || png.channels === 4 ? png.data[i * png.channels + png.channels - 1] : 255
      }
      ctx.postMessage({ id, ok: true, width: png.width, height: png.height, bytes } satisfies DecodeResponse, [bytes.buffer])
    }
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: (err as Error).message } satisfies DecodeResponse)
  }
}
