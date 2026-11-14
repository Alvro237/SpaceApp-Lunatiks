/// <reference lib="webworker" />
/**
 * Decodes tiles off the main thread (plan: "Fuera del hilo principal"): fetch the PNG, inflate it and turn it
 * into heights in metres (Float32Array) or a layer's value + alpha bytes. The buffers are transferred back.
 */
import type { GeoTileRequest } from '../globe/detail/trekGeo'
import type { LiveTileRequest } from './live/cog'
import { decodePng, heightsFromRgb } from './png'

export interface DecodeRequest {
  id: number
  url: string
  /**
   * 'live': heights sampled from a remote DEM block by block (live/cog.ts) instead of a PNG tile.
   * 'globe': a detail tile of the globe from Moon Trek's global layers (globe/detail/trekGeo.ts).
   */
  kind: 'height' | 'layer' | 'live' | 'globe'
  min?: number
  max?: number
  live?: Omit<LiveTileRequest, 'url'>
  globe?: Omit<GeoTileRequest, 'url'>
}

export type DecodeResponse =
  | { id: number; ok: true; width: number; height: number; heights?: Float32Array; bytes?: Uint8Array; min?: number; max?: number }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, url, kind, min = 0, max = 1 } = e.data
  try {
    if (kind === 'live') {
      // geotiff.js (about 300 kB) loads only when the first live tile is asked for
      const { readLiveTile } = await import('./live/cog')
      const t = await readLiveTile({ url, ...e.data.live! })
      ctx.postMessage(
        { id, ok: true, width: t.samples, height: t.samples, heights: t.heights, min: t.min, max: t.max } satisfies DecodeResponse,
        [t.heights.buffer],
      )
      return
    }
    if (kind === 'globe') {
      const { readGeoTile } = await import('../globe/detail/trekGeo')
      const t = await readGeoTile({ url, ...e.data.globe! })
      const n = Math.sqrt(t.kind === 'dem' ? t.heights.length : t.bytes.length)
      if (t.kind === 'dem') {
        ctx.postMessage({ id, ok: true, width: n, height: n, heights: t.heights } satisfies DecodeResponse, [t.heights.buffer])
      } else {
        ctx.postMessage({ id, ok: true, width: n, height: n, bytes: t.bytes } satisfies DecodeResponse, [t.bytes.buffer])
      }
      return
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    const png = await decodePng(await res.arrayBuffer())
    if (kind === 'height') {
      const heights = heightsFromRgb(png, min, max)
      ctx.postMessage({ id, ok: true, width: png.width, height: png.height, heights } satisfies DecodeResponse, [heights.buffer])
    } else {
      // keep two channels (value, alpha) whatever the source layout; the value is 0 where there is no data, so
      // that bilinear filtering on the GPU gives value × coverage and the shader can divide by the coverage
      const n = png.width * png.height
      const bytes = new Uint8Array(n * 2)
      for (let i = 0; i < n; i++) {
        const alpha = png.channels === 2 || png.channels === 4 ? png.data[i * png.channels + png.channels - 1] : 255
        bytes[2 * i] = alpha === 0 ? 0 : png.data[i * png.channels]
        bytes[2 * i + 1] = alpha
      }
      ctx.postMessage({ id, ok: true, width: png.width, height: png.height, bytes } satisfies DecodeResponse, [bytes.buffer])
    }
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: (err as Error).message } satisfies DecodeResponse)
  }
}
