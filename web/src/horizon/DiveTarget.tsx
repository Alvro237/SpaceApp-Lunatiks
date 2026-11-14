/**
 * Publishes the azimuth the horizon view will open on (the followed body, or the free-look direction), so the
 * map's flight down to the place can already face it. Renders nothing; mounted inside the NowProvider.
 */
import { useEffect } from 'react'
import { useHorizonTransition } from '../state/horizon'
import { useEffectiveCamera } from './useEffectiveCamera'

export function DiveTarget() {
  const { yaw } = useEffectiveCamera()
  useEffect(() => useHorizonTransition.getState().setYaw(yaw), [yaw])
  return null
}
