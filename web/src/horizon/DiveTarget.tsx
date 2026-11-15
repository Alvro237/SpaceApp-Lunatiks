/**
 * Publishes the azimuth the horizon view will open on (the followed body, or the free-look direction), so the
 * map's flight down to the place can already face it, and starts reading the place's relief as that flight begins
 * (relief/rings.ts prefetchRings), so the ground is on its way before the view opens. Renders nothing; mounted
 * inside the NowProvider.
 */
import { useEffect } from 'react'
import { useNow } from '../panels/useNow'
import { useHorizonTransition } from '../state/horizon'
import { loadGroundTexture } from './groundTexture'
import { prefetchRings } from './relief/rings'
import { useEffectiveCamera } from './useEffectiveCamera'

export function DiveTarget() {
  const { yaw } = useEffectiveCamera()
  useEffect(() => useHorizonTransition.getState().setYaw(yaw), [yaw])
  const diving = useHorizonTransition((s) => s.phase === 'diving')
  const { info } = useNow()
  const lat = info?.model.lat
  const lon = info?.model.lon
  useEffect(() => {
    // (the relief is lit in workers: without them, as in the unit tests, the view never draws it)
    if (!diving || lat === undefined || lon === undefined || typeof Worker === 'undefined') return
    prefetchRings(lat, lon)
    void loadGroundTexture()
  }, [diving, lat, lon])
  return null
}
