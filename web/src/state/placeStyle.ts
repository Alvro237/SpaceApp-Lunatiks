/**
 * The viewer's own touches on places: a custom name and a pointer colour, set from the place menu (right click on a
 * place, or its ⋯ button in the panels). They are this viewer's conveniences, kept in this browser
 * (localStorage, best effort), not part of a shared scenario link.
 *
 * Also the place menu itself: which place it is open for and where on screen.
 */
import { create } from 'zustand'
import type { Selection } from './store'

/** Stable key of a place: the catalogue id, or "p:lat,lon" for typed or picked coordinates. */
export const placeKey = (s: Selection) => (s.kind === 'site' ? s.id : `p:${s.lat},${s.lon}`)

/** Pointer colours offered in the menu (names are what screen readers hear). */
export const PIN_COLOURS = [
  { id: 'red', name: 'Red', hex: '#ea4335' },
  { id: 'orange', name: 'Orange', hex: '#ff8a1f' },
  { id: 'yellow', name: 'Yellow', hex: '#ffd166' },
  { id: 'green', name: 'Green', hex: '#34d399' },
  { id: 'blue', name: 'Blue', hex: '#4c8dff' },
  { id: 'violet', name: 'Violet', hex: '#b07cff' },
  { id: 'white', name: 'White', hex: '#f2f0ea' },
] as const
export const DEFAULT_PIN = PIN_COLOURS[0].hex

export interface PlaceStyle {
  name?: string
  colour?: string
}

const STORAGE = 'lunatiks.placeStyles.v1'

function read(): Record<string, PlaceStyle> {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE)
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function write(v: Record<string, PlaceStyle>) {
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(v))
  } catch {
    /* private mode or blocked storage: the change lasts for this visit only */
  }
}

export interface PlaceMenuTarget {
  sel: Selection
  /** Name shown before any rename (catalogue name or coordinates). */
  name: string
  /** Where to open, viewport CSS pixels. */
  x: number
  y: number
  /** Element to give the focus back to when the menu closes (the map, or the ⋯ button). */
  returnTo: HTMLElement | null
}

interface PlaceStyleState {
  styles: Record<string, PlaceStyle>
  menu: PlaceMenuTarget | null
  rename: (s: Selection, name: string) => void
  setColour: (s: Selection, colour: string | null) => void
  openMenu: (t: PlaceMenuTarget) => void
  closeMenu: () => void
}

function update(styles: Record<string, PlaceStyle>, key: string, patch: PlaceStyle): Record<string, PlaceStyle> {
  const next = { ...styles, [key]: { ...styles[key], ...patch } }
  const entry = next[key]
  if (!entry.name) delete entry.name
  if (!entry.colour) delete entry.colour
  if (!entry.name && !entry.colour) delete next[key]
  write(next)
  return next
}

export const usePlaceStyles = create<PlaceStyleState>()((set) => ({
  styles: read(),
  menu: null,
  rename: (s, name) => set((st) => ({ styles: update(st.styles, placeKey(s), { name: name.trim() || undefined }) })),
  setColour: (s, colour) => set((st) => ({ styles: update(st.styles, placeKey(s), { colour: colour ?? undefined }) })),
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
}))
