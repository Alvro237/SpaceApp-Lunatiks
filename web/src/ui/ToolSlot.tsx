/**
 * The map's top-right tool bar (Adobe-style options bar). The navigator owns the bar; the active map view (globe
 * or polar map) puts its own tools into it through a portal, so zoom, view and layer controls sit together with
 * the navigator's tools (mission filters) in one strip.
 */
import { type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import { ToolSlotContext } from './toolSlotContext'

/** Renders its children inside the tool bar when there is one, in place otherwise (tests, other pages). */
export function ToolPortal({ children }: { children: ReactNode }) {
  const slot = useContext(ToolSlotContext)
  return slot ? createPortal(children, slot) : <>{children}</>
}
