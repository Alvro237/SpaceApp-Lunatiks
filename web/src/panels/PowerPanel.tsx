/**
 * Power and environment for the chosen place and window, in three bands from fixed data to options:
 *
 *   1. At a glance (always there, no input): power reaching 1 m² of panel, solar elevation, sunlight duration,
 *      Earth visibility windows and the cosmic-ray dose, as a strip of stat cards with the context they assume
 *      (horizon, window, panel). All but the dose come from the same engine as the map and timeline; the dose
 *      comes from POST /api/v1/radiation (MECH, LRO CRaTER).
 *   2. Result: what the power model answered, verdict first, when it has been computed for this scenario.
 *   3. Options: the model (Solar array = API level 2, with the panel orientation inside it; Battery balance = level 3; Colony =
 *      level 4; docs/api-guide-mech.md, flat fields) and its inputs in collapsible panels that say how many of
 *      their fields are filled, then the radiation risk factor. No panel, battery, load or habitat value is
 *      pre-filled: none has a cited source yet; the example button fills the guide's / test suite's values and
 *      says so. The battery and inside-temperature curves are drawn in the timeline at the bottom.
 *
 * Headings give the bands a structure for screen readers; every panel is a native <details>; every explanation
 * sits behind an ⓘ button.
 */
import { type FormEvent, type ReactNode, useId, useMemo, useState } from 'react'
import { isMissing } from '../api/client'
import { usePower, useRadiation } from '../api/hooks'
import type { PowerRequest, PowerResponse, RadiationRequest } from '../api/types'
import { type PowerKey, type PowerModel, useCurrentPowerResult, usePowerStore, useScenarioId } from '../state/power'
import { type Selection, useApp } from '../state/store'
import { formatDuration, formatUtc, isoMinute } from '../time/clock'
import { useParams } from '../time/hooks'
import { ApiStatus, SourceTag } from '../ui/ApiStatus'
import { Tip } from '../ui/Tip'
import {
  IconAntenna,
  IconBattery,
  IconBolt,
  IconClock,
  IconElevation,
  IconHabitat,
  IconPanel,
  IconRadiation,
  IconSliders,
} from '../ui/icons'
import { ColonyResult } from './ColonyResult'
import { ALL_FIELDS, ARRAY, BATTERY, COLONY_LOADS, EXAMPLE, EXAMPLE_COLONY, type FieldSpec, HABITAT, LOAD, SYNODIC_MONTH_H } from './powerSpecs'
import { PanelSetting } from './Settings'
import { useNow } from './useNow'

const K = 273.15
const fmt = (v: number | null | undefined, digits = 0, unit = '') => (v === null || v === undefined ? '—' : `${v.toFixed(digits)}${unit}`)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)} %`)
const stepFor = (durationH: number) => Math.max(60, Math.ceil((durationH * 60) / 19_000))
const PANEL_WORD: Record<string, string> = { vertical: 'Vertical panel', tracking: 'Sun-tracking panel', horizontal: 'Flat panel' }

const MODELS: { id: PowerModel; level: 2 | 3 | 4; title: string; icon: (s: number) => ReactNode }[] = [
  { id: 'array', level: 2, title: 'Solar array', icon: (s) => <IconPanel size={s} /> },
  { id: 'battery', level: 3, title: 'Battery', icon: (s) => <IconBattery size={s} /> },
  { id: 'colony', level: 4, title: 'Colony', icon: (s) => <IconHabitat size={s} /> },
]

export function PowerPanel() {
  return (
    <div className="panel-section power2">
      <Summary />
      <Model />
    </div>
  )
}

/* ------------------------------------------------------------------ 1. at a glance */

function Summary() {
  const id = useId()
  const { series: local, view } = useNow()
  const durationH = useApp((s) => s.durationH)
  const params = useParams()

  if (!local || !view) return <p className="muted">Loading…</p>
  const m = local.metrics
  const sunlitH = (m.sunlightPct / 100) * durationH
  const windows = local.comms.length

  return (
    <section className="band" aria-labelledby={`${id}-h`}>
      <div className="band-head">
        <h3 id={`${id}-h`} className="band-title">
          At a glance
        </h3>
        <Tip label="the summary">
          Computed with the browser engine over the {view.horizonKind === 'terrain' ? 'LOLA terrain' : 'smooth-sphere'} horizon for the whole window. The
          radiation dose comes from the API. The time ranges are in the timeline below.
        </Tip>
        <ul className="context-chips" aria-label="Assumed">
          <li>{view.horizonKind === 'terrain' ? 'Real terrain' : 'Estimated horizon'}</li>
          <li>{Math.round(durationH / 24)} days</li>
          <li>{PANEL_WORD[params.panel] ?? params.panel}</li>
        </ul>
      </div>
      <ul className="stat-strip">
        <Stat icon={<IconBolt size={18} />} tone="sun" label="Power per m²" value={`${m.meanPowerWm2.toFixed(0)}`} unit="W/m²" sub={`mean · now ${view.power.toFixed(0)}`} />
        <Stat
          icon={<IconElevation size={18} />}
          tone="sun"
          label="Solar elevation"
          value={view.sun.el.toFixed(1)}
          unit="°"
          sub={`now · ${m.minSunElDeg.toFixed(1)}° to ${m.maxSunElDeg.toFixed(1)}°`}
        />
        <Stat
          icon={<IconClock size={18} />}
          tone="sun"
          label="Sunlight duration"
          value={sunlitH.toFixed(0)}
          unit="h"
          sub={`${m.sunlightPct.toFixed(0)} % · longest night ${m.longestDarkH.toFixed(0)} h`}
        />
        <Stat
          icon={<IconAntenna size={18} />}
          tone="earth"
          label="Earth visibility windows"
          value={String(windows)}
          unit={windows === 1 ? 'window' : 'windows'}
          sub={`${m.commsPct.toFixed(0)} % in contact${view.nextEarth ? ` · ${view.nextEarth.kind === 'rise' ? 'rise' : 'set'} in ${formatDuration(view.nextEarth.inMs)}` : ''}`}
        />
        <RadiationStat />
      </ul>
    </section>
  )
}

function Stat({ icon, tone, label, value, unit, sub }: { icon?: ReactNode; tone: 'sun' | 'earth' | 'neutral'; label: string; value: string; unit?: string; sub: ReactNode }) {
  return (
    <li className={`stat stat-${tone}`}>
      <span className="stat-top">
        {icon && <span className="stat-icon">{icon}</span>}
        <span className="stat-label">{label}</span>
      </span>
      <span className="stat-value">
        {value}
        {unit && <span className="stat-unit"> {unit}</span>}
      </span>
      <span className="stat-sub">{sub}</span>
    </li>
  )
}

/** The place part of a /power or /radiation request (the section is shown only with a place chosen). */
function placeFields(sel: Selection | null) {
  if (!sel) return {}
  return sel.kind === 'site' ? { site_id: sel.id } : { lat: sel.lat, lon: sel.lon, horizon: 'terrain' as const }
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
      ...placeFields(selection),
      start: isoMinute(startMs),
      duration_h: durationH,
      step_min: stepFor(durationH),
      mast_m: mastM,
      ...(qf.trim() && Number.isFinite(q) && q > 0 ? { quality_factor: q } : {}),
    }
  }, [selection, startMs, durationH, mastM, qf])
}

function RadiationStat() {
  const rad = useRadiation(useRadiationRequest())
  const r = rad.data
  let value = '…'
  let unit: string | undefined
  let sub: ReactNode = 'asking the API…'
  if (rad.error) {
    value = '—'
    sub = isMissing(rad.error) ? 'endpoint not deployed' : 'no answer from the API'
  } else if (r) {
    const d = r.mission_gcr_dose_mgy_si
    value = d ? d.mean.toFixed(1) : '—'
    unit = d ? 'mGy' : undefined
    sub = d ? `cosmic rays · ${d.low.toFixed(1)}–${d.high.toFixed(1)}` : 'no sky data here'
    if (r.risk) sub = `${sub} · risk ${r.risk.index.toFixed(1)}/10`
  }
  return <Stat icon={<IconRadiation size={18} />} tone="neutral" label="Radiation" value={value} unit={unit} sub={sub} />
}

/* ------------------------------------------------------------------ 2 and 3. result and options */

function Model() {
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
  const active = MODELS.find((m) => m.id === model)!
  const level = active.level
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
      let extra: Partial<PowerRequest> = {}
      if (level === 3) extra = { load_w: num('load_w'), night_load_w: num('night_load_w') }
      if (level === 4) {
        const tSet = req('t_set_c') + K
        const tMin = req('t_min_c') + K
        if (tMin >= tSet) throw new Error('Inside minimum must be below the inside target')
        extra = {
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
        }
      }
      const body: PowerRequest = {
        ...placeFields(selection),
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
        ...extra,
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

  const groups: { key: string; title: string; icon: ReactNode; tone: string; fields: FieldSpec[]; lead?: ReactNode; extra?: ReactNode }[] = [
    // panel shape (vertical, tracking, flat) lives inside the Solar array group, before its numbers
    { key: 'array', title: 'Solar array', icon: <IconPanel size={16} />, tone: 'yellow', fields: ARRAY, lead: <PanelSetting /> },
    ...(model !== 'array' ? [{ key: 'battery', title: 'Battery', icon: <IconBattery size={16} />, tone: 'green', fields: BATTERY }] : []),
    ...(model === 'battery' ? [{ key: 'load', title: 'Load', icon: <IconBolt size={16} />, tone: 'orange', fields: LOAD }] : []),
    ...(model === 'colony'
      ? [
          {
            key: 'loads',
            title: 'Loads',
            icon: <IconBolt size={16} />,
            tone: 'orange',
            fields: COLONY_LOADS,
            extra: (
              <label className="check-row">
                <input type="checkbox" checked={commsCritical} onChange={(e) => setFlag('comms_critical', e.target.checked)} />
                <span>Comms are essential</span>
                <Tip label="comms essential">If on, losing the Earth link counts as a failure. Off, the comms load is optional.</Tip>
              </label>
            ),
          },
          { key: 'habitat', title: 'Habitat', icon: <IconHabitat size={16} />, tone: 'blue', fields: HABITAT },
        ]
      : []),
  ]

  return (
    <>
      {(current || (result && !current) || power.error) && (
        <section className="band result-band" aria-labelledby={`${id}-res`} aria-live="polite">
          <div className="band-head">
            <h3 id={`${id}-res`} className="band-title">
              Result
            </h3>
            {current && <span className="band-sub">{MODELS.find((m) => m.level === current.level)?.title ?? `level ${current.level}`}</span>}
          </div>
          {power.error && <ApiStatus error={power.error} what="Power model" fallback={isMissing(power.error) ? 'Coming with the MECH model.' : undefined} />}
          {result && !current && <p className="note">Place or window changed. Compute again.</p>}
          {current && <PowerResult r={current} />}
        </section>
      )}

      <section className="band" aria-labelledby={`${id}-opt`}>
        <div className="band-head">
          <h3 id={`${id}-opt`} className="band-title">
            <IconSliders size={17} /> Options
          </h3>
        </div>

        <div className="opt-top">
          <div className="ios-list setting">
            <div className="ios-row stack">
              <div className="ios-row-top">
                <span className="ios-icon ios-icon-orange">
                  <IconBolt size={16} />
                </span>
                <span id={`${id}-model-l`} className="ios-label">
                  Model
                </span>
                <Tip label="the model">
                  Solar array: watts and energy from a panel you size. Battery: the array feeding a battery and a load. Colony: a heated habitat with essential and
                  optional loads, and whether it survives on its own (needs 30 days or more).
                </Tip>
              </div>
              <div className="seg seg-icons" role="radiogroup" aria-labelledby={`${id}-model-l`}>
                {MODELS.map((mo) => (
                  <label key={mo.id} className={`seg-item${model === mo.id ? ' is-on' : ''}`}>
                    <input type="radio" name={`${id}-model`} checked={model === mo.id} onChange={() => setModel(mo.id)} />
                    <span className="seg-ico">{mo.icon(15)}</span>
                    <span>{mo.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={submit} noValidate className="opt-form" aria-label={`${active.title} inputs`}>
          <div className="opt-panels">
            {groups.map((g, i) => {
              const filled = g.fields.filter((s) => (f[s.key] ?? '').trim()).length
              const needed = g.fields.filter((s) => !s.optional).length
              const done = g.fields.filter((s) => !s.optional && (f[s.key] ?? '').trim()).length === needed
              return (
                <details key={g.key} className={`opt-panel${done ? ' is-done' : ''}`} open={i === 0 || undefined}>
                  <summary>
                    <span className={`ios-icon ios-icon-${g.tone}`}>{g.icon}</span>
                    <span className="opt-title">{g.title}</span>
                    <span className="opt-count" aria-label={`${filled} of ${g.fields.length} filled${done ? ', complete' : ''}`}>
                      {done ? '✓ ' : ''}
                      {filled}/{g.fields.length}
                    </span>
                  </summary>
                  <div className="opt-body">
                    {g.lead}
                    {g.fields.map(input)}
                    {g.extra}
                  </div>
                </details>
              )
            })}
          </div>

          {model === 'colony' && (
            <label className="check-row">
              <input type="checkbox" checked={includeSizing} onChange={(e) => setFlag('include_sizing', e.target.checked)} />
              <span>Find the size needed</span>
              <Tip label="sizing">Also searches the smallest battery and panels that survive on their own. Adds about a second.</Tip>
            </label>
          )}
          {tooShort && (
            <p className="note" role="status">
              Colony needs 30 days or more. A year is better at the poles.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="opt-actions">
            <button type="submit" className="primary" disabled={power.isPending || tooShort}>
              {active.icon(17)}
              {power.isPending ? 'Computing…' : model === 'colony' ? 'Analyse the colony' : model === 'battery' ? 'Compute battery balance' : 'Compute array output'}
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
            {usedExample && <span className="fine">Example values, not recommendations.</span>}
          </div>
        </form>

        <RadiationPanel />
      </section>
    </>
  )
}

function PowerResult({ r }: { r: PowerResponse }) {
  return (
    <div className="result">
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
          <ul className="stat-strip compact">
            <Stat tone="sun" label="Panel power" value={fmt(r.mean_power_w, 1)} unit="W" sub={`peak ${fmt(r.peak_power_w, 1, ' W')}`} />
            <Stat
              tone="sun"
              label="Energy produced"
              value={r.energy_wh === null ? '—' : (r.energy_wh / 1000).toFixed(2)}
              unit="kWh"
              sub={r.eclipse_ranges.length > 0 ? `${fmt(r.eclipse_energy_loss_wh, 0, ' Wh')} lost to eclipses` : 'no eclipses'}
            />
            {r.level === 3 && (
              <>
                <Stat tone="neutral" label="Lowest battery" value={pct(r.min_soc)} sub={`at the end ${pct(r.final_soc)}`} />
                <Stat
                  tone="neutral"
                  label="Energy to spare"
                  value={r.energy_margin_wh === null ? '—' : (r.energy_margin_wh / 1000).toFixed(2)}
                  unit="kWh"
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
        <details className="assumptions">
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

function RadiationPanel() {
  const id = useId()
  const qf = usePowerStore((s) => s.qualityFactor)
  const setQf = usePowerStore((s) => s.setQualityFactor)
  const r = useRadiation(useRadiationRequest()).data
  return (
    <details className="opt-panel radiation-panel">
      <summary>
        <span className="ios-icon ios-icon-purple">
          <IconRadiation size={16} />
        </span>
        <span className="opt-title">Radiation risk</span>
        <span className="opt-count">{r?.risk ? `${r.risk.index.toFixed(1)}/10` : qf.trim() ? 'Q set' : 'needs Q'}</span>
      </summary>
      <div className="opt-body">
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
      </div>
    </details>
  )
}
