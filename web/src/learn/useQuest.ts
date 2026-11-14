/**
 * Which challenge is running and which ones the viewer has solved. Progress is a per-browser convenience kept
 * in localStorage; the tool works the same without it (private windows, blocked storage).
 */
import { create } from 'zustand'
import { MAX_COMPARE, useApp } from '../state/store'
import { questById } from './quests'

const KEY = 'lunar-quest-progress-v1'

function readDone(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function writeDone(done: Record<string, boolean>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(done))
  } catch {
    /* storage unavailable: progress lasts for this visit only */
  }
}

interface QuestState {
  activeId: string | null
  done: Record<string, boolean>
  start: (id: string) => void
  stop: () => void
  markDone: (id: string) => void
  reset: () => void
}

export const useQuest = create<QuestState>()((set, get) => ({
  activeId: null,
  done: typeof window === 'undefined' ? {} : readDone(),
  start: (id) => {
    const q = questById(id)
    if (!q) return
    const app = useApp.getState()
    app.set({ mode: 'study', ...q.scene, compare: (q.compare ?? []).slice(0, MAX_COMPARE) })
    app.setPlaying(false)
    app.setCompareMode(Boolean(q.compare?.length))
    if (q.scene.selection) app.select(q.scene.selection)
    set({ activeId: id })
  },
  stop: () => set({ activeId: null }),
  markDone: (id) => {
    const done = { ...get().done, [id]: true }
    writeDone(done)
    set({ done })
  },
  reset: () => {
    writeDone({})
    set({ done: {} })
  },
}))
