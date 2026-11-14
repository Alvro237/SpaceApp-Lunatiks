// Copies the small static files the browser engine reads from data/ into public/data/ (git-ignored):
// the Sun/Earth tables with their index, the site catalogue with its terrain horizon masks, and the
// validation results shown on the Data & methods page. Run automatically before `dev` and `build`.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
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
for (const f of files) copyFileSync(resolve(root, 'data', f), resolve(out, f))
console.log(`copied ${files.length} files from data/ to web/public/data/`)
