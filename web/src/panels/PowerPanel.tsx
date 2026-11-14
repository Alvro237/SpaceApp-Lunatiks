/**
 * Power and environment for the chosen place and window, in two layers so the planner is not flooded:
 *
 *   At a glance (always shown, no input needed): power reaching 1 m² of panel, solar elevation, sunlight
 *   duration, Earth visibility windows and the cosmic-ray dose. All but the dose come from the same engine as the
 *   map and timeline; the dose comes from POST /api/v1/radiation (MECH, LRO CRaTER).
 *
 *   Advanced options: the MECH /power model (docs/api-guide-mech.md, flat fields), offered as two concepts
 *   instead of numbered levels: "Solar array" (API level 2: area, efficiency, losses -> watts and energy) and
 *   "Battery balance" (API level 3: the array feeding a battery and a load -> does it last the longest night).
 *   The battery curve is drawn in the timeline at the bottom. No panel, battery or load value is pre-filled:
 *   none has a cited source yet. The example button fills the guide's test values and says so.
 */
import { type FormEvent, type ReactNode, useId, useMemo, useState } from 'react'
import { isMissing } from '../api/client'
import { usePower, useRadiation } from '../api/hooks'
import type { PowerRequest, PowerResponse, RadiationRequest } from '../api/types'
import { type PowerKey, type PowerModel, useCurrentPowerResult, usePowerStore, useScenarioId } from '../state/power'
import { useApp } from '../state/store'
import { formatDuration, formatUtc, isoMinute } from '../time/clock'
import { useParams } from '../time/hooks'
import { ApiStatus, SourceTag } from '../ui/ApiStatus'
import { IconAntenna, IconBattery, IconBolt, IconClock, IconElevation, IconPanel, IconRadiation, IconSliders } from '../ui/icons'
import { useNow } from './useNow'

interface FieldSpec {
  key: PowerKey
  label: string
  unit: string
  hint: string
  optional?: boolean
}

const ARRAY: FieldSpec[] = [
  { key: 'panel_area_m2', label: 'Panel area', unit: 'm²', hint: 'Total area of solar cells.' },
  { key: 'cell_efficiency', label: 'Cell efficiency', unit: '0–1', hint: 'Share of sunlight turned into electricity, e.g. 0.3.' },
  { key: 'derating', label: 'Other losses factor', unit: '0–1', hint: '1 means no wiring, dust or temperature losses.' },
]
const BATTERY: FieldSpec[] = [
  { key: 'battery_capacity_wh', label: 'Capacity', unit: 'Wh', hint: 'Energy the battery holds when full.' },
  { key: 'battery_initial_soc', label: 'Charge at start', unit: '0–1', hint: '1 means full at the start of the window.' },
  { key: 'battery_min_soc', label: 'Lowest allowed charge', unit: '0–1', hint: 'Below this the battery counts as empty.' },
  { key: 'charge_efficiency', label: 'Charge efficiency', unit: '0–1', hint: 'Energy kept when charging.' },
  { key: 'discharge_efficiency', label: 'Discharge efficiency', unit: '0–1', hint: 'Energy delivered when discharging.' },
]
const LOAD: FieldSpec[] = [
  { key: 'load_w', label: 'Load', unit: 'W', hint: 'Power the lander draws while in sunlight.' },
  { key: 'night_load_w', label: 'Load in darkness', unit: 'W', hint: 'Leave empty to use the same load.', optional: true },
]
const ALL = [...ARRAY, ...BATTERY, ...LOAD]

/** Test values from docs/api-guide-mech.md: for trying the model, not recommended limits. */
const EXAMPLE: Partial<Record<PowerKey, string>> = {
  panel_area_m2: '2',
  cell_efficiency: '0.3',
  derating: '0.9',
  load_w: '60',
  battery_capacity_wh: '3000',
  battery_initial_soc: '1',
  battery_min_soc: '0.2',
  charge_efficiency: '0.95',
  discharge_efficiency: '0.95',
}

const fmt = (v: number | null | undefined, digits = 0, unit = '') => (v === null || v === undefined ? '—' : `${v.toFixed(digits)}${unit}`)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)} %`)
const PANEL_WORD: Record<string, string> = { vertical: 'vertical panel', tracking: 'Sun-tracking panel', horizontal: 'flat panel' }
const stepFor = (durationH: number) => Math.max(60, Math.ceil((durationH * 60) / 19_000))

export function PowerPanel() {
  return (
    <div className="panel-section power">
      <Essentials />
      <Advanced />
    </div>
  )
}

/* ------------------------------------------------------------------ at a glance */

function Essentials() {
  const { series: local, view } = useNow()
  const durationH = useApp((s) => s.durationH)
  const params = useParams()

  if (!local || !view) return <p className="muted">Loading…</p>
  const m = local.metrics
  const sunlitH = (m.sunlightPct / 100) * durationH
  const windows = local.comms.length

  return (
    <>
      <h3 className="sub-head">At a glance</h3>
      <ul className="metric-grid">
        <Metric
          icon={<IconBolt />}
          tone="sun"
          label="Power per m²"
          value={`${m.meanPowerWm2.toFixed(0)} W/m²`}
          sub={`Mean in the window · now ${view.power.toFixed(0)} W/m², ${PANEL_WORD[params.panel] ?? params.panel}`}
        />
        <Metric
          icon={<IconElevation />}
          tone="sun"
          label="Solar elevation"
          value={`${view.sun.el.toFixed(1)}°`}
          sub={`Now · from ${m.minSunElDeg.toFixed(1)}° to ${m.maxSunElDeg.toFixed(1)}° in the window`}
        />
        <Metric
          icon={<IconClock />}
          tone="sun"
          label="Sunlight duration"
          value={`${sunlitH.toFixed(0)} h`}
          sub={`${m.sunlightPct.toFixed(0)} % of the window · longest night ${m.longestDarkH.toFixed(0)} h`}
        />
        <Metric
          icon={<IconAntenna />}
          tone="earth"
          label="Earth visibility windows"
          value={windows === 0 ? 'None' : `${windows} ${windows === 1 ? 'window' : 'windows'}`}
          sub={`${m.commsPct.toFixed(0)} % in contact · ${
            view.nextEarth ? `${view.nextEarth.kind === 'rise' ? 'Earthrise' : 'Earthset'} in ${formatDuration(view.nextEarth.inMs)}` : 'no change within 45 days'
          }`}
        />
        <RadiationMetric />
      </ul>
      <p className="fine">
        Computed over the {view.horizonKind === 'terrain' ? 'LOLA terrain' : 'smooth-sphere'} horizon for the whole window; the dose comes from the API. The ranges
        are in the timeline below.
      </p>
    </>
  )
}

function Metric({ icon, tone, label, value, sub }: { icon?: ReactNode; tone: 'sun' | 'earth' | 'neutral'; label: string; value: string; sub: ReactNode }) {
  return (
    <li className={`metric metric-${tone}`}>
      {icon && <span className="metric-icon">{icon}</span>}
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-sub">{sub}</span>
    </li>
  )
}

function useRadiationRequest(): RadiationRequest {
  const selection = useApp((s) => s.selection)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const qf = usePowerStore((s) => s.qualityFactor)
  return useMemo(() => {
    const q = Number(qf)
    return {
      ...(selection.kind === 'site' ? { site_id: selection.id } : { lat: selection.lat, lon: selection.lon }),
      start: isoMinute(startMs),
      duration_h: durationH,
      step_min: stepFor(durationH),
      mast_m: mastM,
      ...(qf.trim() && Number.isFinite(q) && q > 0 ? { quality_factor: q } : {}),
    }
  }, [selection, startMs, durationH, mastM, qf])
}

function RadiationMetric() {
  const rad = useRadiation(useRadiationRequest())
  const r = rad.data
  let value = '…'
  let sub: ReactNode = 'Asking the API'
  if (rad.error) {
    value = 'Unavailable'
    sub = isMissing(rad.error) ? 'Needs the radiation endpoint (MECH)' : 'The API did not answer'
  } else if (r) {
    const d = r.mission_gcr_dose_mgy_si
    value = d ? `${d.mean.toFixed(1)} mGy` : 'Unknown'
    sub = d ? `Cosmic-ray dose in the window (silicon), ${d.low.toFixed(1)}–${d.high.toFixed(1)}` : 'No sky data at this point'
    if (r.risk) sub = `${sub} · risk ${r.risk.index.toFixed(1)}/10`
  }
  return <Metric icon={<IconRadiation />} tone="neutral" label="Radiation" value={value} sub={sub} />
}

/* ------------------------------------------------------------------ advanced */

function Advanced() {
  const id = useId()
  const selection = useApp((s) => s.selection)
  const mastM = useApp((s) => s.mastM)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const params = useParams()
  const model = usePowerStore((s) => s.model)
  const f = usePowerStore((s) => s.fields)
  const usedExample = usePowerStore((s) => s.usedExample)
  const result = usePowerStore((s) => s.result)
  const { setModel, setFields, setResult } = usePowerStore.getState()
  const current = useCurrentPowerResult()
  const sid = useScenarioId()
  const [error, setError] = useState<string | null>(null)
  const power = usePower()
  const level = model === 'battery' ? 3 : 2

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const num = (k: PowerKey): number | undefined => {
      const s = ALL.find((x) => x.key === k)!
      const v = f[k]?.trim()
      if (!v) {
        if (s.optional) return undefined
        throw new Error(`${s.label} is required`)
      }
      const n = Number(v)
      if (!Number.isFinite(n)) throw new Error(`${s.label} must be a number`)
      return n
    }
    try {
      const body: PowerRequest = {
        ...(selection.kind === 'site' ? { site_id: selection.id } : { lat: selection.lat, lon: selection.lon }),
        start: isoMinute(startMs),
        duration_h: durationH,
        // keep within the API's 20 000-sample limit for long windows
        step_min: stepFor(durationH),
        mast_m: mastM,
        panel: params.panel,
        level,
        panel_area_m2: num('panel_area_m2'),
        cell_efficiency: num('cell_efficiency'),
        derating: num('derating'),
        ...(level === 3
          ? {
              battery_capacity_wh: num('battery_capacity_wh'),
              battery_initial_soc: num('battery_initial_soc'),
              battery_min_soc: num('battery_min_soc'),
              charge_efficiency: num('charge_efficiency'),
              discharge_efficiency: num('discharge_efficiency'),
              load_w: num('load_w'),
              night_load_w: num('night_load_w'),
            }
          : {}),
      }
      setError(null)
      const forScenario = sid
      power.mutate(body, { onSuccess: (r) => setResult(r, forScenario) })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const input = (s: FieldSpec) => (
    <div className="pfield" key={s.key}>
      <label htmlFor={`${id}-${s.key}`}>
        {s.label}
        {s.optional && <span className="opt"> (optional)</span>}
      </label>
      <div className="unit-input">
        <input
          id={`${id}-${s.key}`}
          inputMode="decimal"
          autoComplete="off"
          value={f[s.key] ?? ''}
          aria-describedby={`${id}-${s.key}-h`}
          onChange={(e) => setFields({ ...f, [s.key]: e.target.value })}
        />
        <span className="unit" aria-hidden="true">
          {s.unit}
        </span>
      </div>
      <p id={`${id}-${s.key}-h`} className="pfield-hint">
        {s.hint}
        <span className="sr-only"> Unit: {s.unit}.</span>
      </p>
    </div>
  )

  const models: { id: PowerModel; icon: ReactNode; title: string; text: string }[] = [
    { id: 'array', icon: <IconPanel size={22} />, title: 'Solar array', text: 'Watts and energy from a panel you size.' },
    { id: 'battery', icon: <IconBattery size={22} />, title: 'Battery balance', text: 'Array, battery and load: does it last the night?' },
  ]

  return (
    <details className="advanced">
      <summary>
        <IconSliders size={18} /> Advanced options
      </summary>

      <form onSubmit={submit} noValidate className="power-form" aria-label="Power model">
        <fieldset className="model-cards">
          <legend>What to compute</legend>
          {models.map((mo) => (
            <label key={mo.id} className={`model-card${model === mo.id ? ' is-on' : ''}`}>
              <input type="radio" className="sr-only" name={`${id}-model`} checked={model === mo.id} onChange={() => setModel(mo.id)} />
              <span className="model-icon">{mo.icon}</span>
              <span className="model-title">{mo.title}</span>
              <span className="model-text">{mo.text}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="pgroup">
          <legend>
            <IconPanel size={16} /> Solar array
          </legend>
          {ARRAY.map(input)}
        </fieldset>
        {model === 'battery' && (
          <>
            <fieldset className="pgroup">
              <legend>
                <IconBattery size={16} /> Battery
              </legend>
              {BATTERY.map(input)}
            </fieldset>
            <fieldset className="pgroup">
              <legend>
                <IconBolt size={16} /> Load
              </legend>
              {LOAD.map(input)}
            </fieldset>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={power.isPending}>
            {power.isPending ? 'Computing…' : model === 'battery' ? 'Compute battery balance' : 'Compute array output'}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setFields({ ...EXAMPLE, night_load_w: f.night_load_w }, true)
              setError(null)
            }}
          >
            Fill example values
          </button>
        </div>
        {usedExample && <p className="fine">Example values for trying the model (2 m², 30 %, 60 W, 3 kWh…), not mission recommendations.</p>}
      </form>

      {power.error && <ApiStatus error={power.error} what="Power model" fallback={isMissing(power.error) ? 'Coming with the MECH model.' : undefined} />}
      {result && !current && <p className="note">The place or window changed since the last result. Compute again to update it.</p>}
      {current && <PowerResult r={current} />}
      <RadiationAdvanced />
    </details>
  )
}

function PowerResult({ r }: { r: PowerResponse }) {
  return (
    <div className="result" aria-live="polite">
      <p className="meta-line">
        <span className={`badge badge-${r.horizon_kind}`}>
          {r.horizon_kind === 'terrain' ? `LOLA terrain horizon · ${r.mast_m_used} m` : 'Smooth-sphere horizon (estimate)'}
        </span>
        <SourceTag source="api" />
      </p>
      {r.level === 3 && r.survives !== null && (
        <p className={`verdict-box ${r.survives ? 'pass' : 'fail'}`}>
          <span aria-hidden="true">{r.survives ? '✓ ' : '✗ '}</span>
          {r.survives ? 'The load is served for the whole window' : `The battery runs out${r.first_depletion_at ? ` on ${formatUtc(Date.parse(r.first_depletion_at))}` : ''}`}
        </p>
      )}
      <ul className="metric-grid compact">
        <Metric tone="sun" label="Mean array power" value={fmt(r.mean_power_w, 1, ' W')} sub={`peak ${fmt(r.peak_power_w, 1, ' W')}`} />
        <Metric
          tone="sun"
          label="Energy in the window"
          value={r.energy_wh === null ? '—' : `${(r.energy_wh / 1000).toFixed(2)} kWh`}
          sub={r.eclipse_ranges.length > 0 ? `${fmt(r.eclipse_energy_loss_wh, 0, ' Wh')} lost to eclipses` : 'no eclipse in the window'}
        />
        {r.level === 3 && (
          <>
            <Metric tone="neutral" label="Lowest charge" value={pct(r.min_soc)} sub={`at the end ${pct(r.final_soc)}`} />
            <Metric tone="neutral" label="Longest night needs" value={fmt(r.longest_dark_energy_wh, 0, ' Wh')} sub={`of ${fmt(r.usable_capacity_wh, 0, ' Wh')} usable`} />
          </>
        )}
      </ul>
      {r.level === 3 && (
        <>
          <dl className="kv">
            <div>
              <dt>Margin at the worst moment</dt>
              <dd>{fmt(r.energy_margin_wh, 0, ' Wh')}</dd>
            </div>
            {(r.unserved_energy_wh ?? 0) > 0 && (
              <div>
                <dt>Load not served</dt>
                <dd>{fmt(r.unserved_energy_wh, 0, ' Wh')}</dd>
              </div>
            )}
          </dl>
          <p className="fine">The battery charge over time is drawn in the timeline at the bottom.</p>
        </>
      )}
      {r.assumptions.length > 0 && (
        <details>
          <summary>Assumptions</summary>
          <ul>
            {r.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function RadiationAdvanced() {
  const id = useId()
  const qf = usePowerStore((s) => s.qualityFactor)
  const setQf = usePowerStore((s) => s.setQualityFactor)
  const r = useRadiation(useRadiationRequest()).data
  return (
    <fieldset className="pgroup">
      <legend>
        <IconRadiation size={16} /> Radiation risk
      </legend>
      <div className="pfield">
        <label htmlFor={`${id}-q`}>GCR quality factor</label>
        <div className="unit-input">
          <input id={`${id}-q`} inputMode="decimal" autoComplete="off" value={qf} onChange={(e) => setQf(e.target.value)} aria-describedby={`${id}-q-h`} />
          <span className="unit" aria-hidden="true">
            Q
          </span>
        </div>
        <p id={`${id}-q-h`} className="pfield-hint">
          Turns absorbed dose into effective dose and a 1–10 astronaut risk index. No cited default yet: MSL RAD suggests about 3.8 (to verify).
        </p>
      </div>
      {r && (
        <dl className="kv">
          <div>
            <dt>Shielding by terrain</dt>
            <dd>{r.shielding_factor === null ? '—' : `${(r.shielding_factor * 100).toFixed(0)} % of free space`}</dd>
          </div>
          <div>
            <dt>Effective dose</dt>
            <dd>{r.mission_effective_dose_msv ? `${r.mission_effective_dose_msv.mean.toFixed(1)} mSv` : '— (needs Q)'}</dd>
          </div>
          <div>
            <dt>Risk index</dt>
            <dd>{r.risk ? `${r.risk.index.toFixed(1)} / 10` : '— (needs Q)'}</dd>
          </div>
          <div>
            <dt>Share of career limit</dt>
            <dd>{r.fraction_of_career_limit === null ? '—' : `${(r.fraction_of_career_limit * 100).toFixed(2)} % of ${r.career_limit_msv} mSv`}</dd>
          </div>
        </dl>
      )}
      {r && (
        <p className="fine">
          {r.dataset.name} ({r.dataset.first.slice(0, 4)}–{r.dataset.last.slice(0, 4)}), galactic cosmic rays only.
        </p>
      )}
    </fieldset>
  )
}
