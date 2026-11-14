/**
 * Block Moon's small shared state: what the 3D view can see (published by the scene, read by the story), and the
 * learner's place in Pip's story. Progress is kept in this browser only (a convenience; nothing depends on it).
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

const KEY = 'lunatiks-block-story'

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

export interface StoryState extends Saved {
  memory: StoryMemory
  /** True while the chapter's setup still has to run (set when a chapter is opened). */
  needsSetup: boolean
  open: boolean
  begin: () => void
  goTo: (chapter: number) => void
  markDone: (id: string) => void
  remember: (patch: Partial<StoryMemory>) => void
  setupDone: () => void
  setOpen: (open: boolean) => void
  restart: () => void
}

export const useStory = create<StoryState>()((set, get) => {
  const persist = () => {
    const { chapter, done, started } = get()
    save({ chapter, done, started })
  }
  const saved = load()
  return {
    ...saved,
    memory: EMPTY_MEMORY,
    // a story resumed from an earlier visit sets its chapter up again
    needsSetup: saved.started,
    open: true,
    begin: () => {
      set({ started: true, open: true, memory: { ...EMPTY_MEMORY, visited: {}, latched: [] }, needsSetup: true })
      persist()
    },
    goTo: (chapter) => {
      set({ chapter, memory: { ...EMPTY_MEMORY, visited: {}, latched: [] }, needsSetup: true, open: true })
      persist()
    },
    markDone: (id) => {
      if (get().done.includes(id)) return
      set({ done: [...get().done, id] })
      persist()
    },
    remember: (patch) => set({ memory: { ...get().memory, ...patch } }),
    setupDone: () => set({ needsSetup: false }),
    setOpen: (open) => set({ open }),
    restart: () => {
      set({ chapter: 0, done: [], started: true, memory: { ...EMPTY_MEMORY, visited: {}, latched: [] }, needsSetup: true, open: true })
      persist()
    },
  }
})
