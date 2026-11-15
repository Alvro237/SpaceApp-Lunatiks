// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PHOTO_BASE_LEVEL, TILE_CELLS, allTiles } from './grid'
import { splitPhotoBase } from './photoBase'

describe('splitPhotoBase', () => {
  const N = TILE_CELLS
  const width = 8 * N
  const height = 4 * N
  // every pixel holds its tile's number (x + 8 y) so a misplaced block shows up
  const grey = new Uint8Array(width * height)
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) grey[r * width + c] = Math.floor(c / N) + 8 * Math.floor(r / N)

  it('cuts the 2048 x 1024 image into the 32 tiles of the photo base level, in place', () => {
    const tiles = splitPhotoBase(grey, width, height)
    expect(tiles.map((t) => t.tile)).toEqual(allTiles(PHOTO_BASE_LEVEL))
    for (const { tile, bytes } of tiles) {
      expect(bytes.length).toBe(N * N)
      expect(bytes.every((v) => v === tile.x + 8 * tile.y)).toBe(true)
    }
  })

  it('keeps the rows of a tile in order (row 0 at its north edge)', () => {
    const ramp = new Uint8Array(width * height)
    for (let r = 0; r < height; r++) ramp.fill(r % N, r * width, (r + 1) * width)
    const [first] = splitPhotoBase(ramp, width, height)
    expect(first.bytes[0]).toBe(0)
    expect(first.bytes[(N - 1) * N]).toBe(N - 1)
  })

  it('refuses an image of another size', () => {
    expect(() => splitPhotoBase(new Uint8Array(4), 2, 2)).toThrow(/expected 2048 x 1024/)
  })
})
