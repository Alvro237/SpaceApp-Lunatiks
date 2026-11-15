import { describe, expect, it } from 'vitest'
import { layerOrder, moveItem, priorityOrder, recompute, reweight, rocWeights } from './score'

const u8 = (...v: number[]) => Uint8Array.from(v)

describe('rank order centroid weights (mission-design-spec 3.6, 8.1)', () => {
  it('n = 1..4 sum to 1 and decrease', () => {
    for (let n = 1; n <= 4; n++) {
      const w = rocWeights(n)
      expect(w).toHaveLength(n)
      expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12)
      for (let i = 1; i < n; i++) expect(w[i]).toBeLessThan(w[i - 1])
    }
  })

  it('n = 2 gives 0.75 and 0.25; n = 3 and 4 the published values', () => {
    expect(rocWeights(1)).toEqual([1])
    expect(rocWeights(2)).toEqual([0.75, 0.25])
    const w3 = rocWeights(3)
    expect(w3[0]).toBeCloseTo(11 / 18, 12)
    expect(w3[1]).toBeCloseTo(5 / 18, 12)
    expect(w3[2]).toBeCloseTo(1 / 9, 12)
    const w4 = rocWeights(4)
    expect(w4[0]).toBeCloseTo(25 / 48, 12)
    expect(w4[3]).toBeCloseTo(1 / 16, 12)
  })
})

describe('client score = server score (design spec 9.3, hand case of 8.6)', () => {
  // q1 = [250, 0, 255], q2 = [125, 125, 125], w = [0.75, 0.25] -> score [0.875, 0.125, 0.5]
  const codes = u8(3, 3, 3)
  const q1 = u8(250, 0, 255)
  const q2 = u8(125, 125, 125)

  it('scores [0.875, 0.125, 0.5] as uint8 floor(s * 255 + 0.5)', () => {
    const { score } = recompute(codes, [q1, q2], [0.75, 0.25])
    expect([...score]).toEqual([Math.floor(0.875 * 255 + 0.5), Math.floor(0.125 * 255 + 0.5), Math.floor(0.5 * 255 + 0.5)])
    expect([...score]).toEqual([223, 32, 128])
  })

  it('limiting: the layer costing the most score (weight x (1 - utility)), first index on ties', () => {
    const { limiting } = recompute(codes, [q1, q2], [0.75, 0.25])
    expect([...limiting]).toEqual([1, 0, 1])
  })

  it('non-viable cells score 0; viable cells never score 0; no layers scores 1', () => {
    const r = recompute(u8(0, 1, 2, 5, 4, 3), [u8(250, 250, 250, 250, 250, 0)], [1])
    expect([...r.score]).toEqual([0, 0, 0, 0, 0, 1])
    expect([...recompute(u8(3, 2), [], []).score]).toEqual([255, 0])
  })
})

describe('priority order and re-weighting', () => {
  it('the displayed list keeps the stored order of the active categories, then the rest in catalogue order', () => {
    expect(priorityOrder([], ['earth', 'power'])).toEqual(['power', 'earth'])
    expect(priorityOrder(['radiation', 'earth'], ['power', 'earth', 'topography'])).toEqual(['earth', 'power', 'topography'])
  })

  it('moveItem moves one place up or down, clamped', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('layers follow the priority order', () => {
    expect(layerOrder(['power', 'earth', 'radiation'], ['radiation', 'power'])).toEqual([2, 0, 1])
  })

  it('in the answer order it gives the server numbers; swapped, Earth first takes 75 %', () => {
    const codes = u8(3, 3, 3)
    const power = u8(250, 0, 255)
    const earth = u8(125, 125, 125)
    const same = reweight(codes, [power, earth], ['power', 'earth'], ['power', 'earth'])
    expect([...same.score]).toEqual([223, 32, 128])
    expect(same.weights).toEqual({ power: 0.75, earth: 0.25 })
    const swapped = reweight(codes, [power, earth], ['power', 'earth'], ['earth', 'power'])
    expect(swapped.weights).toEqual({ earth: 0.75, power: 0.25 })
    // cell 0: 0.75 x 0.5 + 0.25 x 1 = 0.625; cell 1: 0.75 x 0.5 = 0.375; cell 2: earth only, 0.5
    expect([...swapped.score]).toEqual([Math.floor(0.625 * 255 + 0.5), Math.floor(0.375 * 255 + 0.5), 128])
    // limiting is an index into the ANSWER's layers: cell 0 loses most on Earth (0.375), cell 1 on Earth (0.375 > 0.25)
    expect([...swapped.limiting]).toEqual([1, 1, 1])
  })
})
