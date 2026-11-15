// @vitest-environment node
/**
 * The missions' scenes against the real tables and horizons: each one must be completable with the data in the
 * repository, and the facts the texts lean on must be what the engine finds (not what the texts say).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, EphemerisTable, evaluateAt, isSunlit, makeModel } from '../time/engine'
import { evaluateWindow } from '../time/hooks'
import { HorizonMasks, parseSegments, type EphemerisIndex, type SitesDoc } from '../time/staticData'
import { APOLLO17, APOLLO17_LANDING_MS, BASE_PLACES, BLUE_GHOST, BLUE_GHOST_ECLIPSE_EVE_MS, CABEUS, CHAPTERS, IM1, MALAPERT, SHACKLETON, SLIM, eclipseSpan, firstDay } from './story'

const ROOT = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(ROOT, p))
const index = JSON.parse(read('data/ephemeris.json').toString()) as EphemerisIndex
const eph = new EphemerisTable(
  parseSegments(
    index,
    index.segments.map((s) => {
      const b = read(`data/${s.file}`)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    }),
  ),
)
const doc = JSON.parse(read('data/sites.json').toString()) as SitesDoc
const hb = read('data/horizons.i16')
const masks = new HorizonMasks(doc, new Int16Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength)))
const H = 3_600_000
/** The model the app builds for a catalogue site with the default 2 m mast (time/place.ts). */
function model(id: string) {
  const s = masks.site(id)!
  const { horizon, mastUsedM } = masks.forSite(s, 2)
  return makeModel(s.lat, s.lon, s.terrain.available ? (s.terrain.groundHeightM ?? 0) : 0, horizon, mastUsedM)
}
const month = (id: string, startMs: number) => evaluateWindow(eph, model(id), startMs, 720, 30, DEFAULT_PARAMS)!
const TODAY = Date.parse('2026-11-15T00:00:00Z')
const ch = (id: string) => CHAPTERS.find((c) => c.id === id)!

describe('mission scenes against the real tables', () => {
  it('every scene is a catalogue site', () => {
    for (const c of CHAPTERS) if (c.scene.site) expect(masks.site(c.scene.site), c.id).toBeDefined()
  })

  it('Blue Ghost: the Earth covers the whole Sun on 14 March 2025, about nine hours after the scene opens', () => {
    const fine = evaluateWindow(eph, model(BLUE_GHOST), BLUE_GHOST_ECLIPSE_EVE_MS, 48, 5, DEFAULT_PARAMS)!
    const span = eclipseSpan(fine.t, fine.samples.map((s) => s.eclipse))!
    expect(new Date(span.midMs).toISOString().slice(0, 13)).toBe('2025-03-14T07')
    // Firefly reported about 2 h 16 min of totality
    expect(span.totalH).toBeGreaterThan(2.1)
    expect(span.totalH).toBeLessThan(2.45)
    expect(span.anyH).toBeGreaterThan(4.5)
    expect(span.anyH).toBeLessThan(5.2)
    // it is day there: the dark is the Earth, not a sunset
    expect(isSunlit(evaluateAt(eph, model(BLUE_GHOST), span.midMs))).toBe(true)
  })

  it('Apollo 17: the Earth is up at landing and never sets in the days that follow', () => {
    const w = evaluateWindow(eph, model(APOLLO17), APOLLO17_LANDING_MS, 72, 30, DEFAULT_PARAMS)!
    expect(w.metrics.commsPct).toBe(100)
    expect(w.samples[0].earth.el).toBeGreaterThan(40)
  })

  it('SLIM: the Sun is low on the morning the scene opens, and high nine days later', () => {
    const m = model(SLIM)
    const after = ch('slim').scene.afterSunriseH!
    const around = evaluateWindow(eph, m, TODAY - 35 * 24 * H, 75 * 24, 20, DEFAULT_PARAMS)!
    const day = firstDay(around.t, around.samples.map(isSunlit))!
    const start = around.t[day.rise] + after * H
    // low enough to be a morning, high enough to clear the skyline and be found by turning around
    const morning = evaluateAt(eph, m, start).sun
    expect(morning.el).toBeGreaterThan(8)
    expect(morning.el).toBeLessThan(16)
    expect(morning.az).toBeLessThan(180)
    // nine days on it is high, on the western side, and the Sun has not set yet
    const later = evaluateAt(eph, m, start + 9 * 24 * H).sun
    expect(later.el).toBeGreaterThan(50)
    expect(later.az).toBeGreaterThan(180)
    expect(around.t[day.set] - start).toBeGreaterThan(9 * 24 * H)
  })

  it('Cabeus and Shackleton get no Sun; Odysseus’s site sees the Earth all month and Shackleton never does', () => {
    expect(month(CABEUS, TODAY).metrics.sunlightPct).toBe(0)
    expect(month(SHACKLETON, TODAY).metrics.sunlightPct).toBe(0)
    expect(month(SHACKLETON, TODAY).metrics.commsPct).toBe(0)
    expect(month(IM1, TODAY).metrics.commsPct).toBe(100)
  })

  it('Moon base: Mons Malapert has the most Sun and Earth together, whatever the month', () => {
    for (let k = 0; k < 12; k++) {
      const start = TODAY + k * 30 * 24 * H
      const score = (id: string) => {
        const { sunlightPct, commsPct } = month(id, start).metrics
        return sunlightPct + commsPct
      }
      const best = BASE_PLACES.reduce((a, b) => (score(b) > score(a) ? b : a))
      expect(best, new Date(start).toISOString()).toBe(MALAPERT)
    }
  })
})
