/** The floating info bubble (section 3.5): placement, pointer, closing, and one bubble open at a time. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tip, place } from './Tip'

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440)
  vi.stubGlobal('innerHeight', 900)
})
afterEach(() => vi.unstubAllGlobals())

function stubRect(el: HTMLElement, rect: Partial<DOMRect>) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect)
}

describe('Tip', () => {
  it('opens to the right of the button with a pointer facing it, and wraps without overflow for long text', async () => {
    const user = userEvent.setup()
    render(
      <Tip label="battery autonomy">
        A very long explanation that must wrap inside the bubble instead of growing wider than its 280 px maximum width,
        so the bubble grows in height, never cut.
      </Tip>,
    )
    const btn = screen.getByRole('button', { name: 'About battery autonomy' })
    stubRect(btn, { left: 100, right: 124, top: 200, bottom: 224 })
    await user.click(btn)
    const note = screen.getByRole('note')
    expect(note).toHaveClass('tip-right')
    expect(note.style.left).toBe('136px') // button.right (124) + GAP (12)
    expect(note).toHaveTextContent(/A very long explanation/)
  })

  it('flips to the left near the right edge', async () => {
    const user = userEvent.setup()
    render(<Tip label="region radius">Size of the area searched.</Tip>)
    const btn = screen.getByRole('button', { name: 'About region radius' })
    stubRect(btn, { left: 1400, right: 1420, top: 100, bottom: 124 })
    await user.click(btn)
    expect(screen.getByRole('note')).toHaveClass('tip-left')
  })

  it('closes on an outside pointer down, Escape (focus back to the button), and a second click', async () => {
    const user = userEvent.setup()
    render(<Tip label="cell size">Size of each cell.</Tip>)
    const btn = screen.getByRole('button', { name: 'About cell size' })
    stubRect(btn, { left: 10, right: 34, top: 10, bottom: 34 })
    await user.click(btn)
    expect(screen.getByRole('note')).toBeInTheDocument()
    await user.click(document.body)
    expect(screen.queryByRole('note')).toBeNull()

    await user.click(btn)
    expect(screen.getByRole('note')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('note')).toBeNull()
    expect(btn).toHaveFocus()

    await user.click(btn)
    expect(screen.getByRole('note')).toBeInTheDocument()
    await user.click(btn)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('only one bubble is open at a time', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Tip label="first">First note.</Tip>
        <Tip label="second">Second note.</Tip>
      </>,
    )
    const [first, second] = screen.getAllByRole('button')
    stubRect(first, { left: 10, right: 34, top: 10, bottom: 34 })
    stubRect(second, { left: 10, right: 34, top: 60, bottom: 84 })
    await user.click(first)
    expect(screen.getAllByRole('note')).toHaveLength(1)
    await user.click(second)
    expect(screen.getAllByRole('note')).toHaveLength(1)
    expect(screen.getByRole('note')).toHaveTextContent('Second note.')
  })
})

describe('place', () => {
  const view = { w: 1440, h: 900 }
  const btn = (left: number, top: number) => ({ left, right: left + 24, top, bottom: top + 24, width: 24, height: 24, x: left, y: top }) as DOMRect

  it('puts the pointer level with the button centre, the bubble centred on it', () => {
    const p = place(btn(300, 400), { w: 280, h: 60 }, view)
    expect(p.right).toBe(true)
    expect(p.left).toBe(336) // 324 + 12
    expect(p.top).toBe(382) // centre 412 - 60 / 2
    expect(p.top + p.pointerTop).toBe(412) // the pointer points at the button's centre
  })

  it('slides the bubble inside the window and keeps the pointer on the button', () => {
    const p = place(btn(300, 860), { w: 280, h: 120 }, view) // button centre at 872: the bubble cannot be centred
    expect(p.top).toBe(900 - 8 - 120)
    expect(p.top + p.pointerTop).toBe(872)
  })

  it('goes to the left of the button, right next to it, when the right side is too narrow', () => {
    const p = place(btn(1300, 100), { w: 280, h: 60 }, view)
    expect(p.right).toBe(false)
    expect(p.left).toBe(1300 - 12 - 280)
  })
})
