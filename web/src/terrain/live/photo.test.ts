import { describe, expect, it } from 'vitest'
import { PHOTO_SERVICE, photoMaxZ, photoTileUrl } from './photo'

// the map's square (public/tiles/tileset.json): 1 966 080 m, 7 680 m cells at z0
const ts = { extentM: [-983040, -983040, 983040, 983040] as [number, number, number, number] }

describe('photo layer of the polar map', () => {
  it('stops at the level whose 256 cells are the last no finer than half a 100 m mosaic pixel', () => {
    // z7: 7680 / 128 = 60 m cells; z8 would be 30 m
    expect(photoMaxZ(ts)).toBe(7)
  })

  it('asks for the whole square at z0 and a quarter of it at z1, in the map projection', () => {
    const u0 = new URL(photoTileUrl(ts, { z: 0, x: 0, y: 0 }))
    expect(u0.pathname).toContain(`/${PHOTO_SERVICE}/ImageServer/exportImage`)
    expect(u0.searchParams.get('bbox')).toBe('-983040,-983040,983040,983040')
    expect(u0.searchParams.get('size')).toBe('256,256')
    expect(u0.searchParams.get('f')).toBe('image')
    // row 0 is the top (largest y): tile (1, 1, 0) is the north-east quarter
    expect(new URL(photoTileUrl(ts, { z: 1, x: 1, y: 0 })).searchParams.get('bbox')).toBe('0,0,983040,983040')
  })
})
