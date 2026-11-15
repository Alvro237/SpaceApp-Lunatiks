/**
 * Educational mode's missions: twelve short missions built on real Moon missions, written for children, in three
 * groups (the Sun, the Earth, exploring). Each one puts the world where a real mission was (place and date), tells
 * what happened in a few one-line facts with their source, gives a task done in the tool (find the Sun, play the
 * days, fly to another place), asks one question, and answers with a few big numbers from the engine: the same JPL
 * tables and LOLA horizons as the planner, never a typed value.
 * Text is kept short and simple on purpose: one idea per line, plain words, no jargon, numbers as tiles
 * (days rather than percentages), no paragraphs. Every step carries its own tip, and where the tool can do the
 * step's action for the child (play, fly to a place, stand on the ground) the step carries that action, so the card
 * shows one big button instead of sending the child to look for a control.
 *
 * Facts and their sources (also in docs/references.md):
 *   - Apollo: sun elevation at landing drove the launch time; landings near the sunrise terminator put the Sun
 *     behind the lander (no glare) and lit the surface work. NASA SP-4214, ch. 6.
 *   - Apollo 17: landed 11 December 1972 in the Taurus-Littrow valley, three days on the surface with a rover (NASA).
 *   - Chandrayaan-3: landed 23 August 2023 near 69.4° S; rover asleep 2 September, lander 4 September; no signal
 *     after the next sunrise (ISRO, 22 September 2023).
 *   - SLIM: landed 19 January 2024 (15:20 UTC) off its planned attitude, with its solar cells facing west and
 *     generating nothing (JAXA, 25 January 2024); power returned on 28 January (NBC News).
 *   - IM-1 Odysseus: landed 22 February 2024 near Malapert A and returned science data for about a week (NASA).
 *   - IM-2 Athena: landed 6 March 2025 on Mons Mouton, on its side in a crater; with the low Sun and the panels'
 *     orientation the batteries could not recharge, and the mission ended on 7 March (Spaceflight Now, 7 March 2025).
 *   - Blue Ghost Mission 1: landed 2 March 2025 in Mare Crisium, worked for a lunar day and photographed the Earth
 *     covering the Sun on 14 March 2025, about 2 h 16 min of totality (Firefly Aerospace; NASA).
 *   - LCROSS: impact in Cabeus crater on 9 October 2009, water found in the plume (Colaprete et al. 2010).
 *   - Artemis III candidate regions on rims and ridges near the south pole, and the Artemis Base Camp concept (NASA).
 * Pure functions over a context, so every mission is testable.
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
  /** Earth elevation when the scene was set, degrees. */
  startEarthEl: number | null
  startSel: Selection | null
  /**
   * The moment the chapter waits for, from the engine's series: the sunset after the sunrise it starts at, or the
   * middle of the eclipse.
   */
  targetMs: number | null
  /** Hours the Earth covers the whole Sun, and any part of it, in the eclipse the chapter waits for. */
  eclipse: { totalH: number; anyH: number } | null
  /** Sunlight and Earth contact over the window, recorded when the learner opens a catalogue site. */
  visited: Record<string, { sunPct: number; earthPct: number }>
  /** The right answer, once the learner has picked it. */
  answer: string | null
  /** Wrong choices already tried: they are crossed out, and the learner tries again. */
  wrong: string[]
  /** Steps already reached in this chapter: they stay ticked even if the view moves on. */
  latched: number[]
}

export const EMPTY_MEMORY: StoryMemory = {
  startTMs: null,
  startSunUp: null,
  startSunEl: null,
  startEarthEl: null,
  startSel: null,
  targetMs: null,
  eclipse: null,
  visited: {},
  answer: null,
  wrong: [],
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
  /** 0 none, 1 partial, 2 total: the Earth covering the Sun now. */
  eclipse: number | null
  tMs: number
  windowDays: number
  metrics: StoryMetrics | null
  memory: StoryMemory
  names: (id: string) => string
}

/**
 * Something the card can do for the child, shown as one big button on the step:
 *   - `play`: start (or pause) the days;
 *   - `site`: fly to a catalogue place, instead of typing its name in the search box;
 *   - `view`: stand on the ground, or go back to the whole Moon;
 *   - `look`: nothing to do in the tool, the child looks and says "I see it!" (the step is ticked by that button).
 */
export type StepAction =
  | { kind: 'play' }
  | { kind: 'site'; id: string; label: string }
  | { kind: 'view'; view: BlockView; label: string }
  | { kind: 'look'; label: string }

export interface Step {
  text: string
  done: boolean
  /** How to do it, in one short line, shown while the step is the current one. */
  tip: string
  action?: StepAction
}

/** Where a chapter puts the world when it opens. */
export interface Scene {
  site?: string
  /** UTC instant, ms; the analysis window starts there. */
  atMs?: number
  view?: BlockView
  /** Turn the ground camera to look away from the Sun, so the learner has to find it. */
  lookAway?: boolean
  /** The body the task asks to find: the camera tips up so it fits in the picture (the Sun when `lookAway`). */
  find?: 'sun' | 'earth'
  /** Start the window at the first sunrise in it (once the place's series is known). */
  atSunrise?: boolean
  /** With `atSunrise`: start this many hours after that sunrise, when the Sun has cleared the skyline. */
  afterSunriseH?: number
  /** The chapter waits for the Earth to cover the Sun: the target is the middle of the first total eclipse. */
  until?: 'eclipse'
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

export type GroupId = 'sun' | 'earth' | 'explore'

/** The three shelves of the mission map, in order. `icon` is a MissionIcon id. */
export const GROUPS: { id: GroupId; title: string; blurb: string; icon: string }[] = [
  { id: 'sun', title: 'The Sun', blurb: 'Light, shadows and very long days', icon: 'chandrayaan-3' },
  { id: 'earth', title: 'The Earth', blurb: 'Calling home from the Moon', icon: 'call-home' },
  { id: 'explore', title: 'Explorer', blurb: 'Ice, a Moon base and your own landing', icon: 'yours' },
]

export interface Chapter {
  id: string
  group: GroupId
  /** Year or programme, shown above the title. */
  tag: string
  title: string
  /** One or two words under the mission's icon in the mission picker. */
  short: string
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
export const APOLLO17 = 'apollo-17'
export const CHANDRAYAAN3 = 'chandrayaan-3'
export const SLIM = 'slim'
export const IM1 = 'im-1'
export const IM2 = 'im-2'
export const BLUE_GHOST = 'blue-ghost-1'
export const MALAPERT = 'mons-malapert'
export const SHACKLETON = 'shackleton'
export const NOBILE = 'nobile'
export const CABEUS = 'cabeus'

/** Eagle's touchdown, from data/sites.json (NASA Apollo Lunar Surface Journal). */
export const APOLLO11_LANDING_MS = Date.parse('1969-07-20T20:17:39Z')
/** Challenger's touchdown, from data/sites.json (NASA Apollo Lunar Surface Journal). */
export const APOLLO17_LANDING_MS = Date.parse('1972-12-11T19:54:58Z')
/** Athena's landing day (sites.json gives the date only): noon UTC stands for "that day". */
export const IM2_LANDING_DAY_MS = Date.parse('2025-03-06T12:00:00Z')
/**
 * A moment when the Earth is up over Nobile crater and sets about five days later (engine, LOLA horizon, 2 m mast:
 * Earth 8.2° high at the start, in view 2027-02-10T22Z to 2027-02-16T22Z, Sun up too). Craters such as Faustini,
 * Shackleton or Cabeus never see the Earth at all, so the chapter needs a place and a date where it comes and goes.
 */
export const NOBILE_EARTH_UP_MS = Date.parse('2027-02-12T00:00:00Z')
/**
 * The evening before the Earth covered the Sun over Blue Ghost. Engine, at the catalogue point in Mare Crisium:
 * the Earth touches the Sun's disc at 2025-03-14T05:05Z, covers all of it from 06:20Z to 08:35Z and leaves it at
 * 09:55Z, with the Sun 29° above the horizon. At one hour a second the dark comes about nine seconds after play.
 */
export const BLUE_GHOST_ECLIPSE_EVE_MS = Date.parse('2025-03-13T22:00:00Z')

const PLAY: StepAction = { kind: 'play' }
const LOOK: StepAction = { kind: 'look', label: 'I see it!' }
const TO_SHACKLETON: StepAction = { kind: 'site', id: SHACKLETON, label: 'Fly to Shackleton crater' }
const DRAG_SUN = 'Drag the picture sideways until you see the golden ball.'
const NOT_OUR_YEARS = 'Our Sun and Earth data starts in 2025, so we look at the sky of today.'
/** Time played since the scene was set, hours (0 until the scene is set). */
const played = (c: StoryCtx) => (c.memory.startTMs === null ? 0 : Math.abs(c.tMs - c.memory.startTMs) / H)

export const CHAPTERS: Chapter[] = [
  // ------------------------------------------------------------------ the Sun
  {
    id: 'apollo-11',
    group: 'sun',
    tag: '1969 · Apollo 11',
    title: 'Land in the morning',
    short: 'Apollo 11',
    where: 'Sea of Tranquillity',
    when: '20 July 1969',
    story: [
      'The first astronauts on the Moon landed right here!',
      'NASA picked a morning landing, with the Sun low behind them.',
      'So the Sun was not in their eyes, and shadows showed every rock.',
    ],
    source: { label: 'NASA SP-4214', url: 'https://www.nasa.gov/wp-content/uploads/static/history/SP-4214/ch6-2.html' },
    scene: { site: APOLLO11, atMs: APOLLO11_LANDING_MS, view: 'ground', lookAway: true },
    lesson: 'A low Sun makes long shadows, and shadows show the shape of the ground.',
    steps: (c) => [{ text: 'Turn around and find the Sun', tip: DRAG_SUN, done: c.view === 'ground' && c.sunOnScreen }],
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
            stats: [{ value: deg(c.memory.startSunEl), label: 'how high the Sun was. Straight up is 90°, so that is low!' }],
            note: 'Low Sun, long shadows. Look at the shadows of the cubes!',
          },
  },
  {
    id: 'chandrayaan-3',
    group: 'sun',
    tag: '2023 · Chandrayaan-3',
    title: 'A very long day',
    short: 'Long day',
    where: 'Near the South Pole',
    when: '23 August 2023',
    story: ['India’s robot lander touched down here in the morning.', 'It worked hard while the Sun was shining.', 'When night came it went to sleep, and never woke up.'],
    note: 'Our Sun data starts in 2025, so we replay a sunrise from our own time.',
    source: { label: 'ISRO', url: 'https://www.isro.gov.in/Chandrayaan3_Details.html' },
    scene: { site: CHANDRAYAAN3, view: 'ground', atSunrise: true, speed: '1d' },
    lesson: 'A Moon day lasts about two weeks, and so does a Moon night.',
    steps: (c) => [
      { text: 'Press play', tip: 'One day goes by every second.', action: PLAY, done: played(c) >= 1 },
      { text: 'Watch until the Sun goes down', tip: 'It stops by itself at sunset. Watch the shadows move!', action: PLAY, done: c.memory.targetMs !== null && c.tMs >= c.memory.targetMs },
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
    id: 'slim',
    group: 'sun',
    tag: '2024 · SLIM',
    title: 'The sleepy lander',
    short: 'SLIM',
    where: 'Near Shioli crater',
    when: '19 January 2024',
    story: ['Japan’s little lander SLIM tipped over when it landed.', 'Its solar panels faced away from the morning Sun, so it slept.', 'About nine days later the Sun reached them, and SLIM woke up.'],
    note: 'Our Sun data starts in 2025, so we replay a morning from our own time.',
    source: { label: 'JAXA, SLIM landing', url: 'https://global.jaxa.jp/press/2024/01/20240125-1_e.html' },
    // a day after sunrise the Sun is about 12° up (engine), clear of the skyline and easy to find, as on SLIM's landing morning
    scene: { site: SLIM, view: 'ground', atSunrise: true, afterSunriseH: 24, lookAway: true, speed: '1d' },
    lesson: 'The Sun crosses the Moon’s sky slowly: about two weeks from side to side.',
    steps: (c) => [
      { text: 'Find the Sun. It is morning, so it is low', tip: DRAG_SUN, done: c.view === 'ground' && c.sunOnScreen },
      { text: 'Press play and watch nine days go by', tip: 'Watch the Sun climb. It stops by itself.', action: PLAY, done: played(c) >= 9 * 24 },
    ],
    question: {
      text: 'Where is the Sun now?',
      choices: [
        { id: 'high', label: 'High up in the sky' },
        { id: 'low', label: 'Still low, near the ground' },
      ],
      answer: (c) => (c.sunEl === null ? null : c.sunEl >= 30 ? 'high' : 'low'),
    },
    found: (c) => {
      if (c.sunEl === null) return null
      const stats: Stat[] = [{ value: deg(c.sunEl), label: 'how high the Sun is now. Straight up is 90°' }]
      if (c.sunElMax !== null) stats.push({ value: deg(c.sunElMax), label: 'the highest it gets here' })
      return {
        stats,
        note: c.sunEl >= 30 ? 'The Sun climbed up and over, very slowly. SLIM just had to wait for it.' : 'The Sun is still low here. Play a few more days and look again!',
      }
    },
  },
  {
    id: 'im-2',
    group: 'sun',
    tag: '2025 · IM-2 Athena',
    title: 'The Sun that stays low',
    short: 'Low Sun',
    where: 'Mons Mouton, near the South Pole',
    when: '6 March 2025',
    story: ['The lander Athena landed here, but it tipped over.', 'Here the Sun is always low, and its solar panels faced away.', 'Its batteries could not charge, so it stopped the next day.'],
    source: {
      label: 'Spaceflight Now',
      url: 'https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/',
    },
    scene: { site: IM2, atMs: IM2_LANDING_DAY_MS, view: 'ground', lookAway: true, speed: '6h' },
    lesson: 'Near the poles the Sun stays low, so a hill can hide it.',
    steps: (c) => [
      { text: 'Find the Sun', tip: DRAG_SUN, done: c.view === 'ground' && c.sunOnScreen },
      { text: 'Press play and watch the Sun for a whole day', tip: 'See how it slides sideways and never climbs.', action: PLAY, done: played(c) >= 24 },
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
  // ------------------------------------------------------------------ the Earth
  {
    id: 'apollo-17',
    group: 'earth',
    tag: '1972 · Apollo 17',
    title: 'The Earth that stays',
    short: 'Apollo 17',
    where: 'Taurus-Littrow valley',
    when: '11 December 1972',
    story: ['The last astronauts on the Moon landed in this valley.', 'They stayed three days and drove a Moon car.', 'High above them, far away, was the blue Earth.'],
    source: { label: 'NASA, Apollo 17', url: 'https://www.nasa.gov/missions/apollo/apollo-17-mission-details/' },
    scene: { site: APOLLO17, atMs: APOLLO17_LANDING_MS, view: 'ground', speed: '6h' },
    lesson: 'On the side of the Moon that faces us, the Earth never sets.',
    steps: (c) => [{ text: 'Press play and watch three days go by', tip: 'Keep an eye on the box “Can we see Earth?”.', action: PLAY, done: played(c) >= 72 }],
    question: {
      text: 'Did the Earth ever go away?',
      choices: [
        { id: 'stayed', label: 'No, it stayed in the sky' },
        { id: 'hid', label: 'Yes, it went down' },
      ],
      answer: (c) => (c.metrics === null ? null : c.metrics.commsPct >= 99.9 ? 'stayed' : 'hid'),
    },
    found: (c) =>
      c.memory.startEarthEl === null || c.metrics === null
        ? null
        : {
            stats: [{ value: deg(c.memory.startEarthEl), label: 'how high the Earth was. Straight up is 90°' }],
            note:
              c.metrics.commsPct >= 99.9
                ? 'The Earth never set! From here it always stays in the same part of the sky.'
                : 'The Earth went out of view here for a while.',
          },
  },
  {
    id: 'call-home',
    group: 'earth',
    tag: 'Every mission',
    title: 'Phone home',
    short: 'Call home',
    where: 'Nobile crater, near the South Pole',
    when: '12 February 2027',
    story: ['Every lander needs to talk to Earth.', 'Radio only works if the Earth is above the hills.', 'The Earth wobbles a little in the sky, so hills can hide it.'],
    source: { label: 'NASA SVS, Moon libration', url: 'https://svs.gsfc.nasa.gov/5588' },
    scene: { site: NOBILE, atMs: NOBILE_EARTH_UP_MS, view: 'ground', find: 'earth', speed: '1d' },
    lesson: 'No Earth in the sky means no call home.',
    steps: (c) => {
      const never = c.metrics !== null && c.metrics.commsPct >= 99.9
      return [
        { text: 'Find the Earth (the blue ball)', tip: 'Drag the picture sideways until you see the big blue ball.', done: c.view === 'ground' && c.earthOnScreen },
        {
          text: never ? 'The Earth never hides here! Search for another crater, then press play until “Can we see Earth?” says No' : 'Press play until “Can we see Earth?” says No',
          tip: 'Watch the blue ball sink behind the hills.',
          action: PLAY,
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
    id: 'im-1',
    group: 'earth',
    tag: '2024 · IM-1 Odysseus',
    title: 'A good place to call from',
    short: 'Odysseus',
    where: 'Near Malapert A crater',
    when: '22 February 2024',
    story: ['The lander Odysseus touched down here, near the South Pole.', 'It sent its pictures to Earth by radio.', 'Radio needs to see the Earth. Is that easy everywhere?'],
    note: NOT_OUR_YEARS,
    source: { label: 'NASA, IM-1 science', url: 'https://www.nasa.gov/missions/artemis/clps/nasa-collects-first-surface-science-in-decades-via-commercial-moon-mission/' },
    scene: { site: IM1, view: 'ground' },
    lesson: 'To call home, land where you can see the Earth.',
    steps: (c) => [
      { text: 'Look at the Earth row at the bottom', tip: 'A blue block is a day when you can see the Earth. Count them!', action: LOOK, done: false },
      { text: 'Now fly into Shackleton crater', tip: 'Then look at the Earth row again.', action: TO_SHACKLETON, done: SHACKLETON in c.memory.visited },
    ],
    question: {
      text: 'From which place can a lander call home?',
      choices: [
        { id: IM1, label: 'Where Odysseus landed' },
        { id: SHACKLETON, label: 'Inside Shackleton crater' },
      ],
      answer: (c) => {
        const a = c.memory.visited[IM1]
        const b = c.memory.visited[SHACKLETON]
        return a && b ? (a.earthPct >= b.earthPct ? IM1 : SHACKLETON) : null
      },
    },
    found: (c) => {
      const a = c.memory.visited[IM1]
      const b = c.memory.visited[SHACKLETON]
      if (!a || !b) return null
      return {
        stats: [
          { value: daysOf(a.earthPct, c.windowDays), label: `with the Earth in view where Odysseus landed, out of ${c.windowDays}` },
          { value: daysOf(b.earthPct, c.windowDays), label: `with the Earth in view in ${c.names(SHACKLETON)}, out of ${c.windowDays}` },
        ],
        note:
          a.earthPct > b.earthPct
            ? 'High ground looks over the hills to the Earth. Deep in a crater, the walls hide it.'
            : 'These days the crater sees the Earth as much as the high ground does.',
      }
    },
  },
  {
    id: 'blue-ghost',
    group: 'earth',
    tag: '2025 · Blue Ghost',
    title: 'The day the Earth hid the Sun',
    short: 'Eclipse',
    where: 'Sea of Crises',
    when: '14 March 2025',
    story: ['A robot lander called Blue Ghost worked here for two weeks.', 'One day the Earth slid right in front of the Sun.', 'Blue Ghost took pictures of it from the Moon!'],
    source: { label: 'Firefly Aerospace, Blue Ghost Mission 1', url: 'https://fireflyspace.com/news/blue-ghost-mission-1-live-updates/' },
    scene: { site: BLUE_GHOST, atMs: BLUE_GHOST_ECLIPSE_EVE_MS, view: 'ground', speed: '1h', until: 'eclipse' },
    lesson: 'When the Earth gets between the Sun and the Moon, the Moon goes dark.',
    steps: (c) => [
      { text: 'Press play', tip: 'One hour goes by every second.', action: PLAY, done: played(c) >= 1 },
      { text: 'Watch the ground until it goes dark', tip: 'It takes a little while. It stops by itself!', action: PLAY, done: c.memory.targetMs !== null && c.tMs >= c.memory.targetMs },
    ],
    question: {
      text: 'Why did it go dark?',
      choices: [
        { id: 'earth', label: 'The Earth moved in front of the Sun' },
        { id: 'night', label: 'The Sun went down' },
      ],
      // the chapter only has an eclipse to wait for when the engine found the Earth covering the whole Sun
      answer: (c) => (c.memory.eclipse ? 'earth' : null),
    },
    found: (c) =>
      c.memory.eclipse
        ? {
            stats: [
              { value: dur(c.memory.eclipse.totalH), label: 'with the whole Sun hidden behind the Earth' },
              { value: dur(c.memory.eclipse.anyH), label: 'from the first bite to the last' },
            ],
            note: 'At the same time, people on Earth saw the Moon turn dark red.',
          }
        : null,
  },
  // ------------------------------------------------------------------ explorer
  {
    id: 'light-ice',
    group: 'explore',
    tag: 'Artemis · South Pole',
    title: 'Sunny mountains, icy craters',
    short: 'Ice',
    where: 'Mons Malapert and Shackleton crater',
    when: 'Today',
    story: ['NASA’s Artemis astronauts may land on hills near the South Pole.', 'Next to those hills are deep craters.', 'Scientists think ice is hiding inside them.'],
    source: { label: 'NASA, Artemis III landing regions', url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/' },
    scene: { site: MALAPERT, view: 'ground' },
    lesson: 'Mountains catch the Sun, and dark craters keep the ice.',
    steps: (c) => [
      { text: 'You are on a mountain. Look at the Sun row at the bottom', tip: 'A yellow block is a day with sunshine. Count them!', action: LOOK, done: false },
      { text: 'Now fly into Shackleton crater', tip: 'Then look at the Sun row again.', action: TO_SHACKLETON, done: SHACKLETON in c.memory.visited },
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
    id: 'lcross',
    group: 'explore',
    tag: '2009 · LCROSS',
    title: 'Splash! Looking for water',
    short: 'Water',
    where: 'Cabeus crater',
    when: '9 October 2009',
    story: ['NASA crashed a rocket into this crater. On purpose!', 'A small spacecraft flew through the cloud of dust.', 'It found water in it!'],
    note: 'Our Sun data starts in 2025, so we look at the crater today.',
    source: { label: 'NASA, LCROSS', url: 'https://science.nasa.gov/mission/lcross/' },
    scene: { site: CABEUS, view: 'ground', speed: '1d' },
    lesson: 'Where the Sun never shines, ice can stay frozen for a very long time.',
    steps: (c) => [{ text: 'Press play and watch five days go by', tip: 'Look for the golden Sun. Will it come?', action: PLAY, done: played(c) >= 5 * 24 }],
    question: {
      text: 'Did the Sun shine in the crater?',
      choices: [
        { id: 'dark', label: 'No, it stayed dark' },
        { id: 'sun', label: 'Yes, the Sun came out' },
      ],
      answer: (c) => (c.metrics === null ? null : c.metrics.sunlightPct < 1 ? 'dark' : 'sun'),
    },
    found: (c) =>
      c.metrics
        ? {
            stats: [
              { value: daysOf(c.metrics.sunlightPct, c.windowDays), label: `of sunshine, out of ${c.windowDays}` },
              { value: dur(c.metrics.longestDarkH), label: 'the longest time in the dark' },
            ],
            note:
              c.metrics.sunlightPct < 1
                ? 'No sunshine at all! It is so cold down here that ice never melts.'
                : 'Only a little sunshine gets in here, so it stays very cold.',
          }
        : null,
  },
  {
    id: 'moon-base',
    group: 'explore',
    tag: 'Artemis · Base camp',
    title: 'Pick a place for a Moon base',
    short: 'Moon base',
    where: 'Three places near the South Pole',
    when: 'Today',
    story: ['One day NASA wants a camp near the South Pole.', 'A base needs sunshine to make electricity.', 'It also needs to see the Earth, to talk to home.'],
    source: { label: 'NASA, Artemis Base Camp', url: 'https://www.nasa.gov/blogs/artemis/2020/10/28/lunar-living-nasas-artemis-base-camp-concept/' },
    scene: { site: MALAPERT, view: 'ground' },
    lesson: 'A Moon base needs the Sun for power and the Earth for radio.',
    steps: (c) => [
      { text: 'You are on Mons Malapert. Look at the Sun row and the Earth row', tip: 'Yellow is sunshine. Blue is the Earth in view.', action: LOOK, done: false },
      { text: 'Fly to Nobile crater and look again', tip: 'More blocks, or fewer?', action: { kind: 'site', id: NOBILE, label: 'Fly to Nobile crater' }, done: NOBILE in c.memory.visited },
      { text: 'Fly to Shackleton crater and look again', tip: 'Last one!', action: TO_SHACKLETON, done: SHACKLETON in c.memory.visited },
    ],
    question: {
      text: 'Which place has the most Sun and Earth?',
      choices: [
        { id: MALAPERT, label: 'Mons Malapert' },
        { id: NOBILE, label: 'Nobile crater' },
        { id: SHACKLETON, label: 'Shackleton crater' },
      ],
      answer: (c) => bestBase(c)?.id ?? null,
    },
    found: (c) => {
      const best = bestBase(c)
      if (!best) return null
      const name = c.names(best.id)
      return {
        stats: [
          { value: daysOf(best.sunPct, c.windowDays), label: `of sunshine at ${name}, out of ${c.windowDays}` },
          { value: daysOf(best.earthPct, c.windowDays), label: `with the Earth in view, out of ${c.windowDays}` },
        ],
        note: `${name} has the most Sun and Earth together. A good spot for a base!`,
      }
    },
  },
  {
    id: 'yours',
    group: 'explore',
    tag: 'Your mission',
    title: 'Your turn: plan a landing',
    short: 'Your turn',
    where: 'Anywhere you like',
    when: 'You choose',
    story: ['Now you are the mission planner!', 'Find a place and a time with the Sun up and the Earth in view.'],
    source: { label: 'NASA Space Apps 2026', url: 'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/' },
    scene: { view: 'moon' },
    lesson: 'Mission planners check the Sun, the Earth and the ground for every date.',
    steps: (c) => {
      const moved = c.memory.startSel !== null && !same(c.memory.startSel, c.selection)
      return [
        { text: 'Pick a new place', tip: 'Click a place on the Moon, or search for one at the top.', done: moved },
        {
          text: 'Pick a time with the Sun up and the Earth in view',
          tip: 'At the bottom, click a day with a yellow block and a blue block.',
          done: moved && c.sunUp === true && c.earthContact === true,
        },
        { text: 'Stand there and look around', tip: 'See your landing place from the ground.', action: { kind: 'view', view: 'ground', label: 'Stand here' }, done: moved && c.view === 'ground' },
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

/** The three places of the Moon base mission. */
export const BASE_PLACES = [MALAPERT, NOBILE, SHACKLETON]

/** Of the base mission's three places, the one with the most sunshine and Earth contact together; null until all are visited. */
function bestBase(c: StoryCtx): { id: string; sunPct: number; earthPct: number } | null {
  const seen = BASE_PLACES.map((id) => ({ id, v: c.memory.visited[id] }))
  if (seen.some((s) => !s.v)) return null
  const best = seen.reduce((a, b) => (b.v.sunPct + b.v.earthPct > a.v.sunPct + a.v.earthPct ? b : a))
  return { id: best.id, ...best.v }
}

/** A name for how far the explorer has got, from the number of missions done. */
export function rankOf(done: number, total: number): string {
  if (done <= 0) return 'New explorer'
  if (done >= total) return 'Mission commander'
  if (done * 3 < total) return 'Moon cadet'
  if (done * 3 < total * 2) return 'Moon pilot'
  return 'Moon captain'
}

/**
 * The first total eclipse in a series (0 none, 1 partial, 2 total: the Earth covering the Sun): its middle, how long
 * the whole Sun is hidden, and how long any of it is. Durations count the samples, so they are good to one step.
 * Null when the series holds no total eclipse.
 */
export function eclipseSpan(t: number[], eclipse: number[]): { midMs: number; totalH: number; anyH: number } | null {
  const a = eclipse.indexOf(2)
  if (a < 0 || t.length < 2) return null
  let b = a
  while (b + 1 < eclipse.length && eclipse[b + 1] === 2) b++
  let a0 = a
  while (a0 > 0 && eclipse[a0 - 1] > 0) a0--
  let b0 = b
  while (b0 + 1 < eclipse.length && eclipse[b0 + 1] > 0) b0++
  const stepH = (t[1] - t[0]) / H
  return { midMs: (t[a] + t[b]) / 2, totalH: (b - a + 1) * stepH, anyH: (b0 - a0 + 1) * stepH }
}

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
