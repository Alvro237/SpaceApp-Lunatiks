/** WebGL probe for `WebGLGuard`: can this browser create a WebGL context at all? */

let cached: boolean | undefined

/** True when this browser can create a WebGL context (WebGL 2 or 1). The probe context is released at once. */
export function webglAvailable(): boolean {
  if (cached !== undefined) return cached
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null
    cached = gl != null
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = false
  }
  return cached
}

/** Test hook: forget the probe result. */
export function resetWebglProbe(): void {
  cached = undefined
}
