/**
 * The horizon view's real ground for one place: loads the rings (rings.ts), has the worker light them at the
 * active instant (light.worker.ts) and hands the renderer a scene (render.ts). The rings load once per place; the
 * sunlight is recomputed when the Sun has moved enough to move a shadow visibly (SUN_EPS), one job at a time.
 * Once the rings are in, the far ground the eye can see gets the mosaic's 100 m detail tiles (detailPhoto.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { GroundStack, type SunDir } from './light'
import type { LightRequest, LightResponse } from './light.worker'
import { type Ring, loadRing, photoAlbedo, placePhotoMean, planeFrame, ringSpecs } from './rings'
import { detailSampler, detailTileUrl, loadDetailTile, tileKey, visibleFarTiles } from './detailPhoto'
import { MAX_LAT, kKey, kaguyaMean, kaguyaSampler, kaguyaTileUrl, loadKaguyaTile, pixelGrid, visibleKaguyaTiles } from './kaguya'
import { groundTexture } from '../groundTexture'
import type { ReliefScene } from './render'

/** Eye height over the ground when the mask is for the bare surface (mast 0 m): a standing person's eyes. */
export const EYE_MIN_M = 1.7
/** Sun motion that triggers a new lighting pass, degrees (elevation, azimuth). */
const SUN_EPS = { el: 0.02, az: 0.15 }
/** Rings arriving within this many ms are lit as one set. */
const BATCH_MS = 700
/** Most workers that share a lighting pass. */
const MAX_WORKERS = 4

export type ReliefStatus = 'unavailable' | 'loading' | 'ready' | 'failed'

export interface Relief {
  status: ReliefStatus
  scene: ReliefScene | null
  /** Cell of the DEM read at the observer, metres, and the outermost ring's reach, km. */
  cellM: number | null
  reachKm: number | null
  /** Duration of the last lighting pass in the slowest worker, ms. */
  lightMs: number | null
  /** At night: lit by earthshine (exposure raised) or dark (neither the Sun nor the Earth up). */
  night?: 'earthshine' | 'dark' | null
  /** The data under the observer, in words: "LOLA 5 m DEM", or "LROC NAC 1.6 m DTM + LOLA" where one is merged in. */
  sourceLabel?: string | null
  /** Finer photo tiles of the ground in view: which mosaic, read so far, and asked for. */
  detailTiles?: { source: 'kaguya' | 'wac'; loaded: number; wanted: number }
}

/** Words for the data a ring was built from (rings.ts). */
export function ringSourceLabel(r: Ring): string {
  if (r.fine && (r.fineShare ?? 0) > 0) {
    const kind = r.fine.dem.file.startsWith('Apollo15_PanCam') ? 'Apollo 15 Panoramic Camera' : 'LROC NAC'
    return `${kind} ${r.fine.dem.cellM.toFixed(1)} m DTM + LOLA`
  }
  return `LOLA ${r.source.demM} m DEM`
}

const D = Math.PI / 180

/** Last lighting pass: workers, slowest worker ms and wall-clock ms (for the console and the tests). */
export const reliefLightStats = { workers: 0, ms: 0, wallMs: 0 }

/**
 * The lights of the instant: the Sun, and at night the Earth (earthshine) with its irradiance as a fraction of
 * sunlight (light.ts earthshineRatio). `sunVisible`: any part of the Sun's disc above the observer's skyline.
 */
export interface SceneLights {
  sun: SunDir
  sunVisible: boolean
  earth: SunDir | null
  earthRatio: number
}

/** Exposure at night relative to day: earthlit ground at this fraction of the brightness of sunlit ground. */
export const NIGHT_EXPOSURE = 0.6

export function useRelief(lat: number | undefined, lon: number | undefined, mastM: number, lights: SceneLights | null): Relief {
  const sun = lights?.sun ?? null
  const specs = useMemo(() => (lat === undefined || lon === undefined ? null : ringSpecs(lat, lon)), [lat, lon])
  const key = specs?.map((s) => s.url).join('|') ?? ''
  // rings as they arrive (progressive: the view draws whatever has arrived, the finest ring at each point)
  const [loaded, setLoaded] = useState<{ key: string; rings: (Ring | undefined)[]; failed: number }>({ key: '', rings: [], failed: 0 })

  useEffect(() => {
    if (!specs || specs.length === 0) return
    let live = true
    // state of another place is replaced on the first answer for this one
    const fresh = (prev: typeof loaded) => (prev.key === key ? prev : { key, rings: [], failed: 0 })
    specs.forEach((s, i) =>
      loadRing(s).then(
        (r) =>
          live &&
          setLoaded((prev) => {
            const base = fresh(prev)
            const rings = base.rings.slice()
            rings[i] = r
            return { ...base, rings }
          }),
        // a ring that fails leaves the others on screen; all of them failing means no relief here
        () => live && setLoaded((prev) => ({ ...fresh(prev), failed: fresh(prev).failed + 1 })),
      ),
    )
    return () => {
      live = false
    }
  }, [specs, key])

  // the first ring to arrive is lit at once; later ones arriving within BATCH_MS of each other are lit together
  const [batch, setBatch] = useState(loaded)
  useEffect(() => {
    const first = loaded.key === key && batch.key !== key && loaded.rings.some(Boolean)
    const id = setTimeout(() => setBatch(loaded), first ? 0 : BATCH_MS)
    return () => clearTimeout(id)
  }, [loaded, batch.key, key])
  const frame = useMemo(() => (lat === undefined || lon === undefined ? null : planeFrame(lat, lon)), [lat, lon])
  const stack = useMemo(() => {
    if (batch.key !== key || !frame) return null
    // finest first, whatever has arrived: the outer rings give the far ground and the skyline's foreground at once,
    // the inner ones sharpen it as they come
    const have = batch.rings.filter((r): r is Ring => !!r).sort((a, b) => a.cellM - b.cellM)
    return have.length > 0 ? new GroundStack(have, frame) : null
  }, [batch, key, frame])

  // the place's photo: one brightness scale for every ring and detail tile (rings.ts photoAlbedo)
  const photoMean = useMemo(() => (stack ? placePhotoMean(stack.rings as Ring[]) : null), [stack])
  const ringAlbedo = useMemo(
    () => (stack && photoMean ? (stack.rings as Ring[]).map((r) => (r.photo ? photoAlbedo(r.photo, photoMean) : null)) : null),
    [stack, photoMean],
  )
  // the ground in view at a finer photo: Kaguya TC (21 m) up to MAX_LAT, the WAC mosaic's own 100 m beyond (the
  // ray casting of the horizon picks the tiles); worked out once all the rings are in, shown as the tiles arrive
  const kaguya = lat !== undefined && Math.abs(lat) <= MAX_LAT
  const [detail, setDetail] = useState<{ key: string; tiles: Map<string, Uint8Array>; wanted: number; source: 'kaguya' | 'wac' }>({
    key: '',
    tiles: new Map(),
    wanted: 0,
    source: 'wac',
  })
  const complete = !!stack && !!specs && stack.rings.length === specs.length
  useEffect(() => {
    if (!complete || !stack || lat === undefined || lon === undefined) return
    let live = true
    const eye = stack.heightAt(0, (512 - 1) / 2, (512 - 1) / 2) + Math.max(mastM, EYE_MIN_M)
    const source = kaguya ? 'kaguya' : 'wac'
    const jobs: { key: string; url: string; load: (u: string) => Promise<Uint8Array | null> }[] = kaguya
      ? visibleKaguyaTiles(stack, eye, lat, lon).map((t) => ({ key: kKey(t.col, t.row), url: kaguyaTileUrl(t.col, t.row), load: loadKaguyaTile }))
      : visibleFarTiles(stack, eye).map((t) => ({ key: tileKey(t.ix, t.iy), url: detailTileUrl(lat, lon, t.ix, t.iy), load: loadDetailTile }))
    const got = new Map<string, Uint8Array>()
    setDetail({ key, tiles: new Map(), wanted: jobs.length, source })
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      if (live) setDetail({ key, tiles: new Map(got), wanted: jobs.length, source })
    }
    for (const j of jobs)
      void j.load(j.url).then((g) => {
        if (!live || !g) return
        got.set(j.key, g)
        // a few tiles at a time: each new set costs a render
        timer ??= setTimeout(flush, 500)
      })
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [complete, stack, key, lat, lon, mastM, kaguya])
  // the projection from the place's plane to the Kaguya grid, worked out once per place
  const kGrid = useMemo(() => (kaguya && lat !== undefined && lon !== undefined ? pixelGrid(lat, lon) : null), [kaguya, lat, lon])
  const detailAt = useMemo(() => {
    if (detail.key !== key || detail.tiles.size === 0 || lat === undefined || lon === undefined) return undefined
    if (detail.source === 'kaguya') {
      const m = kaguyaMean(detail.tiles)
      return m && kGrid ? kaguyaSampler(detail.tiles, m, lat, lon, kGrid) : undefined
    }
    return photoMean ? detailSampler(detail.tiles, photoMean) : undefined
  }, [detail, key, photoMean, lat, lon, kGrid])

  // what is on screen: a stack with its normals and its sunlight, swapped only once a larger stack is fully lit
  const [shown, setShown] = useState<{
    key: string
    stack: GroundStack
    normals: Float32Array[]
    sunlight: Float32Array[]
    ms: number
    earthlight: Float32Array[] | null
    lights: SceneLights | null
  } | null>(null)
  const kick = useRef<(() => void) | null>(null)
  const job = useRef<{ busy: boolean; sent: SceneLights | null; want: SceneLights | null; id: number; quick: boolean }>({
    busy: false,
    sent: null,
    want: null,
    id: 0,
    quick: true,
  })

  useEffect(() => {
    if (!stack || typeof Worker === 'undefined') return
    // a small pool: each worker lights every n-th row (light.ts ringLightHorizon), the parts are summed
    const count = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1))
    const pool = Array.from({ length: count }, () => new Worker(new URL('./light.worker.ts', import.meta.url), { type: 'module' }))
    job.current = { busy: false, sent: null, want: job.current.want, id: 0, quick: true }
    let normals: Float32Array[] | null = null
    let pending: { sunlight: Float32Array[]; earthlight: Float32Array[] | null; ms: number; lights: SceneLights | null } | null = null
    let earthParts: (Float32Array[] | null)[] = []
    let parts: Float32Array[][] = []
    let worst = 0
    let started = 0
    const publish = () => {
      if (!normals || !pending) return
      setShown({ key, stack, normals, ...pending })
    }
    // every new stack or light position is lit twice: a quick pass shown at once, then the full one
    const send = (quick: boolean) => {
      const j = job.current
      if (j.busy || !j.want) return
      j.busy = true
      j.quick = quick
      j.sent = j.want
      j.id++
      parts = []
      worst = 0
      started = performance.now()
      const want = j.want
      earthParts = []
      // earthshine only matters while the Sun is hidden from the observer
      const earth = !want.sunVisible && want.earth ? want.earth : null
      pool.forEach((w, i) => w.postMessage({ type: 'sun', id: j.id, sun: want.sun, earth, rowOffset: i, rowStride: count, quick } satisfies LightRequest))
    }
    pool.forEach((w, wi) => {
      w.onmessage = (e: MessageEvent<LightResponse>) => {
        const m = e.data
        if (m.type === 'normals') {
          if (wi === 0) {
            normals = m.normals
            publish()
          }
          return
        }
        if (m.id !== job.current.id) return
        parts.push(m.sunlight)
        earthParts.push(m.earthlight)
        worst = Math.max(worst, m.ms)
        if (parts.length < count) return
        // rows not computed by a worker are 0 in its part: the sum is the whole pass
        const sunlight = parts[0]
        for (let p = 1; p < parts.length; p++)
          for (let k = 0; k < sunlight.length; k++) {
            const a = sunlight[k]
            const b = parts[p][k]
            for (let i = 0; i < a.length; i++) a[i] += b[i]
          }
        Object.assign(reliefLightStats, { workers: count, ms: worst, wallMs: performance.now() - started })
        let earthlight: Float32Array[] | null = null
        if (earthParts.every((e) => e)) {
          earthlight = earthParts[0]!
          for (let p = 1; p < earthParts.length; p++)
            for (let k = 0; k < earthlight.length; k++) {
              const a = earthlight[k]
              const b = earthParts[p]![k]
              for (let i = 0; i < a.length; i++) a[i] += b[i]
            }
        }
        pending = { sunlight, earthlight, ms: worst, lights: job.current.sent }
        publish()
        job.current.busy = false
        if (moved(job.current.sent, job.current.want)) send(true)
        else if (job.current.quick) send(false)
      }
      // each worker gets its own copy of the heights; the renderer keeps these
      const copies = stack.rings.map((r) => ({ cellM: r.cellM, heights: r.heights.slice() }))
      w.postMessage({ type: 'rings', frame: stack.frame, rings: copies } satisfies LightRequest, copies.map((r) => r.heights.buffer))
    })
    kick.current = () => send(true)
    send(true)
    return () => {
      pool.forEach((w) => w.terminate())
      kick.current = null
    }
  }, [stack, key])

  useEffect(() => {
    if (!lights) return
    const j = job.current
    j.want = lights
    if (moved(j.sent, lights)) kick.current?.()
  }, [lights])

  return useMemo<Relief>(() => {
    if (!specs || specs.length === 0) return { status: 'unavailable', scene: null, cellM: null, reachKm: null, lightMs: null }
    const cellM = specs[0].source.demM
    const live = shown && shown.key === key ? shown : null
    if (!live) {
      const failed = loaded.key === key && loaded.failed === specs.length
      return { status: failed ? 'failed' : 'loading', scene: null, cellM, reachKm: null, lightMs: null }
    }
    const reachKm = (live.stack.rings[live.stack.rings.length - 1].cellM * 256) / 1000
    const lit0 = live.lights ?? lights
    const night: Relief['night'] = !lit0 || lit0.sunVisible ? null : live.earthlight && lit0.earthRatio > 0 ? 'earthshine' : 'dark'
    const ground = live.stack.heightAt(0, (512 - 1) / 2, (512 - 1) / 2)
    const lit = live.lights ?? lights
    const s = lit?.sun ?? sun
    const dir: [number, number, number] = s
      ? [Math.sin(s.az * D) * Math.cos(s.el * D), Math.cos(s.az * D) * Math.cos(s.el * D), Math.sin(s.el * D)]
      : [0, 0, 1]
    return {
      status: 'ready',
      scene: {
        stack: live.stack,
        normals: live.normals,
        sunlight: live.sunlight,
        eyeM: ground + Math.max(mastM, EYE_MIN_M),
        sun: dir,
        sunRadiusDeg: lit?.sun.radiusDeg,
        earthRadiusDeg: lit?.earth?.radiusDeg,
        earthlight: live.earthlight,
        earth: lit?.earth ? unit(lit.earth) : undefined,
        earthRatio: lit?.earthRatio ?? 0,
        exposure: night === 'earthshine' && lit ? NIGHT_EXPOSURE / lit.earthRatio : 1,
        albedo: live.stack === stack && ringAlbedo ? ringAlbedo : undefined,
        detailAt: live.stack === stack ? detailAt : undefined,
        grain: groundTexture(),
      },
      night,
      cellM,
      reachKm,
      lightMs: live.ms,
      // the finest ring on screen is what the observer stands on
      sourceLabel: ringSourceLabel(live.stack.rings[0] as Ring),
      detailTiles: detail.key === key ? { source: detail.source, loaded: detail.tiles.size, wanted: detail.wanted } : undefined,
    }
  }, [specs, key, shown, loaded, mastM, sun, lights, stack, ringAlbedo, detailAt, detail])
}

const unit = (b: SunDir): [number, number, number] => [
  Math.sin(b.az * D) * Math.cos(b.el * D),
  Math.cos(b.az * D) * Math.cos(b.el * D),
  Math.sin(b.el * D),
]

function movedDir(a: SunDir | null, b: SunDir | null): boolean {
  if (!a || !b) return a !== b
  const daz = Math.abs(((b.az - a.az + 540) % 360) - 180)
  return Math.abs(b.el - a.el) > SUN_EPS.el || daz > SUN_EPS.az
}

function moved(a: SceneLights | null, b: SceneLights | null): boolean {
  if (!b) return false
  if (!a) return true
  if (a.sunVisible !== b.sunVisible) return true
  return movedDir(a.sun, b.sun) || (!b.sunVisible && movedDir(a.earth, b.earth))
}
