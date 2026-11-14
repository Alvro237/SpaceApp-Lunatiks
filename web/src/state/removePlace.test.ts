/** Removing a place (right click on the map, or its remove button) and undoing it. */
import { beforeEach, describe, expect, it } from 'vitest'
import { type Selection, defaultScene, useApp } from './store'

const im2: Selection = { kind: 'site', id: 'im-2' }
const malapert: Selection = { kind: 'site', id: 'mons-malapert' }
const point: Selection = { kind: 'point', lat: -89.45, lon: 137.3 }

beforeEach(() => useApp.setState({ ...defaultScene(Date.UTC(2026, 10, 14)), compareMode: false, history: [], lastRemoved: null }))

describe('removePlace', () => {
  it('takes the selected place away and goes back to the place picked before it', () => {
    const app = useApp.getState()
    app.select(malapert)
    app.select(point)
    useApp.getState().removePlace(point, 'typed point')
    expect(useApp.getState().selection).toEqual(malapert)
    expect(useApp.getState().lastRemoved).toMatchObject({ name: 'typed point', wasCurrent: true, compareIndex: -1 })
  })

  it('falls back to the default site when nothing was picked before', () => {
    useApp.getState().select(point)
    useApp.setState({ history: [] })
    useApp.getState().removePlace(point, 'typed point')
    expect(useApp.getState().selection).toEqual(im2)
  })

  it('removes a compared place and undo puts it back where it was', () => {
    const app = useApp.getState()
    app.setCompareMode(true)
    app.select(malapert)
    useApp.getState().select(point)
    expect(useApp.getState().compare).toEqual([im2, malapert, point])
    useApp.getState().removePlace(malapert, 'Mons Malapert')
    expect(useApp.getState().compare).toEqual([im2, point])
    expect(useApp.getState().selection).toEqual(point)
    useApp.getState().undoRemove()
    expect(useApp.getState().compare).toEqual([im2, malapert, point])
    expect(useApp.getState().lastRemoved).toBeNull()
  })

  it('ignores a place that is neither selected nor compared', () => {
    useApp.getState().removePlace(malapert, 'Mons Malapert')
    expect(useApp.getState().lastRemoved).toBeNull()
    expect(useApp.getState().selection).toEqual(im2)
  })
})

describe('multiselect', () => {
  it('starts with the current place and clears the comparison when turned off', () => {
    useApp.getState().setCompareMode(true)
    expect(useApp.getState().compare).toEqual([im2])
    useApp.getState().select(malapert)
    expect(useApp.getState().compare).toEqual([im2, malapert])
    useApp.getState().setCompareMode(false)
    expect(useApp.getState().compare).toEqual([])
    expect(useApp.getState().selection).toEqual(malapert)
  })
})
