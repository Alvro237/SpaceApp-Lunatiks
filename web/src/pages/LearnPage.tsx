/** Short explanations for educators and the public: why light and Earth contact are hard at the south pole. */
export function LearnPage() {
  return (
    <article className="page prose">
      <h1>Learn</h1>
      <p className="intro">Why choosing where and when to land near the lunar south pole is a question of horizons.</p>

      <h2>A Sun that skims the horizon</h2>
      <p>
        The Moon's axis is tilted only about 1.5° from upright, so near the poles the Sun never climbs high: it circles the sky a few degrees above or below
        the horizon. A small hill or crater rim is enough to hide it. Some crater floors have not seen sunlight for billions of years (permanent shadow),
        while some ridges are lit most of the time.
      </p>

      <h2>An Earth that rises and sets</h2>
      <p>
        From the near side the Earth hangs almost still in the sky. Near the south pole it sits close to the horizon and rocks up and down by several degrees
        over the month (libration), so a lander can lose direct radio contact for days. Planners need to know both: when the Sun sets for power, and when the
        Earth sets for communication.
      </p>

      <h2>Discs, not points</h2>
      <p>
        The Sun looks about half a degree wide and the Earth almost two degrees. When they graze the terrain, a share of the disc can be hidden: this tool
        reports the visible share, not just above or below.
      </p>

      <h2>No air, sharp shadows</h2>
      <p>
        The Moon has no atmosphere to bend light or scatter it into twilight. A place is lit only by the part of the Sun it can see directly, which is why the
        horizon decides everything.
      </p>

      <h2>Words used in the tool</h2>
      <dl className="glossary">
        <dt>Azimuth</dt>
        <dd>Direction along the horizon, measured clockwise from north (90° is east).</dd>
        <dt>Elevation</dt>
        <dd>Angle above the flat horizontal; negative means below it.</dd>
        <dt>Horizon mask</dt>
        <dd>The height of the skyline in every direction, computed from LOLA laser altimetry of the real terrain.</dd>
        <dt>Mast</dt>
        <dd>Height of the solar panel or antenna above the ground; a taller mast sees over nearby bumps.</dd>
        <dt>UTC</dt>
        <dd>Coordinated Universal Time, used for every date in the tool.</dd>
      </dl>
    </article>
  )
}
