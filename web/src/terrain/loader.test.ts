// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { HOST_LIMITS, hostOf, workerIndex } from './loader'

const geometry = { i0: 0, j0: 0, extentX0: 0, extentY1: 0, cellM: 1, samples: 257 }

describe('tile loader routing', () => {
  it('counts each server against its own limit', () => {
    expect(hostOf({ kind: 'height' })).toBe('static')
    expect(hostOf({ kind: 'layer' })).toBe('static')
    expect(hostOf({ kind: 'globe' })).toBe('trek')
    expect(hostOf({ kind: 'live', live: { file: 'LRO_LOLA_DEM_SPole875_5mp_v04', source: 'trek', geometry } })).toBe('trek')
    expect(hostOf({ kind: 'live', live: { file: 'LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF', source: 'cog', geometry } })).toBe('pgda')
    expect(HOST_LIMITS.trek).toBe(6) // Moon Trek answers over HTTP/1.1: six connections per host in a browser
  })

  it('sends every read of one GeoTIFF to the same worker and spreads the rest', () => {
    const a = { kind: 'live' as const, live: { file: 'LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF', source: 'cog' as const, geometry } }
    const seen = new Set([0, 1, 2, 3, 4].map((turn) => workerIndex(a, 3, turn)))
    expect(seen.size).toBe(1)
    const pngs = [0, 1, 2].map((turn) => workerIndex({ kind: 'height' }, 3, turn))
    expect(new Set(pngs).size).toBe(3)
  })
})
