/**
 * Pip's journey: the Block Moon story. Six short chapters that teach the navigator by using it. Each chapter tells
 * a bit of the story, gives a task as a checklist that ticks itself from what the learner does, and ends with what
 * was found, in the engine's own numbers. Pure functions over a context, so every chapter is testable.
 */
import type { BlockView, Selection } from '../state/store'

export interface StoryMetrics {
  sunlightPct: number
  commsPct: number
  longestDarkH: number
  longestBlackoutH: number
}

/** What a chapter remembers from the moment it started, and what the learner did during it. */
export interface StoryMemory {
  startTMs: number | null
  startSunUp: boolean | null
  /** Sunlight and Earth contact over the window, recorded when the learner picks a catalogue site. */
  visited: Record<string, { sunPct: number; earthPct: number }>
  answer: string | null
  /** Steps already reached in this chapter: they stay ticked even if the view moves on. */
  latched: number[]
}

export const EMPTY_MEMORY: StoryMemory = { startTMs: null, startSunUp: null, visited: {}, answer: null, latched: [] }

export interface StoryCtx {
  view: BlockView
  selection: Selection
  /** Latitude of the selection, degrees. */
  lat: number | null
  horizonKind: 'terrain' | 'smooth_sphere' | null
  sunUp: boolean | null
  earthContact: boolean | null
  sunEl: number | null
  sunOnScreen: boolean
  earthOnScreen: boolean
  tMs: number
  metrics: StoryMetrics | null
  memory: StoryMemory
  names: (id: string) => string
}

export interface Step {
  text: string
  done: boolean
}

export interface Chapter {
  id: string
  title: string
  /** The story so far: two or three sentences, read before the task. */
  story: string
  steps: (c: StoryCtx) => Step[]
  /** What the learner found, once every step is done. */
  found: (c: StoryCtx) => string
  /** A question to answer as the last step, when the chapter has one. */
  choices?: (c: StoryCtx) => { id: string; label: string }[] | null
  /** Done when the chapter starts: put the scene where the story needs it. */
  setup?: 'land-im2' | 'after-sunset' | 'look-away'
}

const H = 3_600_000
/** Distance along the surface to the nearest pole, km (Moon radius 1737.4 km). */
const poleKm = (lat: number) => ((90 - Math.abs(lat)) * Math.PI * 1737.4) / 180
const isSite = (s: Selection, id: string) => s.kind === 'site' && s.id === id
const pct = (v: number) => `${Math.round(v)} %`
const hours = (h: number) => (h >= 48 ? `${Math.round(h)} hours (about ${Math.round(h / 24)} days)` : `${Math.round(h)} hours`)

export const MALAPERT = 'mons-malapert'
export const SHACKLETON = 'shackleton'
export const IM2 = 'im-2'

export const CHAPTERS: Chapter[] = [
  {
    id: 'arrival',
    title: 'Arrival',
    story:
      'Meet Pip, a small lander made of blocks that runs on sunlight. Pip is flying to the Moon’s south pole, to the spot the IM-2 Athena lander was aiming for. Help Pip land.',
    setup: 'land-im2',
    steps: (c) => [
      { text: 'In Places, choose IM-2 Athena', done: isSite(c.selection, IM2) },
      { text: 'Press “Stand here” to land', done: c.view === 'ground' && isSite(c.selection, IM2) },
    ],
    found: (c) =>
      `Pip has landed${c.lat !== null ? ` at ${Math.abs(c.lat).toFixed(1)}° south, about ${Math.round(poleKm(c.lat))} km from the pole` : ''}. Every cube under Pip is a real piece of ground: 960 m wide, its height measured by NASA’s Lunar Reconnaissance Orbiter (LOLA).`,
  },
  {
    id: 'sun',
    title: 'Where is the Sun?',
    story:
      'Pip’s solar panel needs the Sun, so first Pip has to find it. But near the pole the Sun never climbs high: it slides around the edge of the sky.',
    setup: 'look-away',
    steps: (c) => [
      { text: 'Stand at a place (“Stand here”)', done: c.view === 'ground' },
      { text: 'Drag the view until the gold ball, the Sun, is on your screen', done: c.view === 'ground' && c.sunOnScreen },
    ],
    found: (c) => {
      if (c.sunEl === null) return 'You found the Sun.'
      const widths = Math.abs(c.sunEl) / 0.53
      const where =
        c.sunEl >= 0
          ? `only ${c.sunEl.toFixed(2)}° above flat ground, about ${widths < 1.5 ? 'one' : Math.round(widths)} Sun-width${widths < 1.5 ? '' : 's'}`
          : `${Math.abs(c.sunEl).toFixed(2)}° below flat ground`
      const seen = c.sunUp ? 'Pip can see it.' : c.sunEl > 0 ? 'But the hills are taller, so Pip, down on the ground, cannot see it.' : 'So it is night for Pip.'
      return `The Sun is ${where}. ${seen} That is why the shape of the ground matters so much at the pole. (In the cube world the heights and the sky angles are both stretched 4 times, so the Sun looks higher than it is.)`
    },
  },
  {
    id: 'night',
    title: 'The long night',
    story:
      'Pip’s batteries only last so long in the dark. Mission control asks: how long until sunlight reaches Pip again? Let’s find out by moving time forward.',
    setup: 'after-sunset',
    steps: (c) => [
      { text: 'Press “Play the days” or “Day ▸” to move time forward', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= H },
      { text: 'Stop when “Is the Sun up?” turns to YES or PARTLY', done: c.memory.startSunUp === false && c.sunUp === true },
    ],
    found: (c) => {
      const waited = c.memory.startTMs !== null ? (c.tMs - c.memory.startTMs) / H : null
      const dark = c.metrics ? ` In these 30 days, the longest dark spell here lasts ${hours(c.metrics.longestDarkH)}.` : ''
      return `${waited !== null ? `Pip waited ${hours(waited)} for the Sun.` : 'The Sun is back.'} A day on the Moon, from one sunrise to the next, lasts about 29.5 Earth days, so nights are long.${dark} Landers must carry enough battery for the longest night they will meet.`
    },
  },
  {
    id: 'call',
    title: 'Calling home',
    story:
      'Pip took its first photos and wants to send them to Earth. Radio travels in straight lines, so Pip can only call home while the Earth is above the hills.',
    steps: (c) => {
      const never = c.metrics !== null && c.metrics.commsPct >= 99.9
      return [
        { text: 'Stand at a place and drag the view until the blue ball, the Earth, is on your screen', done: c.view === 'ground' && c.earthOnScreen },
        {
          text: never
            ? 'Here the Earth never hides in these 30 days. Choose Shackleton crater, then move time until “Can we see Earth?” says NO'
            : 'Move time (or click a grey block in the Earth row) until “Can we see Earth?” says NO',
          done: c.earthContact === false,
        },
      ]
    },
    found: (c) => {
      const gap = c.metrics ? ` Here, the longest time without Earth in these 30 days is ${hours(c.metrics.longestBlackoutH)}.` : ''
      return `No Earth in the sky means no direct call: Pip has to store its photos and wait.${gap} Real missions plan around these blackouts, or use a satellite to relay their messages.`
    },
  },
  {
    id: 'home',
    title: 'A better home',
    story:
      'Mission control is planning Pip’s next trip. Should Pip go to a mountain top or to the floor of a crater? Visit both and compare their gold Sun blocks.',
    steps: (c) => [
      { text: 'In Places, choose Mons Malapert (a mountain)', done: MALAPERT in c.memory.visited },
      { text: 'Then choose Shackleton crater', done: SHACKLETON in c.memory.visited },
      { text: 'Answer: which one gets more sunlight?', done: c.memory.answer !== null },
    ],
    choices: (c) =>
      MALAPERT in c.memory.visited && SHACKLETON in c.memory.visited
        ? [
            { id: MALAPERT, label: c.names(MALAPERT) },
            { id: SHACKLETON, label: c.names(SHACKLETON) },
          ]
        : null,
    found: (c) => {
      const a = c.memory.visited[MALAPERT]
      const b = c.memory.visited[SHACKLETON]
      if (!a || !b) return ''
      const winner = a.sunPct >= b.sunPct ? MALAPERT : SHACKLETON
      const verdict = c.memory.answer === winner ? 'You chose right.' : 'Not this time, but now you know.'
      return `${verdict} Over the next 30 days ${c.names(MALAPERT)} gets sunlight ${pct(a.sunPct)} of the time and ${c.names(SHACKLETON)} ${pct(b.sunPct)}. High ground rises above the long shadows of the pole; deep crater floors can stay dark for a very long time, which is also where ice may hide.`
    },
  },
  {
    id: 'yours',
    title: 'Your own spot',
    story: 'Now you are the planner. Pick any spot near the south pole and send Pip there to look around.',
    steps: (c) => [
      { text: 'Choose “Whole Moon”, then click anywhere near the south pole', done: c.selection.kind === 'point' && c.lat !== null && c.lat <= -60 },
      { text: 'Press “Stand here” to land there', done: c.view === 'ground' && c.selection.kind === 'point' },
    ],
    found: (c) =>
      c.horizonKind === 'smooth_sphere'
        ? 'Pip has landed on your spot. Careful: nobody has measured the full skyline for this exact point, so here the Sun and Earth answers treat the Moon as smooth. Real hills could hide the Sun, or lift Pip above the shadows. The cubes show those hills: compare them with the answers.'
        : 'Pip has landed on your spot, with its real skyline measured from LOLA.',
  },
]

/** The chapter's steps, a step counting as done once it has been reached (latched) during the chapter. */
export function stepsOf(ch: Chapter, c: StoryCtx): Step[] {
  return ch.steps(c).map((s, i) => ({ ...s, done: s.done || c.memory.latched.includes(i) }))
}

export const chapterDone = (ch: Chapter, c: StoryCtx) => stepsOf(ch, c).every((s) => s.done)
