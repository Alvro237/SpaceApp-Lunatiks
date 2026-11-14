import { useNow } from '../panels/useNow'
import { type CameraMode, useHorizonCam } from '../state/horizon'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Where the camera points: the followed body, or the free-look direction. */
export function useEffectiveCamera(): { mode: CameraMode; yaw: number; pitch: number; fov: number } {
  const { view } = useNow()
  const { mode, yaw, pitch, fov } = useHorizonCam()
  if (mode === 'sun' && view) return { mode, yaw: view.sun.az, pitch: clamp(view.sun.el, -10, 60), fov }
  if (mode === 'earth' && view) return { mode, yaw: view.earth.az, pitch: clamp(view.earth.el, -10, 60), fov }
  return { mode, yaw, pitch, fov }
}

