/** The Guide button opens a labelled dialog that names every zone of the screen, and its close button closes it. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { GuideButton } from './GuideDialog'

describe('GuideButton', () => {
  it('opens the guide with every zone and closes it', async () => {
    const user = userEvent.setup()
    render(<GuideButton />)
    // closed: the dialog is in the DOM but not open
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Guide' }))
    const dialog = screen.getByRole('dialog', { name: 'Guide' })
    for (const zone of ['Top bar', 'Where and when', 'Tool bar', 'Map and globe', 'Side panel', 'Timeline']) {
      expect(within(dialog).getByRole('heading', { level: 3, name: new RegExp(zone) })).toBeInTheDocument()
    }
    expect(within(dialog).getByRole('navigation', { name: 'Guide contents' })).toBeInTheDocument()
    expect(within(dialog).getByRole('table', { name: 'Keyboard shortcuts' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close the guide' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
