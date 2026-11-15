/**
 * Adaptive pixel ratio for a React Three Fiber canvas that draws every frame (the Educational world of cubes).
 * A slow GPU gets fewer pixels and a fast one keeps them all: the frame rate is judged over windows of WINDOW_S,
 * and below SLOW_FPS the pixel ratio goes down a step (to 1.5, then to 1). It is the rule the globe applies
 * (globe/GlobeView.tsx), so the three views behave alike. Nothing is judged in the first GRACE_S (shaders compiling,
 * the first cubes building), on a hidden page or across a stall, and the ratio never goes back up, so a machine at
 * its limit does not swing between two sizes.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'

export const WINDOW_S = 2
export const SLOW_FPS = 45
export const GRACE_S = 3
/** A frame longer than this (s) is a stall (tab switch, garbage collection), not the GPU's pace. */
const STALL_S = 0.25

/** The pixel ratio to use after a window drawn at `fps` with ratio `dpr`: one step down when it was slow. */
export function nextDpr(dpr: number, fps: number): number {
  if (fps >= SLOW_FPS || dpr <= 1) return dpr
  return dpr > 1.5 ? 1.5 : 1
}

export function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr)
  const perf = useRef({ frames: 0, time: 0, age: 0, dpr: 0 })

  useFrame((state, dt) => {
    const p = perf.current
    if (p.dpr === 0) p.dpr = state.viewport.dpr
    p.age += dt
    if (document.visibilityState !== 'visible' || dt > STALL_S) {
      p.frames = 0
      p.time = 0
      return
    }
    p.frames++
    p.time += dt
    if (p.time < WINDOW_S) return
    const fps = p.frames / p.time
    p.frames = 0
    p.time = 0
    if (p.age <= GRACE_S) return
    const dpr = nextDpr(p.dpr, fps)
    if (dpr !== p.dpr) {
      p.dpr = dpr
      setDpr(dpr)
    }
  })

  return null
}
