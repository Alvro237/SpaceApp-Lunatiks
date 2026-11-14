/**
 * Threshold fields of the hard filters, as specified in docs/endpoints.md. Only the filters the API reports
 * as registered (GET /meta/constraints) are offered; a registered filter without a spec here gets a JSON box.
 * No value is pre-filled: thresholds need a cited source or the owner's decision (CLAUDE.md).
 */
export interface FieldSpec {
  key: string
  label: string
  kind: 'number' | 'select'
  options?: string[]
  optional?: boolean
}

export const FILTER_SPECS: Record<string, { title: string; fields: FieldSpec[]; help?: string }> = {
  max_slope: { title: 'Maximum slope', fields: [{ key: 'max_deg', label: 'Max slope (°)', kind: 'number' }] },
  continuous_light: {
    title: 'Sunlight during the mission',
    fields: [
      { key: 'min_fraction', label: 'Min share of time lit (0–1)', kind: 'number', optional: true },
      { key: 'max_dark_h', label: 'Max dark stretch (h)', kind: 'number', optional: true },
      { key: 'min_sun_fraction', label: 'Disc share that counts as lit (0–1)', kind: 'number', optional: true },
    ],
    help: 'Leave blank to use the API’s strict reading: light for the whole mission.',
  },
  sun_elevation_at_landing: {
    title: 'Solar elevation at landing',
    fields: [
      { key: 'min_deg', label: 'Min (°)', kind: 'number' },
      { key: 'max_deg', label: 'Max (°)', kind: 'number', optional: true },
    ],
  },
  crater_density: {
    title: 'Crater density',
    fields: [
      { key: 'max_per_km2', label: 'Max craters per km²', kind: 'number' },
      { key: 'radius_km', label: 'Radius (km)', kind: 'number' },
      { key: 'min_diam_km', label: 'Min diameter (km)', kind: 'number' },
    ],
  },
  rock_abundance: { title: 'Rocks', fields: [], help: 'No boulder dataset exists: this filter reports “unknown”.' },
  comms_hours: {
    title: 'Direct-to-Earth time',
    fields: [
      { key: 'min_hours', label: 'Min hours', kind: 'number', optional: true },
      { key: 'min_fraction', label: 'or min share of time (0–1)', kind: 'number', optional: true },
    ],
  },
  max_blackout: { title: 'Longest blackout', fields: [{ key: 'max_hours', label: 'Max hours without Earth', kind: 'number' }] },
  max_temperature: {
    title: 'Maximum temperature',
    fields: [
      { key: 'max_k', label: 'Max (K)', kind: 'number' },
      { key: 'mode', label: 'Reading', kind: 'select', options: ['discrete', 'continuous'] },
      { key: 'max_hours_above', label: 'Hours above allowed (continuous)', kind: 'number', optional: true },
    ],
  },
  radiation: {
    title: 'Radiation',
    fields: [
      { key: 'max_dose', label: 'Max dose', kind: 'number' },
      { key: 'unit', label: 'Unit', kind: 'select', options: ['mSv', 'mGy'] },
    ],
  },
}

export function buildThreshold(spec: FieldSpec[], values: Record<string, string>): Record<string, unknown> | string {
  const out: Record<string, unknown> = {}
  for (const f of spec) {
    const v = (values[f.key] ?? '').trim()
    if (!v) {
      if (f.optional) continue
      return `${f.label} is required`
    }
    if (f.kind === 'number') {
      const n = Number(v.replace(',', '.'))
      if (!Number.isFinite(n)) return `${f.label} must be a number`
      out[f.key] = n
    } else out[f.key] = v
  }
  return out
}
