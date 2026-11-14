/** Block Moon as one lazily loaded piece: its three.js world and panels load only when the switch is turned on. */
import { BlockPanels } from './BlockPanels'
import { BlockWorld } from './BlockWorld'

export default function BlockMode() {
  return (
    <>
      <BlockWorld />
      <BlockPanels />
    </>
  )
}
