/**
 * Line icons drawn inline (no icon font, no third-party request). 24-unit grid, stroke = currentColor, so they
 * follow the theme and forced colours. Always decorative: the control that holds one carries the accessible name.
 */
import type { ReactNode } from 'react'

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

type P = { size?: number }

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)
export const IconGlobe = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Svg>
)
export const IconPole = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </Svg>
)
export const IconCube = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
    <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
  </Svg>
)
export const IconFit = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
)
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
)
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
)
export const IconHorizon = (p: P) => (
  <Svg {...p}>
    <path d="M2 18h20" />
    <path d="m2 18 5-6 3 3 4-6 3 4 5-3" />
    <circle cx="17" cy="5" r="1.6" />
  </Svg>
)
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </Svg>
)
export const IconAntenna = (p: P) => (
  <Svg {...p}>
    <path d="M12 12v10M8 22h8" />
    <path d="M8.5 8.5a5 5 0 0 1 7 0M5.5 5.5a9 9 0 0 1 13 0" />
    <circle cx="12" cy="11.5" r="1.2" fill="currentColor" />
  </Svg>
)
export const IconRadiation = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="1.6" />
    <path d="M12 9.4V3.5a8.5 8.5 0 0 1 7.4 4.3l-5.1 2.9M14.3 13.3l5.1 2.9A8.5 8.5 0 0 1 12 20.5M9.7 13.3l-5.1 2.9A8.5 8.5 0 0 1 4.6 7.8l5.1 2.9" />
  </Svg>
)
export const IconElevation = (p: P) => (
  <Svg {...p}>
    <path d="M3 20h18M3 20 19 6" />
    <path d="M10 20a7 7 0 0 0-1.3-4.3" />
    <circle cx="19" cy="6" r="1.8" />
  </Svg>
)
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)
export const IconPanel = (p: P) => (
  <Svg {...p}>
    <path d="M3 15 6 5h15l-3 10H3Z" />
    <path d="M4.5 10h15M10.5 5l-2 10M15.5 5l-2 10M10 15v5M7 20h6" />
  </Svg>
)
export const IconBattery = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="7" width="17" height="10" rx="2" />
    <path d="M22 11v2M6 10v4M9.5 10v4" />
  </Svg>
)
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5 8 12l7 7" />
  </Svg>
)
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
)
export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)
export const IconMast = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v16M8 20h8M9 7h6" />
  </Svg>
)
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
)
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
  </Svg>
)
export const IconCompare = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="7.5" height="16" rx="1.6" />
    <rect x="13.5" y="4" width="7.5" height="16" rx="1.6" />
    <path d="M5.8 15v-2M17.2 15V9" />
  </Svg>
)
export const IconHabitat = (p: P) => (
  <Svg {...p}>
    <path d="M3 20h18M5 20v-5a7 7 0 0 1 14 0v5" />
    <path d="M10 20v-4h4v4M12 6V3" />
  </Svg>
)
export const IconThermo = (p: P) => (
  <Svg {...p}>
    <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z" />
    <path d="M12 9v7" />
  </Svg>
)
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" />
  </Svg>
)
export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M8 5v14M16 5v14" strokeWidth={3} />
  </Svg>
)
export const IconSpeed = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 18a8.5 8.5 0 1 1 15 0" />
    <path d="m12 14 4-5" />
    <circle cx="12" cy="14" r="1.2" fill="currentColor" />
  </Svg>
)
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
    <path d="M12 14v7" />
  </Svg>
)
export const IconSpin = (p: P) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4h-4" />
  </Svg>
)
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Svg>
)
export const IconCrosshair = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
  </Svg>
)
export const IconFilter = (p: P) => (
  <Svg {...p}>
    <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
  </Svg>
)
