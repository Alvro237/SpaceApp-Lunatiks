/**
 * Crater rims from the Robbins (2018) catalogue, drawn as rings on the terrain (plan: "Cráteres ≥ 3 km",
 * GET /api/v1/craters, AERO-1). Requested for the area in view once the camera is close enough; a ring is a
 * circle of the crater's radius on the ground, scaled by the projection's map factor.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useCraters } from '../api/hooks'
import type { CameraRig } from './cameraRig'
import type { TerrainEngine } from './engine'
import { polarLatLon, polarXY, scaleFactor } from './tileset'

export const CRATER_MIN_DIAM_KM = 3
const MAX_VIEW_KM = 400
const SEGMENTS = 48

/** Lat/lon box around a map point, for the request. */
function bbox(xKm: number, zKm: number, halfKm: number): [number, number, number, number] {
  const pts = [-1, 1].flatMap((a) => [-1, 1].map((b) => polarLatLon((xKm + a * halfKm) * 1000, -(zKm + b * halfKm) * 1000)))
  const [cLat] = polarLatLon(xKm * 1000, -zKm * 1000)
  const lats = pts.map((p) => p[0])
  const maxLat = Math.min(-60, Math.max(...lats, cLat))
  const minLat = Math.max(-90, Math.min(...lats, cLat))
  // near the pole every longitude is in view
  const lons = pts.map((p) => p[1])
  const span = Math.max(...lons) - Math.min(...lons)
  return span > 180 || Math.hypot(xKm, zKm) < halfKm * 1.5 ? [minLat, -180, maxLat, 180] : [minLat, Math.min(...lons), maxLat, Math.max(...lons)]
}

export function Craters({ rig, engine, exaggeration, onStatus }: { rig: CameraRig; engine: TerrainEngine; exaggeration: number; onStatus: (e: unknown) => void }) {
  const [area, setArea] = useState<[number, number, number, number] | null>(null)
  const query = useCraters(area, CRATER_MIN_DIAM_KM)

  // Re-request when the view moved by more than a third of its size.
  useFrame(() => {
    const n = rig.now
    if (n.dist > MAX_VIEW_KM) return
    const half = n.dist * 0.8
    const box = bbox(n.tx, n.tz, half)
    if (!area || Math.abs(box[0] - area[0]) + Math.abs(box[2] - area[2]) > (area[2] - area[0]) / 3 || Math.abs(box[1] - area[1]) > 5) {
      setArea(box.map((v) => Math.round(v * 100) / 100) as [number, number, number, number])
    }
  })

  useEffect(() => onStatus(query.error ?? null), [query.error, onStatus])

  const lines = useMemo(() => {
    const craters = query.data?.craters ?? []
    if (!craters.length) return null
    const pos = new Float32Array(craters.length * SEGMENTS * 2 * 3)
    let o = 0
    for (const c of craters) {
      const [x, y] = polarXY(c.lat, c.lon)
      const rM = ((c.diam_km * 1000) / 2) * scaleFactor(c.lat)
      const h = (((engine.heightAt(x, y) ?? 0) + 30) / 1000) * exaggeration
      for (let i = 0; i < SEGMENTS; i++) {
        for (const k of [i, i + 1]) {
          const a = (k / SEGMENTS) * Math.PI * 2
          pos[o++] = (x + rM * Math.cos(a)) / 1000
          pos[o++] = h
          pos[o++] = -(y + rM * Math.sin(a)) / 1000
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [query.data, engine, exaggeration])

  useEffect(() => () => lines?.dispose(), [lines])
  if (!lines) return null
  return (
    <lineSegments geometry={lines} renderOrder={2}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.75} depthTest={false} />
    </lineSegments>
  )
}
