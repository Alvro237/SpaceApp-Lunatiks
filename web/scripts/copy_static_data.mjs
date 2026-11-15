// Copies the small static files the browser engine reads from data/ into public/data/ (git-ignored):
// the Sun/Earth tables with their index, the site catalogue with its terrain horizon masks, and the
// validation results shown on the Data & methods page. Run automatically before `dev` and `build`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = resolve(root, 'web/public/data')
mkdirSync(out, { recursive: true })

const index = JSON.parse(readFileSync(resolve(root, 'data/ephemeris.json'), 'utf8'))
const files = ['ephemeris.json', ...index.segments.map((s) => s.file), 'sites.json', 'horizons.i16', 'validation.json']
// the global LOLA topography for the globe (data/globe, built by pipeline/lunarnav/globe.py)
mkdirSync(resolve(out, 'globe'), { recursive: true })
files.push('globe/globe.json', `globe/${JSON.parse(readFileSync(resolve(root, 'data/globe/globe.json'), 'utf8')).file}`)
// the NASA SVS star map behind the globe (data/sky, built by pipeline/lunarnav/sky.py)
mkdirSync(resolve(out, 'sky'), { recursive: true })
const sky = JSON.parse(readFileSync(resolve(root, 'data/sky/sky.json'), 'utf8'))
files.push('sky/sky.json', ...Object.values(sky.files).map((f) => `sky/${f.file}`))
for (const f of files) copyFileSync(resolve(root, 'data', f), resolve(out, f))
console.log(`copied ${files.length} files from data/ to web/public/data/`)

// Past landings on the map (mission planner, section 3.6): the catalogue of measured landing and impact points.
copyFileSync(resolve(root, 'data/external/sites/landing_sites.csv'), resolve(out, 'landing_sites.csv'))
console.log('copied landing_sites.csv to web/public/data/')

// Diameters of the catalogue's named features, from the IAU Gazetteer copy in data/external/nomenclature.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
const [head, ...rows] = parseCsv(readFileSync(resolve(root, 'data/external/nomenclature/moon_nomenclature.csv'), 'utf8'))
const col = (n) => head.indexOf(n)
const byName = new Map(rows.map((r) => [r[col('clean_name')]?.toLowerCase(), r]))
const sites = JSON.parse(readFileSync(resolve(root, 'data/sites.json'), 'utf8')).sites
const features = {}
for (const s of sites) {
  const key = s.name.toLowerCase().replace(/ (crater|massif)$/, '')
  const r = byName.get(key)
  if (r) features[s.id] = { iauName: r[col('name')], diameterKm: Number(Number(r[col('diameter')]).toFixed(3)), link: r[col('link')] }
}
writeFileSync(
  resolve(out, 'features.json'),
  JSON.stringify({ source: 'USGS/IAU Gazetteer of Planetary Nomenclature (data/external/nomenclature)', url: 'https://planetarynames.wr.usgs.gov/', features }, null, 1),
)
console.log(`feature diameters for ${Object.keys(features).length} catalogue sites`)
