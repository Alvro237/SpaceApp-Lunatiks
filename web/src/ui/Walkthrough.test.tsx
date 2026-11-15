/**
 * The tour steps through the controls on screen, skips the ones that are not there, ends with Escape (putting the
 * app back as it was) and offers the full guide on its last step.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { useApp } from '../state/store'
import { STEPS, TourButton } from './Walkthrough'

function Screen() {
  return (
    <MemoryRouter>
      <div className="mode-switch" />
      <div className="site-search" />
      <div className="pill-btn" />
      <TourButton />
    </MemoryRouter>
  )
}

afterEach(() => useApp.getState().set({ mode: 'study', blocks: false }))

describe('TourButton', () => {
  it('walks the steps whose control is on screen and ends with the full guide', async () => {
    const user = userEvent.setup()
    useApp.getState().set({ mode: 'study', blocks: true })
    render(<Screen />)
    await user.click(screen.getByRole('button', { name: 'Tour' }))
    // Educational mode is turned off for the tour
    expect(useApp.getState().blocks).toBe(false)

    const titles: string[] = []
    for (let i = 0; i < STEPS.length; i++) {
      const card = screen.getByRole('dialog')
      titles.push(within(card).getByRole('heading').textContent!)
      const done = within(card).queryByRole('button', { name: 'Done' })
      if (done) {
        await user.click(within(card).getByRole('button', { name: 'Read the full guide' }))
        break
      }
      await user.click(within(card).getByRole('button', { name: 'Next' }))
    }
    // shown: the steps without a target, those that change the app, and those whose control exists here
    expect(titles).toContain('Two ways to work')
    expect(titles).toContain('Choose when')
    expect(titles).toContain('Mission filters')
    expect(titles).not.toContain('Map tools')
    expect(titles.at(-1)).toBe('You are ready')

    // the tour is over, the app is back as it was, and the full guide opens
    await screen.findByRole('dialog', { name: 'Guide' })
    expect(useApp.getState()).toMatchObject({ mode: 'study', blocks: true })
  })

  it('ends with Escape and returns the focus to the Tour button', async () => {
    const user = userEvent.setup()
    render(<Screen />)
    const btn = screen.getByRole('button', { name: 'Tour' })
    await user.click(btn)
    expect(screen.getByRole('dialog')).toHaveTextContent('Step 1 of')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog')).toHaveTextContent('Two ways to work')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(btn).toHaveFocus()
  })
})
