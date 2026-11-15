/**
 * The landing page's background: the Moon rendered live from the LROC WAC global mosaic (the same texture the
 * navigator's globe opens with, data/globe) in front of the NASA SVS star map (data/sky), lit by a Sun in the Moon's
 * equatorial plane, so the light grazes the south pole as it does there. Scrolling moves the camera along a path of
 * keyframes, one per section of the page: from the whole Moon down to the south pole with the Earth over the limb.
 *
 * Frame: Moon radius 1 at the origin, +Y north, near side (longitude 0, facing the Earth) towards +Z.
 * Not a measurement: a picture made from real imagery; the numbers are in the navigator.
 */
import * as THREE from 'three'

export interface MoonScene {
  /** Scroll progress 0..1 (top of the page .. bottom). */
  setProgress(p: number): void
  dispose(): void
}

interface Key {
  /** Camera position. */
  pos: [number, number, number]
  /** Point the camera looks at. */
  look: [number, number, number]
  /** Camera "up": north at first, then the local vertical of the south pole (-Y) so the ground ends at the bottom. */
  up: [number, number, number]
  /** Sideways shift of the Moon on wide screens, in look-at units (text sits on the left). */
  shift: number
}

// One keyframe per section: hero, demo, the four features, mobile, the closing call.
const KEYS: Key[] = [
  { pos: [0.0, 0.25, 4.3], look: [0, 0, 0], up: [0, 1, 0], shift: -1.15 },
  { pos: [-0.6, 0.6, 6.4], look: [0, 0.15, 0], up: [0, 1, 0], shift: 0 },
  { pos: [-2.4, -0.7, 2.6], look: [0, -0.2, 0], up: [0, 1, 0], shift: -0.85 },
  { pos: [-1.0, -2.6, 1.4], look: [0, -0.55, 0], up: [0, 0.4, 1], shift: -0.75 },
  { pos: [-0.35, -2.05, -0.2], look: [0, -0.85, 0.35], up: [0, -0.5, 1], shift: -0.6 },
  { pos: [0.1, -1.55, -1.35], look: [0.05, -0.75, 2.5], up: [0, -1, 0.3], shift: -0.4 },
  { pos: [0.55, -1.42, -1.7], look: [0.3, -0.65, 2.8], up: [0, -1, 0.3], shift: 0.2 },
  { pos: [0.05, -1.3, -2.1], look: [0.05, -0.55, 3], up: [0, -1, 0.3], shift: 0 },
]

// The Sun lies in the Moon's equatorial plane (y = 0): grazing light at the poles.
const SUN_DIR = new THREE.Vector3(1, 0, 0.42).normalize()
// The Earth beyond the near-side limb, about 2 degrees wide as seen from the Moon.
const EARTH_POS = new THREE.Vector3(6, 2.5, 60)
const EARTH_R = 1.3

const smooth = (t: number) => t * t * (3 - 2 * t)

export function createMoonScene(canvas: HTMLCanvasElement, dataBase: string, onReady: () => void): MoonScene | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null // no WebGL: the page keeps its plain dark background
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#020203')
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 400)

  const loader = new THREE.TextureLoader()
  const maxAniso = renderer.capabilities.getMaxAnisotropy()
  const load = (url: string, then: (t: THREE.Texture) => void) =>
    loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = maxAniso
      then(t)
      ready()
    })
  let pending = 2
  const ready = () => {
    shown = -1 // draw again with the new texture
    pending -= 1
    if (pending === 0) onReady()
  }

  // stars: inside of a large sphere, dimmed so they stay behind the text
  const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.55, 0.6), side: THREE.BackSide, depthWrite: false })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 64, 32), skyMat)
  scene.add(sky)
  load(`${dataBase}sky/starmap_4k.jpg`, (t) => {
    skyMat.map = t
    skyMat.needsUpdate = true
  })

  // the Moon: LROC WAC mosaic, column 0 at 180 W; turn the sphere so longitude 0 faces +Z
  const moonMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 1, metalness: 0 })
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), moonMat)
  moon.rotation.y = -Math.PI / 2
  scene.add(moon)
  load(`${dataBase}globe/wac_global_level1.jpg`, (t) => {
    moonMat.map = t
    moonMat.color.set('#ffffff')
    moonMat.needsUpdate = true
  })

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R, 64, 32),
    new THREE.MeshStandardMaterial({ color: '#4f86d9', roughness: 0.6, emissive: '#0b1a33', emissiveIntensity: 0.6 }),
  )
  earth.position.copy(EARTH_POS)
  scene.add(earth)

  const sun = new THREE.DirectionalLight('#fff6e8', 3.4)
  sun.position.copy(SUN_DIR).multiplyScalar(50)
  scene.add(sun)
  // earthshine: a faint fill so the night side is not pure black
  scene.add(new THREE.AmbientLight('#8fa6c8', 0.05))

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const right = new THREE.Vector3()

  let progress = 0
  let shown = -1
  let raf = 0
  let width = 0
  let height = 0

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === width && h === height) return
    width = w
    height = h
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    shown = -1
  }

  function frame() {
    raf = requestAnimationFrame(frame)
    resize()
    if (Math.abs(progress - shown) < 1e-5) return
    shown = progress
    const x = progress * (KEYS.length - 1)
    const i = Math.min(Math.floor(x), KEYS.length - 2)
    const t = smooth(Math.min(1, Math.max(0, x - i)))
    const k0 = KEYS[i]
    const k1 = KEYS[i + 1]
    pos.lerpVectors(a.fromArray(k0.pos), b.fromArray(k1.pos), t)
    look.lerpVectors(a.fromArray(k0.look), b.fromArray(k1.look), t)
    camera.position.copy(pos)
    camera.up.lerpVectors(a.fromArray(k0.up), b.fromArray(k1.up), t).normalize()
    camera.lookAt(look)
    // wide screens: slide the Moon to the right of the text column by looking a little to its left
    const wide = Math.min(1, Math.max(0, (width / Math.max(height, 1) - 1) / 0.6))
    const shift = (k0.shift + (k1.shift - k0.shift) * t) * wide * pos.distanceTo(look) * 0.18
    if (shift !== 0) {
      right.setFromMatrixColumn(camera.matrix, 0)
      camera.lookAt(look.addScaledVector(right, shift))
    }
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(frame)

  return {
    setProgress(p) {
      progress = Math.min(1, Math.max(0, p))
    },
    dispose() {
      cancelAnimationFrame(raf)
      renderer.dispose()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const m = o.material as THREE.MeshStandardMaterial
          m.map?.dispose()
          m.dispose()
        }
      })
    },
  }
}
