/** The Low graphics switch (state/graphics.ts): a keyboard-operable switch whose choice is kept in this browser. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphics } from '../state/graphics'
import { GraphicsToggle } from './GraphicsToggle'

const KEY = 'lunatiks.graphics.v1'

describe('Low graphics switch', () => {
  beforeEach(() => {
    window.localStorage.removeItem(KEY)
    useGraphics.setState({ low: false })
  })

  it('is a named switch, off by default (high quality)', () => {
    render(<GraphicsToggle />)
    const sw = screen.getByRole('switch', { name: 'Low graphics' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveAccessibleDescription(/without the photo/)
  })

  it('turns low graphics on and off with the keyboard and remembers the choice', async () => {
    const user = userEvent.setup()
    render(<GraphicsToggle />)
    const sw = screen.getByRole('switch', { name: 'Low graphics' })
    sw.focus()
    await user.keyboard('{Enter}')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(useGraphics.getState().low).toBe(true)
    expect(window.localStorage.getItem(KEY)).toBe('low')
    await user.keyboard(' ')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(useGraphics.getState().low).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps working when the browser refuses storage', async () => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      useGraphics.getState().setLow(true)
      expect(useGraphics.getState().low).toBe(true)
    } finally {
      Storage.prototype.setItem = setItem
    }
  })
})
