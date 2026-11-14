/**
 * Globe shaders: a sphere lifted by the global LOLA heights (exaggerated, labelled) and lit by the Sun at the
 * chosen instant, so the day and night sides are the real ones. Output is sRGB as written (no tone mapping).
 *
 * Detail tiles (detail/grid.ts) read live from Moon Trek replace the shipped 4 ppd heights in the shading wherever
 * one is loaded: in relief mode the LOLA 118 m DEM, in photo mode the LROC WAC mosaic (its own, photographed
 * lighting, dimmed on the night side of the chosen instant). The relief of the mesh itself stays the shipped grid,
 * interpolated bilinearly, its exaggeration easing from x4 (whole Moon) to x1 (closest zoom) so that the fine shading
 * does not slide over steps of the coarse mesh.
 */
import { MAX_LEVEL } from './detail/grid'

// bilinear between the centres of the shipped height grid's cells, longitude wrapping
const H_AT = /* glsl */ `
float hAt(vec2 uv) {
  ivec2 size = textureSize(uHeight, 0);
  vec2 f = uv * vec2(size) - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  int w = size.x;
  ivec2 a = ivec2((i.x % w + w) % w, clamp(i.y, 0, size.y - 1));
  ivec2 b = ivec2(((i.x + 1) % w + w) % w, a.y);
  ivec2 c = ivec2(a.x, clamp(i.y + 1, 0, size.y - 1));
  ivec2 d = ivec2(b.x, c.y);
  return mix(mix(texelFetch(uHeight, a, 0).r, texelFetch(uHeight, b, 0).r, t.x),
             mix(texelFetch(uHeight, c, 0).r, texelFetch(uHeight, d, 0).r, t.x), t.y);
}
`

export const GLOBE_VERT = /* glsl */ `
uniform sampler2D uHeight;  // 1440 x 720 heights, metres; row 0 = 90 N, column 0 = longitude 0, east positive
uniform float uExag;        // relief exaggeration of the mesh (x4 for the whole Moon, x1 close in)
out vec3 vMe;               // unit vector of the point, Moon Mean-Earth axes
out float vHeight;
const float PI = 3.141592653589793;
${H_AT}
void main() {
  vec3 p = normalize(position);
  vec3 me = vec3(p.x, -p.z, p.y);
  float lat = asin(clamp(me.z, -1.0, 1.0));
  float lon = atan(me.y, me.x);
  float v = (0.5 * PI - lat) / PI;
  // The sphere's poles are 513 vertices at one point, each with its own longitude: give them all the same height
  // (the grid's first column), or they fan out into spikes of different heights.
  float u = abs(me.z) > 0.999999 ? 0.0 : fract(lon / (2.0 * PI));
  float h = hAt(vec2(u, v));
  vMe = me;
  vHeight = h;
  vec3 pos = p * (1737.4 + h / 1000.0 * uExag);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

export const GLOBE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
#define DETAIL_MAX_LEVEL ${MAX_LEVEL}
uniform sampler2D uHeight;
uniform vec3 uSun;          // unit vector to the Sun, Moon Mean-Earth axes
uniform float uDiscLat;     // the polar map covers south of this latitude (degrees)
uniform sampler2DArray uDetail;        // detail tiles, 256 x 256 cells each (heights in metres, or photo 0..1)
uniform sampler2D uIndex;              // R8: layer + 1 of each loaded tile of every level, 0 = none (slots.ts)
uniform float uMaxLevel;    // finest level the view uses; -1 = no detail
uniform float uPhotoMode;   // 1 = LROC WAC photo, 0 = LOLA relief
uniform float uDetailShade; // slope exaggeration of the shading from detail heights
in vec3 vMe;
in float vHeight;
layout(location = 0) out highp vec4 fragColor;
const float PI = 3.141592653589793;
const float R = 1737400.0;
const float PHOTO_GAIN = 1.6;

${H_AT}

// Finest loaded tile that holds the point (degrees) and is not finer than the view: from the view's level down, the
// tile under the point in the index (slots.ts, findSlot). cell = position in the tile in cells, size = side (degrees).
int findTile(float lonDeg, float latDeg, out vec2 cell, out float size) {
  for (int z = min(int(uMaxLevel), DETAIL_MAX_LEVEL); z >= 0; z--) {
    float s = 90.0 / float(1 << z);
    vec2 f = vec2((lonDeg + 180.0) / s, (90.0 - latDeg) / s);
    ivec2 t = clamp(ivec2(floor(f)), ivec2(0), ivec2((4 << z) - 1, (2 << z) - 1));
    int slot = int(texelFetch(uIndex, ivec2(t.x, 2 * ((1 << z) - 1) + t.y), 0).r * 255.0 + 0.5) - 1;
    if (slot >= 0) {
      cell = (f - vec2(t)) * 256.0;
      size = s;
      return slot;
    }
  }
  cell = vec2(0.0);
  size = 0.0;
  return -1;
}

// bilinear between cell centres, clamped to the tile. (Four texelFetch, not one filtered texture() read: with
// LINEAR filtering of this float32 texture array the globe took 1.0-1.3 ms per 1600 x 1600 frame against 0.05 ms,
// measured on an Apple M2 under ANGLE Metal, 2026-11-14; same image within 1/255.)
float dAt(int slot, vec2 cell) {
  vec2 g = clamp(cell - 0.5, vec2(0.0), vec2(255.0));
  ivec2 i = ivec2(floor(g));
  vec2 t = g - vec2(i);
  ivec2 j = min(i + 1, ivec2(255));
  return mix(mix(texelFetch(uDetail, ivec3(i.x, i.y, slot), 0).r, texelFetch(uDetail, ivec3(j.x, i.y, slot), 0).r, t.x),
             mix(texelFetch(uDetail, ivec3(i.x, j.y, slot), 0).r, texelFetch(uDetail, ivec3(j.x, j.y, slot), 0).r, t.x), t.y);
}

void main() {
  vec3 up = normalize(vMe);
  float lat = asin(clamp(up.z, -1.0, 1.0));
  float lon = atan(up.y, up.x);
  float day = smoothstep(-0.02, 0.05, dot(up, uSun));
  vec2 cell;
  float tileDeg;
  int slot = uMaxLevel >= 0.0 ? findTile(degrees(lon), degrees(lat), cell, tileDeg) : -1;
  vec3 colour;
  if (slot >= 0 && uPhotoMode > 0.5) {
    // the photograph carries its own shading; the chosen instant only decides day and night
    colour = vec3(min(1.0, dAt(slot, cell) * PHOTO_GAIN)) * (0.10 + 0.90 * day);
  } else {
    vec2 uv = vec2(fract(lon / (2.0 * PI)), (0.5 * PI - lat) / PI);
    vec2 size = vec2(textureSize(uHeight, 0));
    float dLon = 2.0 * PI / size.x;
    float dLat = PI / size.y;
    float coslat = max(cos(lat), 0.05);
    float he;
    float hn;
    float exag;
    if (slot >= 0) {
      // slopes from the detail heights, one cell either side
      // (inside the tile: next to its edge the step shrinks rather than reading the clamped border, which drew
      // lines along the tile edges)
      float c = radians(tileDeg / 256.0);
      float xm = max(cell.x - 1.0, 0.5);
      float xp = min(cell.x + 1.0, 255.5);
      float ym = max(cell.y - 1.0, 0.5);
      float yp = min(cell.y + 1.0, 255.5);
      he = (dAt(slot, vec2(xp, cell.y)) - dAt(slot, vec2(xm, cell.y))) / (R * coslat * c * max(xp - xm, 0.5));
      hn = (dAt(slot, vec2(cell.x, ym)) - dAt(slot, vec2(cell.x, yp))) / (R * c * max(yp - ym, 0.5));
      exag = uDetailShade;
    } else {
      // slopes in metres per metre, east and north; relief shading exaggerated x3 for legibility at 7.6 km pixels
      he = (hAt(uv + vec2(1.0 / size.x, 0.0)) - hAt(uv - vec2(1.0 / size.x, 0.0))) / (2.0 * R * coslat * dLon);
      hn = (hAt(uv - vec2(0.0, 1.0 / size.y)) - hAt(uv + vec2(0.0, 1.0 / size.y))) / (2.0 * R * dLat);
      exag = 3.0;
    }
    vec3 east = vec3(-sin(lon), cos(lon), 0.0);
    vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
    vec3 n = normalize(up - exag * (he * east + hn * north));
    float sun = max(0.0, dot(n, uSun));
    // the night side keeps a faint fixed-light relief (like earthshine) so its shape stays readable
    vec3 fixedLight = normalize(up + 0.6 * east + 0.4 * north);
    float night = 0.07 + 0.12 * max(0.0, dot(n, fixedLight));
    float light = night + (1.0 - night) * sun * day;
    colour = vec3(0.72, 0.71, 0.68) * light;
  }
  // outline of the polar map's coverage
  float latDeg = degrees(lat);
  if (abs(latDeg - uDiscLat) < 0.18) colour = mix(colour, vec3(0.925, 0.918, 0.894), 0.85);
  fragColor = vec4(colour, 1.0);
}
`
