/** The Educational switch in the top bar: the same place and time, drawn as a world of cubes for learners. */
import { useApp } from '../state/store'
import { loadBlockMode } from './preload'
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
      title="Educational mode"
      // fetch the Educational mode code as soon as the pointer or the focus shows the intent, so the switch does not wait
      onPointerEnter={() => void loadBlockMode()}
      onFocus={() => void loadBlockMode()}
      onClick={() => {
        useApp.getState().setPlaying(false)
        set({ blocks: !blocks })
      }}
    >
      <span className="track" aria-hidden="true">
        <span className="knob" />
      </span>
      <span className="block-toggle-label">Educational</span>
    </button>
  )
}
