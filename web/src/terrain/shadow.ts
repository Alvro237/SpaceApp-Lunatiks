/**
 * Shadows at the chosen instant, by the same horizon method as the API.
 *
 * For each cell of the overview height grid: march along the ground toward the Sun's local azimuth, take the
 * highest elevation angle of the terrain including the drop of the lunar curvature (d² / 2R), and compare it
 * with the Sun's elevation. The visible share of the solar disc over that horizon (the API's flat_fraction,
 * radius 0.27°) darkens the terrain. This is the method the pipeline used for the horizon masks (ray march
 * over LOLA with exact curvature, docs/data-and-computation.md), run on the GPU for every cell and every frame
 * instead of precomputed, on the 960 m preview heights until the finer tiles and precomputed horizon maps
 * exist. The marching range is 175 km, as in the masks.
 *
 * `horizonDeg` and `sunFraction` below are the reference implementation; SHADOW_FRAG is the same computation in
 * GLSL. shadow.test.ts checks the reference against hand-worked cases.
 */
import { flatFraction } from '../time/engine'
import { R_M, polarLatLon, scaleFactor } from './tileset'

const DEG = Math.PI / 180
export const SHADOW_STEPS = 72
export const SHADOW_RANGE_M = 175_000

/** Ground distance of step i (1-based): dense near the point, sparser far away. */
export const stepDistance = (i: number, cellM: number) => cellM * i * (1 + i / 24)

/** Unit vector of a local azimuth on the map at a point (conformal projection: angles are preserved). */
export function mapDirection(azDeg: number, lonDeg: number): [number, number] {
  const lon = lonDeg * DEG
  const e = Math.sin(azDeg * DEG)
  const n = Math.cos(azDeg * DEG)
  // east on the map = (cos lon, −sin lon); north = (sin lon, cos lon): away from the pole
  return [e * Math.cos(lon) + n * Math.sin(lon), -e * Math.sin(lon) + n * Math.cos(lon)]
}

/** Elevation (degrees) of the terrain horizon at map point (x, y) toward azimuth az. */
export function horizonDeg(
  heightAt: (x: number, y: number) => number | null,
  x: number,
  y: number,
  azDeg: number,
  cellM: number,
  mastM = 0,
): number {
  const [lat, lon] = polarLatLon(x, y)
  const k = scaleFactor(lat)
  const [dx, dy] = mapDirection(azDeg, lon)
  const h0 = (heightAt(x, y) ?? 0) + mastM
  let best = -Infinity
  for (let i = 1; i <= SHADOW_STEPS; i++) {
    const d = stepDistance(i, cellM)
    if (d > SHADOW_RANGE_M) break
    const h = heightAt(x + dx * d * k, y + dy * d * k)
    if (h === null) break
    best = Math.max(best, (h - h0 - (d * d) / (2 * R_M)) / d)
  }
  return best === -Infinity ? -90 : Math.atan(best) / DEG
}

export function sunFraction(sunElDeg: number, horizonElDeg: number, sunRadiusDeg: number): number {
  return flatFraction(sunElDeg - horizonElDeg, sunRadiusDeg)
}

export const SHADOW_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Output: r = visible fraction of the solar disc (0..1), g = horizon elevation toward the Sun / 90,
 * b = Sun elevation / 90. Texture convention (also for the height overview): u = (x − x0) / size,
 * v = (yTop − y) / size, i.e. row 0 is the top of the map.
 */
export const SHADOW_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D uHeight;   // overview heights, metres (R channel)
uniform vec4 uExtent;        // x0, yTop, size (m), cell (m)
uniform vec3 uSun;           // unit vector to the Sun, MOON_ME
uniform float uSunR;         // solar angular radius, degrees
uniform float uMast;         // metres above the ground
const float R = ${R_M.toFixed(1)};
const float PI = 3.141592653589793;
const int STEPS = ${SHADOW_STEPS};
const float RANGE = ${SHADOW_RANGE_M.toFixed(1)};

float heightAt(vec2 p) {
  vec2 uv = vec2((p.x - uExtent.x) / uExtent.z, (uExtent.y - p.y) / uExtent.z);
  return texture(uHeight, uv).r;
}

float flatFraction(float d, float r) {
  float x = clamp(-d / r, -1.0, 1.0);
  return (acos(x) - x * sqrt(1.0 - x * x)) / PI;
}

void main() {
  vec2 p = vec2(uExtent.x + vUv.x * uExtent.z, uExtent.y - vUv.y * uExtent.z);
  float colat = 2.0 * atan(length(p) / (2.0 * R));
  float lat = colat - 0.5 * PI;
  float lon = atan(p.x, p.y);
  vec3 up = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
  float e = dot(uSun, east);
  float n = dot(uSun, north);
  float sunEl = degrees(asin(clamp(dot(uSun, up), -1.0, 1.0)));
  if (sunEl + uSunR < -6.0) { fragColor = vec4(0.0, 0.0, sunEl / 90.0, 1.0); return; }
  vec2 dir = normalize(e * vec2(cos(lon), -sin(lon)) + n * vec2(sin(lon), cos(lon)));
  float k = 1.0 / (cos(0.5 * colat) * cos(0.5 * colat));
  float h0 = heightAt(p) + uMast;
  float best = -1.0e9;
  for (int i = 1; i <= STEPS; i++) {
    float fi = float(i);
    float d = uExtent.w * fi * (1.0 + fi / 24.0);
    if (d > RANGE) break;
    vec2 q = p + dir * d * k;
    vec2 uv = vec2((q.x - uExtent.x) / uExtent.z, (uExtent.y - q.y) / uExtent.z);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    best = max(best, (heightAt(q) - h0 - d * d / (2.0 * R)) / d);
  }
  float hz = best < -1.0e8 ? -90.0 : degrees(atan(best));
  fragColor = vec4(flatFraction(sunEl - hz, uSunR), hz / 90.0, sunEl / 90.0, 1.0);
}
`
