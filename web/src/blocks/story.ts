/**
 * Learn mode's mission log: six short chapters built on real Moon missions, written for children. Each
 * chapter puts the world where a real mission was (place and date), tells what happened in a few one-line facts
 * with their source, gives a task done in the tool (find the Sun, play the days, compare two places), and answers
 * with a few big numbers from the engine: the same JPL tables and LOLA horizons as the planner, never a typed value.
 * Text is kept short and simple on purpose: one idea per line, plain words, no jargon, numbers as tiles
 * (days rather than percentages), no paragraphs.
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
const deg = (v: number) => `${v.toFixed(1)}°`
/** A whole number of days or hours, said the way a child would read it aloud. */
const count = (n: number, unit: 'day' | 'hour') => `${n} ${unit}${n === 1 ? '' : 's'}`
/** A duration as people say it: hours below two days, whole days above. */
export const dur = (h: number) => (h >= 48 ? count(Math.round(h / 24), 'day') : count(Math.round(h), 'hour'))
/** A share of the window told as days out of the window ("21 days" out of 30): easier for children than a percentage. */
export const daysOf = (pctOfTime: number, windowDays: number) => count(Math.round((pctOfTime / 100) * windowDays), 'day')
const same = (a: Selection | null, b: Selection) =>
  !!a && (a.kind === 'site' ? b.kind === 'site' && a.id === b.id : b.kind === 'point' && a.lat === b.lat && a.lon === b.lon)

export const APOLLO11 = 'apollo-11'
export const CHANDRAYAAN3 = 'chandrayaan-3'
export const IM2 = 'im-2'
export const MALAPERT = 'mons-malapert'
export const SHACKLETON = 'shackleton'
export const NOBILE = 'nobile'

/** Eagle's touchdown, from data/sites.json (NASA Apollo Lunar Surface Journal). */
export const APOLLO11_LANDING_MS = Date.parse('1969-07-20T20:17:39Z')
/** Athena's landing day (sites.json gives the date only): noon UTC stands for "that day". */
export const IM2_LANDING_DAY_MS = Date.parse('2025-03-06T12:00:00Z')
/**
 * A moment when the Earth is up over Nobile crater and sets about five days later (engine, LOLA horizon, 2 m mast:
 * Earth 8.2° high at the start, in view 2027-02-10T22Z to 2027-02-16T22Z, Sun up too). Craters such as Faustini,
 * Shackleton or Cabeus never see the Earth at all, so the chapter needs a place and a date where it comes and goes.
 */
export const NOBILE_EARTH_UP_MS = Date.parse('2027-02-12T00:00:00Z')

export const CHAPTERS: Chapter[] = [
  {
    id: 'apollo-11',
    tag: '1969 · Apollo 11',
    title: 'Land in the morning',
    where: 'Sea of Tranquillity',
    when: '20 July 1969',
    story: [
      'The first astronauts on the Moon landed right here!',
      'NASA picked a morning landing, with the Sun low behind them.',
      'So the Sun was not in their eyes, and shadows showed every rock.',
    ],
    source: { label: 'NASA SP-4214', url: 'https://www.nasa.gov/wp-content/uploads/static/history/SP-4214/ch6-2.html' },
    scene: { site: APOLLO11, atMs: APOLLO11_LANDING_MS, view: 'ground', lookAway: true },
    hint: 'Drag the picture sideways until you see the golden ball.',
    lesson: 'A low Sun makes long shadows, and shadows show the shape of the ground.',
    steps: (c) => [{ text: 'Turn around and find the Sun (the golden ball)', done: c.view === 'ground' && c.sunOnScreen }],
    question: {
      text: 'Was the Sun high or low when they landed?',
      choices: [
        { id: 'low', label: 'Low, near the ground' },
        { id: 'high', label: 'High, above their heads' },
      ],
      answer: (c) => (c.memory.startSunEl === null ? null : c.memory.startSunEl < 20 ? 'low' : c.memory.startSunEl > 45 ? 'high' : null),
    },
    found: (c) =>
      c.memory.startSunEl === null
        ? null
        : {
            stats: [{ value: deg(c.memory.startSunEl), label: 'how high the Sun was (0° is the ground, 90° is straight up)' }],
            note: 'Low Sun, long shadows. Look at the shadows of the cubes!',
          },
  },
  {
    id: 'chandrayaan-3',
    tag: '2023 · Chandrayaan-3',
    title: 'A very long day',
    where: 'Near the South Pole',
    when: '23 August 2023',
    story: ['India’s robot lander touched down here at sunrise.', 'It worked hard while the Sun was shining.', 'When night came it went to sleep, and never woke up.'],
    note: 'Our Sun data starts in 2025, so we replay a sunrise from our own time.',
    source: { label: 'ISRO', url: 'https://www.isro.gov.in/Chandrayaan3_Details.html' },
    scene: { site: CHANDRAYAAN3, view: 'ground', atSunrise: true, speed: '1d' },
    hint: 'Press the play button at the bottom. It stops by itself when the Sun goes down.',
    lesson: 'A Moon day lasts about two weeks, and so does a Moon night.',
    steps: (c) => [
      { text: 'Press play', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= H },
      { text: 'Watch until the Sun goes down', done: c.memory.targetMs !== null && c.tMs >= c.memory.targetMs },
    ],
    found: (c) => {
      const { startTMs, targetMs } = c.memory
      const stats: Stat[] = []
      if (startTMs !== null && targetMs !== null) stats.push({ value: `${((targetMs - startTMs) / (24 * H)).toFixed(1)} days`, label: 'of sunshine, from sunrise to sunset' })
      if (c.metrics) stats.push({ value: dur(c.metrics.longestDarkH), label: 'of night, the longest one' })
      return stats.length ? { stats, note: 'Moon nights are colder than any freezer. A robot has to stay warm until morning.' } : null
    },
  },
  {
    id: 'im-2',
    tag: '2025 · IM-2 Athena',
    title: 'The Sun that stays low',
    where: 'Mons Mouton, near the South Pole',
    when: '6 March 2025',
    story: ['The lander Athena landed here, but it tipped over.', 'Here the Sun is always low, and its solar panels faced away.', 'Its batteries could not charge, so it stopped the next day.'],
    source: {
      label: 'Spaceflight Now',
      url: 'https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/',
    },
    scene: { site: IM2, atMs: IM2_LANDING_DAY_MS, view: 'ground', lookAway: true, speed: '6h' },
    hint: 'First find the golden ball. Then press play and watch where it goes.',
    lesson: 'Near the poles the Sun stays low, so a hill can hide it.',
    steps: (c) => [
      { text: 'Find the Sun', done: c.view === 'ground' && c.sunOnScreen },
      { text: 'Press play and watch the Sun for a whole day', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= 24 * H },
    ],
    question: {
      text: 'How does the Sun move here?',
      choices: [
        { id: 'around', label: 'It goes around, close to the ground' },
        { id: 'over', label: 'It climbs up high, then sets' },
      ],
      answer: (c) => (c.sunElMax === null ? null : c.sunElMax < 15 ? 'around' : 'over'),
    },
    found: (c) =>
      c.sunElMax === null
        ? null
        : {
            stats: [{ value: deg(c.sunElMax), label: `the highest the Sun gets in ${c.windowDays} days (90° is straight up)` }],
            note: 'The Sun goes round and round, close to the ground. A hill, or a tipped-over lander, can block it.',
          },
  },
  {
    id: 'light-ice',
    tag: 'Artemis · South Pole',
    title: 'Sunny mountains, icy craters',
    where: 'Mons Malapert and Shackleton crater',
    when: 'Today',
    story: [
      'NASA’s Artemis astronauts may land on hills near the South Pole.',
      'Next to them are deep craters where the Sun never shines.',
      'In 2009 a NASA probe crashed into one on purpose and found water!',
    ],
    source: { label: 'NASA, LCROSS', url: 'https://science.nasa.gov/mission/lcross/' },
    scene: { site: MALAPERT, view: 'ground' },
    hint: 'Type “Shackleton” in the search box at the top left. The Sun row at the bottom shows each day.',
    lesson: 'Mountains catch the Sun, and dark craters keep the ice.',
    steps: (c) => [
      { text: 'Look at the Sun row at the bottom: this is a mountain', done: MALAPERT in c.memory.visited },
      { text: 'Now search for Shackleton crater and look again', done: SHACKLETON in c.memory.visited },
    ],
    question: {
      text: 'Which one gets more sunshine?',
      choices: [
        { id: MALAPERT, label: 'The mountain' },
        { id: SHACKLETON, label: 'The crater' },
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
          { value: daysOf(a.sunPct, c.windowDays), label: `of sunshine on ${c.names(MALAPERT)}, out of ${c.windowDays}` },
          { value: daysOf(b.sunPct, c.windowDays), label: `of sunshine in ${c.names(SHACKLETON)}, out of ${c.windowDays}` },
        ],
        note: 'Mountains poke up into the sunshine. Deep craters stay dark and freezing, so ice can last there.',
      }
    },
  },
  {
    id: 'call-home',
    tag: 'Every mission',
    title: 'Phone home',
    where: 'Nobile crater, near the South Pole',
    when: '12 February 2027',
    story: ['Every lander needs to talk to Earth.', 'Radio only works if the Earth is above the hills.', 'The Earth wobbles a little in the sky, so hills can hide it.'],
    source: { label: 'NASA SVS, Moon libration', url: 'https://svs.gsfc.nasa.gov/5588' },
    scene: { site: NOBILE, atMs: NOBILE_EARTH_UP_MS, view: 'ground', speed: '1d' },
    hint: 'The Earth is the blue ball. Then press play, or click a dark block in the Earth row.',
    lesson: 'No Earth in the sky means no call home.',
    steps: (c) => {
      const never = c.metrics !== null && c.metrics.commsPct >= 99.9
      return [
        { text: 'Find the Earth (the blue ball)', done: c.view === 'ground' && c.earthOnScreen },
        {
          text: never ? 'The Earth never hides here! Search for another crater, then press play until “Can we see Earth?” says No' : 'Press play until “Can we see Earth?” says No',
          done: c.earthContact === false,
        },
      ]
    },
    found: (c) =>
      c.metrics
        ? {
            stats: [
              { value: daysOf(c.metrics.commsPct, c.windowDays), label: `with the Earth in view, out of ${c.windowDays}` },
              { value: dur(c.metrics.longestBlackoutH), label: 'the longest time with no call home' },
            ],
            note: 'Right now the Earth is behind the hills: no calling home!',
          }
        : null,
  },
  {
    id: 'yours',
    tag: 'Your mission',
    title: 'Your turn: plan a landing',
    where: 'Anywhere you like',
    when: 'You choose',
    story: ['Now you are the mission planner!', 'Find a place and a time with the Sun up and the Earth in view.'],
    source: { label: 'NASA Space Apps 2026', url: 'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/' },
    scene: { view: 'moon' },
    hint: 'Search for a place, or click one on the Whole Moon. Click a day block to change the day.',
    lesson: 'Mission planners check the Sun, the Earth and the ground for every date.',
    steps: (c) => {
      const moved = c.memory.startSel !== null && !same(c.memory.startSel, c.selection)
      return [
        { text: 'Pick a new place', done: moved },
        { text: 'Pick a time with the Sun up and the Earth in view', done: moved && c.sunUp === true && c.earthContact === true },
        { text: 'Press “Stand here” and look around', done: moved && c.view === 'ground' },
      ]
    },
    found: (c) => {
      const m = c.metrics
      const where = c.placeName ?? 'Your place'
      const hills =
        c.horizonKind === 'smooth_sphere'
          ? 'Nobody has mapped the hills here yet, so real hills could change these numbers.'
          : 'These numbers use the real hills, measured by NASA’s LRO spacecraft.'
      return {
        stats: m
          ? [
              { value: daysOf(m.sunlightPct, c.windowDays), label: `of sunshine, out of ${c.windowDays}` },
              { value: daysOf(m.commsPct, c.windowDays), label: `with the Earth in view, out of ${c.windowDays}` },
              { value: dur(m.longestDarkH), label: 'the longest night' },
              { value: dur(m.longestBlackoutH), label: 'the longest time with no call home' },
            ]
          : [],
        note: `${where}: ready to land! ${hills}`,
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
