/**
 * Relief around the place the camera looks at. The globe's own mesh has a vertex every 0.7 degrees (21 km): fine for
 * the whole Moon, but a tilted view from a few hundred kilometres up shows it as a smooth ball with craters painted
 * on. So up to three square grids of latitude and longitude are drawn around the centre of the view, each PATCH_CELLS
 * cells across and four times the size of the one inside it, lifted by the heights in the vertex shader
 * (shaders.ts, PATCH_VERT). The globe, and each grid, leave out the part a finer grid draws.
 *
 * The cells are whole fractions of a degree (powers of two) and each grid's centre is a multiple of its cell, so
 * while the camera moves a vertex stays over the same ground and the relief does not shimmer. A cell is wider in
 * longitude by a power of two near to 1 / cos(latitude), so cells stay roughly square on the ground.
 *
 * Pure geometry here (tested in patch.test.ts); GlobeView draws it.
 */
import * as THREE from 'three'
import { MOON_R_KM } from './orbit'

/** Cells across a grid (the grid has PATCH_CELLS + 1 vertices a side). */
export const PATCH_CELLS = 256
export const PATCH_LEVELS = 3
/** Each grid is this many times the size of the one inside it. */
export const PATCH_RATIO = 4
/** The finest grid reaches this many times the camera's distance to the place it looks at, each way. */
export const PATCH_REACH = 1.5
/** A grid is drawn only if its cells are smaller than this (km): beyond it the globe's 21 km mesh of the 7.6 km heights is as good. */
export const PATCH_MAX_CELL_KM = 10
/** No grids poleward of this latitude: meridians converge and a grid of latitude and longitude folds up. */
export const PATCH_MAX_LAT = 80

const KM_PER_DEG = (MOON_R_KM * Math.PI) / 180

export interface PatchWindow {
  /** Centre, degrees. */
  lon: number
  lat: number
  /** Cell size, degrees of longitude and of latitude. */
  cellLon: number
  cellLat: number
  /** Cell size on the ground along a meridian, km. */
  cellKm: number
}

const pow2 = (x: number) => 2 ** Math.round(Math.log2(x))

/**
 * The grids for a camera `rangeKm` from the place it looks at (lat, lon), finest first; empty when none would add
 * anything (far from the Moon, near a pole).
 */
export function patchWindows(lat: number, lon: number, rangeKm: number): PatchWindow[] {
  if (Math.abs(lat) > PATCH_MAX_LAT || !(rangeKm > 0)) return []
  const finest = pow2((2 * PATCH_REACH * rangeKm) / PATCH_CELLS / KM_PER_DEG)
  const widen = pow2(1 / Math.cos((lat * Math.PI) / 180))
  const out: PatchWindow[] = []
  for (let l = 0; l < PATCH_LEVELS; l++) {
    const cellLat = finest * PATCH_RATIO ** l
    const cellKm = cellLat * KM_PER_DEG
    if (cellKm > PATCH_MAX_CELL_KM) break
    const cellLon = cellLat * widen
    // a grid wider than the Moon would overlap itself
    if (cellLon * PATCH_CELLS >= 360) break
    out.push({ lon: Math.round(lon / cellLon) * cellLon, lat: Math.round(lat / cellLat) * cellLat, cellLon, cellLat, cellKm })
  }
  return out
}

/**
 * Poleward of this latitude (south) the grids are laid out in south polar stereographic metres instead
 * (polarPatchWindows), lifted by the polar map's tiles (detail/polar.ts).
 */
export const POLAR_PATCH_LAT = -75

/**
 * Largest polar grid cell, km. Larger than PATCH_MAX_CELL_KM: a tilted view from a few hundred kilometres sees past
 * the grid that limit allows (1 000 km across), and beyond it the globe's own mesh has no detail heights; 16 km cells
 * (4 200 km across) reach the horizon and still beat its 21 km rows.
 */
export const POLAR_PATCH_MAX_CELL_KM = 16.4

export interface PolarPatchWindow {
  /** Centre, south polar stereographic metres. */
  x: number
  y: number
  /** Cell size, metres of the map (ground metres × the scale factor, 1.00 to 1.04 south of 75° S). */
  cellM: number
}

/**
 * The polar grids for a camera `rangeKm` from the point (x, y) it looks at, finest first: the same sizes as
 * patchWindows (cells a power of two of metres, each grid PATCH_RATIO times the one inside, cells up to
 * POLAR_PATCH_MAX_CELL_KM), centres snapped to the grid's cell so a vertex stays over the same ground while the camera
 * moves.
 */
export function polarPatchWindows(x: number, y: number, rangeKm: number): PolarPatchWindow[] {
  if (!(rangeKm > 0)) return []
  const finest = pow2((2 * PATCH_REACH * rangeKm * 1000) / PATCH_CELLS)
  const out: PolarPatchWindow[] = []
  for (let l = 0; l < PATCH_LEVELS; l++) {
    const cellM = finest * PATCH_RATIO ** l
    if (cellM > POLAR_PATCH_MAX_CELL_KM * 1000) break
    out.push({ x: Math.round(x / cellM) * cellM, y: Math.round(y / cellM) * cellM, cellM })
  }
  return out
}

/** The square a polar grid draws, smaller by `margin` cells each side: centre x, y and half-width, metres. */
export function polarHoleOf(w: PolarPatchWindow, margin = 1): [number, number, number] {
  return [w.x, w.y, (PATCH_CELLS / 2 - margin) * w.cellM]
}

/**
 * The part of the Moon a grid covers that the mesh around it leaves out: the grid's box, smaller by `margin` cells
 * each side so the two overlap (the grid's skirt hides what little gap is left). As the shader takes it: centre
 * longitude, half-width in longitude, south and north latitude.
 */
export function holeOf(w: PatchWindow, margin = 1): [number, number, number, number] {
  const half = PATCH_CELLS / 2 - margin
  return [w.lon, half * w.cellLon, Math.max(-89.9, w.lat - half * w.cellLat), Math.min(89.9, w.lat + half * w.cellLat)]
}

/** The grid: `position.xy` counts cells from the centre; `skirt` is 1 on a second rim that hangs down. */
export function patchGeometry(n = PATCH_CELLS): THREE.BufferGeometry {
  const side = n + 1
  const position: number[] = []
  const skirt: number[] = []
  const index: number[] = []
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    position.push(i - n / 2, n / 2 - j, 0)
    skirt.push(0)
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * side + i
    index.push(a, a + side, a + 1, a + 1, a + side, a + side + 1)
  }
  // the rim, once around, repeated as the skirt
  const rim: number[] = []
  for (let i = 0; i < n; i++) rim.push(i)
  for (let j = 0; j < n; j++) rim.push(j * side + n)
  for (let i = n; i > 0; i--) rim.push(n * side + i)
  for (let j = n; j > 0; j--) rim.push(j * side)
  const base = side * side
  rim.forEach((v, k) => {
    position.push(position[3 * v], position[3 * v + 1], 0)
    skirt.push(1)
    const next = (k + 1) % rim.length
    index.push(v, base + k, rim[next], rim[next], base + k, base + next)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('skirt', new THREE.Float32BufferAttribute(skirt, 1))
  g.setIndex(index)
  return g
}
