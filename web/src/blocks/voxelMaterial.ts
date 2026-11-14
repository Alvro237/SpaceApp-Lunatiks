/**
 * Shading for a ball of cubes (the Moon, the Earth). Lit as a sphere, not as loose cubes: the light of each cube
 * comes from the direction of its centre (so day and night meet along one clean terminator, the body's phase),
 * and its faces add relief and a dark rim so the cubes still read as cubes. Plain Lambert on axis-aligned cubes
 * would light whole rows of faces the same way and draw stripes across the ball.
 */
import * as THREE from 'three'

const VERT = /* glsl */ `
uniform vec3 uSun;
varying vec3 vColor;
varying float vLight;
varying vec3 vLocal;
void main() {
  vLocal = position;
  mat4 world = modelMatrix * instanceMatrix;
  vec3 centre = normalize(mat3(modelMatrix) * instanceMatrix[3].xyz + vec3(1e-6));
  vec3 face = normalize(mat3(world) * normal);
  float day = clamp(dot(centre, uSun) * 2.5 + 0.15, 0.0, 1.0);
  float relief = 0.55 + 0.65 * max(dot(face, uSun), 0.0);
  vLight = day * relief;
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * world * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
uniform float uAmbient;
uniform float uGain;
varying vec3 vColor;
varying float vLight;
varying vec3 vLocal;
void main() {
  // a dark rim on every face, so neighbouring cubes stay apart however close the camera comes
  vec3 q = abs(vLocal);
  float big = max(q.x, max(q.y, q.z));
  float small = min(q.x, min(q.y, q.z));
  float mid = q.x + q.y + q.z - big - small;
  float rim = 1.0 - 0.35 * smoothstep(0.40, 0.5, mid);
  gl_FragColor = vec4(vColor * (uAmbient + uGain * vLight) * rim, 1.0);
  #include <colorspace_fragment>
}
`

/** `sun`: unit vector toward the Sun in world space, updated by the caller each frame. */
export function voxelBodyMaterial(ambient = 0.05, gain = 1.35): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uAmbient: { value: ambient },
      uGain: { value: gain },
    },
  })
}
