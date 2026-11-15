import { beforeEach, describe, expect, it } from 'vitest'
import { useCinematic } from './cinematic'
import { usePanels } from './panels'
import { useApp } from './store'

describe('cinematic mode', () => {
  beforeEach(() => {
    useCinematic.setState({ on: false, prevScale: null })
    usePanels.setState({ section: null })
    useApp.getState().set({ scale: 'globe' })
  })

  it('shows the globe and closes the horizon view, then puts the polar map back', () => {
    useApp.getState().set({ scale: 'map' })
    usePanels.getState().setSection('horizon')
    useCinematic.getState().enter()
    expect(useCinematic.getState().on).toBe(true)
    expect(useApp.getState().scale).toBe('globe')
    expect(usePanels.getState().section).toBeNull()
    useCinematic.getState().exit()
    expect(useCinematic.getState().on).toBe(false)
    expect(useApp.getState().scale).toBe('map')
  })

  it('keeps any other open section for when it ends', () => {
    usePanels.getState().setSection('power')
    useCinematic.getState().enter()
    expect(usePanels.getState().section).toBe('power')
    useCinematic.getState().exit()
    expect(useApp.getState().scale).toBe('globe')
  })
})
