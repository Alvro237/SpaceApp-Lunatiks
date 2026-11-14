/**
 * Every challenge must be answerable from the repository data: the browser engine solves it, the answer is one
 * of the offered choices, the choices are distinct, and the explanation carries measured numbers.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EphemerisTable } from '../time/engine'
import { HorizonMasks, parseSegments, type EphemerisIndex, type SitesDoc } from '../time/staticData'
import { QUESTS } from './quests'

const ROOT = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(ROOT, p))

function context() {
  const index = JSON.parse(read('data/ephemeris.json').toString()) as EphemerisIndex
  const buffers = index.segments.map((s) => {
    const b = read(`data/${s.file}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  })
  const doc = JSON.parse(read('data/sites.json').toString()) as SitesDoc
  const h = read('data/horizons.i16')
  return {
    table: new EphemerisTable(parseSegments(index, buffers)),
    masks: new HorizonMasks(doc, new Int16Array(h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength))),
  }
}

const ctx = context()

describe('Lunar Quest', () => {
  it.each(QUESTS.map((q) => [q.id, q] as const))('%s is solved by the engine', (_, quest) => {
    const solved = quest.solve(ctx)
    expect(solved).not.toBeNull()
    const ids = solved!.choices.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(solved!.answerId)
    expect(solved!.explanation).toMatch(/\d/)
  })

  it('compares two sites whose answer is not a coin toss', () => {
    const s = QUESTS.find((q) => q.id === 'which-site')!.solve(ctx)!
    expect(s.answerId).toBe('mons-malapert')
    expect(s.explanation).toMatch(/Shackleton crater 0 %/)
  })
})
