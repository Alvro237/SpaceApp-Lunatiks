import { useNow } from '../panels/useNow'
import { type CameraMode, useHorizonCam } from '../state/horizon'
import { followPitch } from './project'

/**
 * Where the camera points: the followed body, or the free-look direction. Following keeps the body's azimuth in
 * the centre; when the body is below or near the skyline the view is raised so the skyline stays in its lower part
 * (followPitch), otherwise a Sun or an Earth under the horizon would fill the view with ground.
 */
export function useEffectiveCamera(): { mode: CameraMode; yaw: number; pitch: number; fov: number } {
  const { view, info } = useNow()
  const { mode, yaw, pitch, fov } = useHorizonCam()
  const body = mode === 'sun' ? view?.sun : mode === 'earth' ? view?.earth : null
  if (body) {
    const skyline = info ? info.model.horizon.at(body.az) : 0
    return { mode, yaw: body.az, pitch: followPitch(body.el, skyline, fov), fov }
  }
  return { mode, yaw, pitch, fov }
}
