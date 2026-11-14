/**
 * Terrain shaders. One 65 × 65 vertex grid (plus skirts) is shared by every tile; the vertex shader lifts it
 * with the tile's height texture. The fragment shader shades the relief, applies the colour layer through a
 * lookup texture and darkens by the visible share of the solar disc from the shadow pass (shadow.ts).
 *
 * Output is written as sRGB directly (no tone mapping, no colour-space conversion), so the layer colours on
 * the map are exactly the colours of the legend.
 *
 * GPU cost (it ran at 10 ms per frame, 15-19 ms at peaks, for a tilted view at device pixel ratio 2, measured with
 * a GPU timer, so frames were dropped once the shadow pass or a larger window was added):
 * - DISC_EDGE: only tiles that reach past the map's disc carry the discard; a shader that can discard loses the
 *   GPU's hidden-surface removal, so in tilted views every hidden layer of terrain was shaded too.
 * - FLOAT_LINEAR (where float textures filter linearly): the slope comes from 4 hardware-filtered reads of the
 *   height texture instead of 16 texel fetches.
 * - The Sun's direction in the scene is worked out per vertex (it changes smoothly over a tile: the error of the
 *   linear interpolation is about (vertex spacing / R)^2 / 8, under 0.002 degrees for the 29 km of level 0), not per
 *   pixel, and without trigonometry.
 */
import { BEHIND_DEG, DEPTH_RANGE_M, NEAR_BLEND_M } from './ground'
import { R_M } from './tileset'

export const GRID_VERTICES = 65

export const TERRAIN_VERT = /* glsl */ `
uniform sampler2D uHeight;   // 257 x 257 heights, metres, NEAREST
uniform vec4 uBounds;        // xMin, yMax, size (m), vertical exaggeration
uniform float uSkirtKm;
uniform vec3 uSun;           // unit vector to the Sun, MOON_ME
in float skirt;
out vec2 vUv;
out vec2 vMap;
out float vHeight;
out vec3 vSunScene;          // the Sun's direction in the scene at this point (not normalised)
// Ground view (ground.ts): the tiles seen by an observer on the surface, on the horizon view's angular screen.
uniform float uGround;       // 1: ground view; 0: the map's own camera
uniform vec3 uObs;           // observer: map x, y (m) and eye height above the sphere (m)
uniform vec3 uObsEast;       // observer's local east, north (unit, sphere axes) and map scale in uObsScale.x
uniform vec3 uObsNorth;
uniform vec4 uObsMap;        // east (xy) and north (zw) unit vectors on the map
uniform float uObsScale;     // map distance = scale x ground distance at the observer
uniform vec4 uView;          // yaw, pitch (deg), degrees per pixel, unused
uniform vec4 uScreen;        // centre x, centre y, width, height of the horizon view (CSS px)
out float vBehind;
const float R = ${R_M.toFixed(1)};
void main() {
  ivec2 texel = ivec2(round(uv * 256.0));
  float h = texelFetch(uHeight, texel, 0).r;
  vec2 map = vec2(uBounds.x + uv.x * uBounds.z, uBounds.y - uv.y * uBounds.z);
  vec3 pos = vec3(map.x / 1000.0, h / 1000.0 * uBounds.w - skirt * uSkirtKm, -map.y / 1000.0);
  vUv = uv;
  vMap = map;
  vHeight = h;
  // Local east/north/up of the sphere at this point, drawn on the polar map, without trigonometry: the south polar
  // stereographic radius r gives colatitude 2 atan(r / 2R), so with t = r / 2R, cos(lat) = 2t / (1 + t^2) and
  // sin(lat) = -(1 - t^2) / (1 + t^2); longitude atan(x, y) gives cos(lon) = y / r, sin(lon) = x / r. On the pole
  // itself (a vertex of every level) the longitude is undefined (atan(0, 0) is undefined in GLSL) and any value gives
  // the same result, so 0 is used.
  float r = length(map);
  float t = r / (2.0 * R);
  float k = 1.0 / (1.0 + t * t);
  float cosLat = 2.0 * t * k;
  float sinLat = -(1.0 - t * t) * k;
  vec2 cs = r > 0.0 ? vec2(map.y, map.x) / r : vec2(1.0, 0.0);   // cos(lon), sin(lon)
  vec3 up = vec3(cosLat * cs.x, cosLat * cs.y, sinLat);
  vec3 east = vec3(-cs.y, cs.x, 0.0);
  vec3 north = vec3(-sinLat * cs.x, -sinLat * cs.y, cosLat);
  vSunScene = dot(uSun, east) * vec3(cs.x, 0.0, cs.y)
            + dot(uSun, north) * vec3(cs.y, 0.0, -cs.x)
            + dot(uSun, up) * vec3(0.0, 1.0, 0.0);
  vBehind = 0.0;
  if (uGround > 0.5) {
    // twin of ground.ts groundDirection + groundScreen: keep the two in step
    float hv = h - skirt * uSkirtKm * 1000.0;              // true height (no exaggeration); skirts hang below
    vec2 d = map - uObs.xy;
    vec2 nearEN = vec2(dot(d, uObsMap.xy), dot(d, uObsMap.zw)) / (uObsScale * R);
    float w = smoothstep(${NEAR_BLEND_M[0].toFixed(1)}, ${NEAR_BLEND_M[1].toFixed(1)}, length(nearEN) * R);
    vec2 en = mix(nearEN, vec2(dot(up, uObsEast), dot(up, uObsNorth)), w);   // sin(theta) x (east, north)
    float sinT = min(1.0, length(en));
    float theta = asin(sinT);
    float half_ = sin(theta * 0.5);
    float rs = R + hv;
    float vertical = hv - uObs.z - rs * 2.0 * half_ * half_;
    float horizontal = rs * sinT;
    float az = degrees(atan(en.x, en.y));
    float el = degrees(atan(vertical, max(horizontal, 1e-3)));
    float dAz = mod(az - uView.x + 540.0, 360.0) - 180.0;
    float dist = max(length(vec2(vertical, horizontal)), ${DEPTH_RANGE_M[0].toFixed(1)});
    float depth = clamp(log(dist / ${DEPTH_RANGE_M[0].toFixed(1)}) / log(${(DEPTH_RANGE_M[1] / DEPTH_RANGE_M[0]).toFixed(1)}), 0.0, 1.0);
    vec2 px = vec2(uScreen.x + dAz / uView.z, uScreen.y - (el - uView.y) / uView.z);
    vBehind = abs(dAz) > ${BEHIND_DEG.toFixed(1)} ? 1.0 : 0.0;
    gl_Position = vec4(px.x / uScreen.z * 2.0 - 1.0, 1.0 - px.y / uScreen.w * 2.0, depth * 2.0 - 1.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uHeight;
uniform vec4 uBounds;
uniform float uCellM;
uniform sampler2D uShadow;   // r: visible solar disc fraction (shadow pass)
uniform vec4 uExtent;        // x0, yTop, size of the shadow texture (m)
uniform float uShadowReady;
uniform vec3 uSun;           // unit vector to the Sun, MOON_ME
uniform float uLighting;     // 1: the Sun at the chosen instant; 0: neutral relief
uniform int uLayerMode;      // 0 none, 1 data layer, 2 elevation
uniform sampler2D uLayer;    // value (r) + alpha (g), 256 x 256 cells
uniform vec4 uLayerXf;       // uv offset (xy) and scale (zw) when an ancestor's layer tile is used
uniform float uHasLayer;
uniform sampler2D uLut;      // 256 x 1 colour map
uniform vec2 uElevRange;
uniform vec3 uHighlight;     // x, y (m) and radius (m) of the selected place ring
uniform float uDiscR;        // the map is the disc of this projected radius (m) around the pole
uniform sampler2D uArea;     // mission mode: r = code (0 outside, 1 fails static, 2 fails window, 3 viable, 4 unknown), g = score
uniform vec4 uAreaXf;        // x left, y top, width, height of the search raster (m)
uniform float uHasArea;
uniform vec3 uRegion;        // x, y (m) and radius (m) of the search region ring
uniform float uGround;       // 1: ground view (physical light, no map decorations)
in float vBehind;
in vec2 vUv;
in vec2 vMap;
in float vHeight;
in vec3 vSunScene;
layout(location = 0) out highp vec4 fragColor;

int areaCode(ivec2 c, ivec2 n) {
  if (c.x < 0 || c.y < 0 || c.x >= n.x || c.y >= n.y) return 0;
  return int(texelFetch(uArea, c, 0).r * 255.0 + 0.5);
}

// Heights between samples, bilinear. The slope below is the difference of two such reads one sample apart on either
// side, which equals the central-difference gradients at the four samples around the fragment blended bilinearly:
// smooth across cells, without the square facets that differentiating the bilinear surface within a cell shows on
// a coarse tile seen from close up.
#ifdef FLOAT_LINEAR
// the 257 samples sit at texel centres: sample i of 0..256 is at (i + 0.5) / 257
float hBil(vec2 uv) { return texture(uHeight, (clamp(uv, 0.0, 1.0) * 256.0 + 0.5) / 257.0).r; }
#else
float hAt(ivec2 t) { return texelFetch(uHeight, clamp(t, ivec2(0), ivec2(256)), 0).r; }
float hBil(vec2 uv) {
  vec2 f = clamp(uv, 0.0, 1.0) * 256.0;
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  return mix(mix(hAt(i), hAt(i + ivec2(1, 0)), t.x), mix(hAt(i + ivec2(0, 1)), hAt(i + ivec2(1, 1)), t.x), t.y);
}
#endif

void main() {
  float rMap = length(vMap);
#ifdef DISC_EDGE
  if (rMap > uDiscR) discard;
#endif
  // ground view: a triangle with a vertex behind the observer would wrap around the screen
  if (vBehind > 0.0) discard;
  float du = 1.0 / 256.0;
  float hx = (hBil(vUv + vec2(du, 0.0)) - hBil(vUv - vec2(du, 0.0))) / (2.0 * uCellM);
  float hy = (hBil(vUv - vec2(0.0, du)) - hBil(vUv + vec2(0.0, du))) / (2.0 * uCellM);
  vec3 nrm = normalize(vec3(-hx, 1.0, hy));   // scene axes: X = x, Y = up, Z = -y

  float lambert = max(0.0, dot(nrm, normalize(vSunScene)));

  float visible = 1.0;
  if (uShadowReady > 0.5) {
    vec2 suv = vec2((vMap.x - uExtent.x) / uExtent.z, (uExtent.y - vMap.y) / uExtent.z);
    visible = texture(uShadow, suv).r;
  }
  float sunLight = visible * lambert;
  if (uGround > 0.5) {
    // The landscape painter's exposure (horizon/terrain2d.ts): a face square to the Sun at 0.9, display gamma 2, a
    // faint cool floor so shadow is not the sky's black. Airless: no ambient light, no haze.
    float v = 0.9 * sqrt(sunLight);
    fragColor = vec4(max(vec3(v, v * 0.9875, v * 0.9644), vec3(0.0283, 0.0292, 0.03)), 1.0);
    return;
  }
  float relief = 0.30 + 0.70 * max(0.0, dot(nrm, normalize(vec3(-0.55, 0.75, -0.40))));

  vec3 base = vec3(0.66, 0.66, 0.64);
  bool coloured = false;
  if (uLayerMode == 2) {
    base = texture(uLut, vec2(clamp((vHeight - uElevRange.x) / (uElevRange.y - uElevRange.x), 0.0, 1.0), 0.5)).rgb;
    coloured = true;
  } else if (uLayerMode == 1 && uHasLayer > 0.5) {
    // bilinear between cell centres, so the 960 m cells read as a smooth field when zoomed in: r is value ×
    // coverage (value 0 where there is no data), g the coverage, so r / g is the mean of the cells with data and
    // cells without data neither pull their neighbours towards zero nor leave a staircase edge
    vec4 l = texture(uLayer, uLayerXf.xy + vUv * uLayerXf.zw);
    if (l.g > 0.5) {
      base = texture(uLut, vec2(clamp(l.r / l.g, 0.0, 1.0), 0.5)).rgb;
      coloured = true;
    }
  }
  float light;
  // Shadowed ground keeps a third of the relief shading so its shape stays readable.
  if (uLighting > 0.5) light = coloured ? 0.32 + 0.68 * sunLight : 0.34 * relief + 0.66 * sunLight;
  else light = coloured ? 0.55 + 0.45 * relief : relief;
  vec3 colour = base * light;

  // Mission mode: the area search painted cell by cell. Never colour alone: viable areas get a solid outline,
  // cells failing a window filter diagonal hatching, unknown cells dots, cells failing a static filter are dimmed
  // (the legend and the panel's table say the same in words).
  if (uHasArea > 0.5) {
    ivec2 n = textureSize(uArea, 0);
    vec2 p = vec2((vMap.x - uAreaXf.x) / uAreaXf.z, (uAreaXf.y - vMap.y) / uAreaXf.w) * vec2(n);
    vec2 fw = max(fwidth(p) * 1.6, vec2(1e-4));   // outline width: about 1.6 px whatever the zoom (uniform flow here)
    ivec2 c = ivec2(floor(p));
    int code = areaCode(c, n);
    if (code > 0) {
      float hatch = step(mod(gl_FragCoord.x + gl_FragCoord.y, 7.0), 1.5);
      float dots = step(length(mod(gl_FragCoord.xy, 6.0) - 3.0), 1.2);
      if (code == 3) {
        float s = texelFetch(uArea, c, 0).g;
        colour = mix(colour, mix(vec3(0.10, 0.55, 0.42), vec3(0.36, 0.92, 0.62), s), 0.62);
        vec2 f = fract(p);
        bool edge = (f.x < fw.x && areaCode(c - ivec2(1, 0), n) != 3) || (f.x > 1.0 - fw.x && areaCode(c + ivec2(1, 0), n) != 3)
                 || (f.y < fw.y && areaCode(c - ivec2(0, 1), n) != 3) || (f.y > 1.0 - fw.y && areaCode(c + ivec2(0, 1), n) != 3);
        if (edge) colour = vec3(0.93, 1.0, 0.96);
      } else if (code == 2) {
        colour = mix(colour * 0.8, vec3(0.93, 0.62, 0.22), 0.14 + 0.4 * hatch);
      } else if (code == 4) {
        colour = mix(colour * 0.8, vec3(0.72, 0.74, 0.92), 0.15 + 0.55 * dots);
      } else {
        colour *= 0.55;
      }
    }
  }
  if (uRegion.z > 0.0) {
    float dReg = length(vMap - uRegion.xy);
    if (abs(dReg - uRegion.z) < fwidth(dReg) * 1.8) colour = mix(colour, vec3(0.98, 0.86, 0.45), 0.9);
  }

  // Ring around the selected place (drawn in the terrain so it follows the relief).
  float d = length(vMap - uHighlight.xy);
  float w = max(uHighlight.z * 0.05, uCellM * 0.6);
  if (uHighlight.z > 0.0 && abs(d - uHighlight.z) < w) colour = mix(colour, vec3(0.925, 0.918, 0.894), 0.9);

  // a thin limb at the edge of the disc
  if (rMap > uDiscR - 2.0 * uCellM) colour = mix(colour, vec3(0.55, 0.6, 0.7), 0.6);
  fragColor = vec4(colour, 1.0);
}
`
