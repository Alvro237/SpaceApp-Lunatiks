/**
 * One small picture per mission, drawn in blocks on an 8 x 8 grid like the rest of Educational mode, so a child can
 * tell the missions apart before reading: a lander, the Sun, a lander on its side, a Moon car, the Earth, a radio
 * dish, the Earth over the Sun, ice, a drop of water, a base, a flag. Decorative: the mission's name always goes
 * with it, so the icon has no text alternative of its own.
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
  // SLIM: the lander tipped over, legs in the air, asleep under a low Sun
  slim: [
    [GREY, 0, 7, 8, 1],
    [GREY, 1, 1, 1, 2],
    [GREY, 4, 1, 1, 2],
    [SUN, 1, 3, 4, 3],
    [EARTH, 2, 4, 2, 1],
    [GREY, 2, 6, 2, 1],
    [SUN, 6, 5, 2, 2],
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
  // Apollo 17: the Moon car, with the Earth above it
  'apollo-17': [
    [EARTH, 5, 0, 2, 2],
    [GREY, 1, 3, 1, 2],
    [GREY, 1, 4, 6, 1],
    [SUN, 3, 3, 2, 1],
    [GREY, 1, 5, 2, 2],
    [GREY, 5, 5, 2, 2],
  ],
  // IM-1: a radio dish calling the Earth
  'im-1': [
    [EARTH, 6, 0, 2, 2],
    [GREY, 1, 2, 1, 3],
    [GREY, 2, 4, 1, 2],
    [GREY, 3, 5, 2, 1],
    [SUN, 3, 3, 1, 1],
    [SUN, 4, 2, 1, 1],
    [GREY, 3, 6, 1, 2],
    [GREY, 2, 7, 3, 1],
  ],
  // Blue Ghost: the Earth sliding over the Sun
  'blue-ghost': [
    [SUN, 1, 2, 4, 4],
    [SUN, 2, 1, 2, 6],
    [EARTH, 3, 2, 4, 4],
    [EARTH, 4, 1, 2, 6],
    [LAND, 4, 3, 2, 1],
  ],
  // Peaks of light, craters of ice: an ice block with a shine
  'light-ice': [
    [ICE, 1, 1, 6, 6],
    ['#ffffff', 2, 2, 2, 1],
    ['#ffffff', 2, 3, 1, 1],
  ],
  // LCROSS: a drop of water
  lcross: [
    [ICE, 3, 0, 2, 2],
    [ICE, 2, 2, 4, 2],
    [ICE, 1, 4, 6, 3],
    [ICE, 2, 7, 4, 1],
    ['#ffffff', 2, 4, 1, 2],
  ],
  // Moon base: a dome with a door and a flag
  'moon-base': [
    [GREY, 0, 7, 8, 1],
    [GREY, 2, 3, 4, 1],
    [GREY, 1, 4, 6, 3],
    [EARTH, 3, 5, 2, 2],
    [GREY, 6, 0, 1, 3],
    [SUN, 4, 0, 2, 2],
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
