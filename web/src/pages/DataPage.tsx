/**
 * Data & methods: where every number comes from, how it was normalised and checked, what is missing, and how
 * AI was used. Provenance comes from the API (GET /meta/datasets) and from the static files the browser loads
 * (validation.json, tileset.json), so this page states measured results only.
 */
import { useQuery } from '@tanstack/react-query'
import { useDatasets } from '../api/hooks'
import { DataTable } from '../charts/DataTable'
import type { Tileset } from '../terrain/tileset'
import { DATA_BASE } from '../time/staticData'
import { ApiStatus } from '../ui/ApiStatus'

interface Validation {
  ephemerisVsHorizons: { comparisons: number; sites: number; maxElevationErrorDeg: number; maxAzimuthErrorDeg: number; toleranceDeg: number; dateRange: [string, string] }
  ephemerisVsApolloTables: { events: number; sunElevationMaxErrorDeg: number; sunAzimuthMaxErrorDeg: number; note: string }
  terrainHeightVsLroc: { site: string; referenceElevationM: number; ourDemElevationM: number; differenceM: number; reference: string }[]
}

const json = <T,>(url: string) => async () => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return (await r.json()) as T
}

export function DataPage() {
  const datasets = useDatasets()
  const validation = useQuery({ queryKey: ['static', 'validation'], queryFn: json<Validation>(`${DATA_BASE}validation.json`), staleTime: Infinity })
  const tileset = useQuery({ queryKey: ['static', 'tileset'], queryFn: json<Tileset>(`${import.meta.env.BASE_URL}tiles/tileset.json`), staleTime: Infinity })
  const v = validation.data
  const ts = tileset.data

  return (
    <article className="page prose">
      <h1>Data & methods</h1>
      <p className="intro">Every number on screen has a source. This page lists the sources, the processing, the checks and the gaps.</p>

      <h2>NASA data at the core</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Data sources">
        <table>
          <caption>Datasets and what each one gives</caption>
          <thead>
            <tr>
              <th scope="col">Dataset</th>
              <th scope="col">Source</th>
              <th scope="col">Used for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Sun and Earth positions, hourly 2025–2035 and 1969–1972</th>
              <td>
                <a href="https://naif.jpl.nasa.gov/pub/naif/generic_kernels/">JPL SPICE</a> DE440, Moon Mean-Earth frame, light time + aberration
              </td>
              <td>Azimuth, elevation, distance; playback in the browser (4-point Lagrange interpolation)</td>
            </tr>
            <tr>
              <th scope="row">Terrain horizon masks, 13 sites × 4 mast heights</th>
              <td>
                <a href="https://pgda.gsfc.nasa.gov/products/90">LRO LOLA DEMs, PGDA product 90</a> (10–240 m)
              </td>
              <td>Visible share of the solar and Earth discs, sunset and Earthset times</td>
            </tr>
            <tr>
              <th scope="row">The whole Moon (globe)</th>
              <td>
                <a href="https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/">LOLA LDEM_16</a>, NASA PDS
                (4 px/deg area means)
              </td>
              <td>Globe lit by the Sun at the chosen time; relief exaggerated ×4</td>
            </tr>
            <tr>
              <th scope="row">The whole Moon, read while you zoom</th>
              <td>
                <a href="https://trek.nasa.gov/moon/">NASA Moon Trek</a> LOLA DEMs (global 256 px/deg between 45° S and 45° N, 100 m polar DEMs beyond;
                down to 83 m cells) and LROC WAC global mosaic (303 px/deg, 100 m), read on demand and kept in this browser's storage
              </td>
              <td>Sharper relief shading on the globe; the optional photo view (the WAC mosaic keeps the lighting it was photographed with)</td>
            </tr>
            <tr>
              <th scope="row">Relief tiles and elevation</th>
              <td>
                LOLA LDEM_60S_240MPP_ADJ (960 m cells, whole map) and{' '}
                <a href="https://pgda.gsfc.nasa.gov/products/90">LDEM_80S_80MPP_ADJ</a> (480 to 60 m cells within about 300 km of the pole), PGDA product 90
              </td>
              <td>2D and 3D terrain, shadows at the chosen instant</td>
            </tr>
            <tr>
              <th scope="row">Finest relief, read while you zoom</th>
              <td>
                LOLA DEMs read on demand and kept in this browser's storage (the oldest are deleted above 45 % of the site's quota):{' '}
                <a href="https://trek.nasa.gov/moon/">NASA Moon Trek</a> 100 m and 30 m south-pole DEMs (120 and 60 m cells across the whole map) and
                its 5 m DEM (3.75 m cells near the pole); PGDA product 90 LDEM_80S_20MPP_ADJ (30 m cells) and LDEM_83S_10MPP_ADJ (15 and 7.5 m cells)
                {import.meta.env.DEV || import.meta.env.VITE_PGDA_PROXY ? '' : ' (the PGDA ones are not enabled in this build)'}
              </td>
              <td>2D and 3D terrain when you zoom in</td>
            </tr>
            <tr>
              <th scope="row">Slope</th>
              <td>
                LOLA LDSM_60S_240MPP_ADJ, PGDA product 90 (960 m cells; zoomed in, 240 m and, within about 300 km of the pole, LDSM_80S_80MPP_ADJ at
                120 m, read on demand{import.meta.env.DEV || import.meta.env.VITE_PGDA_PROXY ? '' : ', not enabled in this build'})
              </td>
              <td>Slope layer, slope hard filter</td>
            </tr>
            <tr>
              <th scope="row">Mean sunlight, Earth visibility, permanent shadow (18.6-year means)</th>
              <td>
                <a href="https://pgda.gsfc.nasa.gov/products/69">PGDA product 69</a> (Mazarico et al. 2011): 960 m cells; zoomed in, the 240 m originals
                read on demand{import.meta.env.DEV || import.meta.env.VITE_PGDA_PROXY ? '' : ' (not enabled in this build)'}
              </td>
              <td>Colour layers for screening areas</td>
            </tr>
            <tr>
              <th scope="row">Craters above 1–2 km</th>
              <td>Robbins (2018), USGS; LRO and JAXA Kaguya data</td>
              <td>Crater density filter</td>
            </tr>
            <tr>
              <th scope="row">Site coordinates</th>
              <td>NASA NSSDCA, LROC, USGS/IAU Gazetteer</td>
              <td>Catalogue of 21 sites, each with its citation</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Validation (measured)</h2>
      {v ? (
        <ul>
          <li>
            Sun and Earth directions against <strong>JPL Horizons</strong>: {v.ephemerisVsHorizons.comparisons} comparisons at {v.ephemerisVsHorizons.sites}{' '}
            sites ({v.ephemerisVsHorizons.dateRange.map((d) => d.slice(0, 10)).join(' to ')}), largest error {v.ephemerisVsHorizons.maxElevationErrorDeg}° in elevation
            and {v.ephemerisVsHorizons.maxAzimuthErrorDeg}° in azimuth (tolerance {v.ephemerisVsHorizons.toleranceDeg}°). The browser engine is checked
            against the same reference in its test suite.
          </li>
          <li>
            Against the <strong>Apollo Lunar Surface Journal</strong> tables: {v.ephemerisVsApolloTables.events} events, Sun elevation within{' '}
            {v.ephemerisVsApolloTables.sunElevationMaxErrorDeg}°. {v.ephemerisVsApolloTables.note}
          </li>
          {v.terrainHeightVsLroc.map((t) => (
            <li key={t.site}>
              Ground height at <strong>{t.site}</strong>: {t.ourDemElevationM} m from LOLA against {t.referenceElevationM} m published by{' '}
              <a href={t.reference}>LROC</a> (difference {t.differenceM} m).
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Loading validation results…</p>
      )}

      <h2>From DEM to map tiles</h2>
      <ol>
        <li>Each product must declare the same south polar stereographic projection on the 1737.4 km sphere (MOON_ME); otherwise the build stops.</li>
        <li>Heights are metres above the 1737.4 km sphere, the API's datum.</li>
        <li>Gaps are filled from the next coarser level, never with zeros.</li>
        <li>Coarser levels are area means; finer ones are bilinear.</li>
        <li>
          Each 257 × 257 tile is normalised to its own minimum and maximum (16 bits in the red and green channels of a lossless PNG); neighbours share their
          edge samples.
        </li>
        <li>Checked against the catalogue ground heights and for identical shared edges (below).</li>
      </ol>
      {ts?.validation && (
        <>
          <p>
            {ts.kind === 'preview' ? 'Preview tileset' : 'Tileset'} built {ts.builtUtc.slice(0, 10)}: {Object.keys(ts.height.tiles).length} height tiles,{' '}
            {ts.levels.length} levels ({ts.levels.map((l) => `${l.cellM} m`).join(', ')}), shared-edge mismatches: {ts.validation.sharedEdgeMismatches},
            quantisation at most {ts.validation.maxQuantisationM} m. {ts.validation.note}
          </p>
          <DataTable
            summary="Tile height at each terrain site against the catalogue"
            caption="Height of the terrain tiles at the catalogue sites"
            head={['Site', 'Catalogue (m)', 'Tiles (m)', 'Difference (m)', 'Finest level']}
            rows={ts.validation.siteHeights.map((s) => [s.site, s.catalogueGroundM, s.tileM, s.differenceM, s.finestLevel ?? '—'])}
          />
        </>
      )}

      <h2>Method</h2>
      <ul>
        <li>
          <strong>Discs, not points.</strong> The Sun (0.53° wide) and the Earth (about 1.9°) are integrated against the horizon in seven vertical slices. “Sunlit”
          means any part of the solar disc is above the horizon; “contact” means at least the chosen share of the Earth's disc (50 % by default).
        </li>
        <li>
          <strong>Parallax.</strong> The site position is always subtracted before computing angles: from the lunar surface the Earth shifts by up to 0.26°.
        </li>
        <li>
          <strong>Horizon.</strong> Catalogue sites with terrain use LOLA horizon masks ray-marched to 175 km with exact lunar curvature. Anywhere else the
          horizon is a smooth sphere, which can only overstate light and contact; the panels say which horizon was used.
        </li>
        <li>
          <strong>Shadows on the map.</strong> For each terrain cell the GPU marches toward the Sun's azimuth over the LOLA heights, including the curvature
          drop, and darkens the cell by the share of the solar disc above that horizon: the same rule as the API. Measured against the LOLA masks at the
          13 terrain sites (72 azimuths each), the map's horizon from the 960 m preview heights is 1.2° lower on average (from 0.2° at Shoemaker
          to 5.6° at Mons Malapert), because nearby ridges are smoothed away: the map shows slightly more light than there is. It is for
          seeing patterns; the numbers in the panels come from the masks.
        </li>
        <li>
          <strong>Level of detail.</strong> A tile is refined when its cells would look larger than 2 screen pixels and merged back below 1.5 px; at most 6 tiles
          load at once, and the parent tile stays until its children arrive.
        </li>
      </ul>

      <h2>Known gaps</h2>
      <ul>
        <li>No boulder dataset: rocks are reported as unknown. The crater catalogue stops at about 1–2 km.</li>
        <li>No measured temperature (Diviner) or radiation-dose dataset is loaded.</li>
        <li>Terrain horizons exist for 13 catalogue sites; other points use a smooth sphere.</li>
        <li>Screening layers are 960 m means: they screen areas, they do not certify a landing ellipse.</li>
        <li>Sun and Earth tables cover 2025–2035 and 1969–1972.</li>
      </ul>

      <h2>Provenance reported by the API</h2>
      {datasets.data ? (
        Object.entries(datasets.data).map(([k, val]) =>
          typeof val === 'string' ? (
            <p key={k}>
              <strong>{k.replace(/_/g, ' ')}:</strong> {val}
            </p>
          ) : (
            <details key={k} className="json">
              <summary>{k.replace(/_/g, ' ')}</summary>
              <pre>{JSON.stringify(val, null, 2)}</pre>
            </details>
          ),
        )
      ) : (
        <ApiStatus error={datasets.error} what="Dataset provenance" />
      )}

      <h2>Use of AI</h2>
      <p>
        Claude (Anthropic) assisted the team with research, code (API, data pipeline and this interface), tests and documentation, under the team's direction
        and review. No AI-generated images, video or audio are used. The relief, shadows and colours on the map are rendered from NASA data.
      </p>
    </article>
  )
}
