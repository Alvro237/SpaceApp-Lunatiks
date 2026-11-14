/**
 * Ground view hand-over between the first-person horizon view (which knows what is on screen) and the terrain
 * engine's frame loop (which draws the 3D relief under it): docs/horizon-view-plan.md, Layer B. The two live in
 * different React roots (the engine runs inside the WebGL canvas), so they meet here.
 */
import { create } from 'zustand'
import type { GroundScreen } from '../terrain/ground'

export interface GroundRequest {
  lat: number
  lon: number
  screen: GroundScreen
}

interface GroundState {
  /** What the horizon view asks the engine to draw; null when the ground view is off. */
  request: GroundRequest | null
  /** The engine has drawn the request with every tile it wanted (nothing still loading). */
  ready: boolean
  setRequest: (r: GroundRequest | null) => void
  setReady: (ready: boolean) => void
}

export const useGround = create<GroundState>()((set, get) => ({
  request: null,
  ready: false,
  setRequest: (request) => set(request ? { request } : { request: null, ready: false }),
  setReady: (ready) => {
    if (get().ready !== ready) set({ ready })
  },
}))
