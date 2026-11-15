/**
 * The polar map is one step away from the globe (a button, a click on the cap, a zoom): fetch what it opens with
 * while the globe is on screen, so entering it does not wait for the download. That is the tile index, the overview
 * heights (the largest file of the map, about 6 MB: relief of the whole pole and the shadows) and the first tile.
 * The files are only brought into the browser's HTTP cache, at low priority; the map then reads them as usual.
 */
import type { QueryClient } from '@tanstack/react-query'
import { TILES_BASE, loadTileset } from './TerrainView'
import { tileUrl } from './tileset'

let started = false

export function prefetchMap(client: QueryClient): void {
  if (started) return
  started = true
  client
    .fetchQuery({ queryKey: ['static', 'tileset'], queryFn: loadTileset, staleTime: Infinity })
    .then((ts) => {
      const urls = [TILES_BASE + ts.overview.path, TILES_BASE + tileUrl(ts.height.path, { z: 0, x: 0, y: 0 })]
      // read to the end: an answer left unread is not kept in the cache
      for (const url of urls) void fetch(url, { priority: 'low' } as RequestInit).then((r) => r.arrayBuffer()).catch(() => {})
    })
    .catch(() => {
      started = false // the map reports a missing tileset itself
    })
}
