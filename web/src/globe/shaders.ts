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
import { MAX_LEVEL, PHOTO_BASE_LEVEL } from './detail/grid'
import { POLAR_MAX_Z } from './detail/polar'

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

// The detail tiles: which one holds a point, and its value there (needs DETAIL_MAX_LEVEL). Each kind of tile
// (heights, photo) has its own texture array and index, passed in.
const DETAIL_LOOKUP = /* glsl */ `
// Finest loaded tile that holds the point (degrees) and is not finer than maxLevel: from that level down, the tile
// under the point in the index (slots.ts, findSlot). cell = position in the tile in cells, size = side (degrees).
int findTile(sampler2D index, float lonDeg, float latDeg, int maxLevel, out vec2 cell, out float size) {
  for (int z = min(maxLevel, DETAIL_MAX_LEVEL); z >= 0; z--) {
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

// The south-polar detail tiles (detail/polar.ts): the polar map's quadtree in south polar stereographic metres,
// x = r sin(lon), y = r cos(lon), r = 2R tan((90° + lat) / 2), tile rows from the top (largest y). Heights are
// 257 × 257 vertices per tile, photos 256 × 256 cells. Needs uPolarMaxZ, uPolarExtent and POLAR_MAX_Z.
const POLAR_LOOKUP = /* glsl */ `
vec2 polarXY(float latRad, float lonRad) {
  float r = 2.0 * 1737400.0 * tan(0.5 * (1.5707963267948966 + latRad));
  return vec2(r * sin(lonRad), r * cos(lonRad));
}
// Finest loaded tile holding the point (metres), from the finest level down. cell = position in the tile in units of
// tile / cells (0 at the tile's west and north edges); sizeM = the tile's side.
int findPolar(sampler2D index, vec2 xy, float cells, out vec2 cell, out float sizeM) {
  for (int z = min(int(uPolarMaxZ), POLAR_MAX_Z); z >= 0; z--) {
    float n = float(1 << z);
    float s = 2.0 * uPolarExtent / n;
    vec2 f = vec2((xy.x + uPolarExtent) / s, (uPolarExtent - xy.y) / s);
    if (f.x < 0.0 || f.y < 0.0 || f.x >= n || f.y >= n) return -1;
    ivec2 t = ivec2(floor(f));
    int slot = int(texelFetch(index, ivec2(t.x, (1 << z) - 1 + t.y), 0).r * 255.0 + 0.5) - 1;
    if (slot >= 0) {
      cell = (f - vec2(t)) * cells;
      sizeM = s;
      return slot;
    }
  }
  cell = vec2(0.0);
  sizeM = 0.0;
  return -1;
}
// height (metres) between the tile's vertices, bilinear
float polarH(int slot, vec2 v) {
  vec2 g = clamp(v, vec2(0.0), vec2(256.0));
  ivec2 i = min(ivec2(floor(g)), ivec2(255));
  vec2 t = g - vec2(i);
  ivec2 j = i + 1;
  return mix(mix(texelFetch(uPolarH, ivec3(i.x, i.y, slot), 0).r, texelFetch(uPolarH, ivec3(j.x, i.y, slot), 0).r, t.x),
             mix(texelFetch(uPolarH, ivec3(i.x, j.y, slot), 0).r, texelFetch(uPolarH, ivec3(j.x, j.y, slot), 0).r, t.x), t.y);
}
// Share of the polar tiles in the picture: 1 a degree and a half inside the disc's edge, easing to 0 at the edge,
// where the latitude/longitude tiles and the shipped grid take over without a seam.
float polarWeight(float latDeg) { return uPolarMaxZ < 0.0 ? 0.0 : smoothstep(uDiscLat, uDiscLat - 1.5, latDeg); }
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
#define PHOTO_BASE_LEVEL ${PHOTO_BASE_LEVEL}
#define POLAR_MAX_Z ${POLAR_MAX_Z}
uniform sampler2D uHeight;
uniform vec3 uSun;          // unit vector to the Sun, Moon Mean-Earth axes
uniform float uDiscLat;     // the polar tiles cover south of this latitude (degrees)
uniform sampler2DArray uPolarH;      // south-polar height tiles, 257 x 257 vertices, metres (detail/polar.ts)
uniform sampler2D uPolarHIndex;
uniform sampler2DArray uPolarP;      // south-polar photo tiles, 256 x 256 cells, reflectance 0..1
uniform sampler2D uPolarPIndex;
uniform float uPolarMaxZ;   // finest polar level; -1 = none
uniform float uPolarExtent; // half-width of the polar quadtree's square, metres
uniform vec4 uPolarHole;    // drawn by a finer polar mesh instead (patch.ts): centre x, y and half-width (metres); w > 0 = on
uniform sampler2D uPolarOverview; // heights of the whole polar square, 2049 x 2049 vertices, metres (detail/polar.ts)
uniform float uPolarShadow; // 1 once the overview is loaded: the terrain casts shadows south of 60 S
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
// Brightness of the grey that stands in for the polar mosaic's photographed shadows: the dim end of the mosaic's own
// lit ground after PHOTO_GAIN (0.15-0.3 raw, x2). A neutral grey like the photo itself, not the warm REGOLITH: the
// mosaic is assembled from strips photographed under different light, and along their straight seams a tinted
// stand-in on the dark side showed as a line across the ground.
const float PHOTO_SHADOW_FILL = 0.34;
// Brightness of the photo: the mosaic's value x PHOTO_GAIN, rolled off smoothly above TONE_KNEE instead of clipped at
// white, so sunlit slopes keep their texture (same value and slope up to the knee).
const float TONE_KNEE = 0.6;
float photoTone(float raw) {
  float a = raw * PHOTO_GAIN;
  return a <= TONE_KNEE ? a : TONE_KNEE + (1.0 - TONE_KNEE) * (1.0 - exp(-(a - TONE_KNEE) / (1.0 - TONE_KNEE)));
}

// Overview height (metres) at a point of the polar square, bilinear (vertex-registered samples); far below the ground
// outside the square, so it blocks nothing.
float ovH(vec2 xy) {
  vec2 f = vec2(xy.x + uPolarExtent, uPolarExtent - xy.y) / (2.0 * uPolarExtent);
  if (f.x < 0.0 || f.y < 0.0 || f.x > 1.0 || f.y > 1.0) return -1e5;
  vec2 n = vec2(textureSize(uPolarOverview, 0));
  return texture(uPolarOverview, (f * (n - 1.0) + 0.5) / n).r;
}

// Share of the solar disc above the terrain's horizon at a point (0 in the terrain's shadow, 1 in full Sun). The Sun's
// direction along the ground is turned into the polar map's directions; the march takes SHADOW_STEPS points toward
// it, from 400 m out to about 165 km, 25 % farther each, and keeps the steepest elevation of the overview heights
// (960 m cells) above the point, less the drop of the curved surface (d² / 2R). The solar disc is 0.53° wide, so the
// shadow's edge is eased over ±0.27° of elevation. Real heights (no exaggeration): the shadows are the real ones.
const int SHADOW_STEPS = 28;
float polarSunVisible(vec2 xy, vec3 up, vec3 east, vec3 north, float lat, float lon) {
  float se = dot(up, uSun);
  vec3 hz = uSun - up * se;
  float hl = length(hz);
  if (hl < 1e-6) return 1.0;
  hz /= hl;
  float elev = asin(clamp(se, -1.0, 1.0));
  // relief at the pole rises a few degrees at most over these distances: a Sun higher than 20 degrees casts none
  if (elev > 0.35) return 1.0;
  float k = 1.0 / pow(cos(0.5 * (0.5 * PI + lat)), 2.0);
  float ce = dot(hz, east);
  float cn = dot(hz, north);
  vec2 dir = normalize(vec2(ce * cos(lon) + cn * sin(lon), -ce * sin(lon) + cn * cos(lon)));
  float h0 = ovH(xy) + 15.0;
  float steepest = -1.0;
  float d = 400.0;
  // Terrain this steep hides the whole solar disc: the answer below is 0 whatever lies farther, so the march stops
  // there. The picture is the same; ground in shadow (most of a polar view) costs a few steps instead of all of them.
  float hidden = tan(elev + 0.0046);
  for (int i = 0; i < SHADOW_STEPS; i++) {
    float h = ovH(xy + dir * d * k);
    steepest = max(steepest, (h - h0 - d * d / (2.0 * R)) / d);
    if (steepest >= hidden) return 0.0;
    d *= 1.25;
  }
  return smoothstep(-0.0046, 0.0046, elev - atan(steepest));
}

// share of the LOLA slope shading laid over the photo (the photo already holds some shading of its own)
const float PHOTO_RELIEF = 0.7;

${H_AT}

${DETAIL_LOOKUP}
${POLAR_LOOKUP}
// Level of a tile from its side (degrees).
int levelOf(float sizeDeg) { return int(floor(log2(90.0 / sizeDeg) + 0.5)); }
float wrapLonDeg(float d) { return mod(d + 180.0, 360.0) - 180.0; }

// The edges of the finest tiles fade into the next coarser ones. The view rarely has its finest level everywhere: the
// close-up's block of 83 m tiles sits in a view of coarser tiles (at most MAX_VIEW_TILES per view), and a quad
// arrives before its neighbours. Where such a tile ended the ground changed from sharp to soft along a straight line.
// Within EDGE_FADE cells of an edge with nothing as fine beyond it, the tile's value is mixed with the coarser tile's,
// which it reaches at the edge.
const float EDGE_FADE = 64.0;
// whether a tile at least as fine as sizeDeg is loaded at the point
bool hasLevel(sampler2D index, float lonDeg, float latDeg, int maxLevel, float sizeDeg) {
  vec2 c;
  float s;
  return findTile(index, wrapLonDeg(lonDeg), clamp(latDeg, -89.999, 89.999), maxLevel, c, s) >= 0 && s <= sizeDeg * 1.001;
}
// weight of the tile at the point (cell, sizeDeg from findTile) against the next coarser one: 1 inside, 0 on an edge
// with nothing as fine beyond it
float edgeWeight(sampler2D index, float lonDeg, float latDeg, int maxLevel, vec2 cell, float sizeDeg) {
  // cells to the west, east, north and south edges (cell.y counts from the north edge)
  float dw = cell.x;
  float de = 256.0 - cell.x;
  float dn = cell.y;
  float ds = 256.0 - cell.y;
  if (min(min(dw, de), min(dn, ds)) >= EDGE_FADE) return 1.0;
  // a point half a cell beyond each edge
  float c = sizeDeg / 256.0;
  float lw = lonDeg - (dw + 0.5) * c;
  float le = lonDeg + (de + 0.5) * c;
  float ln = latDeg + (dn + 0.5) * c;
  float ls = latDeg - (ds + 0.5) * c;
  bool w = dw < EDGE_FADE;
  bool e = de < EDGE_FADE;
  bool n = dn < EDGE_FADE;
  bool s = ds < EDGE_FADE;
  float d = EDGE_FADE;
  if (w && !hasLevel(index, lw, latDeg, maxLevel, sizeDeg)) d = min(d, dw);
  if (e && !hasLevel(index, le, latDeg, maxLevel, sizeDeg)) d = min(d, de);
  if (n && !hasLevel(index, lonDeg, ln, maxLevel, sizeDeg)) d = min(d, dn);
  if (s && !hasLevel(index, lonDeg, ls, maxLevel, sizeDeg)) d = min(d, ds);
  // corners: the diagonal tile alone may be missing
  if (w && n && !hasLevel(index, lw, ln, maxLevel, sizeDeg)) d = min(d, max(dw, dn));
  if (e && n && !hasLevel(index, le, ln, maxLevel, sizeDeg)) d = min(d, max(de, dn));
  if (w && s && !hasLevel(index, lw, ls, maxLevel, sizeDeg)) d = min(d, max(dw, ds));
  if (e && s && !hasLevel(index, le, ls, maxLevel, sizeDeg)) d = min(d, max(de, ds));
  return smoothstep(0.0, 1.0, d / EDGE_FADE);
}

// East and north slopes (metres per metre) at latitude and longitude (radians): from DEM tile 'slot', one cell either
// side (inside the tile: next to its edge the step shrinks rather than reading the clamped border, which drew lines
// along the tile edges), or, for slot -1, from the shipped grid.
vec2 slopes(int slot, vec2 cell, float tileDeg, float lat, float lon) {
  float coslat = max(cos(lat), 0.05);
  if (slot >= 0) {
    float c = radians(tileDeg / 256.0);
    float xm = max(cell.x - 1.0, 0.5);
    float xp = min(cell.x + 1.0, 255.5);
    float ym = max(cell.y - 1.0, 0.5);
    float yp = min(cell.y + 1.0, 255.5);
    return vec2((dAt(slot, vec2(xp, cell.y)) - dAt(slot, vec2(xm, cell.y))) / (R * coslat * c * max(xp - xm, 0.5)),
                (dAt(slot, vec2(cell.x, ym)) - dAt(slot, vec2(cell.x, yp))) / (R * c * max(yp - ym, 0.5)));
  }
  vec2 uv = vec2(fract(lon / (2.0 * PI)), (0.5 * PI - lat) / PI);
  vec2 size = vec2(textureSize(uHeight, 0));
  return vec2((hAt(uv + vec2(1.0 / size.x, 0.0)) - hAt(uv - vec2(1.0 / size.x, 0.0))) / (2.0 * R * coslat * (2.0 * PI / size.x)),
              (hAt(uv - vec2(0.0, 1.0 / size.y)) - hAt(uv + vec2(0.0, 1.0 / size.y))) / (2.0 * R * (PI / size.y)));
}
// relief shading exaggeration of the shipped grid's slopes, for legibility at 7.6 km pixels
const float GRID_SHADE = 3.0;

void main() {
  vec3 up = normalize(vMe);
  // Finest tile level worth reading at this pixel: the level whose cells match the ground the pixel spans (as
  // grid.ts, levelFor, does for the centre of the view), like a mipmap. The view may hold finer tiles than that (the
  // close-up's 83 m block around the place, tiles kept from a closer zoom); read where a pixel covers several of
  // their cells they alias into streaks, and where they end the view showed a straight seam between streaked and
  // smooth ground. Taken before the discards below, where the derivatives are still defined.
  float pixRad = max(max(length(dFdx(up)), length(dFdy(up))), 1e-9);
  int pixLevel = int(floor(log2(radians(90.0 / 256.0) / pixRad) + 0.5));
  int maxLevel = min(int(uMaxLevel), pixLevel);
  float lat = asin(clamp(up.z, -1.0, 1.0));
  float lon = length(up.xy) > 1e-9 ? atan(up.y, up.x) : 0.0;
  if (uHole.y > 0.0) {
    float dLon = mod(degrees(lon) - uHole.x + 540.0, 360.0) - 180.0;
    float la = degrees(lat);
    if (abs(dLon) < uHole.y && la > uHole.z && la < uHole.w) discard;
  }
  float pw = lat < 0.0 ? polarWeight(degrees(lat)) : 0.0;
  vec2 pxy = lat < 0.0 ? polarXY(lat, lon) : vec2(0.0);
  if (uPolarHole.w > 0.0 && lat < 0.0 && abs(pxy.x - uPolarHole.x) < uPolarHole.z && abs(pxy.y - uPolarHole.y) < uPolarHole.z) discard;
  float day = smoothstep(-0.02, 0.05, dot(up, uSun));
  // Well inside the polar cap the polar tiles replace the latitude/longitude ones. What is replaced is not looked up: the
  // shadow march alone is 28 reads a pixel, each tile lookup up to 9 index reads and 4 texel reads.
  bool onlyPolar = pw > 0.999;
  vec2 cell;
  float tileDeg;
  int slot = uMaxLevel >= 0.0 && !onlyPolar ? findTile(uIndex, degrees(lon), degrees(lat), maxLevel, cell, tileDeg) : -1;
  // ground brightness: the WAC photograph where a photo tile is loaded (photo mode), else plain regolith grey
  vec3 albedo = REGOLITH;
  bool photo = false;
  // share of the ground where the polar mosaic's photographed shadow is replaced by plain regolith (below)
  float fill = 0.0;
  if (uPhotoMode > 0.5 && uMaxLevel >= 0.0 && !onlyPolar) {
    vec2 pCell;
    float pDeg;
    // never coarser than the photo base, which is always loaded: where a pixel spans more ground than a base cell
    // (the whole Moon far away, the foreshortened limbs, slopes facing the camera) the pixel's own level is 0 and
    // holds no photo, and the ground showed the plain relief grey in its place
    int photoLevel = max(maxLevel, PHOTO_BASE_LEVEL);
    int pSlot = findTile(uPhotoIndex, degrees(lon), degrees(lat), photoLevel, pCell, pDeg);
    if (pSlot >= 0) {
      // faded into the coarser photo tile toward a lone edge (edgeWeight)
      float raw = tileAt(uPhoto, pSlot, pCell);
      float w = edgeWeight(uPhotoIndex, degrees(lon), degrees(lat), photoLevel, pCell, pDeg);
      if (w < 1.0) {
        vec2 cCell;
        float cDeg;
        int coarse = findTile(uPhotoIndex, degrees(lon), degrees(lat), levelOf(pDeg) - 1, cCell, cDeg);
        if (coarse >= 0) raw = mix(tileAt(uPhoto, coarse, cCell), raw, w);
      }
      albedo = vec3(photoTone(raw));
      photo = true;
    }
  }
  // south of 60 S the polar mosaic (same gain as the polar map), eased in from the disc's edge
  if (uPhotoMode > 0.5 && pw > 0.0) {
    vec2 qCell;
    float qSize;
    int qSlot = findPolar(uPolarPIndex, pxy, 256.0, qCell, qSize);
    if (qSlot >= 0) {
      // The mosaic keeps the shadows it was photographed with, nearly black near the pole (median 0.016 within 60 km
      // of it), and a few blocks without data (0). There the ground eases to the plain regolith grey, lit like the
      // rest by the Sun at the chosen instant, so the LOLA relief reads instead of a black patch.
      // The stand-in is a floor under the photo, not a blend with it: a blend passed through the photo's darkest
      // greys on the way (darker than both the stand-in and the lit ground), which drew a dark outline around every
      // photographed shadow. With the floor the brightness never falls below the stand-in and rises from it without
      // a step where the photo is brighter.
      float raw = tileAt(uPolarP, qSlot, qCell);
      float seen = smoothstep(0.04, 0.5 * PHOTO_SHADOW_FILL, raw);
      fill = pw * (1.0 - seen);
      vec3 polarAlbedo = vec3(max(photoTone(raw), PHOTO_SHADOW_FILL));
      albedo = photo ? mix(albedo, polarAlbedo, pw) : mix(REGOLITH, polarAlbedo, pw);
      photo = true;
    }
  }
  vec3 colour;
  {
    float he;
    float hn;
    float exag;
    if (onlyPolar) {
      // replaced by the polar slopes below
      he = 0.0;
      hn = 0.0;
      exag = uDetailShade;
    } else if (slot >= 0) {
      // slopes from the detail heights, faded into the coarser tile's toward a lone edge (edgeWeight)
      vec2 g = slopes(slot, cell, tileDeg, lat, lon);
      exag = uDetailShade;
      float w = edgeWeight(uIndex, degrees(lon), degrees(lat), maxLevel, cell, tileDeg);
      if (w < 1.0) {
        vec2 cCell;
        float cDeg;
        int coarse = findTile(uIndex, degrees(lon), degrees(lat), levelOf(tileDeg) - 1, cCell, cDeg);
        g = mix(slopes(coarse, cCell, cDeg, lat, lon), g, w);
        exag = mix(coarse >= 0 ? uDetailShade : GRID_SHADE, uDetailShade, w);
      }
      he = g.x;
      hn = g.y;
    } else {
      vec2 g = slopes(-1, cell, tileDeg, lat, lon);
      he = g.x;
      hn = g.y;
      exag = GRID_SHADE;
    }
    // south of 60 S the slopes of the polar height tiles, eased in from the disc's edge: one and a half vertices
    // either side in map metres (wider than one: the bilinear heights' slope then changes smoothly across a cell
    // instead of in steps at its edges, which drew fine terraces on crater walls), times the scale factor k = 1 / cos²((90° + lat) / 2) for ground metres, turned to east and north
    // (map north is away from the pole, (sin lon, cos lon); east is (cos lon, −sin lon))
    if (pw > 0.0) {
      vec2 hv;
      float hSize;
      int hSlot = findPolar(uPolarHIndex, pxy, 256.0, hv, hSize);
      if (hSlot >= 0) {
        float cellM = hSize / 256.0;
        float xm = max(hv.x - 1.5, 0.0);
        float xp = min(hv.x + 1.5, 256.0);
        float ym = max(hv.y - 1.5, 0.0);
        float yp = min(hv.y + 1.5, 256.0);
        float k = 1.0 / pow(cos(0.5 * (0.5 * PI + lat)), 2.0);
        float gx = k * (polarH(hSlot, vec2(xp, hv.y)) - polarH(hSlot, vec2(xm, hv.y))) / (cellM * max(xp - xm, 0.5));
        // rows run down the map (toward smaller y)
        float gy = k * (polarH(hSlot, vec2(hv.x, ym)) - polarH(hSlot, vec2(hv.x, yp))) / (cellM * max(yp - ym, 0.5));
        he = mix(he, gx * cos(lon) - gy * sin(lon), pw);
        hn = mix(hn, gx * sin(lon) + gy * cos(lon), pw);
        exag = mix(exag, uDetailShade, pw);
      }
    }
    vec3 east = vec3(-sin(lon), cos(lon), 0.0);
    vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
    vec3 n = normalize(up - exag * (he * east + hn * north));
    float sun = max(0.0, dot(n, uSun));
    // the shadows the terrain casts, south of 60 S (eased in from the disc's edge like the polar tiles)
    float lit = 1.0;
    if (pw > 0.0 && uPolarShadow > 0.5 && dot(up, uSun) > -0.01) lit = mix(1.0, polarSunVisible(pxy, up, east, north, lat, lon), pw);
    sun *= lit;
    float light;
    // a faint fixed light (like earthshine) keeps the shape of the ground readable at night and in shadow
    vec3 fixedLight = normalize(up + 0.6 * east + 0.4 * north);
    if (photo) {
      // photo: the slope's Sun relative to flat ground's (1 on the flat, brighter facing the Sun, darker away from
      // it; the 0.2 keeps it finite at the terminator), over the day and night of the chosen instant
      float rel = clamp((sun + 0.2) / (max(0.0, dot(up, uSun)) + 0.2), 0.0, 1.8);
      // where the regolith stands in for the photo's shadows, the relief is shaded in full (no photo shading there)
      float ambient = 0.05 + 0.09 * max(0.0, dot(n, fixedLight));
      light = ambient + (1.0 - ambient) * day * lit * mix(1.0, rel, mix(PHOTO_RELIEF, 1.0, fill));
    } else {
      // the night side keeps a faint fixed-light relief so its shape stays readable
      float night = 0.07 + 0.12 * max(0.0, dot(n, fixedLight));
      light = night + (1.0 - night) * sun * day;
    }
    colour = albedo * light;
  }
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
#define PHOTO_BASE_LEVEL ${PHOTO_BASE_LEVEL}
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
  return findTile(uIndex, wrapLon(lonDeg), latDeg, int(uMaxLevel), c, s) < 0;
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
    int slot = findTile(uIndex, lonDeg, latDeg, int(uMaxLevel), cell, size);
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

/**
 * A polar patch: the same dense grid as PATCH_VERT, laid out in south polar stereographic metres around the place
 * the camera looks at (patch.ts, polarPatchWindows), so it stays square over the pole where a latitude/longitude grid
 * folds up. Lifted by the polar height tiles (detail/polar.ts) eased in from the disc's edge, else the shipped grid.
 * Drawn with the globe's fragment shader.
 */
export const POLAR_PATCH_VERT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
#define POLAR_MAX_Z ${POLAR_MAX_Z}
uniform sampler2D uHeight;
uniform float uExag;
uniform float uDiscLat;
uniform sampler2DArray uPolarH;
uniform sampler2D uPolarHIndex;
uniform float uPolarMaxZ;
uniform float uPolarExtent;
uniform vec4 uPWin;         // centre x and y, cell size (metres); w = 1 on the outermost grid
uniform float uSkirtKm;
in float skirt;
out vec3 vMe;
out float vHeight;
const float PI = 3.141592653589793;
${H_AT}
${POLAR_LOOKUP}
void main() {
  vec2 xy = uPWin.xy + position.xy * uPWin.z;
  // the outermost grid eases back to the shipped heights over its last EDGE_CELLS cells, so it meets the globe's own
  // mesh (which has no detail heights) without a step
  const float EDGE_CELLS = 24.0;
  float edge = uPWin.w > 0.5 ? clamp((128.0 - max(abs(position.x), abs(position.y))) / EDGE_CELLS, 0.0, 1.0) : 1.0;
  float r = length(xy);
  float lat = 2.0 * atan(r / (2.0 * 1737400.0)) - 0.5 * PI;
  // atan(0, 0) is undefined (NaN on some GPUs): the vertex on the pole takes longitude 0
  float lon = r > 1e-3 ? atan(xy.x, xy.y) : 0.0;
  vec3 me = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  float h = hAt(vec2(fract(lon / (2.0 * PI)), (0.5 * PI - lat) / PI));
  float pw = polarWeight(degrees(lat)) * edge;
  if (pw > 0.0) {
    vec2 v;
    float sizeM;
    int slot = findPolar(uPolarHIndex, xy, 256.0, v, sizeM);
    if (slot >= 0) h = mix(h, polarH(slot, v), pw);
  }
  vMe = me;
  vHeight = h;
  vec3 pos = vec3(me.x, me.z, -me.y) * (1737.4 + h / 1000.0 * uExag - skirt * uSkirtKm);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`
