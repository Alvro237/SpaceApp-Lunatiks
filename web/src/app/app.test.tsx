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
    expect(await screen.findByRole('heading', { level: 1, name: 'Lunar Landing Site Navigator' })).toBeInTheDocument()
    const im2 = await screen.findByRole('button', { name: /IM-2/ })
    expect(im2).toHaveAttribute('aria-pressed', 'true')
    const sun = await screen.findByRole('article', { name: 'Sun' }, { timeout: 5000 })
    expect(within(sun).getByText('Elevation')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Earth' })).toBeInTheDocument()
    expect(screen.getAllByText('Browser engine').length).toBeGreaterThan(0)
    expect(screen.getByText(/LOLA horizon · 2 m/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Sunlit .*% and Earth in view/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /360° horizon with the Sun and the Earth/ })).toBeInTheDocument()
    await noAxeViolations(container)
  })

  it('opens on the globe; the map replaces it when entered', async () => {
    renderAt('/')
    expect(await screen.findByRole('img', { name: 'Globe (test stub)' })).toBeInTheDocument()
    useApp.getState().enterMap(-85, 30)
    expect(await screen.findByRole('img', { name: 'Map (test stub)' })).toBeInTheDocument()
    expect(useApp.getState().mapEntry).toMatchObject({ lat: -85, lon: 30 })
  })

  it('selects another site from the list with the keyboard', async () => {
    const user = userEvent.setup()
    renderAt('/')
    const btn = await screen.findByRole('button', { name: /Shackleton crater/ })
    btn.focus()
    await user.keyboard('{Enter}')
    expect(useApp.getState().selection).toEqual({ kind: 'site', id: 'shackleton' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('rejects invalid manual coordinates with an alert, accepts valid ones', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(await screen.findByText('Coordinates'))
    const lat = await screen.findByLabelText('Latitude (°)')
    await user.clear(lat)
    await user.type(lat, '-95')
    await user.click(screen.getByRole('button', { name: 'Analyse this point' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Latitude must be a number from −90 to 90/)
    expect(lat).toHaveAttribute('aria-invalid', 'true')
    await user.clear(lat)
    await user.type(lat, '-89.5')
    await user.click(screen.getByRole('button', { name: 'Analyse this point' }))
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
  })

  it('mission mode: filters need a value, and a missing endpoint is reported, not faked', async () => {
    const user = userEvent.setup()
    useApp.setState({ mode: 'mission' })
    const { container } = renderAt('/')
    const slope = await screen.findByRole('checkbox', { name: /Maximum slope/ })
    await user.click(slope)
    await user.click(screen.getByRole('button', { name: 'Find viable sites' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Max slope (°) is required')
    await user.type(screen.getByLabelText('Max slope (°)'), '8')
    await user.click(screen.getByRole('button', { name: 'Find viable sites' }))
    expect(await screen.findByText(/Candidate search: not available yet/)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'sunlight' })).toHaveValue('0.5')
    await noAxeViolations(container)
  })

  it('compares places live: each pick while Compare is on adds a numbered column', async () => {
    const user = userEvent.setup()
    const { container } = renderAt('/')
    await screen.findByRole('article', { name: 'Sun' }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /^Compare$/ }))
    const list = screen.getByRole('region', { name: 'Catalogue sites' })
    await user.click(within(list).getByRole('button', { name: /Mons Malapert/ }))
    await user.click(within(list).getByRole('button', { name: /Shackleton crater/ }))
    const table = await screen.findByRole('table', { name: /Places side by side/ })
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads.join('|')).toMatch(/1IM-2.*\|2Mons Malapert.*\|3Shackleton crater/)
    expect(within(table).getByRole('rowheader', { name: 'Sunlit (window)' })).toBeInTheDocument()
    expect(useApp.getState().compare).toHaveLength(3)
    await user.click(within(table).getByRole('button', { name: 'Remove Shackleton crater' }))
    expect(useApp.getState().compare).toHaveLength(2)
    await noAxeViolations(container)
  })

  it('keeps working from static data when the API is down', async () => {
    vi.stubGlobal('fetch', fakeFetch(false))
    renderAt('/')
    expect(await screen.findByText(/Site catalogue: the API did not answer/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /IM-2/ })).toBeInTheDocument()
    expect(await screen.findByRole('article', { name: 'Sun' }, { timeout: 5000 })).toBeInTheDocument()
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
