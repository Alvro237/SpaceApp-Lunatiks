/** The Block Moon switch in the top bar: the same place and time, drawn as a world of cubes for learners. */
import { useApp } from '../state/store'
import './blocks.css'

export function BlockToggle() {
  const blocks = useApp((s) => s.blocks)
  const set = useApp((s) => s.set)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={blocks}
      className="block-toggle"
      onClick={() => {
        useApp.getState().setPlaying(false)
        set({ blocks: !blocks })
      }}
    >
      <span className="track" aria-hidden="true">
        <span className="knob" />
      </span>
      Block Moon
    </button>
  )
}
