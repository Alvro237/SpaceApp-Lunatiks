/**
 * One small picture per mission, drawn in blocks on an 8 x 8 grid like the rest of Learn mode, so a child can tell
 * the missions apart before reading: a lander, the Sun, a lander on its side, ice, the Earth, a flag. Decorative:
 * the mission's name always goes with it, so the icon has no text alternative of its own.
 */
const SUN = '#ffb547'
const EARTH = '#6cb2ff'
const GREY = '#cfccc4'
const ICE = '#9fd8ff'
const LAND = '#7ee2a8'

/** Rectangles as [colour, x, y, width, height] on the 8 x 8 grid. */
type Px = [string, number, number, number, number]

const ICONS: Record<string, Px[]> = {
  // Apollo 11: the lander, standing
  'apollo-11': [
    [SUN, 2, 2, 4, 3],
    [EARTH, 3, 3, 2, 1],
    [GREY, 1, 5, 1, 2],
    [GREY, 6, 5, 1, 2],
    [GREY, 3, 0, 2, 2],
  ],
  // Chandrayaan-3: the Sun of one long day
  'chandrayaan-3': [
    [SUN, 2, 2, 4, 4],
    [SUN, 3, 0, 2, 1],
    [SUN, 3, 7, 2, 1],
    [SUN, 0, 3, 1, 2],
    [SUN, 7, 3, 1, 2],
  ],
  // IM-2: the lander on its side, the Sun low on the ground
  'im-2': [
    [GREY, 0, 7, 8, 1],
    [SUN, 1, 3, 3, 4],
    [EARTH, 2, 4, 1, 2],
    [GREY, 4, 3, 2, 1],
    [GREY, 4, 6, 2, 1],
    [SUN, 6, 5, 2, 2],
  ],
  // Peaks of light, craters of ice: an ice block with a shine
  'light-ice': [
    [ICE, 1, 1, 6, 6],
    ['#ffffff', 2, 2, 2, 1],
    ['#ffffff', 2, 3, 1, 1],
  ],
  // Phone home: the Earth
  'call-home': [
    [EARTH, 2, 1, 4, 1],
    [EARTH, 1, 2, 6, 4],
    [EARTH, 2, 6, 4, 1],
    [LAND, 2, 2, 2, 2],
    [LAND, 5, 4, 1, 2],
  ],
  // Your turn: a flag
  yours: [
    [GREY, 2, 1, 1, 7],
    [SUN, 3, 1, 4, 3],
  ],
}

export function MissionIcon({ id, size = 24 }: { id: string; size?: number }) {
  const px = ICONS[id] ?? ICONS['apollo-11']
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {px.map(([fill, x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  )
}
