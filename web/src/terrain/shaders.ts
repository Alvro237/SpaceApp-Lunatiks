/**
 * Terrain shaders. One 65 × 65 vertex grid (plus skirts) is shared by every tile; the vertex shader lifts it
 * with the tile's height texture. The fragment shader shades the relief, applies the colour layer through a
 * lookup texture and darkens by the visible share of the solar disc from the shadow pass (shadow.ts).
 *
 * Output is written as sRGB directly (no tone mapping, no colour-space conversion), so the layer colours on
 * the map are exactly the colours of the legend.
 */
import { R_M } from './tileset'

export const GRID_VERTICES = 65

export const TERRAIN_VERT = /* glsl */ `
uniform sampler2D uHeight;   // 257 x 257 heights, metres, NEAREST
uniform vec4 uBounds;        // xMin, yMax, size (m), vertical exaggeration
uniform float uSkirtKm;
in float skirt;
out vec2 vUv;
out vec2 vMap;
out float vHeight;
void main() {
  ivec2 texel = ivec2(round(uv * 256.0));
  float h = texelFetch(uHeight, texel, 0).r;
  vec2 map = vec2(uBounds.x + uv.x * uBounds.z, uBounds.y - uv.y * uBounds.z);
  vec3 pos = vec3(map.x / 1000.0, h / 1000.0 * uBounds.w - skirt * uSkirtKm, -map.y / 1000.0);
  vUv = uv;
  vMap = map;
  vHeight = h;
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
in vec2 vUv;
in vec2 vMap;
in float vHeight;
layout(location = 0) out highp vec4 fragColor;
const float R = ${R_M.toFixed(1)};
const float PI = 3.141592653589793;

float hAt(ivec2 t) { return texelFetch(uHeight, clamp(t, ivec2(0), ivec2(256)), 0).r; }

// Colour layer at a layer uv, bilinear between cell centres and weighted by each cell's alpha, so the 960 m
// cells read as a smooth field when the camera is much closer than one cell, and cells without data neither
// pull their neighbours towards zero nor leave a hard staircase edge. Returns value (x) and coverage (y).
// Display interpolation only: the legend states the cell size of the data.
vec2 layerAt(vec2 luv) {
  ivec2 n = textureSize(uLayer, 0);
  vec2 p = luv * vec2(n) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = p - floor(p);
  ivec2 hi = n - 1;
  vec2 a = texelFetch(uLayer, clamp(i, ivec2(0), hi), 0).rg;
  vec2 b = texelFetch(uLayer, clamp(i + ivec2(1, 0), ivec2(0), hi), 0).rg;
  vec2 c = texelFetch(uLayer, clamp(i + ivec2(0, 1), ivec2(0), hi), 0).rg;
  vec2 d = texelFetch(uLayer, clamp(i + ivec2(1, 1), ivec2(0), hi), 0).rg;
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 wa = w * step(0.5, vec4(a.y, b.y, c.y, d.y));
  float cover = wa.x + wa.y + wa.z + wa.w;
  float v = cover > 0.0 ? dot(wa, vec4(a.x, b.x, c.x, d.x)) / cover : 0.0;
  return vec2(v, cover);
}
// Height gradient (dh/dx, dh/dy in map metres) by central differences at a sample, then blended bilinearly
// between the four samples around the fragment. Differentiating the bilinear surface instead gives one
// constant normal per cell, which shows as square facets when a coarse tile is seen from close up.
vec2 gAt(ivec2 t) {
  return vec2(hAt(t + ivec2(1, 0)) - hAt(t - ivec2(1, 0)), hAt(t - ivec2(0, 1)) - hAt(t + ivec2(0, 1))) / (2.0 * uCellM);
}
vec2 gBil(vec2 uv) {
  vec2 f = clamp(uv, 0.0, 1.0) * 256.0;
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  return mix(mix(gAt(i), gAt(i + ivec2(1, 0)), t.x), mix(gAt(i + ivec2(0, 1)), gAt(i + ivec2(1, 1)), t.x), t.y);
}

void main() {
  float rMap = length(vMap);
  if (rMap > uDiscR) discard;
  vec2 g = gBil(vUv);
  vec3 nrm = normalize(vec3(-g.x, 1.0, g.y));   // scene axes: X = x, Y = up, Z = -y

  // Sun direction in the scene at this point (local east/north/up of the sphere, drawn on the polar map).
  float colat = 2.0 * atan(length(vMap) / (2.0 * R));
  float lat = colat - 0.5 * PI;
  float lon = atan(vMap.x, vMap.y);
  vec3 up = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
  vec3 sunScene = dot(uSun, east) * vec3(cos(lon), 0.0, sin(lon))
                + dot(uSun, north) * vec3(sin(lon), 0.0, -cos(lon))
                + dot(uSun, up) * vec3(0.0, 1.0, 0.0);
  float lambert = max(0.0, dot(nrm, normalize(sunScene)));

  float visible = 1.0;
  if (uShadowReady > 0.5) {
    vec2 suv = vec2((vMap.x - uExtent.x) / uExtent.z, (uExtent.y - vMap.y) / uExtent.z);
    visible = texture(uShadow, suv).r;
  }
  float sunLight = visible * lambert;
  float relief = 0.30 + 0.70 * max(0.0, dot(nrm, normalize(vec3(-0.55, 0.75, -0.40))));

  vec3 base = vec3(0.66, 0.66, 0.64);
  bool coloured = false;
  if (uLayerMode == 2) {
    base = texture(uLut, vec2(clamp((vHeight - uElevRange.x) / (uElevRange.y - uElevRange.x), 0.0, 1.0), 0.5)).rgb;
    coloured = true;
  } else if (uLayerMode == 1 && uHasLayer > 0.5) {
    vec2 l = layerAt(uLayerXf.xy + vUv * uLayerXf.zw);
    if (l.y > 0.5) {
      base = texture(uLut, vec2(l.x, 0.5)).rgb;
      coloured = true;
    }
  }
  float light;
  // Shadowed ground keeps a third of the relief shading so its shape stays readable.
  if (uLighting > 0.5) light = coloured ? 0.32 + 0.68 * sunLight : 0.34 * relief + 0.66 * sunLight;
  else light = coloured ? 0.55 + 0.45 * relief : relief;
  vec3 colour = base * light;

  // Ring around the selected place (drawn in the terrain so it follows the relief).
  float d = length(vMap - uHighlight.xy);
  float w = max(uHighlight.z * 0.05, uCellM * 0.6);
  if (uHighlight.z > 0.0 && abs(d - uHighlight.z) < w) colour = mix(colour, vec3(0.925, 0.918, 0.894), 0.9);

  // a thin limb at the edge of the disc
  if (rMap > uDiscR - 2.0 * uCellM) colour = mix(colour, vec3(0.55, 0.6, 0.7), 0.6);
  fragColor = vec4(colour, 1.0);
}
`
