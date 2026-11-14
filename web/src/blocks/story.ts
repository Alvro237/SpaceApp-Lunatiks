/**
 * Pip's journey: the Block Moon story, written for children. Six short chapters told by Pip, a little lander made
 * of blocks. Each one tells a bit of the story, gives a task as a checklist that ticks itself from what the learner
 * does, and ends with what Pip found, in the engine's own numbers, and one sentence to remember. Pure functions over a context, so every chapter is testable.
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
  /** A nudge for when the learner is stuck. */
  hint: string
  /** One sentence to remember, collected at the end of the story. */
  lesson: string
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
    title: 'Hello, Moon!',
    story:
      'Beep boop! I’m Pip, a little lander made of blocks. I eat sunshine to stay awake. I’m flying to the south pole of the Moon. Can you help me land?',
    hint: 'Open “Places” on the left to see the landing spots.',
    lesson: 'The blocks are the real shape of the Moon, measured with a laser from space.',
    setup: 'land-im2',
    steps: (c) => [
      { text: 'Open “Places” and pick IM-2 Athena', done: isSite(c.selection, IM2) },
      { text: 'Press “Stand here” to land', done: c.view === 'ground' && isSite(c.selection, IM2) },
    ],
    found: (c) =>
      `I landed! ${c.lat !== null ? `I’m only ${Math.round(poleKm(c.lat))} km from the south pole. ` : ''}Every block under me is a real piece of the Moon. A spacecraft called LRO measured how high the ground is by bouncing a laser off it.`,
  },
  {
    id: 'sun',
    title: 'Where is the Sun?',
    story: 'Brrr, it’s dark here! My solar panel needs the Sun. I’m looking the wrong way. Can you turn around and find it for me?',
    hint: 'Drag the world with your mouse or finger. The Sun is the golden ball.',
    lesson: 'At the pole the Sun stays low, so even small hills make long shadows.',
    setup: 'look-away',
    steps: (c) => [
      { text: 'Be on the ground (“Stand here”)', done: c.view === 'ground' },
      { text: 'Drag the world until you see the golden ball', done: c.view === 'ground' && c.sunOnScreen },
    ],
    found: (c) => {
      if (c.sunEl === null) return 'There it is: the Sun!'
      const widths = Math.max(1, Math.round(Math.abs(c.sunEl) / 0.53))
      const where =
        c.sunEl >= 0
          ? `It’s only a tiny bit above the ground: about ${widths} Sun${widths === 1 ? '' : 's'} high.`
          : 'It’s just below the edge of the sky.'
      const seen = c.sunUp
        ? 'And I can see it. Yummy sunshine!'
        : c.sunEl > 0
          ? 'But the hills are taller, so they hide it from me.'
          : 'So for me, it’s night.'
      return `There it is! ${where} ${seen} At the pole the Sun never climbs high: it rolls around the edge of the sky like a ball along the floor. (In my block world, hills and sky are stretched 4 times so you can see them.)`
    },
  },
  {
    id: 'night',
    title: 'The long night',
    story: 'My batteries are getting low… How long until the Sun reaches me again? Let’s make time go faster and watch!',
    hint: '“Play the days” makes time fly. It stops by itself when the Sun comes back.',
    lesson: 'A Moon day, from one sunrise to the next, lasts about 29 and a half Earth days.',
    setup: 'after-sunset',
    steps: (c) => [
      { text: 'Press “Play the days”', done: c.memory.startTMs !== null && Math.abs(c.tMs - c.memory.startTMs) >= H },
      { text: 'Wait until “Is the Sun up?” says YES', done: c.memory.startSunUp === false && c.sunUp === true },
    ],
    found: (c) => {
      const waited = c.memory.startTMs !== null ? (c.tMs - c.memory.startTMs) / H : null
      const dark = c.metrics ? ` The longest night here this month: ${hours(c.metrics.longestDarkH)}.` : ''
      return `Sunshine! ${waited !== null ? `I waited ${hours(waited)}.` : ''} On the Moon, one day, from sunrise to sunrise, lasts about 29 and a half Earth days, so nights can be very long.${dark} That’s why landers carry big batteries.`
    },
  },
  {
    id: 'call',
    title: 'Calling home',
    story:
      'I took a picture and I want to send it to Earth! But radio goes in straight lines, like the beam of a torch. I can only call home when I can see the Earth.',
    hint: 'The Earth is the blue ball. Then use “Play the days” or click a grey block in the Earth row.',
    lesson: 'No Earth in the sky means no phone call home.',
    steps: (c) => {
      const never = c.metrics !== null && c.metrics.commsPct >= 99.9
      return [
        { text: 'On the ground, drag the world until you see the blue ball', done: c.view === 'ground' && c.earthOnScreen },
        {
          text: never
            ? 'Here the Earth never hides this month! Pick Shackleton crater, then make time go by until “Can we see Earth?” says NO'
            : 'Make time go by until “Can we see Earth?” says NO',
          done: c.earthContact === false,
        },
      ]
    },
    found: (c) => {
      const gap = c.metrics ? ` The longest wait without Earth here this month: ${hours(c.metrics.longestBlackoutH)}.` : ''
      return `Oh no, the Earth is hiding behind the hills! I can’t call home now. I’ll keep my picture safe until it comes back.${gap} Real missions plan for this, or send messages through a satellite.`
    },
  },
  {
    id: 'home',
    title: 'Mountain or crater?',
    story: 'Good news: Mission Control says I can move! Should I live on top of a mountain or down in a deep crater? Visit both and count the golden Sun blocks at the bottom.',
    hint: 'Open “Places”. The Sun row at the bottom shows each day: gold means sunshine.',
    lesson: 'Mountain tops catch the low Sun; deep crater floors near the pole can stay dark for a very long time.',
    steps: (c) => [
      { text: 'Visit Mons Malapert (a mountain)', done: MALAPERT in c.memory.visited },
      { text: 'Visit Shackleton (a deep crater)', done: SHACKLETON in c.memory.visited },
      { text: 'Tell me: which one gets more sunshine?', done: c.memory.answer !== null },
    ],
    choices: (c) =>
      MALAPERT in c.memory.visited && SHACKLETON in c.memory.visited
        ? [
            { id: MALAPERT, label: 'The mountain' },
            { id: SHACKLETON, label: 'The crater' },
          ]
        : null,
    found: (c) => {
      const a = c.memory.visited[MALAPERT]
      const b = c.memory.visited[SHACKLETON]
      if (!a || !b) return ''
      const winner = a.sunPct >= b.sunPct ? MALAPERT : SHACKLETON
      const verdict = c.memory.answer === winner ? 'Yes, you got it!' : 'Good guess, but not this time.'
      return `${verdict} This month the mountain (${c.names(MALAPERT)}) gets sunshine ${pct(a.sunPct)} of the time, and the crater (${c.names(SHACKLETON)}) ${pct(b.sunPct)}. Mountain tops poke up into the low sunlight. Deep crater floors can stay dark for a very long time, and that’s where ice may be hiding!`
    },
  },
  {
    id: 'yours',
    title: 'You are Mission Control',
    story: 'Now YOU are Mission Control! Pick any spot on the whole Moon and send me there. Where will I go?',
    hint: 'Press “Whole Moon”, then click (don’t drag) on the Moon.',
    lesson: 'Planners pick landing spots by checking sunlight, Earth and the shape of the ground.',
    steps: (c) => [
      { text: 'Press “Whole Moon” and click anywhere on it', done: c.selection.kind === 'point' },
      { text: 'Press “Stand here” to send me', done: c.view === 'ground' && c.selection.kind === 'point' },
    ],
    found: (c) =>
      c.horizonKind === 'smooth_sphere'
        ? 'Wheee, I’m here! One secret: nobody has measured the faraway hills around this exact spot yet, so my Sun and Earth answers pretend the Moon is smooth. Look at the blocks around me: do you think the hills would hide the Sun?'
        : 'Wheee, I’m here, and my skyline was measured from real laser data!',
  },
]

/** The chapter's steps, a step counting as done once it has been reached (latched) during the chapter. */
export function stepsOf(ch: Chapter, c: StoryCtx): Step[] {
  return ch.steps(c).map((s, i) => ({ ...s, done: s.done || c.memory.latched.includes(i) }))
}

export const chapterDone = (ch: Chapter, c: StoryCtx) => stepsOf(ch, c).every((s) => s.done)
