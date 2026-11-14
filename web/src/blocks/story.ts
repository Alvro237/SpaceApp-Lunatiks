/**
 * Learn mode's mission log: six short chapters built on real Moon missions, for learners and the public. Each
 * chapter puts the world where a real mission was (place and date), tells what happened in a few one-line facts
 * with their source, gives a task done in the tool (find the Sun, play the days, compare two places), and answers
 * with a few big numbers from the engine: the same JPL tables and LOLA horizons as the planner, never a typed value.
 * Text is kept short on purpose: one idea per line, numbers as tiles, no paragraphs.
 *
 * Facts and their sources (also in docs/references.md):
 *   - Apollo: sun elevation at landing drove the launch time; landings near the sunrise terminator put the Sun
 *     behind the lander (no glare) and lit the surface work. NASA SP-4214, ch. 6.
 *   - Chandrayaan-3: landed 23 August 2023 near 69.4° S; rover asleep 2 September, lander 4 September; no signal
 *     after the next sunrise (ISRO, 22 September 2023).
 *   - IM-2 Athena: landed 6 March 2025 on Mons Mouton, on its side in a crater; with the low Sun and the panels'
 *     orientation the batteries could not recharge, and the mission ended on 7 March (Intuitive Machines).
 *   - LCROSS: impact in Cabeus crater on 9 October 2009, water found in the plume (Colaprete et al. 2010).
 *   - Artemis III candidate regions on rims and ridges near the south pole: sites.json notes (NASA).
 * Pure functions over a context, so every chapter is testable.
 */
import type { BlockView, Selection } from '../state/store'
import type { SpeedId } from '../time/clock'

export interface StoryMetrics {
  sunlightPct: number
  commsPct: number
  longestDarkH: number
  longestBlackoutH: number
}

/** What a chapter remembers from the moment its scene was set, and what the learner did during it. */
export interface StoryMemory {
  startTMs: number | null
  startSunUp: boolean | null
  /** Sun elevation when the scene was set, degrees (the landing moment in the Apollo chapter). */
  startSunEl: number | null
  startSel: Selection | null
  /** The moment the chapter waits for (the sunset after the sunrise it starts at), from the engine's series. */
  targetMs: number | null
  /** Sunlight and Earth contact over the window, recorded when the learner opens a catalogue site. */
  visited: Record<string, { sunPct: number; earthPct: number }>
  answer: string | null
  /** Steps already reached in this chapter: they stay ticked even if the view moves on. */
  latched: number[]
}

export const EMPTY_MEMORY: StoryMemory = {
  startTMs: null,
  startSunUp: null,
  startSunEl: null,
  startSel: null,
  targetMs: null,
  visited: {},
  answer: null,
  latched: [],
}

export interface StoryCtx {
  view: BlockView
  selection: Selection
  placeName: string | null
  horizonKind: 'terrain' | 'smooth_sphere' | null
  sunUp: boolean | null
  earthContact: boolean | null
  sunEl: number | null
  /** Highest Sun elevation over the analysis window, degrees. */
  sunElMax: number | null
  sunOnScreen: boolean
  earthOnScreen: boolean
  tMs: number
  windowDays: number
  metrics: StoryMetrics | null
  memory: StoryMemory
  names: (id: string) => string
}

export interface Step {
  text: string
  done: boolean
}

/** Where a chapter puts the world when it opens. */
export interface Scene {
  site?: string
  /** UTC instant, ms; the analysis window starts there. */
  atMs?: number
  view?: BlockView
  /** Turn the ground camera to look away from the Sun, so the learner has to find it. */
  lookAway?: boolean
  /** Start the window at the first sunrise in it (once the place's series is known). */
  atSunrise?: boolean
  /** Playback speed for the chapter's task. */
  speed?: SpeedId
}

/** One number the engine found, shown big, with a few words under it. */
export interface Stat {
  value: string
  label: string
}

/** What the learner found: the engine's numbers as tiles, and one short line on what they mean. */
export interface Found {
  stats: Stat[]
  note: string
}

export interface Chapter {
  id: string
  /** Year or programme, shown above the title. */
  tag: string
  title: string
  /** Where and when, shown as two short labels. */
  where: string
  when: string
  /** What happened: two or three facts, one short line each. */
  story: string[]
  /** A caveat about how the chapter is replayed, shown small. */
  note?: string
  source: { label: string; url: string }
  scene: Scene
  steps: (c: StoryCtx) => Step[]
  /** A question to answer once the steps before it are done. */
  question?: { text: string; choices: { id: string; label: string }[]; answer: (c: StoryCtx) => string | null }
  /** What the learner found, once every step is done: the engine's numbers. Null while they are not known. */
  found: (c: StoryCtx) => Found | null
  hint: string
  /** One short sentence to remember. */
  lesson: string
}

const H = 3_600_000
const pct = (v: number) => `${Math.round(v)} %`
const deg = (v: number) => `${v.toFixed(1)}°`
/** A duration as people say it: hours below two days, whole days above. */
export const dur = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`)
const same = (a: Selection | null, b: Selection) =>
  !!a && (a.kind === 'site' ? b.kind === 'site' && a.id === b.id : b.kind === 'point' && a.lat === b.lat && a.lon === b.lon)

export const APOLLO11 = 'apollo-11'
export const CHANDRAYAAN3 = 'chandrayaan-3'
export const IM2 = 'im-2'
export const MALAPERT = 'mons-malapert'
export const SHACKLETON = 'shackleton'
export const FAUSTINI = 'faustini'

/** Eagle's touchdown, from data/sites.json (NASA Apollo Lunar Surface Journal). */
export const APOLLO11_LANDING_MS = Date.parse('1969-07-20T20:17:39Z')
/** Athena's landing day (sites.json gives the date only): noon UTC stands for "that day". */
export const IM2_LANDING_DAY_MS = Date.parse('2025-03-06T12:00:00Z')

export const CHAPTERS: Chapter[] = [
  {
    id: 'apollo-11',
    tag: '1969 · Apollo 11',
    title: 'Land in the morning',
    where: 'Sea of Tranquillity',
    when: '20 July 1969',
    story: [
      'Eagle landed here in the local morning.',
      'NASA timed every Apollo landing for a low Sun behind the lander.',
      'No glare for the pilots, and long shadows that show every bump.',
    ],
    source: { label: 'NASA SP-4214', url: 'https://www.nasa.gov/wp-content/uploads/static/history/SP-4214/ch6-2.html' },
    scene: { site: APOLLO11, atMs: APOLLO11_LANDING_MS, view: 'ground', lookAway: true },
    hint: 'Drag the world sideways until the golden ball comes into view.',
    lesson: 'Low Sun, long shadows: you can see the shape of the ground.',
    steps: (c) => [{ text: 'Turn around and find the Sun', done: c.view === 'ground' && c.sunOnScreen }],
    question: {
      text: 'How high was the Sun when Eagle touched down?',
      choices: [
        { id: 'low', label: 'Low, under 20°' },
        { id: 'high', label: 'High, over 45°' },
      ],
      answer: (c) => (c.memory.startSunEl === null ? null : c.memory.startSunEl < 20 ? 'low' : c.memory.startSunEl > 45 ? 'high' : null),
    },
    found: (c) =>
      c.memory.startSunEl === null
        ? null
        : { stats: [{ value: deg(c.memory.startSunEl), label: 'Sun height at touchdown, 20:17 UTC' }], note: 'Look how long the shadows of the cubes are.' },
  },
  {
    id: 'chandrayaan-3',
    tag: '2023 · Chandrayaan-3',
    title: 'One lunar day',
    where: '69° S, near the south pole',
    when: '23 August 2023',
    story: ['India’s lander touched down at sunrise.', 'It worked while the Sun was up.', 'It went to sleep before the night and never woke up.'],
    note: 'Our Sun tables start in 2025, so you replay a sunrise here in our own years.',
    source: { label: 'ISRO', url: 'https://www.isro.gov.in/Chandrayaan3_Details.html' },
    scene: { site: CHANDRAYAAN3, view: 'ground', atSunrise: true, speed: '1d' },
    hint: 'The play button at the bottom makes the days go by. It stops by itself at sunset.',
    lesson: 'Away from the poles: about two weeks of light, then two weeks of night.',
    steps: (c) => [
      { text: 'Press play', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= H },
      { text: 'Watch until the Sun sets', done: c.memory.targetMs !== null && c.tMs >= c.memory.targetMs },
    ],
    found: (c) => {
      const { startTMs, targetMs } = c.memory
      const stats: Stat[] = []
      if (startTMs !== null && targetMs !== null) stats.push({ value: `${((targetMs - startTMs) / (24 * H)).toFixed(1)} days`, label: 'of sunlight' })
      if (c.metrics) stats.push({ value: dur(c.metrics.longestDarkH), label: 'longest night' })
      return stats.length ? { stats, note: 'A lander must sleep through the cold night or carry a lot of stored energy.' } : null
    },
  },
  {
    id: 'im-2',
    tag: '2025 · IM-2 Athena',
    title: 'The Sun skims the ground',
    where: 'Mons Mouton, 158 km from the pole',
    when: '6 March 2025',
    story: ['Athena landed on its side in a small crater.', 'The Sun was low and its panels faced the wrong way.', 'The batteries ran out the next day.'],
    source: {
      label: 'Spaceflight Now',
      url: 'https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/',
    },
    scene: { site: IM2, atMs: IM2_LANDING_DAY_MS, view: 'ground', lookAway: true, speed: '6h' },
    hint: 'Find the golden ball first, then press play and watch where it goes.',
    lesson: 'Near the poles the Sun stays low: a slope or a crater wall decides light or dark.',
    steps: (c) => [
      { text: 'Find the Sun', done: c.view === 'ground' && c.sunOnScreen },
      { text: 'Play one Earth day and watch it move', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= 24 * H },
    ],
    question: {
      text: 'Near the pole, how does the Sun move?',
      choices: [
        { id: 'around', label: 'It slides along the horizon' },
        { id: 'over', label: 'It climbs high and sets' },
      ],
      answer: (c) => (c.sunElMax === null ? null : c.sunElMax < 15 ? 'around' : 'over'),
    },
    found: (c) =>
      c.sunElMax === null
        ? null
        : {
            stats: [{ value: deg(c.sunElMax), label: `highest Sun in ${c.windowDays} days` }],
            note: 'The Sun circles close to the horizon: a crater wall, or a lander on its side, loses it.',
          },
  },
  {
    id: 'light-ice',
    tag: 'Artemis · south pole',
    title: 'Peaks of light, craters of ice',
    where: 'Mons Malapert and Shackleton crater',
    when: 'Now',
    story: [
      'Artemis aims for ridges and crater rims near the south pole.',
      'The deep crater floors next to them never see the Sun.',
      'In 2009 NASA’s LCROSS hit one, Cabeus, and found water.',
    ],
    source: { label: 'NASA, LCROSS', url: 'https://science.nasa.gov/mission/lcross/' },
    scene: { site: MALAPERT, view: 'ground' },
    hint: 'Type “Shackleton” in the search box at the top left. The Sun row at the bottom shows each day.',
    lesson: 'Peaks catch the low Sun; dark crater floors keep the ice.',
    steps: (c) => [
      { text: 'Look at the Sun row on Mons Malapert, a mountain', done: MALAPERT in c.memory.visited },
      { text: 'Search for Shackleton crater and look again', done: SHACKLETON in c.memory.visited },
    ],
    question: {
      text: 'Which one gets more sunlight?',
      choices: [
        { id: MALAPERT, label: 'The mountain' },
        { id: SHACKLETON, label: 'The crater floor' },
      ],
      answer: (c) => {
        const a = c.memory.visited[MALAPERT]
        const b = c.memory.visited[SHACKLETON]
        return a && b ? (a.sunPct >= b.sunPct ? MALAPERT : SHACKLETON) : null
      },
    },
    found: (c) => {
      const a = c.memory.visited[MALAPERT]
      const b = c.memory.visited[SHACKLETON]
      if (!a || !b) return null
      return {
        stats: [
          { value: pct(a.sunPct), label: `${c.names(MALAPERT)} sunlit` },
          { value: pct(b.sunPct), label: `${c.names(SHACKLETON)} sunlit` },
        ],
        note: `Over ${c.windowDays} days, with the real LOLA skyline.`,
      }
    },
  },
  {
    id: 'call-home',
    tag: 'Every mission',
    title: 'Calling home',
    where: 'Faustini crater, near the pole',
    when: 'Now',
    story: ['Every lander must send its data home.', 'Radio needs the Earth above the skyline.', 'The Earth wobbles a little in the sky, so hills can hide it.'],
    source: { label: 'NASA SVS, Moon libration', url: 'https://svs.gsfc.nasa.gov/5588' },
    scene: { site: FAUSTINI, view: 'ground', speed: '1d' },
    hint: 'The Earth is the blue ball. Then press play, or click a dark block in the Earth row.',
    lesson: 'No Earth in the sky, no direct call home.',
    steps: (c) => {
      const never = c.metrics !== null && c.metrics.commsPct >= 99.9
      return [
        { text: 'Find the Earth (the blue ball)', done: c.view === 'ground' && c.earthOnScreen },
        {
          text: never ? 'The Earth never hides here. Search another crater, then play until “Can we see Earth?” says No' : 'Play until “Can we see Earth?” says No',
          done: c.earthContact === false,
        },
      ]
    },
    found: (c) =>
      c.metrics
        ? {
            stats: [
              { value: pct(c.metrics.commsPct), label: 'of the time the Earth is in view' },
              { value: dur(c.metrics.longestBlackoutH), label: 'longest wait for the Earth' },
            ],
            note: 'Right now the Earth is behind the hills: no direct call.',
          }
        : null,
  },
  {
    id: 'yours',
    tag: 'Your mission',
    title: 'Plan a landing',
    where: 'Anywhere you like',
    when: 'You choose',
    story: ['Launch dates slip, and every new date changes the sky.', 'Now you are the planner.'],
    source: { label: 'NASA Space Apps 2026', url: 'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/' },
    scene: { view: 'moon' },
    hint: 'Search a place or click one on the Whole Moon. Change the date with the date button, or click a day block.',
    lesson: 'Check the Sun, the Earth and the ground for every date, and again when it slips.',
    steps: (c) => {
      const moved = c.memory.startSel !== null && !same(c.memory.startSel, c.selection)
      return [
        { text: 'Pick a new place', done: moved },
        { text: 'Pick a time: Sun up, Earth in view', done: moved && c.sunUp === true && c.earthContact === true },
        { text: 'Press “Stand here” and look around', done: moved && c.view === 'ground' },
      ]
    },
    found: (c) => {
      const m = c.metrics
      const where = c.placeName ?? 'Your place'
      const skyline =
        c.horizonKind === 'smooth_sphere'
          ? 'No real skyline here yet: the Moon is taken as smooth, so real hills could make it better or worse.'
          : 'Real LOLA skyline.'
      return {
        stats: m
          ? [
              { value: pct(m.sunlightPct), label: 'Sun' },
              { value: pct(m.commsPct), label: 'Earth in view' },
              { value: dur(m.longestDarkH), label: 'longest night' },
              { value: dur(m.longestBlackoutH), label: 'longest wait for Earth' },
            ]
          : [],
        note: `${where}: ready for landing. Next ${c.windowDays} days. ${skyline}`,
      }
    },
  },
]

/**
 * The first sunrise in a sunlit series and the sunset that ends that day, as sample indices. A sunset is the start
 * of a dark spell of at least `minDarkMs`, so the Sun grazing the skyline at dawn (in and out of view for an hour
 * or two over real terrain) does not count as night. Null when the window holds no such day.
 */
export function firstDay(t: number[], lit: boolean[], minDarkMs = 24 * H): { rise: number; set: number } | null {
  const rise = lit.findIndex((v, i) => i > 0 && v && !lit[i - 1])
  if (rise < 0) return null
  for (let j = rise + 1; j < lit.length; j++) {
    if (lit[j]) continue
    let k = j
    while (k < lit.length && !lit[k]) k++
    // a dark spell that runs past the end of the window counts if it is already long enough
    if (k === lit.length ? t[k - 1] - t[j] >= minDarkMs : t[k] - t[j] >= minDarkMs) return { rise, set: j }
    j = k
  }
  return null
}

/** The chapter's steps, a step counting as done once it has been reached (latched) during the chapter. */
export function stepsOf(ch: Chapter, c: StoryCtx): Step[] {
  return ch.steps(c).map((s, i) => ({ ...s, done: s.done || c.memory.latched.includes(i) }))
}

/** True when the steps are done and, if there is a question, it has been answered. */
export function chapterDone(ch: Chapter, c: StoryCtx): boolean {
  return stepsOf(ch, c).every((s) => s.done) && (!ch.question || c.memory.answer !== null)
}

/** Whether the question can be asked yet (its steps done and its answer computable). */
export function questionReady(ch: Chapter, c: StoryCtx): boolean {
  return !!ch.question && stepsOf(ch, c).every((s) => s.done) && ch.question.answer(c) !== null
}
