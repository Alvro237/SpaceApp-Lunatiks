/**
 * Tileset contract (docs/web-tileset.md) and the south polar stereographic projection it uses.
 *
 * Projection (same as data/grids and every PGDA south-pole product): x = r sin(lon), y = r cos(lon),
 * r = 2R tan((90 + lat) / 2), R = 1737.4 km, metres. Longitude 0 points to +y (up on the map), 90° E to +x.
 *
 * Scene units are kilometres: sceneX = x / 1000, sceneZ = −y / 1000, sceneY = height / 1000 × exaggeration.
 */

export const R_M = 1_737_400
const DEG = Math.PI / 180

export interface TilesetLevel {
  z: number
  tiles: number
  cellM: number
}

export interface LayerMeta {
  name: string
  unit: string
  min: number
  max: number
  colormap: 'inferno' | 'viridis' | 'magma' | 'cividis'
  levels: number
  description: string
  cellM: number
  sourcePixelM?: number | null
  source: { agency?: string; url?: string; product?: string }
}

export interface Tileset {
  format: number
  kind: string
  note?: string
  extentM: [number, number, number, number]
  /** The map is the disc south of this latitude; radius in projected metres. */
  discLatDeg?: number
  discRadiusM?: number
  tileCells: number
  tileSamples: number
  levels: TilesetLevel[]
  height: {
    path: string
    encoding: string
    /** "z/x/y" → [min, max] metres. */
    tiles: Record<string, [number, number]>
    sources: { id: string; description: string; source: { url?: string; product?: string; agency?: string }; cellM: number }[]
  }
  overview: { path: string; samples: number; min: number; max: number }
  layers: Record<string, LayerMeta>
  validation?: {
    siteHeights: { site: string; catalogueGroundM: number; tileM: number; differenceM: number; finestLevel?: string }[]
    maxAbsSiteDifferenceM: number | null
    sharedEdgeMismatches: number
    maxQuantisationM: number
    note: string
  }
  builtUtc: string
}

export interface TileKey {
  z: number
  x: number
  y: number
}

export const keyOf = (t: TileKey) => `${t.z}/${t.x}/${t.y}`
export function parseKey(k: string): TileKey {
  const [z, x, y] = k.split('/').map(Number)
  return { z, x, y }
}

export const children = (t: TileKey): TileKey[] => [
  { z: t.z + 1, x: 2 * t.x, y: 2 * t.y },
  { z: t.z + 1, x: 2 * t.x + 1, y: 2 * t.y },
  { z: t.z + 1, x: 2 * t.x, y: 2 * t.y + 1 },
  { z: t.z + 1, x: 2 * t.x + 1, y: 2 * t.y + 1 },
]

export const parent = (t: TileKey): TileKey | null => (t.z === 0 ? null : { z: t.z - 1, x: t.x >> 1, y: t.y >> 1 })

export const tileUrl = (template: string, t: TileKey) =>
  template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))

/** Projected bounds of a tile, metres: [xMin, yMin, xMax, yMax]. Row 0 is the top (largest y). */
export function tileBounds(ts: Pick<Tileset, 'extentM'>, t: TileKey): [number, number, number, number] {
  const [x0, , x1, y1] = ts.extentM
  const size = (x1 - x0) / 2 ** t.z
  const xMin = x0 + t.x * size
  const yMax = y1 - t.y * size
  return [xMin, yMax - size, xMin + size, yMax]
}

export function polarXY(latDeg: number, lonDeg: number): [number, number] {
  const r = 2 * R_M * Math.tan(((90 + latDeg) * DEG) / 2)
  return [r * Math.sin(lonDeg * DEG), r * Math.cos(lonDeg * DEG)]
}

export function polarLatLon(x: number, y: number): [number, number] {
  const r = Math.hypot(x, y)
  const lat = (2 * Math.atan(r / (2 * R_M))) / DEG - 90
  const lon = Math.atan2(x, y) / DEG
  return [lat, lon]
}

/** Map scale factor of the projection at a latitude: map distance = k × ground distance. */
export const scaleFactor = (latDeg: number) => 1 / Math.cos(((90 + latDeg) * DEG) / 2) ** 2

export const toScene = (x: number, y: number, heightM = 0, exaggeration = 1): [number, number, number] => [
  x / 1000,
  (heightM / 1000) * exaggeration,
  -y / 1000,
]

export const fromScene = (sx: number, sz: number): [number, number] => [sx * 1000, -sz * 1000]

/** True when a lat/lon falls on the map (inside its disc, or its square extent when no disc is given). */
export function inExtent(ts: Pick<Tileset, 'extentM' | 'discRadiusM'>, lat: number, lon: number): boolean {
  const [x, y] = polarXY(lat, lon)
  const [x0, y0, x1, y1] = ts.extentM
  if (ts.discRadiusM !== undefined && Math.hypot(x, y) > ts.discRadiusM) return false
  return lat < 0 && x >= x0 && x <= x1 && y >= y0 && y <= y1
}
