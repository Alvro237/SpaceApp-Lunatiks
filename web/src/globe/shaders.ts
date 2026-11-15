/**
 * Globe shaders: a sphere lifted by the global LOLA heights (exaggerated, labelled) and lit by the Sun at the
 * chosen instant, so the day and night sides are the real ones. Output is sRGB as written (no tone mapping).
 *
 * Detail tiles (detail/grid.ts) read live from Moon Trek replace the shipped 4 ppd heights in the shading wherever
 * one is loaded (the LOLA 118 m DEM). In photo mode (the default) the LROC WAC mosaic is loaded as well and draped
 * over the 3D relief: the photograph keeps its own brightness on the day side, and the LOLA slopes are shaded by the
 * Sun at the chosen instant relative to flat ground, so a tilted view shows the shape of the ground without the whole
 * scene going dark when the Sun is low. The night side is the chosen instant's. The globe's mesh is the shipped
 * grid, interpolated bilinearly, its exaggeration easing from x4 (whole Moon) to x2 (closest zoom, orbit.ts); the
 * patches (below) lift the ground by the detail heights in both modes.
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

// The detail tiles: which one holds a point, and its value there (needs uMaxLevel, DETAIL_MAX_LEVEL). Each kind of
// tile (heights, photo) has its own texture array and index, passed in.
const DETAIL_LOOKUP = /* glsl */ `
// Finest loaded tile that holds the point (degrees) and is not finer than the view: from the view's level down, the
// tile under the point in the index (slots.ts, findSlot). cell = position in the tile in cells, size = side (degrees).
int findTile(sampler2D index, float lonDeg, float latDeg, out vec2 cell, out float size) {
  for (int z = min(int(uMaxLevel), DETAIL_MAX_LEVEL); z >= 0; z--) {
    float s = 90.0 / float(1 << z);
    vec2 f = vec2((lonDeg + 180.0) / s, (90.0 - latDeg) / s);
    ivec2 t = clamp(ivec2(floor(f)), ivec2(0), ivec2((4 << z) - 1, (2 << z) - 1));
    int slot = int(texelFetch(index, ivec2(t.x, 2 * ((1 << z) - 1) + t.y), 0).r * 255.0 + 0.5) - 1;
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
float tileAt(sampler2DArray tiles, int slot, vec2 cell) {
  vec2 g = clamp(cell - 0.5, vec2(0.0), vec2(255.0));
  ivec2 i = ivec2(floor(g));
  vec2 t = g - vec2(i);
  ivec2 j = min(i + 1, ivec2(255));
  return mix(mix(texelFetch(tiles, ivec3(i.x, i.y, slot), 0).r, texelFetch(tiles, ivec3(j.x, i.y, slot), 0).r, t.x),
             mix(texelFetch(tiles, ivec3(i.x, j.y, slot), 0).r, texelFetch(tiles, ivec3(j.x, j.y, slot), 0).r, t.x), t.y);
}
// heights in metres from the detail DEM tiles
float dAt(int slot, vec2 cell) { return tileAt(uDetail, slot, cell); }
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
uniform sampler2DArray uDetail;        // DEM detail tiles, 256 x 256 cells each, heights in metres
uniform sampler2D uIndex;              // R8: layer + 1 of each loaded DEM tile of every level, 0 = none (slots.ts)
uniform sampler2DArray uPhoto;         // photo detail tiles, 256 x 256 cells each, reflectance 0..1
uniform sampler2D uPhotoIndex;         // the same for the photo tiles
uniform float uMaxLevel;    // finest level the view uses; -1 = no detail
uniform float uPhotoMode;   // 1 = LROC WAC photo draped over the LOLA relief, 0 = LOLA relief alone
uniform float uDetailShade; // slope exaggeration of the shading from detail heights
uniform vec4 uHole;         // drawn by a finer mesh instead (patch.ts): centre longitude, half-width in longitude,
                            // south and north latitude, degrees; half-width 0 = no hole
in vec3 vMe;
in float vHeight;
layout(location = 0) out highp vec4 fragColor;
const float PI = 3.141592653589793;
const float R = 1737400.0;
// The WAC global mosaic's mean brightness is 0.308 of the byte range (median 0.31; the 32 WMTS tiles of matrix 2,
// unweighted by area, measured 2026-11-15): x2 brings it to about the plain regolith grey, as on the polar map.
const float PHOTO_GAIN = 2.0;
const vec3 REGOLITH = vec3(0.72, 0.71, 0.68);
// share of the LOLA slope shading laid over the photo (the photo already holds some shading of its own)
const float PHOTO_RELIEF = 0.7;

${H_AT}

${DETAIL_LOOKUP}
void main() {
  vec3 up = normalize(vMe);
  float lat = asin(clamp(up.z, -1.0, 1.0));
  float lon = atan(up.y, up.x);
  if (uHole.y > 0.0) {
    float dLon = mod(degrees(lon) - uHole.x + 540.0, 360.0) - 180.0;
    float la = degrees(lat);
    if (abs(dLon) < uHole.y && la > uHole.z && la < uHole.w) discard;
  }
  float day = smoothstep(-0.02, 0.05, dot(up, uSun));
  vec2 cell;
  float tileDeg;
  int slot = uMaxLevel >= 0.0 ? findTile(uIndex, degrees(lon), degrees(lat), cell, tileDeg) : -1;
  // ground brightness: the WAC photograph where a photo tile is loaded (photo mode), else plain regolith grey
  vec3 albedo = REGOLITH;
  bool photo = false;
  if (uPhotoMode > 0.5 && uMaxLevel >= 0.0) {
    vec2 pCell;
    float pDeg;
    int pSlot = findTile(uPhotoIndex, degrees(lon), degrees(lat), pCell, pDeg);
    if (pSlot >= 0) {
      albedo = vec3(min(1.0, tileAt(uPhoto, pSlot, pCell) * PHOTO_GAIN));
      photo = true;
    }
  }
  vec3 colour;
  {
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
    float light;
    if (photo) {
      // photo: the slope's Sun relative to flat ground's (1 on the flat, brighter facing the Sun, darker away from
      // it; the 0.2 keeps it finite at the terminator), over the day and night of the chosen instant
      float rel = clamp((sun + 0.2) / (max(0.0, dot(up, uSun)) + 0.2), 0.0, 1.8);
      light = (0.10 + 0.90 * day) * mix(1.0, rel, PHOTO_RELIEF);
    } else {
      // the night side keeps a faint fixed-light relief (like earthshine) so its shape stays readable
      vec3 fixedLight = normalize(up + 0.6 * east + 0.4 * north);
      float night = 0.07 + 0.12 * max(0.0, dot(n, fixedLight));
      light = night + (1.0 - night) * sun * day;
    }
    colour = albedo * light;
  }
  // outline of the polar map's coverage
  float latDeg = degrees(lat);
  if (abs(latDeg - uDiscLat) < 0.18) colour = mix(colour, vec3(0.925, 0.918, 0.894), 0.85);
  fragColor = vec4(colour, 1.0);
}
`

/**
 * A patch: a dense grid of latitude and longitude around the place the camera looks at (patch.ts), lifted by the
 * same heights as the globe and, in relief and photo mode alike, by the detail heights where they are loaded, so that a tilted view
 * shows the shape of the ground and not only its shading. It is drawn with the globe's fragment shader.
 *
 * Detail heights and the shipped grid differ by the relief the grid averages away, hundreds of metres on rough
 * ground, so where the loaded tiles end the mesh would show a cliff. Toward an edge of a tile with nothing loaded
 * beyond it the mesh therefore eases back to the shipped heights over EDGE_FADE cells.
 */
export const PATCH_VERT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
#define DETAIL_MAX_LEVEL ${MAX_LEVEL}
uniform sampler2D uHeight;
uniform float uExag;
uniform sampler2DArray uDetail;
uniform sampler2D uIndex;
uniform float uMaxLevel;
uniform vec4 uWin;          // centre longitude and latitude, cell size in longitude and in latitude (degrees)
uniform float uSkirtKm;     // how far the rim hangs down, hiding the gap to the coarser mesh around it
in float skirt;
out vec3 vMe;
out float vHeight;
const float PI = 3.141592653589793;
const float EDGE_FADE = 24.0;
${H_AT}
${DETAIL_LOOKUP}
float wrapLon(float d) { return mod(d + 180.0, 360.0) - 180.0; }
bool none(float lonDeg, float latDeg) {
  vec2 c;
  float s;
  return findTile(uIndex, wrapLon(lonDeg), latDeg, c, s) < 0;
}
void main() {
  // position.xy counts cells from the centre of the window
  float lonDeg = wrapLon(uWin.x + position.x * uWin.z);
  float latDeg = clamp(uWin.y + position.y * uWin.w, -89.9, 89.9);
  float lat = radians(latDeg);
  float lon = radians(lonDeg);
  vec3 me = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  float h = hAt(vec2(fract(lon / (2.0 * PI)), (0.5 * PI - lat) / PI));
  if (uMaxLevel >= 0.0) {
    vec2 cell;
    float size;
    int slot = findTile(uIndex, lonDeg, latDeg, cell, size);
    if (slot >= 0) {
      float c = size / 256.0;
      float w = 1.0;
      if (cell.x < EDGE_FADE && none(lonDeg - (cell.x + 1.0) * c, latDeg)) w = min(w, cell.x / EDGE_FADE);
      if (256.0 - cell.x < EDGE_FADE && none(lonDeg + (257.0 - cell.x) * c, latDeg)) w = min(w, (256.0 - cell.x) / EDGE_FADE);
      // rows count from the tile's north edge
      if (cell.y < EDGE_FADE && none(lonDeg, latDeg + (cell.y + 1.0) * c)) w = min(w, cell.y / EDGE_FADE);
      if (256.0 - cell.y < EDGE_FADE && none(lonDeg, latDeg - (257.0 - cell.y) * c)) w = min(w, (256.0 - cell.y) / EDGE_FADE);
      h = mix(h, dAt(slot, cell), w);
    }
  }
  vMe = me;
  vHeight = h;
  // Mean-Earth axes to the scene's (north up): x, z, -y
  vec3 pos = vec3(me.x, me.z, -me.y) * (1737.4 + h / 1000.0 * uExag - skirt * uSkirtKm);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`
