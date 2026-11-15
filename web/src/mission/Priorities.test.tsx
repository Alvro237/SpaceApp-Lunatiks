import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuitabilityResponse } from '../api/types'
import { useAreas } from '../state/areas'
import { Priorities } from './AdvancedInputs'

const b64 = (...v: number[]) => btoa(String.fromCharCode(...v))

/** Three viable cells, two layers (the hand case of design spec 8.6), weights 0.75 / 0.25. */
const ANSWER: SuitabilityResponse = {
  grid: { projection: 'south polar stereographic', x_left_m: 0, y_top_m: 960, cell_m: 960, nx: 3, ny: 1 },
  codes_b64: b64(3, 3, 3),
  score_b64: b64(223, 32, 128),
  limiting_b64: b64(1, 0, 1),
  layers: [
    { category: 'power', label: 'Power and sunlight', measure: 'share sunlit', weight: 0.75, utility_b64: b64(250, 0, 255) },
    { category: 'earth', label: 'Earth link', measure: 'share with contact', weight: 0.25, utility_b64: b64(125, 125, 125) },
  ],
  weights: { power: 0.75, earth: 0.25 },
  counts: { outside: 0, failed_static: 0, failed_window: 0, viable: 3, unknown: 0, failed_bound: 0 },
  funnel: [],
  bound: null,
  window: null,
  sites: [],
  sites_dropped: 0,
  seconds: 0.1,
  assumptions: [],
}

beforeEach(() => {
  useAreas.setState({
    categoriesOn: { power: true, earth: true },
    sideOn: false,
    plannerSwitches: {},
    plannerSelects: {},
    plannerValues: {},
    priority: [],
    suit: null,
    raster: null,
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Priorities', () => {
  it('the answer decodes to the server score bit for bit with the order sent', () => {
    useAreas.getState().setSuit(ANSWER)
    expect([...useAreas.getState().raster!.score]).toEqual([223, 32, 128])
    expect([...useAreas.getState().raster!.limiting!]).toEqual([1, 0, 1])
  })

  it('Move up changes the order and the ROC percentages, re-weights the map without a request, and announces it', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useAreas.getState().setSuit(ANSWER)
    render(<Priorities />)
    const rows = () => within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows()[0]).toMatch(/1\. Power and sunlight75 %/)
    expect(rows()[1]).toMatch(/2\. Earth link25 %/)
    expect(screen.getByRole('button', { name: 'Move up: Power and sunlight' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move up: Earth link' }))
    expect(rows()[0]).toMatch(/1\. Earth link75 %/)
    expect(rows()[1]).toMatch(/2\. Power and sunlight25 %/)
    expect(screen.getByText('Earth link moved to position 1 of 2')).toBeInTheDocument()
    expect(useAreas.getState().priority).toEqual(['earth', 'power'])
    expect(useAreas.getState().weights).toEqual({ earth: 0.75, power: 0.25 })
    expect([...useAreas.getState().raster!.score]).toEqual([Math.floor(0.625 * 255 + 0.5), Math.floor(0.375 * 255 + 0.5), 128])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists only the categories that score', () => {
    useAreas.setState({ categoriesOn: { power: true, topography: true, radiation: true }, plannerValues: { max_slope: '10' } })
    render(<Priorities />)
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent?.replace(/\d+ %.*/, ''))).toEqual([
      '1. Power and sunlight',
      '2. Topography and landing safety',
    ])
  })
})
