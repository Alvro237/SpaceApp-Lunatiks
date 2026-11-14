/**
 * Globe shaders: a sphere lifted by the global LOLA heights (exaggerated, labelled) and lit by the Sun at the
 * chosen instant, so the day and night sides are the real ones. Output is sRGB as written (no tone mapping).
 */
export const GLOBE_VERT = /* glsl */ `
uniform sampler2D uHeight;  // 1440 x 720 heights, metres; row 0 = 90 N, column 0 = longitude 0, east positive
uniform float uExag;
out vec3 vMe;               // unit vector of the point, Moon Mean-Earth axes
out float vHeight;
const float PI = 3.141592653589793;
void main() {
  vec3 p = normalize(position);
  vec3 me = vec3(p.x, -p.z, p.y);
  float lat = asin(clamp(me.z, -1.0, 1.0));
  float lon = atan(me.y, me.x);
  ivec2 size = textureSize(uHeight, 0);
  float u = fract(lon / (2.0 * PI));
  float v = (0.5 * PI - lat) / PI;
  ivec2 texel = ivec2(clamp(vec2(u, v) * vec2(size), vec2(0.0), vec2(size) - 1.0));
  float h = texelFetch(uHeight, texel, 0).r;
  vMe = me;
  vHeight = h;
  vec3 pos = p * (1737.4 + h / 1000.0 * uExag);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

export const GLOBE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uHeight;
uniform vec3 uSun;          // unit vector to the Sun, Moon Mean-Earth axes
uniform float uDiscLat;     // the polar map covers south of this latitude (degrees)
in vec3 vMe;
in float vHeight;
layout(location = 0) out highp vec4 fragColor;
const float PI = 3.141592653589793;
const float R = 1737400.0;

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

void main() {
  vec3 up = normalize(vMe);
  float lat = asin(clamp(up.z, -1.0, 1.0));
  float lon = atan(up.y, up.x);
  vec2 uv = vec2(fract(lon / (2.0 * PI)), (0.5 * PI - lat) / PI);
  vec2 size = vec2(textureSize(uHeight, 0));
  float dLon = 2.0 * PI / size.x;
  float dLat = PI / size.y;
  float coslat = max(cos(lat), 0.05);
  // slopes in metres per metre, east and north; relief shading exaggerated x3 for legibility at 7.6 km pixels
  float he = (hAt(uv + vec2(1.0 / size.x, 0.0)) - hAt(uv - vec2(1.0 / size.x, 0.0))) / (2.0 * R * coslat * dLon);
  float hn = (hAt(uv - vec2(0.0, 1.0 / size.y)) - hAt(uv + vec2(0.0, 1.0 / size.y))) / (2.0 * R * dLat);
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
  vec3 n = normalize(up - 3.0 * (he * east + hn * north));
  float sun = max(0.0, dot(n, uSun));
  float day = smoothstep(-0.02, 0.05, dot(up, uSun));
  // the night side keeps a faint fixed-light relief (like earthshine) so its shape stays readable
  vec3 fixedLight = normalize(up + 0.6 * east + 0.4 * north);
  float night = 0.07 + 0.12 * max(0.0, dot(n, fixedLight));
  float light = night + (1.0 - night) * sun * day;
  vec3 colour = vec3(0.72, 0.71, 0.68) * light;
  // outline of the polar map's coverage
  float latDeg = degrees(lat);
  if (abs(latDeg - uDiscLat) < 0.18) colour = mix(colour, vec3(0.0, 0.85, 1.0), 0.85);
  fragColor = vec4(colour, 1.0);
}
`
