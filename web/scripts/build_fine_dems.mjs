/**
 * Builds src/horizon/relief/fineDems.json: the high-resolution DTMs on NASA Moon Trek's ImageServer (LROC NAC stereo
 * DTMs, Apollo 15 Panoramic Camera DTMs, the Apollo 17 NAC DTM) with their extent in degrees (east-positive
 * longitude, -180..180), their cell in metres and their no-data value, read from each service's JSON description.
 * The horizon view (relief/rings.ts) reads them for the rings they cover and fills the rest from LOLA.
 *
 *   node scripts/build_fine_dems.mjs
 */
import { writeFileSync } from 'node:fs'

const BASE = 'https://trek.nasa.gov/moon/trekarcgis/rest/services/'
const list = await (await fetch(`${BASE}?f=json`)).json()
const names = list.services.map((s) => s.name).filter((n) => /^(LRO_NAC_DEM_|Apollo15_PanCam_DEM_|NAC_DTM_APOLLO17$)/.test(n) && !/_NP$|_SP$/.test(n))
const R = 1737400
const out = []
for (const name of names) {
  try {
    const j = await (await fetch(`${BASE}${name}/ImageServer?f=json`)).json()
    const e = j.extent
    const wkt = e.spatialReference?.wkt ?? ''
    const wkid = e.spatialReference?.wkid ?? e.spatialReference?.latestWkid
    let lon0, lon1, lat0, lat1
    const geographic = /^GEOGCS/.test(wkt) || (!wkt && Math.abs(e.xmax) <= 360 && Math.abs(e.ymax) <= 90)
    if (geographic) {
      ;[lon0, lon1, lat0, lat1] = [e.xmin, e.xmax, e.ymin, e.ymax]
    } else {
      // projected (equirectangular / simple cylindrical about a standard parallel and central meridian): convert
      const p = (k) => {
        const i = wkt.toLowerCase().indexOf(`parameter["${k.toLowerCase()}",`)
        return i < 0 ? 0 : parseFloat(wkt.slice(i + k.length + 13))
      }
      const lonC = p('Central_Meridian')
      const latS = p('Standard_Parallel_1')
      const pi = wkt.indexOf('PROJECTION["')
      const proj = pi < 0 ? '' : wkt.slice(pi + 12, wkt.indexOf('"', pi + 12))
      if (!/Equirectangular|Plate_Carree|Equidistant_Cylindrical/i.test(proj)) {
        console.warn(`skip ${name}: projection ${proj || wkid}`)
        continue
      }
      const k = (180 / Math.PI) / R
      lat0 = e.ymin * k
      lat1 = e.ymax * k
      lon0 = lonC + (e.xmin * k) / Math.cos((latS * Math.PI) / 180)
      lon1 = lonC + (e.xmax * k) / Math.cos((latS * Math.PI) / 180)
    }
    const wrap = (l) => ((((l + 180) % 360) + 360) % 360) - 180
    const cellM = geographic ? j.pixelSizeY * (Math.PI / 180) * R : j.pixelSizeY
    out.push({
      file: name,
      lat0: +lat0.toFixed(5),
      lat1: +lat1.toFixed(5),
      lon0: +wrap(lon0).toFixed(5),
      lon1: +wrap(lon1).toFixed(5),
      cellM: +cellM.toFixed(3),
      noData: Array.isArray(j.noDataValues) && j.noDataValues.length ? j.noDataValues[0] : (j.noDataValue ?? null),
    })
  } catch (err) {
    console.warn(`skip ${name}: ${err.message}`)
  }
}
const doc = {
  source: 'NASA Moon Trek ImageServer service descriptions (?f=json), https://trek.nasa.gov/moon/trekarcgis/rest/services/',
  built: new Date().toISOString().slice(0, 10),
  dems: out,
}
writeFileSync(new URL('../src/horizon/relief/fineDems.json', import.meta.url), JSON.stringify(doc, null, 1) + '\n')
console.log(`${out.length} of ${names.length} DTMs`)
