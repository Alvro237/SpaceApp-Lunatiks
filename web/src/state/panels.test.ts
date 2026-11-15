import { beforeEach, describe, expect, it } from 'vitest'
import { usePanels } from './panels'

const st = () => usePanels.getState()

describe('section trail (Back in the side panel)', () => {
  beforeEach(() => usePanels.setState({ section: null, trail: [], resultsOpen: true }))

  it('goes back to the section shown before, then closes', () => {
    st().setSection('power')
    st().setSection('horizon')
    st().setSection('link')
    expect(st().trail).toEqual(['power', 'horizon'])
    st().back()
    expect(st().section).toBe('horizon')
    st().back()
    expect(st().section).toBe('power')
    st().back()
    expect(st().section).toBeNull()
  })

  it('closing forgets the trail', () => {
    st().setSection('power')
    st().setSection('horizon')
    st().setSection(null)
    expect(st().trail).toEqual([])
    st().setSection('link')
    expect(st().trail).toEqual([])
  })

  it('does not stack a section twice', () => {
    st().setSection('power')
    st().setSection('horizon')
    st().setSection('power')
    expect(st().section).toBe('power')
    expect(st().trail).toEqual([])
    st().setSection('power')
    expect(st().trail).toEqual([])
  })
})
