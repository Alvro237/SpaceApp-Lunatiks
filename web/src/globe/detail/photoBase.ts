/**
 * The globe's photo base, shipped with the app (data/globe/wac_global_level1.jpg, built by
 * pipeline/lunarnav/globe_photo.py): the 32 LROC WAC tiles of level PHOTO_BASE_LEVEL from Moon Trek's WMTS cache,
 * placed side by side in one 2048 x 1024 grey image. Loaded with the global heights, so the globe opens in photo
 * mode at once instead of showing the grey relief while the same 32 tiles arrive one by one from Moon Trek.
 */
import { DATA_BASE } from '../../time/staticData'
import { type DetailTile, PHOTO_BASE_LEVEL, TILE_CELLS, columns, rows } from './grid'

export interface PhotoBaseMeta {
  file: string
  width: number
  height: number
  tileCells: number
  level: number
}

/** The photo base cut into its tiles: grey bytes, TILE_CELLS² each, row 0 at the tile's north edge. */
export type PhotoBase = { tile: DetailTile; bytes: Uint8Array }[]

/** Cut a grey image (one byte per pixel, row 0 at 90 N, column 0 at 180 W) into the tiles of level z. */
export function splitPhotoBase(grey: Uint8Array, width: number, height: number, z = PHOTO_BASE_LEVEL): PhotoBase {
  const N = TILE_CELLS
  if (width !== columns(z) * N || height !== rows(z) * N) {
    throw new Error(`photo base is ${width} x ${height}, expected ${columns(z) * N} x ${rows(z) * N}`)
  }
  const out: PhotoBase = []
  for (let y = 0; y < rows(z); y++) {
    for (let x = 0; x < columns(z); x++) {
      const bytes = new Uint8Array(N * N)
      for (let j = 0; j < N; j++) bytes.set(grey.subarray((y * N + j) * width + x * N, (y * N + j) * width + (x + 1) * N), j * N)
      out.push({ tile: { z, x, y }, bytes })
    }
  }
  return out
}

/** Fetch and decode the shipped photo base; null when it cannot be read (the globe then asks Moon Trek for it). */
export async function loadPhotoBase(): Promise<PhotoBase | null> {
  try {
    const meta = (await (await fetch(`${DATA_BASE}globe/globe_photo.json`)).json()) as PhotoBaseMeta
    if (meta.level !== PHOTO_BASE_LEVEL || meta.tileCells !== TILE_CELLS) return null
    const res = await fetch(`${DATA_BASE}globe/${meta.file}`)
    if (!res.ok) return null
    const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' })
    try {
      const { width, height } = bitmap
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0)
      const rgba = ctx.getImageData(0, 0, width, height).data
      const grey = new Uint8Array(width * height)
      for (let i = 0; i < grey.length; i++) grey[i] = rgba[i * 4]
      return splitPhotoBase(grey, width, height)
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}
