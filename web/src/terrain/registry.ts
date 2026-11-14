/** The running terrain engine, so non-3D code (point models, picking) can read the overview heights. */
import type { TerrainEngine } from './engine'

export const terrainRegistry: { engine: TerrainEngine | null } = { engine: null }
