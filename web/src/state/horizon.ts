/**
 * Camera of the first-person horizon view (opened by the Horizon section): free look, or locked on the Sun or the
 * Earth so the view turns with it during playback. Angles in degrees: yaw = azimuth at the centre of the view
 * (clockwise from north), pitch = elevation at the centre, fov = horizontal field of the free map area.
 */
import { create } from 'zustand'

export type CameraMode = 'free' | 'sun' | 'earth'

export const FOV_MIN = 4
export const FOV_MAX = 140
export const PITCH_MIN = -15
export const PITCH_MAX = 70

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface HorizonCam {
  mode: CameraMode
  yaw: number
  pitch: number
  fov: number
  setMode: (m: CameraMode) => void
  /** Free look at an absolute direction. */
  look: (yaw: number, pitch: number) => void
  zoom: (factor: number) => void
}

/**
 * Map ⇄ horizon transition. `diving`: the map's own camera flies to the place, comes down and tilts toward the
 * horizon, facing `yaw` (where the horizon view will open), then fades; `horizon`: the first-person view covers
 * the map (which pauses); `returning`: the map camera flies back to where it was.
 */
export type HorizonPhase = 'map' | 'diving' | 'horizon' | 'returning'
/** Length of the flight down to the place and of the flight back, ms. */
export const DIVE_MS = 1300
export const RETURN_MS = 700

interface HorizonTransition {
  phase: HorizonPhase
  /** Azimuth (degrees) the horizon view opens on, so the flight down already faces it. */
  yaw: number
  setPhase: (p: HorizonPhase) => void
  setYaw: (yaw: number) => void
}

export const useHorizonTransition = create<HorizonTransition>()((set) => ({
  phase: 'map',
  yaw: 0,
  setPhase: (phase) => set({ phase }),
  setYaw: (yaw) => set({ yaw }),
}))

export const useHorizonCam = create<HorizonCam>()((set) => ({
  mode: 'sun',
  yaw: 0,
  pitch: 4,
  // wide enough to show the skyline with the window's Sun and Earth tracks over it (+/− narrow it)
  fov: 90,
  setMode: (mode) => set({ mode }),
  look: (yaw, pitch) => set({ mode: 'free', yaw: ((yaw % 360) + 360) % 360, pitch: clamp(pitch, PITCH_MIN, PITCH_MAX) }),
  zoom: (factor) => set((s) => ({ fov: clamp(s.fov * factor, FOV_MIN, FOV_MAX) })),
}))
