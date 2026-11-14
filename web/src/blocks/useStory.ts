/**
 * Learn mode's small shared state: what the 3D view can see (published by the scene, read by the story), and the
 * learner's place in the mission log. Progress is kept in this browser only (a convenience; nothing depends on it).
 */
import { create } from 'zustand'
import { CHAPTERS, EMPTY_MEMORY, type StoryMemory } from './story'

/**
 * Between the story and the 3D view: whether the Sun and Earth balls are on screen in the ground view (written by
 * the scene when it changes), and a request to turn the ground camera to look from an azimuth (bumped `lookSeq`).
 */
export const useHud = create<{ sunOnScreen: boolean; earthOnScreen: boolean; lookSeq: number; lookFromAz: number }>()(() => ({
  sunOnScreen: false,
  earthOnScreen: false,
  lookSeq: 0,
  lookFromAz: 0,
}))

const KEY = 'lunatiks-block-missions'

interface Saved {
  chapter: number
  done: string[]
  started: boolean
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>
      return {
        chapter: Math.min(CHAPTERS.length - 1, Math.max(0, Number(s.chapter) || 0)),
        done: Array.isArray(s.done) ? s.done.filter((d) => typeof d === 'string') : [],
        started: !!s.started,
      }
    }
  } catch {
    // storage blocked or corrupt: start fresh
  }
  return { chapter: 0, done: [], started: false }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // not saved; the story still works for this visit
  }
}

/**
 * Setting a chapter's scene takes two steps: `apply` moves the place, date and view; `settle` waits until the
 * engine has the new place, then records the starting state (and turns the camera, or jumps to sunrise).
 */
export type SetupStage = 'apply' | 'settle' | null

export interface StoryState extends Saved {
  memory: StoryMemory
  stage: SetupStage
  open: boolean
  begin: () => void
  goTo: (chapter: number) => void
  markDone: (id: string) => void
  remember: (patch: Partial<StoryMemory>) => void
  setStage: (stage: SetupStage) => void
  setOpen: (open: boolean) => void
  restart: () => void
}

const fresh = (): StoryMemory => ({ ...EMPTY_MEMORY, visited: {}, latched: [] })

export const useStory = create<StoryState>()((set, get) => {
  const persist = () => {
    const { chapter, done, started } = get()
    save({ chapter, done, started })
  }
  const saved = load()
  return {
    ...saved,
    memory: fresh(),
    // a story resumed from an earlier visit sets its chapter's scene again
    stage: saved.started ? 'apply' : null,
    open: true,
    begin: () => {
      set({ started: true, open: true, memory: fresh(), stage: 'apply' })
      persist()
    },
    goTo: (chapter) => {
      set({ chapter, memory: fresh(), stage: 'apply', open: true })
      persist()
    },
    markDone: (id) => {
      if (get().done.includes(id)) return
      set({ done: [...get().done, id] })
      persist()
    },
    remember: (patch) => set({ memory: { ...get().memory, ...patch } }),
    setStage: (stage) => set({ stage }),
    setOpen: (open) => set({ open }),
    restart: () => {
      set({ chapter: 0, done: [], started: true, memory: fresh(), stage: 'apply', open: true })
      persist()
    },
  }
})
