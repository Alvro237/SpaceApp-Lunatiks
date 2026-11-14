/** Element of the map's top-right tool bar, provided by the navigator (see ToolSlot.tsx). */
import { createContext } from 'react'

export const ToolSlotContext = createContext<HTMLElement | null>(null)
