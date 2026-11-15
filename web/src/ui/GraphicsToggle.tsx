/**
 * The "Low graphics" switch in the top bar (state/graphics.ts): for a slow computer, the Moon without the photo and
 * a plain horizon view. A switch with its state in the accessible name's role (aria-checked) and a description that
 * says what it changes; it looks like the Educational switch next to it.
 */
import { useId } from 'react'
import { useGraphics } from '../state/graphics'
import '../blocks/blocks.css'

export function GraphicsToggle() {
  const low = useGraphics((s) => s.low)
  const setLow = useGraphics((s) => s.setLow)
  const id = useId()
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={low}
        aria-describedby={id}
        className="block-toggle graphics-toggle"
        title="Low graphics: the Moon without the photo and a plain horizon view, for a slow computer. The numbers stay the same."
        onClick={() => setLow(!low)}
      >
        <span className="track" aria-hidden="true">
          <span className="knob" />
        </span>
        <span className="block-toggle-label">Low graphics</span>
      </button>
      <span id={id} className="sr-only">
        Shows the Moon without the photo and the horizon view without the rendered ground, for a slow computer. The
        numbers stay the same.
      </span>
    </>
  )
}
