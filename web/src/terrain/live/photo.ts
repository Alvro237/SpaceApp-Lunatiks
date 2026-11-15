/**
 * Photo layer of the polar map: the LROC WAC south polar mosaic (100 m; a square of ±1 095.7 km, which holds the
 * map's disc to 60° S), read from NASA Moon Trek's ImageServer as 256 × 256 grey JPEG tiles cut on request. The service is in the map's own projection (south polar
 * stereographic, sphere of 1737.4 km, central meridian 0; checked against the LOLA DEMs' spatial reference on
 * 2026-11-15) and sends CORS headers itself, so a tile is the exportImage of the tile's box: no reprojection.
 *
 * A tile is cell-centred like the layer tiles (pixel-is-area): cell (i, j) covers the tile's box split in 256 × 256.
 * The brightness is the mosaic's as photographed (reflectance, 8 bits): the map's shader uses it as the ground's
 * colour and lights the LOLA relief with the Sun at the chosen instant on top (terrain/shaders.ts, uLayerMode 3).
 */
import { type TileKey, type Tileset, tileBounds } from '../tileset'
import { TREK_IMAGE_SERVER } from './config'

/** LROC WAC south polar mosaic, 100 m per pixel, south polar stereographic. */
export const PHOTO_SERVICE = 'LRO_WAC_Mosaic_SPole60_100m_v02'
export const PHOTO_PIXEL_M = 100
export const PHOTO_CELLS = 256
/** Photo tiles up to this level are asked for as soon as a tile shows them (few, coarse); finer ones once the camera stops. */
export const PHOTO_EAGER_Z = 3

/** Finest level whose photo cells are no finer than half a mosaic pixel (the 60 m cells of z7 for 100 m pixels). */
export function photoMaxZ(ts: Pick<Tileset, 'extentM'>): number {
  const size0 = ts.extentM[2] - ts.extentM[0]
  let z = 0
  while ((size0 / 2 ** (z + 1)) / PHOTO_CELLS >= PHOTO_PIXEL_M / 2) z++
  return z
}

/** exportImage URL of a tile's box: 256 × 256 JPEG, bilinear on the server. */
export function photoTileUrl(ts: Pick<Tileset, 'extentM'>, t: TileKey): string {
  const [xMin, yMin, xMax, yMax] = tileBounds(ts, t)
  const bbox = [xMin, yMin, xMax, yMax].map((v) => Math.round(v * 1000) / 1000).join(',')
  return (
    `${TREK_IMAGE_SERVER}${PHOTO_SERVICE}/ImageServer/exportImage?bbox=${bbox}&size=${PHOTO_CELLS},${PHOTO_CELLS}` +
    `&format=jpg&compressionQuality=85&interpolation=RSP_BilinearInterpolation&f=image`
  )
}
