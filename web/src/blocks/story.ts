/**
 * Block Moon's mission log: six short chapters built on real Moon missions, for learners and the public. Each
 * chapter puts the world where a real mission was (place and date), tells what happened there in two or three
 * sentences with its source, gives a task done in the tool (find the Sun, play the days, compare two places), and
 * answers with the engine's own numbers: the same JPL tables and LOLA horizons as the planner, never a typed value.
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

export interface Chapter {
  id: string
  /** Year or programme, shown above the title. */
  tag: string
  title: string
  /** What happened, two or three sentences. */
  fact: (c: StoryCtx) => string
  source: { label: string; url: string }
  scene: Scene
  steps: (c: StoryCtx) => Step[]
  /** A question to answer once the steps before it are done. */
  question?: { text: string; choices: { id: string; label: string }[]; answer: (c: StoryCtx) => string | null }
  /** What the learner found, once every step is done: the engine's numbers. */
  found: (c: StoryCtx) => string
  hint: string
  /** One sentence to remember. */
  lesson: string
}

const H = 3_600_000
const pct = (v: number) => `${Math.round(v)} %`
const deg = (v: number) => `${v.toFixed(1)}°`
const hours = (h: number) => (h >= 48 ? `${Math.round(h)} hours (about ${Math.round(h / 24)} days)` : `${Math.round(h)} hours`)
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
    fact: () =>
      'On 20 July 1969 the Eagle landed in the Sea of Tranquillity. NASA picked each Apollo launch time so the lander arrived in the local morning, with the Sun low behind it: no glare in the pilots’ eyes, and long shadows that show every bump and crater.',
    source: { label: 'NASA SP-4214, Mission and science planning', url: 'https://www.nasa.gov/wp-content/uploads/static/history/SP-4214/ch6-2.html' },
    scene: { site: APOLLO11, atMs: APOLLO11_LANDING_MS, view: 'ground', lookAway: true },
    hint: 'Drag the world sideways until the golden ball comes into view.',
    lesson: 'A low Sun throws long shadows, and long shadows show the shape of the ground.',
    steps: (c) => [{ text: 'You are standing where Eagle landed. Turn around and find the Sun', done: c.view === 'ground' && c.sunOnScreen }],
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
        ? ''
        : `At 20:17 UTC the engine puts the Sun ${deg(c.memory.startSunEl)} above the horizon, from the same JPL tables the planner uses. Look how long the cubes’ shadows are.`,
  },
  {
    id: 'chandrayaan-3',
    tag: '2023 · Chandrayaan-3',
    title: 'One lunar day',
    fact: () =>
      'India’s Chandrayaan-3 landed here, 69° south, on 23 August 2023, early in the local day. It worked while the Sun was up, went to sleep on 2–4 September before the night came, and never woke up. Our Sun tables do not reach 2023, so we start at a sunrise here in our own years.',
    source: { label: 'ISRO, Chandrayaan-3 updates', url: 'https://www.isro.gov.in/Chandrayaan3_Details.html' },
    scene: { site: CHANDRAYAAN3, view: 'ground', atSunrise: true, speed: '1d' },
    hint: 'The play button at the bottom makes the days go by. It stops by itself at sunset.',
    lesson: 'Away from the poles, a lunar day is about two weeks of sunlight followed by about two weeks of night.',
    steps: (c) => [
      { text: 'Play the days', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= H },
      { text: 'Keep going until the Sun sets', done: c.memory.targetMs !== null && c.tMs >= c.memory.targetMs },
    ],
    found: (c) => {
      const { startTMs, targetMs } = c.memory
      const days = startTMs !== null && targetMs !== null ? (targetMs - startTMs) / (24 * H) : null
      const night = c.metrics ? ` The longest night in this window lasts ${hours(c.metrics.longestDarkH)}.` : ''
      return `Sunset, after ${days !== null ? `about ${days.toFixed(1)} Earth days` : 'many days'} of sunlight.${night} A whole lunar day, sunrise to sunrise, is about 29.5 Earth days: a lander must either sleep through the cold night or carry a lot of stored energy.`
    },
  },
  {
    id: 'im-2',
    tag: '2025 · IM-2 Athena',
    title: 'The Sun skims the ground',
    fact: () =>
      'On 6 March 2025 Athena landed on Mons Mouton, 158 km from the south pole, but came to rest on its side inside a small crater. With the Sun this low and its solar panels facing the wrong way, its batteries could not recharge, and the mission ended the next day.',
    source: {
      label: 'Spaceflight Now, 7 March 2025',
      url: 'https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/',
    },
    scene: { site: IM2, atMs: IM2_LANDING_DAY_MS, view: 'ground', lookAway: true, speed: '6h' },
    hint: 'Find the golden ball first, then press play and watch where it goes.',
    lesson: 'Near the poles the Sun stays a few degrees above the horizon, so a slope or a crater wall decides light or dark.',
    steps: (c) => [
      { text: 'You are at Athena’s planned landing site. Find the Sun', done: c.view === 'ground' && c.sunOnScreen },
      { text: 'Play at least one Earth day and watch the Sun move', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= 24 * H },
    ],
    question: {
      text: 'Near the pole, how does the Sun move through the day?',
      choices: [
        { id: 'around', label: 'It slides along the horizon' },
        { id: 'over', label: 'It climbs high and sets' },
      ],
      answer: (c) => (c.sunElMax === null ? null : c.sunElMax < 15 ? 'around' : 'over'),
    },
    found: (c) =>
      c.sunElMax === null
        ? ''
        : `Over the next ${c.windowDays} days the Sun never climbs higher than ${deg(c.sunElMax)} here (engine). It circles the sky close to the horizon, so a crater wall, or a lander lying on its side, is enough to lose it.`,
  },
  {
    id: 'light-ice',
    tag: 'Artemis · south pole',
    title: 'Peaks of light, craters of ice',
    fact: () =>
      'NASA’s candidate regions for the first Artemis crewed landing are on ridges and crater rims near the south pole, such as Malapert Massif and the peak near Shackleton. The floors of the deep craters next to them never see the Sun: in 2009 NASA’s LCROSS probe crashed into one, Cabeus, and found water in the plume.',
    source: { label: 'NASA, LCROSS mission', url: 'https://science.nasa.gov/mission/lcross/' },
    scene: { site: MALAPERT, view: 'ground' },
    hint: 'Type “Shackleton” in the search box at the top left. The Sun row at the bottom shows each day.',
    lesson: 'Mountain tops catch the low Sun; deep crater floors near the pole stay dark and cold, and that is where ice can last.',
    steps: (c) => [
      { text: 'Look at the Sun row for Mons Malapert, a mountain', done: MALAPERT in c.memory.visited },
      { text: 'Use the search to go to Shackleton crater', done: SHACKLETON in c.memory.visited },
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
      if (!a || !b) return ''
      return `Over these ${c.windowDays} days the mountain (${c.names(MALAPERT)}) is sunlit ${pct(a.sunPct)} of the time and the crater (${c.names(SHACKLETON)}) ${pct(b.sunPct)}, measured over the real LOLA skyline. Mountain tops poke up into the low sunlight; the crater floor sits below its own walls.`
    },
  },
  {
    id: 'call-home',
    tag: 'Every mission',
    title: 'Calling home',
    fact: () =>
      'Every lander has to send its data home. Radio travels in straight lines, so a direct call needs the Earth above the skyline. From the Moon the Earth hardly moves in the sky, but it wobbles a little (libration), and near the pole that is enough to hide it behind the hills.',
    source: { label: 'NASA SVS, Moon Phase and Libration 2026 (south up)', url: 'https://svs.gsfc.nasa.gov/5588' },
    scene: { site: FAUSTINI, view: 'ground', speed: '1d' },
    hint: 'The Earth is the blue ball. Then press play, or click a dark block in the Earth row.',
    lesson: 'No Earth in the sky means no direct call home: a mission waits, or relays through a satellite.',
    steps: (c) => {
      const never = c.metrics !== null && c.metrics.commsPct >= 99.9
      return [
        { text: 'Find the Earth', done: c.view === 'ground' && c.earthOnScreen },
        {
          text: never
            ? 'Here the Earth never hides in this window. Search for another crater, then make time go by until “Can we see Earth?” says No'
            : 'Make time go by until “Can we see Earth?” says No',
          done: c.earthContact === false,
        },
      ]
    },
    found: (c) => {
      const gap = c.metrics ? ` The longest wait without the Earth here in this window: ${hours(c.metrics.longestBlackoutH)}.` : ''
      return `The Earth is behind the hills: no direct call now.${gap} Over the window, the Earth is in view ${c.metrics ? pct(c.metrics.commsPct) : 'part'} of the time from this spot.`
    },
  },
  {
    id: 'yours',
    tag: 'Your mission',
    title: 'Plan a landing',
    fact: () =>
      'Launch dates slip all the time, and every new date changes the sky. Now you are the planner: choose a place and a landing time when the Sun is up and the Earth is in view, then stand there and check the skyline.',
    source: { label: 'NASA Space Apps 2026, Lunar Landing Site Navigator', url: 'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/' },
    scene: { view: 'moon' },
    hint: 'Search a place or click one on the Whole Moon. Change the date with the date button, or click a day block.',
    lesson: 'Planners check the Sun, the Earth and the ground for every date, and check again when the date slips.',
    steps: (c) => {
      const moved = c.memory.startSel !== null && !same(c.memory.startSel, c.selection)
      return [
        { text: 'Choose a new place (search, or click the Whole Moon)', done: moved },
        { text: 'Choose a time with the Sun up and the Earth in view', done: moved && c.sunUp === true && c.earthContact === true },
        { text: 'Stand there and look at the skyline', done: moved && c.view === 'ground' },
      ]
    },
    found: (c) => {
      const m = c.metrics
      const where = c.placeName ?? 'Your place'
      const nums = m
        ? ` Over the next ${c.windowDays} days: Sun ${pct(m.sunlightPct)} of the time, Earth ${pct(m.commsPct)}, longest night ${hours(m.longestDarkH)}, longest wait for Earth ${hours(m.longestBlackoutH)}.`
        : ''
      const caveat =
        c.horizonKind === 'smooth_sphere'
          ? ' Nobody has computed the real skyline here yet, so these answers treat the Moon as smooth: real hills could make them better or worse.'
          : ' These answers use the real LOLA skyline.'
      return `${where}: ready for landing.${nums}${caveat}`
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
