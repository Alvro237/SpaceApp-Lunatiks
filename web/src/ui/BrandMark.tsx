/**
 * The project mark: the lunar limb, a jagged skyline across it and the Sun grazing that skyline. It draws the
 * one idea the tool is about: near the pole the Sun skims the horizon and the terrain decides the light.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-svg" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="13.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.2 19.5 L8 17.2 L11 18.6 L14.5 14.8 L17.6 17.8 L20.4 16.4 L24 19 L28.8 18.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="23.2" cy="15.2" r="2.6" fill="var(--sun)" />
    </svg>
  )
}
