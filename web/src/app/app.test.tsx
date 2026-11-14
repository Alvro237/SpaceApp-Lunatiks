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
    // no side panel until a section is asked for: the sky dial keeps the Sun and Earth on screen
    expect(await screen.findByRole('img', { name: /Sky above IM-2/ }, { timeout: 5000 })).toBeInTheDocument()
    expect(document.querySelector('.side-panel')).toBeNull()
    expect(screen.getByRole('img', { name: /Sunlit .*% and Earth in view/ })).toBeInTheDocument()
    const tools = screen.getByRole('group', { name: 'Place tools' })
    expect(within(tools).getByRole('button', { name: 'Multiselect' })).toHaveAttribute('aria-pressed', 'false')
    await noAxeViolations(container)
    // the sections are buttons in the map tool bar; each opens the side panel, Escape or a second press closes it
    const user = userEvent.setup()
    const horizonBtn = within(tools).getByRole('button', { name: 'Horizon' })
    await user.click(horizonBtn)
    expect(horizonBtn).toHaveAttribute('aria-pressed', 'true')
    // Horizon opens the first-person view on the place: it takes the focus and the keyboard; the side panel steers
    // it and adds the Sun and Earth cards (after the short dive into the place)
    const hv = await screen.findByRole('application', { name: /Horizon view from IM-2/ }, { timeout: 3000 })
    expect(hv).toHaveFocus()
    expect(screen.getByRole('heading', { level: 2, name: 'Horizon' })).toBeInTheDocument()
    const sun = screen.getByRole('article', { name: 'Sun' })
    expect(within(sun).getByText('Elevation')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Earth' })).toBeInTheDocument()
    expect(screen.getAllByText('Browser engine').length).toBeGreaterThan(0)
    expect(screen.getByText(/LOLA horizon · 2 m/)).toBeInTheDocument()
    const camera = screen.getByRole('radiogroup', { name: 'Camera' })
    expect(within(camera).getByRole('radio', { name: /Sun/ })).toBeChecked()
    await user.keyboard('{ArrowRight}')
    expect(within(camera).getByRole('radio', { name: /Free/ })).toBeChecked()
    await user.keyboard('e')
    expect(within(camera).getByRole('radio', { name: /Earth/ })).toBeChecked()
    expect(hv).toHaveAccessibleName(/facing .* Earth at azimuth .*in view/)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('application', { name: /Horizon view/ })).not.toBeInTheDocument()
    expect(document.querySelector('.side-panel')).toBeNull()
    await waitFor(() => expect(horizonBtn).toHaveFocus())
    await user.click(within(tools).getByRole('button', { name: 'Power' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Power' })).toHaveFocus()
    // the engine parameters live in the section they change
    expect(screen.getByRole('radiogroup', { name: 'Panel' })).toBeInTheDocument()
    expect(screen.getByText('Power per m²')).toBeInTheDocument()
    expect(screen.getByText('Solar elevation')).toBeInTheDocument()
    expect(screen.getByText('Sunlight duration')).toBeInTheDocument()
    expect(screen.getByText('Earth visibility windows')).toBeInTheDocument()
    expect(screen.getByText('Radiation')).toBeInTheDocument()
    // fixed data first, then the options in collapsible panels
    expect(screen.getByRole('heading', { level: 3, name: 'At a glance' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /Options/ })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Model' })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^About / })[0])
    expect(screen.getByRole('note')).toBeInTheDocument()
    await noAxeViolations(container)
    await user.click(screen.getByRole('button', { name: 'Close Power' }))
    expect(document.querySelector('.side-panel')).toBeNull()
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
    // the horizon it is computed over is stated in the Horizon section
    await user.click(within(screen.getByRole('group', { name: 'Place tools' })).getByRole('button', { name: 'Horizon' }))
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

  it('multiselect: two places open the comparison with a radar, strips over time and removal with undo', async () => {
    const user = userEvent.setup()
    const { container } = renderAt('/')
    await screen.findByRole('img', { name: /Sky above IM-2/ }, { timeout: 5000 })
    const tools = screen.getByRole('group', { name: 'Place tools' })
    await user.click(within(tools).getByRole('button', { name: 'Multiselect' }))
    // the single-place sections step aside; with one place the bar says what to do next
    expect(within(tools).queryByRole('button', { name: 'Power' })).toBeNull()
    expect(within(tools).getByRole('status')).toHaveTextContent(/Pick another place/)
    const search = screen.getByRole('combobox', { name: 'Search sites and missions' })
    for (const [q, name] of [['malapert', /Mons Malapert/], ['shackle', /Shackleton crater/]] as const) {
      await user.click(search)
      await user.type(search, q)
      await user.click(await screen.findByRole('option', { name }))
    }
    expect(useApp.getState().compare).toHaveLength(3)
    expect(await screen.findByRole('heading', { level: 2, name: 'Comparing 3 places' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /Radar of 3 places/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /When each place is sunlit: 1 IM-2.*2 Mons Malapert.*3 Shackleton crater/ })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Earth/ }))
    expect(screen.getByRole('img', { name: /When each place is in view of the Earth/ })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /Places compared over the window/ })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent).join('|')).toMatch(/Place\|Sunlight\|Earth contact\|Short nights\|Steady contact\|Power/)
    await noAxeViolations(container)
    // removing a place (the keyboard route of a right click on the map) can be undone
    await user.click(screen.getByRole('button', { name: 'Remove Shackleton crater' }))
    expect(useApp.getState().compare).toHaveLength(2)
    expect(await screen.findByText(/Removed Shackleton crater/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(useApp.getState().compare).toHaveLength(3)
    // leaving multiselect clears the comparison and closes its panel
    await user.click(screen.getByRole('button', { name: /Close comparison/ }))
    expect(useApp.getState().compareMode).toBe(false)
    expect(useApp.getState().compare).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: /Comparing/ })).toBeNull()
  })

  it('keeps working from static data when the API is down', async () => {
    vi.stubGlobal('fetch', fakeFetch(false))
    const user = userEvent.setup()
    renderAt('/')
    expect(await screen.findByRole('img', { name: /Sky above IM-2/ }, { timeout: 5000 })).toBeInTheDocument()
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
