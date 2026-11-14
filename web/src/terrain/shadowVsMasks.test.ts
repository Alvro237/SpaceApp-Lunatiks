// @vitest-environment node
/**
 * How close the map's shadows (ray march over the 960 m preview heights) come to the API's LOLA horizon masks
 * (ray-marched over 10-240 m DEMs) at the 13 terrain sites. This is a measurement, not a tolerance from a
 * source: the numbers are printed and only a loose regression bound is asserted. Sites outside the map are
 * left out. Skipped when the tiles are not built.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HorizonMasks, type SitesDoc } from '../time/staticData'
import { decodePng, heightsFromRgb } from './png'
import { horizonDeg } from './shadow'
import { type Tileset, inExtent, polarXY } from './tileset'

const ROOT = resolve(__dirname, '../../..')
const TILES = resolve(__dirname, '../../public/tiles')

describe('map shadows against the LOLA horizon masks', async () => {
  let ts: Tileset
  try {
    ts = JSON.parse(readFileSync(`${TILES}/tileset.json`, 'utf8')) as Tileset
  } catch {
    it.skip('tiles not built (npm run tiles)', () => {})
    return
  }
  const b = readFileSync(`${TILES}/${ts.overview.path}`)
  const png = await decodePng(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
  const h = heightsFromRgb(png, ts.overview.min, ts.overview.max)
  const n = png.width - 1
  const [x0, , x1, y1] = ts.extentM
  const cell = (x1 - x0) / n
  const heightAt = (x: number, y: number) => {
    const fx = (x - x0) / cell
    const fy = (y1 - y) / cell
    if (fx < 0 || fy < 0 || fx >= n || fy >= n) return null
    const c = Math.floor(fx)
    const r = Math.floor(fy)
    const u = fx - c
    const v = fy - r
    const s = n + 1
    return h[r * s + c] * (1 - u) * (1 - v) + h[r * s + c + 1] * u * (1 - v) + h[(r + 1) * s + c] * (1 - u) * v + h[(r + 1) * s + c + 1] * u * v
  }
  const doc = JSON.parse(readFileSync(resolve(ROOT, 'data/sites.json'), 'utf8')) as SitesDoc
  const raw = readFileSync(resolve(ROOT, 'data/horizons.i16'))
  const masks = new HorizonMasks(doc, new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)))

  it('reports the horizon difference per site (degrees)', () => {
    const rows: string[] = []
    const all: number[] = []
    for (const s of doc.sites.filter((q) => q.terrain.available && inExtent(ts, q.lat, q.lon))) {
      const { horizon } = masks.forSite(s, 2)
      const [x, y] = polarXY(s.lat, s.lon)
      const diffs: number[] = []
      for (let az = 0; az < 360; az += 5) diffs.push(horizonDeg(heightAt, x, y, az, cell, 2) - horizon.at(az))
      const mae = diffs.reduce((a, d) => a + Math.abs(d), 0) / diffs.length
      const bias = diffs.reduce((a, d) => a + d, 0) / diffs.length
      all.push(...diffs)
      rows.push(`${s.id.padEnd(14)} mean |Δ| ${mae.toFixed(2)}°  bias ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}°  max |Δ| ${Math.max(...diffs.map(Math.abs)).toFixed(2)}°`)
    }
    const mae = all.reduce((a, d) => a + Math.abs(d), 0) / all.length
    console.log(`map horizon (960 m) minus LOLA mask, 72 azimuths × ${rows.length} sites, 2 m mast\n${rows.join('\n')}\nall sites: mean |Δ| ${mae.toFixed(2)}°`)
    // Regression guard on the measured value (1.2° on 2026-11-14), not a requirement from a source.
    expect(mae).toBeLessThan(3)
  })
})
