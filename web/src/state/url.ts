/**
 * Scenario ↔ URL. The scene is JSON, base64url-encoded in `?s=` with a version field; anything that fails
 * validation is dropped and the default scene is used instead, so a corrupt or old link never breaks the app.
 */
import type { PanelModel } from '../time/engine'
import { type LayerId, type Scene, type Selection, MASTS_M, MAX_COMPARE, defaultScene } from './store'

const VERSION = 1
const MAX_URL_BYTES = 8192
const LAYERS: LayerId[] = ['none', 'photo', 'elevation', 'slope', 'sun_illumination', 'earth_visibility', 'permanent_shadow']
const PANELS: PanelModel[] = ['tracking', 'vertical', 'horizontal']
/** The tables cover 1969-1972 and 2025-2035; anything far outside is rejected as corrupt. */
const T_MIN = Date.parse('1969-01-01T00:00:00Z')
const T_MAX = Date.parse('2036-01-01T00:00:00Z')

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isTime = (v: unknown): v is number => isNum(v) && v >= T_MIN && v <= T_MAX

function selection(v: unknown): Selection | null {
  if (typeof v === 'string' && /^[a-z0-9-]{1,64}$/.test(v)) return { kind: 'site', id: v }
  if (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180) {
    return { kind: 'point', lat: v[0], lon: v[1] }
  }
  return null
}

const packSel = (s: Selection) => (s.kind === 'site' ? s.id : [s.lat, s.lon])

export function encodeScene(s: Scene): string {
  return b64urlEncode(
    JSON.stringify({
      v: VERSION,
      m: s.mode,
      sc: s.scale,
      w: s.view,
      p: s.selection ? packSel(s.selection) : null,
      t: s.tMs,
      st: s.startMs,
      d: s.durationH,
      h: s.mastM,
      pn: s.panel,
      c: s.commsMinFraction,
      l: s.layer,
      li: s.lighting,
      cr: s.craters ? 1 : 0,
      cmp: s.compare.map(packSel),
    }),
  )
}

/** Decode `?s=`; returns the default scene (and `ok: false`) for anything missing, corrupt or too large. */
export function decodeScene(param: string | null, fallback: Scene = defaultScene()): { scene: Scene; ok: boolean } {
  if (!param) return { scene: fallback, ok: true }
  if (param.length > MAX_URL_BYTES) return { scene: fallback, ok: false }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(b64urlDecode(param)) as Record<string, unknown>
  } catch {
    return { scene: fallback, ok: false }
  }
  if (typeof raw !== 'object' || raw === null || raw.v !== VERSION) return { scene: fallback, ok: false }
  // no place chosen is written as null; anything else that is not a place is corrupt
  const sel = raw.p === null || raw.p === undefined ? null : selection(raw.p)
  if ((sel === null && raw.p != null) || !isTime(raw.t) || !isTime(raw.st)) return { scene: fallback, ok: false }
  const compare = Array.isArray(raw.cmp)
    ? raw.cmp
        .map((c) => selection(c))
        .filter((c): c is Selection => !!c)
        .slice(0, MAX_COMPARE)
    : []
  return {
    ok: true,
    scene: {
      mode: raw.m === 'mission' ? 'mission' : 'study',
      scale: raw.sc === 'map' ? 'map' : 'globe',
      view: raw.w === '3d' ? '3d' : '2d',
      selection: sel,
      tMs: raw.t,
      startMs: raw.st,
      durationH: isNum(raw.d) && raw.d >= 1 && raw.d <= 24 * 365 ? raw.d : fallback.durationH,
      mastM: (MASTS_M as readonly number[]).includes(raw.h as number) ? (raw.h as number) : fallback.mastM,
      panel: PANELS.includes(raw.pn as PanelModel) ? (raw.pn as PanelModel) : fallback.panel,
      commsMinFraction: isNum(raw.c) && raw.c > 0 && raw.c <= 1 ? raw.c : fallback.commsMinFraction,
      layer: LAYERS.includes(raw.l as LayerId) ? (raw.l as LayerId) : fallback.layer,
      lighting: raw.li === 'relief' ? 'relief' : 'sun',
      craters: raw.cr === 1,
      compare,
    },
  }
}
