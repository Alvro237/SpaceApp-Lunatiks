/**
 * Keeps the scenario in the URL (`#/?s=…`) so any view can be shared or reloaded. Read once on start; written
 * with replaceState when the scene changes and playback is paused (not 60 times a second).
 */
import { useEffect, useState } from 'react'
import { sceneOf, useApp } from './store'
import { decodeScene, encodeScene } from './url'

function paramFromHash(): string | null {
  const q = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(q).get('s')
}

export function useUrlSync(): { restoredFromCorruptLink: boolean } {
  const [initial] = useState(() => {
    const param = paramFromHash()
    return { param, ...decodeScene(param) }
  })

  useEffect(() => {
    // A link restores its scenario; without one the current state (the default on a first visit) stays.
    if (initial.param) {
      useApp.getState().set(initial.scene)
      useApp.setState((s) => ({ focusSeq: s.focusSeq + 1 }))
    }

    let last = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const write = () => {
      const s = useApp.getState()
      if (s.playing) return
      const enc = encodeScene(sceneOf(s))
      if (enc === last) return
      last = enc
      const [path] = window.location.hash.replace(/^#/, '').split('?')
      window.history.replaceState(null, '', `#${path || '/'}?s=${enc}`)
    }
    const unsubscribe = useApp.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(write, 250)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [initial])

  return { restoredFromCorruptLink: !initial.ok }
}
