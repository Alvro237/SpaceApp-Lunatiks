import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(cleanup)

// Node 25 has its own `localStorage` global, unusable without --localstorage-file, and it shadows jsdom's
// (CI runs Node 22, where this does nothing). Give the browser-like tests a working in-memory one.
if (typeof window !== 'undefined' && typeof globalThis.localStorage?.clear !== 'function') {
  const items = new Map<string, string>()
  const memory: Storage = {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  }
  for (const target of new Set([globalThis, window])) Object.defineProperty(target, 'localStorage', { value: memory, configurable: true })
}
