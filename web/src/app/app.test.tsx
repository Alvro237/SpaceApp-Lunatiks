/**
 * The app as a user meets it: the navigator, the text pages, keyboard-reachable controls, honest messages when
 * an endpoint is not deployed, and no axe-core violations (WCAG 2 A/AA, 2.1 and 2.2 AA, best practice).
 * The WebGL map is replaced by a stub: jsdom has no GPU; the engine behind it is tested in terrain/*.test.ts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from './routes'
import { defaultScene, useApp } from '../state/store'
import { colorAt, luminance, textOn } from '../terrain/colormaps'

vi.mock('../terrain/TerrainView', () => ({ TerrainView: () => <div role="img" aria-label="Map (test stub)" /> }))
vi.mock('../globe/GlobeView', () => ({ GlobeView: () => <div role="img" aria-label="Globe (test stub)" /> }))

const ROOT = resolve(__dirname, '../../..')
const sitesDoc = JSON.parse(readFileSync(resolve(ROOT, 'data/sites.json'), 'utf8')) as {
  sites: { id: string; name: string; group: string; kind: string; lat: number; lon: number; region?: string; landingUtc?: string; terrain: { available: boolean } }[]
}
const apiSites = {
  count: sitesDoc.sites.length,
  groups: [...new Set(sitesDoc.sites.map((s) => s.group))],
  sites: sitesDoc.sites.map((s) => ({
    id: s.id,
    name: s.name,
    group: s.group,
    kind: s.kind,
    lat: s.lat,
    lon: s.lon,
    region: s.region ?? null,
    landing_utc: s.landingUtc ?? null,
    terrain_available: s.terrain.available,
  })),
}
const constraints = {
  hard_filters: { max_slope: 'threshold: {"max_deg": float}', continuous_light: 'threshold: {"min_fraction": float = 1.0}' },
  soft_score_default_weights: { sunlight: 0.5, comms: 0.3, continuity: 0.2 },
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const file = (name: string) => {
  const b = readFileSync(resolve(ROOT, 'data', name))
  return new Response(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { status: 200 })
}

/** A backend where only the merged endpoints exist; everything else is FastAPI's 404 "Not Found". */
function fakeFetch(apiUp = true) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const data = /\/data\/([\w.]+)$/.exec(url)
    if (data) return file(data[1])
    if (url.includes('/tiles/')) return json({ detail: 'Not Found' }, 404)
    if (!apiUp) throw new TypeError('Failed to fetch')
    if (url.endsWith('/api/v1/sites')) return json(apiSites)
    if (url.endsWith('/api/v1/meta/constraints')) return json(constraints)
    if (url.endsWith('/api/v1/meta/datasets')) return json({ frame: 'MOON_ME', correction: 'LT+S' })
    return json({ detail: 'Not Found' }, 404)
  })
}

const T = Date.parse('2027-01-10T00:00:00Z')

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  )
}

async function noAxeViolations(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, // contrast cannot run in jsdom
  })
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch())
  window.location.hash = ''
  useApp.setState({ ...defaultScene(T), playing: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('navigator', () => {
  it('shows the catalogue, the Sun and Earth for IM-2, and says which engine computed them', async () => {
    const { container } = renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Lunar Landing Site Navigator' }, { timeout: 5000 })).toBeInTheDocument()
    // the left panel is gone: where is a search box at the top left that shows the current place
    const search = await screen.findByRole('combobox', { name: 'Search sites and missions' })
    await waitFor(() => expect(search).toHaveAttribute('placeholder', expect.stringMatching(/IM-2/)))
    expect(screen.getByRole('button', { name: 'Coordinates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Date and duration' })).toBeInTheDocument()
    const sun = await screen.findByRole('article', { name: 'Sun' }, { timeout: 5000 })
    expect(within(sun).getByText('Elevation')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Earth' })).toBeInTheDocument()
    expect(screen.getAllByText('Browser engine').length).toBeGreaterThan(0)
    expect(screen.getByText(/LOLA horizon · 2 m/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Sunlit .*% and Earth in view/ })).toBeInTheDocument()
    await noAxeViolations(container)
    // the sections are square buttons; each opens in place with a way back
    const user = userEvent.setup()
    await user.click(within(screen.getByRole('group', { name: 'Sections' })).getByRole('button', { name: /Horizon/ }))
    expect(screen.getByRole('heading', { level: 3, name: /Horizon/ })).toHaveFocus()
    expect(screen.getByRole('img', { name: /360° horizon with the Sun and the Earth/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All sections' }))
    await user.click(within(screen.getByRole('group', { name: 'Sections' })).getByRole('button', { name: /Power/ }))
    // the engine parameters live in the section they change
    expect(screen.getByRole('radiogroup', { name: 'Panel' })).toBeInTheDocument()
    expect(screen.getByText('Power per m²')).toBeInTheDocument()
    expect(screen.getByText('Solar elevation')).toBeInTheDocument()
    expect(screen.getByText('Sunlight duration')).toBeInTheDocument()
    expect(screen.getByText('Earth visibility windows')).toBeInTheDocument()
    expect(screen.getByText('Radiation')).toBeInTheDocument()
    expect(screen.getByText('Advanced options')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^About / })[0])
    expect(screen.getByRole('note')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All sections' }))
    await noAxeViolations(container)
   }, 30_000)

  it('opens on the globe; the map replaces it when entered', async () => {
    renderAt('/')
    expect(await screen.findByRole('img', { name: 'Globe (test stub)' })).toBeInTheDocument()
    useApp.getState().enterMap(-85, 30)
    expect(await screen.findByRole('img', { name: 'Map (test stub)' })).toBeInTheDocument()
    expect(useApp.getState().mapEntry).toMatchObject({ lat: -85, lon: 30 })
  })

  it('finds and selects a site from the search box with the keyboard', async () => {
    const user = userEvent.setup()
    renderAt('/')
    const search = await screen.findByRole('combobox', { name: 'Search sites and missions' })
    await user.click(search)
    await user.type(search, 'shackle')
    expect(search).toHaveAttribute('aria-expanded', 'true')
    const option = await screen.findByRole('option', { name: /Shackleton crater/ })
    expect(option).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(useApp.getState().selection).toEqual({ kind: 'site', id: 'shackleton' })
    expect(search).toHaveAttribute('aria-expanded', 'false')
  })

  it('rejects invalid manual coordinates with an alert, accepts valid ones', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(await screen.findByRole('button', { name: 'Coordinates' }))
    const lat = await screen.findByLabelText('Latitude (°)')
    await user.clear(lat)
    await user.type(lat, '-95')
    await user.click(screen.getByRole('button', { name: 'Analyse this point' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Latitude must be a number from −90 to 90/)
    expect(lat).toHaveAttribute('aria-invalid', 'true')
    await user.clear(lat)
    await user.type(lat, '-89.5')
    await user.click(screen.getByRole('button', { name: 'Analyse this point' }))
    // a valid point closes the coordinates panel
    expect(useApp.getState().selection).toEqual({ kind: 'point', lat: -89.5, lon: 137.3 })
    expect((await screen.findAllByText(/Smooth sphere · 2 m/)).length).toBeGreaterThan(0)
  })

  it('plays and pauses with the button and with the space bar', async () => {
    const user = userEvent.setup()
    renderAt('/')
    const play = await screen.findByRole('button', { name: /Play/ })
    await user.click(play)
    expect(useApp.getState().playing).toBe(true)
    document.body.focus()
    await user.keyboard(' ')
    expect(useApp.getState().playing).toBe(false)
    // the second icon cycles the playback speed
    const before = useApp.getState().speed
    await user.click(screen.getByRole('button', { name: /^Speed:/ }))
    expect(useApp.getState().speed).not.toBe(before)
  })

  it('mission mode: filters need a value, and a missing endpoint is reported, not faked', async () => {
    const user = userEvent.setup()
    useApp.setState({ mode: 'mission' })
    const { container } = renderAt('/')
    // the filters open from the tool bar at the top right
    await user.click(await screen.findByRole('button', { name: 'Mission filters' }))
    const slope = await screen.findByRole('switch', { name: /Maximum slope/ })
    await user.click(slope)
    await user.click(screen.getByRole('button', { name: 'Find viable sites' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Steepest slope is required')
    expect(slope).toHaveAttribute('aria-checked', 'true')
    await user.type(screen.getByLabelText('Steepest slope'), '8')
    await user.click(screen.getByRole('button', { name: 'Find viable sites' }))
    expect(await screen.findByText(/Candidate search: not available yet/)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Sunlight' })).toHaveValue('0.5')
    await noAxeViolations(container)
  })

  it('compares places live: each pick while Compare is on adds a numbered column', async () => {
    const user = userEvent.setup()
    const { container } = renderAt('/')
    await screen.findByRole('article', { name: 'Sun' }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /^Compare$/ }))
    const search = screen.getByRole('combobox', { name: 'Search sites and missions' })
    for (const [q, name] of [['malapert', /Mons Malapert/], ['shackle', /Shackleton crater/]] as const) {
      await user.click(search)
      await user.type(search, q)
      await user.click(await screen.findByRole('option', { name }))
    }
    // the comparison is a section of the place panel: one card per place, numbers also in a table behind them
    expect(await screen.findByRole('heading', { level: 3, name: /Compare/ })).toBeInTheDocument()
    const card = await screen.findByRole('article', { name: /Shackleton crater/ })
    expect(within(card).getByText('Sunlit')).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: /Places side by side/ })
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads.join('|')).toMatch(/Metric\|1 IM-2.*\|2 Mons Malapert.*\|3 Shackleton crater/)
    expect(within(table).getByRole('rowheader', { name: 'Sunlit' })).toBeInTheDocument()
    expect(useApp.getState().compare).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Remove Shackleton crater' }))
    expect(useApp.getState().compare).toHaveLength(2)
    await noAxeViolations(container)
  })

  it('keeps working from static data when the API is down', async () => {
    vi.stubGlobal('fetch', fakeFetch(false))
    const user = userEvent.setup()
    renderAt('/')
    expect(await screen.findByRole('article', { name: 'Sun' }, { timeout: 5000 })).toBeInTheDocument()
    // the catalogue comes from the static copy, and the search list says so
    await user.click(screen.getByRole('combobox', { name: 'Search sites and missions' }))
    expect(await screen.findByText(/Site catalogue: the API did not answer/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /IM-2/ })).toBeInTheDocument()
  })
})

describe('text pages', () => {
  it.each([
    ['/data', 'Data & methods'],
    ['/learn', 'Learn'],
  ])('%s has one h1 and no axe violations', async (path, title) => {
    const { container } = renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toContain(title))
    await noAxeViolations(container)
  })

  it('data page shows the measured validation against JPL Horizons', async () => {
    renderAt('/data')
    expect(await screen.findByText(/352 comparisons/)).toBeInTheDocument()
  })
})

describe('colour', () => {
  it('text on every colour-map cell reaches 4.5:1', () => {
    for (const cmap of ['inferno', 'viridis', 'magma', 'cividis'] as const) {
      for (let i = 0; i <= 100; i++) {
        const bg = colorAt(cmap, i / 100)
        const l = luminance(bg)
        const ratio = textOn(bg) === '#000' ? (l + 0.05) / 0.05 : 1.05 / (l + 0.05)
        expect(ratio).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
