/**
 * Lunar Quest: short challenges that teach the navigator by using it. Each challenge sets up a real scene in
 * the navigator (place, date, view, layers) and asks one question whose answer is computed here, at run time,
 * by the browser engine: the same engine the panels use, a port of the API's engine validated against JPL
 * Horizons. Nothing in the answers is typed by hand.
 */
import type { Scene, Selection } from '../state/store'
import { DEFAULT_PARAMS, type EphemerisTable, MS_PER_HOUR, nextTransition } from '../time/engine'
import { evaluateWindow } from '../time/hooks'
import { evaluateAt } from '../time/engine'
import { placeModel } from '../time/place'
import type { HorizonMasks } from '../time/staticData'

export interface QuestContext {
  table: EphemerisTable
  masks: HorizonMasks
}

export interface Choice {
  id: string
  label: string
}

export interface Solved {
  choices: Choice[]
  answerId: string
  /** One or two sentences with the measured numbers behind the answer. */
  explanation: string
}

export interface Quest {
  id: string
  title: string
  /** What the player does: shown as a tag on the card. */
  kind: 'Choose a site' | 'Read the map' | 'Use the timeline' | 'Compare dates'
  skill: string
  /** Shown on the Learn page card. */
  teaser: string
  question: string
  /** How to find the answer with the tool. */
  hint: string
  /** The scene the navigator switches to when the challenge starts. */
  scene: Partial<Scene>
  /** Places added to the live comparison while the challenge runs. */
  compare?: Selection[]
  solve: (ctx: QuestContext) => Solved | null
}

const NOV_2027 = Date.UTC(2027, 10, 1)
const NOW_2027 = Date.UTC(2027, 10, 6, 17)
const MAST_M = 2
const malapert: Selection = { kind: 'site', id: 'mons-malapert' }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const fmtDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

function model(ctx: QuestContext, sel: Selection) {
  return placeModel(ctx.masks, sel, MAST_M)
}

/** Share of a window with any part of the Sun (or half the Earth) above the real skyline, hourly. */
function windowMetrics(ctx: QuestContext, sel: Selection, startMs: number, hours: number) {
  const m = model(ctx, sel)
  if (!m) return null
  return evaluateWindow(ctx.table, m.model, startMs, hours, 60, DEFAULT_PARAMS)?.metrics ?? null
}

function pickBetween(ctx: QuestContext, a: Selection & { kind: 'site' }, b: Selection & { kind: 'site' }, metric: 'sunlightPct' | 'commsPct', what: string): Solved | null {
  const ma = windowMetrics(ctx, a, NOV_2027, 14 * 24)
  const mb = windowMetrics(ctx, b, NOV_2027, 14 * 24)
  const na = model(ctx, a)?.name
  const nb = model(ctx, b)?.name
  if (!ma || !mb || !na || !nb) return null
  const va = ma[metric]
  const vb = mb[metric]
  const winner = va >= vb ? a.id : b.id
  return {
    choices: [
      { id: a.id, label: na },
      { id: b.id, label: nb },
    ],
    answerId: winner,
    explanation: `Over 1–14 November 2027: ${na} ${va.toFixed(0)} % of the time ${what}, ${nb} ${vb.toFixed(0)} %.`,
  }
}

const COMPASS = ['north', 'east', 'south', 'west'] as const

export const QUESTS: Quest[] = [
  {
    id: 'which-site',
    title: 'Which site wins?',
    kind: 'Choose a site',
    skill: 'Sunlight depends on the skyline',
    teaser: 'A mountain top or a crater floor: where does a solar rover get light?',
    question: 'A solar rover lands on 1 November 2027 and must work for 14 days. Which site gives it more sunlight?',
    hint: 'Both sites are in the comparison table at the bottom. Turn on the "Sunlight, long-term" colour layer and look at where each one sits.',
    scene: { scale: 'map', view: '2d', selection: malapert, startMs: NOV_2027, tMs: NOV_2027, durationH: 14 * 24, layer: 'sun_illumination', mastM: MAST_M },
    compare: [malapert, { kind: 'site', id: 'shackleton' }],
    solve: (ctx) => pickBetween(ctx, { kind: 'site', id: 'mons-malapert' }, { kind: 'site', id: 'shackleton' }, 'sunlightPct', 'in sunlight'),
  },
  {
    id: 'sun-direction',
    title: 'Where is the Sun?',
    kind: 'Read the map',
    skill: 'Shadows point away from the Sun',
    teaser: 'Read the shadows on real LOLA relief to find the Sun.',
    question: 'It is 6 November 2027, 17:00 UTC, at Mons Malapert. Look at the shadows on the 3D relief. From which direction is the Sun shining?',
    hint: 'Shadows stretch away from the Sun, and slopes facing it are bright. The map keeps north toward the outer edge of the polar map.',
    scene: { scale: 'map', view: '3d', selection: malapert, tMs: NOW_2027, startMs: NOV_2027, durationH: 30 * 24, layer: 'none', lighting: 'sun', mastM: MAST_M },
    solve: (ctx) => {
      const m = model(ctx, malapert)
      if (!m || !ctx.table.covers(NOW_2027)) return null
      const s = evaluateAt(ctx.table, m.model, NOW_2027, DEFAULT_PARAMS)
      const k = Math.round(s.sun.az / 90) % 4
      return {
        choices: COMPASS.map((c) => ({ id: c, label: `From the ${c}` })),
        answerId: COMPASS[k],
        explanation: `The Sun is at azimuth ${s.sun.az.toFixed(1)}° (${COMPASS[k]}), only ${s.sun.el.toFixed(1)}° above the horizon: that low, a hill casts a shadow kilometres long.`,
      }
    },
  },
  {
    id: 'find-sunset',
    title: 'Find the sunset',
    kind: 'Use the timeline',
    skill: 'Sunset comes from the terrain, not the clock',
    teaser: 'Use the timeline to find when night falls behind the hills.',
    question: 'It is 6 November 2027 at Mons Malapert and the Sun is up. On which day does it set behind the hills?',
    hint: 'Press Play or drag the timeline: the yellow Sunlit bar ends where the last sliver of the Sun drops behind the skyline. The Sun card also counts down to sunset.',
    scene: { scale: 'map', view: '2d', selection: malapert, startMs: NOV_2027, tMs: NOW_2027, durationH: 30 * 24, layer: 'none', lighting: 'sun', mastM: MAST_M },
    solve: (ctx) => {
      const m = model(ctx, malapert)
      if (!m) return null
      const tr = nextTransition(ctx.table, m.model, NOW_2027, 'sun', DEFAULT_PARAMS)
      if (!tr || tr.kind !== 'set') return null
      const day = (ms: number) => Math.floor(ms / (24 * MS_PER_HOUR))
      const right = day(tr.atMs)
      const offsets = [-6, 0, 5, 9]
      return {
        choices: offsets.map((o) => {
          const ms = (right + o) * 24 * MS_PER_HOUR
          return { id: String(right + o), label: fmtDay(ms) }
        }),
        answerId: String(right),
        explanation: `The Sun sets on ${fmtDay(tr.atMs)} at ${new Date(tr.atMs).toISOString().slice(11, 16)} UTC, ${(tr.inMs / (24 * MS_PER_HOUR)).toFixed(1)} days after the start, when its disc drops behind the terrain horizon.`,
      }
    },
  },
  {
    id: 'best-month',
    title: 'Pick the landing month',
    kind: 'Compare dates',
    skill: 'The same place changes over the year',
    teaser: 'Same site, different month: when does a mission get power?',
    question: 'A 14-day mission lands at Mons Malapert on the 1st of a month in 2027. Which month gives it the most sunlight?',
    hint: 'Change the start date in "When" and read "Sunlit" under the timeline, or turn on Compare and try several dates.',
    scene: { scale: 'map', view: '2d', selection: malapert, startMs: Date.UTC(2027, 2, 1), tMs: Date.UTC(2027, 2, 1), durationH: 14 * 24, layer: 'none', mastM: MAST_M },
    solve: (ctx) => {
      const pct = MONTHS.map((_, i) => windowMetrics(ctx, malapert, Date.UTC(2027, i, 1), 14 * 24)?.sunlightPct ?? NaN)
      if (pct.some(Number.isNaN)) return null
      const best = pct.indexOf(Math.max(...pct))
      const others = [2, 5, 7, 8].filter((i) => i !== best).slice(0, 3)
      const ids = [best, ...others].sort((a, b) => a - b)
      return {
        choices: ids.map((i) => ({ id: String(i), label: MONTHS[i] })),
        answerId: String(best),
        explanation: `Sunlight over 14 days from the 1st of each month in 2027: ${pct.map((p, i) => `${MONTHS[i].slice(0, 3)} ${p.toFixed(0)} %`).join(', ')}.`,
      }
    },
  },
  {
    id: 'earth-link',
    title: 'Talk to Earth',
    kind: 'Choose a site',
    skill: 'The Earth also hides behind the terrain',
    teaser: 'Keep a direct radio link home, or lose it behind a crater rim.',
    question: 'Your lander must radio the Earth directly, with no relay satellite. Which site keeps the Earth in view more of 1–14 November 2027?',
    hint: 'Look at the Earth card and the Earth row of the timeline for each site in the comparison table.',
    scene: { scale: 'map', view: '2d', selection: malapert, startMs: NOV_2027, tMs: NOV_2027, durationH: 14 * 24, layer: 'earth_visibility', mastM: MAST_M },
    compare: [malapert, { kind: 'site', id: 'amundsen' }],
    solve: (ctx) => pickBetween(ctx, { kind: 'site', id: 'mons-malapert' }, { kind: 'site', id: 'amundsen' }, 'commsPct', 'with the Earth in view'),
  },
]

export const questById = (id: string | null) => QUESTS.find((q) => q.id === id) ?? null
