/**
 * Power and environment for the chosen place and window, in two layers so the planner is not flooded:
 *
 *   At a glance (always shown, no input needed): power reaching 1 m² of panel, solar elevation, sunlight
 *   duration, Earth visibility windows and the cosmic-ray dose. All but the dose come from the same engine as the
 *   map and timeline; the dose comes from POST /api/v1/radiation (MECH, LRO CRaTER).
 *
 *   Advanced options: the MECH /power model (docs/api-guide-mech.md, flat fields), offered as three concepts
 *   instead of numbered levels: "Solar array" (API level 2: area, efficiency, losses -> watts and energy),
 *   "Battery balance" (level 3: the array feeding a battery and a load -> does it last the longest night) and
 *   "Colony" (level 4: a heated habitat with essential and optional loads -> survives on its own, drains or
 *   fails, and the size it would need). The battery and inside-temperature curves are drawn in the timeline at
 *   the bottom. No panel, battery, load or habitat value is pre-filled: none has a cited source yet. The example
 *   button fills the guide's / test suite's values and says so.
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
import { Tip } from '../ui/Tip'
import { IconAntenna, IconBattery, IconBolt, IconClock, IconElevation, IconHabitat, IconPanel, IconRadiation, IconSliders, IconThermo } from '../ui/icons'
import { ColonyResult } from './ColonyResult'
import { ALL_FIELDS, ARRAY, BATTERY, COLONY_LOADS, EXAMPLE, EXAMPLE_COLONY, type FieldSpec, HABITAT, LOAD, REGOLITH, SYNODIC_MONTH_H } from './powerSpecs'
import { PanelSetting } from './Settings'
import { useNow } from './useNow'

const K = 273.15
const fmt = (v: number | null | undefined, digits = 0, unit = '') => (v === null || v === undefined ? '—' : `${v.toFixed(digits)}${unit}`)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)} %`)
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

  if (!local || !view) return <p className="muted">Loading…</p>
  const m = local.metrics
  const sunlitH = (m.sunlightPct / 100) * durationH
  const windows = local.comms.length

  return (
    <div className="power-col">
      <PanelSetting />
      <h3 className="sub-head">
        At a glance
        <Tip label="the summary">
          Computed with the browser engine over the {view.horizonKind === 'terrain' ? 'LOLA terrain' : 'smooth-sphere'} horizon for the whole window. The
          radiation dose comes from the API. The time ranges are in the timeline below.
        </Tip>
      </h3>
      <ul className="metric-grid">
        <Metric
          icon={<IconBolt />}
          tone="sun"
          label="Power per m²"
          value={`${m.meanPowerWm2.toFixed(0)} W/m²`}
          sub={`Mean · now ${view.power.toFixed(0)} W/m²`}
        />
        <Metric
          icon={<IconElevation />}
          tone="sun"
          label="Solar elevation"
          value={`${view.sun.el.toFixed(1)}°`}
          sub={`Now · range ${m.minSunElDeg.toFixed(1)}° to ${m.maxSunElDeg.toFixed(1)}°`}
        />
        <Metric
          icon={<IconClock />}
          tone="sun"
          label="Sunlight duration"
          value={`${sunlitH.toFixed(0)} h`}
          sub={`${m.sunlightPct.toFixed(0)} % · longest night ${m.longestDarkH.toFixed(0)} h`}
        />
        <Metric
          icon={<IconAntenna />}
          tone="earth"
          label="Earth visibility windows"
          value={windows === 0 ? 'None' : `${windows} ${windows === 1 ? 'window' : 'windows'}`}
          sub={`${m.commsPct.toFixed(0)} % in contact${view.nextEarth ? ` · ${view.nextEarth.kind === 'rise' ? 'rise' : 'set'} in ${formatDuration(view.nextEarth.inMs)}` : ''}`}
        />
        <RadiationMetric />
      </ul>
    </div>
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
  let sub: ReactNode = 'Asking the API…'
  if (rad.error) {
    value = 'Unavailable'
    sub = isMissing(rad.error) ? 'Endpoint not deployed' : 'No answer from the API'
  } else if (r) {
    const d = r.mission_gcr_dose_mgy_si
    value = d ? `${d.mean.toFixed(1)} mGy` : '—'
    sub = d ? `Cosmic rays · ${d.low.toFixed(1)}–${d.high.toFixed(1)}` : 'No sky data here'
    if (r.risk) sub = `${sub} · risk ${r.risk.index.toFixed(1)}/10`
  }
  return <Metric icon={<IconRadiation />} tone="neutral" label="Radiation" value={value} sub={sub} />
}

/* ------------------------------------------------------------------ advanced */

const LEVEL: Record<PowerModel, 2 | 3 | 4> = { array: 2, battery: 3, colony: 4 }

function Advanced() {
  const id = useId()
  const selection = useApp((s) => s.selection)
  const mastM = useApp((s) => s.mastM)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const params = useParams()
  const model = usePowerStore((s) => s.model)
  const f = usePowerStore((s) => s.fields)
  const commsCritical = usePowerStore((s) => s.comms_critical)
  const includeSizing = usePowerStore((s) => s.include_sizing)
  const usedExample = usePowerStore((s) => s.usedExample)
  const result = usePowerStore((s) => s.result)
  const { setModel, setFields, setResult, setFlag } = usePowerStore.getState()
  const current = useCurrentPowerResult()
  const sid = useScenarioId()
  const [error, setError] = useState<string | null>(null)
  const power = usePower()
  const level = LEVEL[model]
  const tooShort = model === 'colony' && durationH < SYNODIC_MONTH_H

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const num = (k: PowerKey): number | undefined => {
      const s = ALL_FIELDS.find((x) => x.key === k)!
      const v = f[k]?.trim()
      if (!v) {
        if (s.optional) return undefined
        throw new Error(`${s.label} is required`)
      }
      const n = Number(v)
      if (!Number.isFinite(n)) throw new Error(`${s.label} must be a number`)
      return n
    }
    const req = (k: PowerKey) => num(k) as number
    try {
      if (tooShort) throw new Error('The colony analysis needs a window of at least 30 days')
      const battery =
        level >= 3
          ? {
              battery_capacity_wh: num('battery_capacity_wh'),
              battery_initial_soc: num('battery_initial_soc'),
              battery_min_soc: num('battery_min_soc'),
              charge_efficiency: num('charge_efficiency'),
              discharge_efficiency: num('discharge_efficiency'),
            }
          : {}
      let colony: Partial<PowerRequest> = {}
      if (level === 3) colony = { load_w: num('load_w'), night_load_w: num('night_load_w') }
      if (level === 4) {
        const tSet = req('t_set_c') + K
        const tMin = req('t_min_c') + K
        if (tMin >= tSet) throw new Error('Inside minimum must be below the inside target')
        colony = {
          critical_load_w: num('critical_load_w'),
          deferrable_load_w: num('deferrable_load_w'),
          comms_load_w: num('comms_load_w'),
          comms_critical: commsCritical,
          shed_soc: num('shed_soc'),
          max_charge_w: num('max_charge_w'),
          max_discharge_w: num('max_discharge_w'),
          include_sizing: includeSizing,
          habitat: {
            crew_count: req('crew_count'),
            t_set_k: tSet,
            t_min_k: tMin,
            ua_w_k: req('ua_w_k'),
            area_m2: req('hab_area_m2'),
            skin_absorptivity: req('skin_absorptivity'),
            skin_emissivity: req('skin_emissivity'),
            structure_mass_kg: req('structure_mass_kg'),
            structure_specific_heat_j_kgk: req('structure_specific_heat_j_kgk'),
            air_volume_m3: req('air_volume_m3'),
            air_pressure_pa: req('air_pressure_pa'),
            ...(f.metabolic_w_per_crew?.trim() ? { metabolic_w_per_crew: req('metabolic_w_per_crew') } : {}),
          },
          regolith: {
            albedo: req('reg_albedo'),
            emissivity: req('reg_emissivity'),
            conductivity_w_mk: req('reg_conductivity_w_mk'),
            density_kg_m3: req('reg_density_kg_m3'),
            heat_capacity_j_kgk: req('reg_heat_capacity_j_kgk'),
            geothermal_flux_w_m2: req('reg_geothermal_flux_w_m2'),
          },
        }
      }
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
        ...battery,
        ...colony,
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
      <div className="pfield-top">
        <label htmlFor={`${id}-${s.key}`}>
          {s.label}
          {s.optional && <span className="opt"> (optional)</span>}
        </label>
        <Tip label={s.label.toLowerCase()}>
          {s.hint} Unit: {s.unit}.
        </Tip>
      </div>
      <div className="unit-input">
        <input
          id={`${id}-${s.key}`}
          inputMode="decimal"
          autoComplete="off"
          value={f[s.key] ?? ''}
          onChange={(e) => setFields({ ...f, [s.key]: e.target.value })}
        />
        <span className="unit" aria-hidden="true">
          {s.unit}
        </span>
      </div>
    </div>
  )

  const models: { id: PowerModel; icon: ReactNode; title: string }[] = [
    { id: 'array', icon: <IconPanel size={22} />, title: 'Solar array' },
    { id: 'battery', icon: <IconBattery size={22} />, title: 'Battery balance' },
    { id: 'colony', icon: <IconHabitat size={22} />, title: 'Colony' },
  ]
  const submitLabel = model === 'colony' ? 'Analyse the colony' : model === 'battery' ? 'Compute battery balance' : 'Compute array output'

  return (
    <details className="advanced">
      <summary>
        <IconSliders size={18} /> Advanced options
      </summary>

      <form onSubmit={submit} noValidate className="power-form" aria-label="Power model">
        <fieldset className="model-cards three">
          <legend>
            What to compute
            <Tip label="the model">
              Solar array: watts and energy from a panel you size. Battery balance: the array feeding a battery and a load. Colony: a heated habitat with essential
              and optional loads, and whether it survives on its own.
            </Tip>
          </legend>
          {models.map((mo) => (
            <label key={mo.id} className={`model-card${model === mo.id ? ' is-on' : ''}`}>
              <input type="radio" className="sr-only" name={`${id}-model`} checked={model === mo.id} onChange={() => setModel(mo.id)} />
              <span className="model-icon">{mo.icon}</span>
              <span className="model-title">{mo.title}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="pgroup">
          <legend>
            <IconPanel size={16} /> Solar array
          </legend>
          {ARRAY.map(input)}
        </fieldset>
        {model !== 'array' && (
          <fieldset className="pgroup">
            <legend>
              <IconBattery size={16} /> Battery
            </legend>
            {BATTERY.map(input)}
          </fieldset>
        )}
        {model === 'battery' && (
          <fieldset className="pgroup">
            <legend>
              <IconBolt size={16} /> Load
            </legend>
            {LOAD.map(input)}
          </fieldset>
        )}
        {model === 'colony' && (
          <>
            <fieldset className="pgroup">
              <legend>
                <IconBolt size={16} /> Loads
              </legend>
              {COLONY_LOADS.map(input)}
              <label className="check-row">
                <input type="checkbox" checked={commsCritical} onChange={(e) => setFlag('comms_critical', e.target.checked)} />
                <span>Comms are essential</span>
                <Tip label="comms essential">If on, losing the Earth link counts as a failure. Off, the comms load is optional.</Tip>
              </label>
            </fieldset>
            <details className="pgroup-d">
              <summary>
                <IconHabitat size={16} /> Habitat
              </summary>
              {HABITAT.map(input)}
            </details>
            <details className="pgroup-d">
              <summary>
                <IconThermo size={16} /> Ground
              </summary>
              {REGOLITH.map(input)}
            </details>
            <label className="check-row">
              <input type="checkbox" checked={includeSizing} onChange={(e) => setFlag('include_sizing', e.target.checked)} />
              <span>Find the size needed</span>
              <Tip label="sizing">Also searches the smallest battery and panels that survive on their own. Adds about a second.</Tip>
            </label>
            {tooShort && (
              <p className="note" role="status">
                Needs 30 days or more. A year is better at the poles.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={power.isPending || tooShort}>
            {power.isPending ? 'Computing…' : submitLabel}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setFields({ ...(model === 'colony' ? EXAMPLE_COLONY : EXAMPLE), night_load_w: f.night_load_w }, true)
              setError(null)
            }}
          >
            Fill example values
          </button>
        </div>
        {usedExample && <p className="fine">Example values, not recommendations.</p>}
      </form>

      {power.error && <ApiStatus error={power.error} what="Power model" fallback={isMissing(power.error) ? 'Coming with the MECH model.' : undefined} />}
      {result && !current && <p className="note">Place or window changed. Compute again.</p>}
      {current && <PowerResult r={current} />}
      <RadiationAdvanced />
    </details>
  )
}

function PowerResult({ r }: { r: PowerResponse }) {
  return (
    <div className="result" aria-live="polite">
      <p className="meta-line">
        <span className={`badge badge-${r.horizon_kind}`}>{r.horizon_kind === 'terrain' ? `Real terrain · ${r.mast_m_used} m` : 'Estimated horizon'}</span>
        <SourceTag source="api" />
      </p>
      {r.level === 4 ? (
        <ColonyResult r={r} />
      ) : (
        <>
          {r.level === 3 && r.survives !== null && (
            <p className={`verdict-box ${r.survives ? 'pass' : 'fail'}`}>
              <span aria-hidden="true">{r.survives ? '✓ ' : '✗ '}</span>
              {r.survives ? 'Load served all window' : `Battery runs out${r.first_depletion_at ? ` on ${formatUtc(Date.parse(r.first_depletion_at))}` : ''}`}
            </p>
          )}
          <ul className="metric-grid compact">
            <Metric tone="sun" label="Panel power (W)" value={fmt(r.mean_power_w, 1, ' W')} sub={`peak ${fmt(r.peak_power_w, 1, ' W')}`} />
            <Metric
              tone="sun"
              label="Energy produced (kWh)"
              value={r.energy_wh === null ? '—' : `${(r.energy_wh / 1000).toFixed(2)} kWh`}
              sub={r.eclipse_ranges.length > 0 ? `${fmt(r.eclipse_energy_loss_wh, 0, ' Wh')} lost to eclipses` : 'no eclipses'}
            />
            {r.level === 3 && (
              <>
                <Metric tone="neutral" label="Lowest battery (%)" value={pct(r.min_soc)} sub={`at the end ${pct(r.final_soc)}`} />
                <Metric
                  tone="neutral"
                  label="Energy to spare (kWh)"
                  value={r.energy_margin_wh === null ? '—' : `${(r.energy_margin_wh / 1000).toFixed(2)} kWh`}
                  sub={`longest night needs ${fmt(r.longest_dark_energy_wh, 0, ' Wh')}`}
                />
              </>
            )}
          </ul>
          {r.level === 3 && (r.unserved_energy_wh ?? 0) > 0 && (
            <dl className="kv">
              <div>
                <dt>Load not served</dt>
                <dd>{fmt(r.unserved_energy_wh, 0, ' Wh')}</dd>
              </div>
            </dl>
          )}
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
        <div className="pfield-top">
          <label htmlFor={`${id}-q`}>Quality factor</label>
          <Tip label="the quality factor">
            Turns absorbed dose into effective dose and a 1–10 astronaut risk index. No cited default yet: MSL RAD suggests about 3.8 (to verify).
          </Tip>
        </div>
        <div className="unit-input">
          <input id={`${id}-q`} inputMode="decimal" autoComplete="off" value={qf} onChange={(e) => setQf(e.target.value)} />
          <span className="unit" aria-hidden="true">
            Q
          </span>
        </div>
      </div>
      {r && (
        <dl className="kv">
          <div>
            <dt>
              Shielding
              <Tip label="shielding">
                Share of the free-space dose that reaches this point, from the open sky. Dataset: {r.dataset.name} ({r.dataset.first.slice(0, 4)}–
                {r.dataset.last.slice(0, 4)}), galactic cosmic rays only.
              </Tip>
            </dt>
            <dd>{r.shielding_factor === null ? '—' : `${(r.shielding_factor * 100).toFixed(0)} %`}</dd>
          </div>
          <div>
            <dt>Effective dose</dt>
            <dd>{r.mission_effective_dose_msv ? `${r.mission_effective_dose_msv.mean.toFixed(1)} mSv` : '— (needs Q)'}</dd>
          </div>
          <div>
            <dt>Radiation risk (1-10)</dt>
            <dd>{r.risk ? `${r.risk.index.toFixed(1)} / 10` : '— (needs Q)'}</dd>
          </div>
          <div>
            <dt>Of career limit</dt>
            <dd>{r.fraction_of_career_limit === null ? '—' : `${(r.fraction_of_career_limit * 100).toFixed(2)} %`}</dd>
          </div>
        </dl>
      )}
    </fieldset>
  )
}
