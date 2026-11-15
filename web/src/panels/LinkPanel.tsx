/**
 * Radio link with the Earth's antennas (AERO-2, POST /api/v1/link; team decision 2026-11-14). There is link when the
 * place sees the Earth AND an antenna of the chosen networks sees the Moon above its elevation limit (level 1,
 * "Geometry"); level 2, "Budget", also needs the Eb/N0 margin to reach what the user asks for.
 *
 * Layout, fast first: one status line (link now or why not, and when it changes), four figures, the networks as
 * checkboxes and the best antennas. Everything else sits in collapsed sections: the budget numbers, the direction
 * and the user's own antennas, and a table with every antenna as the text alternative. Only the lunar terminal's EIRP
 * and the data rate are asked at level 2; the rest has the API's stated defaults and is sent only when typed.
 *
 * The same answer draws the "Link" row of the timeline (state/link.ts shares the query).
 */
import { type ReactNode, useId } from 'react'
import { ApiError, isMissing } from '../api/client'
import { useLinkStations } from '../api/hooks'
import type { LinkResponse } from '../api/types'
import { type CustomForm, DIRECTIONS, BANDS, NETWORK_IDS, NETWORK_LABEL, formatRate, nextChange, noLinkReason, rankStations, summarize } from './linkModel'
import { useLinkStore, useLinkResult } from '../state/link'
import { useApp } from '../state/store'
import { formatDuration } from '../time/clock'
import { useThrottledTime } from '../time/hooks'
import { Tip } from '../ui/Tip'
import { IconAntenna, IconClock, IconElevation, IconGlobe, IconTrash } from '../ui/icons'

export function LinkPanel() {
  const result = useLinkResult()
  const level = useLinkStore((s) => s.level)
  return (
    <div className="panel-section link-body">
      <LevelSwitch />
      {result.problem && (
        <p className="error link-hint" role="status">
          {result.problem}
        </p>
      )}
      {result.error ? (
        <p className="error" role="alert">
          {isMissing(result.error) ? 'The link API is not deployed on this server yet.' : result.error instanceof ApiError ? result.error.message : 'No answer from the API.'}
        </p>
      ) : result.data ? (
        <Result r={result.data} busy={result.updating} />
      ) : (
        !result.problem && (
          <p className="muted" role="status">
            {result.isLoading ? 'Asking the API…' : 'Choose a place to see the link.'}
          </p>
        )
      )}      <Networks />
      {level === 2 && <Budget />}
      {result.data && <Antennas r={result.data} />}
      <Advanced />
    </div>
  )
}

/* ------------------------------------------------------------------ level */

function LevelSwitch() {
  const id = useId()
  const level = useLinkStore((s) => s.level)
  const set = useLinkStore((s) => s.set)
  return (
    <div className="link-level">
      <span id={`${id}-l`} className="sr-only">
        Calculation level
      </span>
      <Seg labelId={`${id}-l`} value={String(level)} options={[{ value: '1', label: 'Geometry' }, { value: '2', label: 'Budget' }]} onChange={(v) => set({ level: v === '2' ? 2 : 1 })} />
      <Tip label="the levels">
        Geometry: the Earth is above this place’s horizon and an antenna sees the Moon. Budget: also enough signal for your data rate.
      </Tip>
    </div>
  )
}

/** A segmented radio group (native radios) in the app's own style. */
function Seg({ labelId, value, options, onChange }: { labelId: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const name = useId()
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelId}>
      {options.map((o) => (
        <label key={o.value} className={`seg-item${value === o.value ? ' is-on' : ''}`}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ result */

function Stat({ icon, tone, label, value, unit, sub }: { icon: ReactNode; tone: 'sun' | 'earth' | 'neutral'; label: string; value: string; unit?: string; sub: string }) {
  return (
    <li className={`stat stat-${tone}`}>
      <span className="stat-top">
        <span className="stat-icon">{icon}</span>
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

function Result({ r, busy }: { r: LinkResponse; busy: boolean }) {
  const tMs = useThrottledTime()
  const s = summarize(r)
  const durationH = useApp((x) => x.durationH)
  const last = Date.parse(r.t[r.t.length - 1])
  const reason = noLinkReason(s, tMs)
  const change = nextChange(s.linkRanges, tMs, s.stepMs, last)
  const pct = (f: number) => {
    const v = f * 100
    return v >= 99.95 || v < 0.05 ? v.toFixed(0) : v.toFixed(1)
  }
  const when = change ? `${change.kind === 'end' ? 'ends' : 'next'} in ${formatDuration(change.at - tMs)}` : reason === null ? 'to the end of the window' : 'none in this window'

  return (
    <section className="band link-result" aria-busy={busy}>
      <p className={`link-status ${reason === null ? 'on' : 'off'}`} role="status">
        <IconAntenna size={18} />
        <span>
          <strong>{reason === null ? 'Link now' : 'No link now'}</strong>{busy && <span className="muted"> · updating…</span>}
          <span className="muted"> · {when}</span>
          {reason !== null && <span className="link-why">{reason}</span>}
        </span>
      </p>
      <ul className="stat-strip compact">
        <Stat icon={<IconClock size={18} />} tone="earth" label="Link time" value={pct(s.linkFraction)} unit="%" sub={`${s.linkHours.toFixed(0)} of ${durationH} h`} />
        <Stat icon={<IconClock size={18} />} tone="neutral" label="Longest gap" value={s.gapHours.toFixed(0)} unit="h" sub="without link" />
        <Stat icon={<IconGlobe size={18} />} tone="earth" label="Earth up" value={pct(s.earthFraction)} unit="%" sub="place sees the Earth" />
        {s.level2 && s.margin ? (
          <Stat icon={<IconElevation size={18} />} tone="neutral" label="Margin" value={`${s.margin.min.toFixed(1)}–${s.margin.max.toFixed(1)}`} unit="dB" sub={`needs +${s.needMarginDb} dB`} />
        ) : (
          <Stat icon={<IconAntenna size={18} />} tone="neutral" label="Antennas" value={pct(s.antennaFraction)} unit="%" sub="see the Moon" />
        )}
      </ul>
      {s.level2 && (
        <p className="muted small">Timeline: solid bars are link, dots are contact without enough margin.</p>
      )}
      {r.skipped_stations.length > 0 && (
        <p className="muted small">
          {r.skipped_stations.length} antenna{r.skipped_stations.length === 1 ? '' : 's'} left out: no transmit limit published.
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ networks */

function Networks() {
  const stations = useLinkStations()
  const networks = useLinkStore((s) => s.networks)
  const set = useLinkStore((s) => s.set)
  const counts = new Map<string, number>()
  for (const st of stations.data?.stations ?? []) counts.set(st.network, (counts.get(st.network) ?? 0) + 1)
  const toggle = (id: string, on: boolean) => set({ networks: NETWORK_IDS.filter((n) => (n === id ? on : networks.includes(n))) })

  return (
    <fieldset className="link-networks">
      <legend>Antenna networks</legend>
      {NETWORK_IDS.map((id) => (
        <label key={id} className="check-row" title={stations.data?.networks[id]}>
          <input type="checkbox" checked={networks.includes(id)} onChange={(e) => toggle(id, e.target.checked)} />
          <span>{NETWORK_LABEL[id]}</span>
          {counts.has(id) && <span className="muted small">{counts.get(id)} antennas</span>}
        </label>
      ))}
    </fieldset>
  )
}

/* ------------------------------------------------------------------ best antennas and table */

function Antennas({ r }: { r: LinkResponse }) {
  const id = useId()
  const ranked = rankStations(r)
  const level2 = r.budget !== null && r.budget !== undefined
  const hours = (s: (typeof ranked)[number]) => (s.budget ? s.budget.link_hours : s.contact_hours)
  const top = ranked.slice(0, 3).filter((s) => hours(s) > 0)

  return (
    <section className="band" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="band-title">
        Best antennas
      </h3>
      {top.length === 0 ? (
        <p className="muted small">No antenna gives link in this window.</p>
      ) : (
        <ol className="ant-top">
          {top.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <span className="muted">
                {hours(s).toFixed(0)} h{s.budget && s.budget.max_data_rate_bps_median ? ` · ${formatRate(s.budget.max_data_rate_bps_median)}` : ''}
                {s.budget?.gt_basis === 'estimated' ? ' · est.' : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
      <details className="link-more">
        <summary>All {ranked.length} antennas</summary>
        <div className="table-wrap">
          <table className="ant-table">
            <caption className="sr-only">Antennas of the chosen networks and the hours they give in the window</caption>
            <thead>
              <tr>
                <th scope="col">Antenna</th>
                <th scope="col">Sees Moon</th>
                <th scope="col">{level2 ? 'Link' : 'Contact'}</th>
                {level2 && <th scope="col">G/T</th>}
                {level2 && <th scope="col">Margin</th>}
              </tr>
            </thead>
            <tbody>
              {ranked.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.name}</th>
                  <td>{s.moon_visible_hours.toFixed(0)} h</td>
                  <td>{hours(s).toFixed(0)} h</td>
                  {level2 && <td>{s.budget?.gt_db_per_k === null || s.budget?.gt_db_per_k === undefined ? '—' : `${s.budget.gt_db_per_k.toFixed(1)}${s.budget.gt_basis === 'estimated' ? ' est.' : ''}`}</td>}
                  {level2 && <td>{s.budget?.margin_db_mean === null || s.budget?.margin_db_mean === undefined ? '—' : `${s.budget.margin_db_mean.toFixed(1)} dB`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

/* ------------------------------------------------------------------ budget (level 2) */

function NumField({ label, unit, value, onChange, hint, placeholder, optional }: { label: string; unit: string; value: string; onChange: (v: string) => void; hint: string; placeholder?: string; optional?: boolean }) {
  const id = useId()
  return (
    <div className="pfield">
      <div className="pfield-top">
        <label htmlFor={id}>
          {label}
          {optional && <span className="opt"> (optional)</span>}
        </label>
        <Tip label={label.toLowerCase()}>{hint}</Tip>
      </div>
      <div className="unit-input">
        <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <span className="unit" aria-hidden="true">
          {unit}
        </span>
      </div>
    </div>
  )
}

function Budget() {
  const id = useId()
  const f = useLinkStore()
  const set = useLinkStore((s) => s.set)
  const uplink = f.direction !== 'downlink'
  return (
    <section className="band" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="band-title">
        Your link
      </h3>
      <div className="pfield">
        <div className="pfield-top">
          <span id={`${id}-b`}>Band</span>
          <Tip label="the band">The lunar band sets the carrier frequency: S about 2.2 GHz, X about 8.5 GHz, Ka about 26 GHz. Each antenna’s own sensitivity in that band is used.</Tip>
        </div>
        <Seg labelId={`${id}-b`} value={f.band} options={BANDS.map((b) => ({ value: b, label: b }))} onChange={(v) => set({ band: v as (typeof BANDS)[number] })} />
      </div>
      <NumField label="Lunar EIRP" unit="dBW" value={f.eirp} onChange={(v) => set({ eirp: v })} hint={uplink ? 'Transmit power times antenna gain of the ground antenna, in dBW.' : 'Transmit power times the gain of your lunar antenna, in dBW.'} />
      <NumField label="Data rate" unit="kbit/s" value={f.rateKbps} onChange={(v) => set({ rateKbps: v })} hint="The information rate you want to send." />
      <NumField label="Eb/N0 needed" unit="dB" value={f.ebn0} onChange={(v) => set({ ebn0: v })} hint="What your modulation and coding need to decode. It comes from your radio’s specification." />
      {uplink && <NumField label="Lunar G/T" unit="dB/K" value={f.gt} onChange={(v) => set({ gt: v })} hint="The sensitivity of your lunar receiver: its antenna gain minus 10·log10 of its noise temperature." />}
      <details className="link-more">
        <summary>More options</summary>
        <NumField label="Exact frequency" unit="GHz" value={f.freq} onChange={(v) => set({ freq: v })} optional placeholder="band centre" hint="Type your mission’s channel instead of the band centre." />
        <NumField label="Margin wanted" unit="dB" value={f.margin} onChange={(v) => set({ margin: v })} optional placeholder="3" hint="Extra signal above the need for the link to count as closed." />
        <NumField label="Other losses" unit="dB" value={f.losses} onChange={(v) => set({ losses: v })} optional placeholder="0" hint="Pointing, polarisation, atmosphere: losses this model does not include." />
        {!uplink && <NumField label="Ground G/T" unit="dB/K" value={f.gt} onChange={(v) => set({ gt: v })} optional placeholder="each antenna’s own" hint="Replaces the sensitivity of every ground antenna. Leave empty to use each antenna’s own." />}
      </details>    </section>
  )
}

/* ------------------------------------------------------------------ advanced */

function Advanced() {
  const id = useId()
  const direction = useLinkStore((s) => s.direction)
  const custom = useLinkStore((s) => s.custom)
  const set = useLinkStore((s) => s.set)
  const update = (key: number, patch: Partial<CustomForm>) => set({ custom: custom.map((c) => (c.key === key ? { ...c, ...patch } : c)) })
  const add = () => set({ custom: [...custom, { key: Math.max(0, ...custom.map((c) => c.key)) + 1, lat: '', lon: '', height: '', minEl: '', diameter: '', gt: '' }] })

  return (
    <details className="link-more link-advanced">
      <summary>Direction and own antennas</summary>
      <div className="pfield">
        <div className="pfield-top">
          <span id={`${id}-d`}>Direction</span>
          <Tip label="the direction">
            Downlink: the Moon sends, the antenna receives. Uplink: the antenna sends. Low: transmitter up to 20 kW, the Moon must be above about 10°. High: above 20 kW, the Moon must be above about 14°.
          </Tip>
        </div>
        <Seg labelId={`${id}-d`} value={direction} options={DIRECTIONS.map((d) => ({ value: d.id, label: d.label }))} onChange={(v) => set({ direction: v as typeof direction })} />
      </div>
      <div className="own-list">
        <span className="band-sub">Own antennas</span>
        {custom.map((c, i) => (
          <fieldset key={c.key} className="own-ant">
            <legend>Antenna {i + 1}</legend>
            <NumField label="Latitude" unit="°" value={c.lat} onChange={(v) => update(c.key, { lat: v })} hint="Degrees, north positive." />
            <NumField label="Longitude" unit="°" value={c.lon} onChange={(v) => update(c.key, { lon: v })} hint="Degrees, east positive." />
            <NumField label="Lowest elevation" unit="°" value={c.minEl} onChange={(v) => update(c.key, { minEl: v })} hint="The lowest angle above the horizon at which it can point at the Moon." />
            <NumField label="Height" unit="m" value={c.height} onChange={(v) => update(c.key, { height: v })} optional hint="Above the ellipsoid; 0 if unknown." />
            <NumField label="Dish diameter" unit="m" value={c.diameter} onChange={(v) => update(c.key, { diameter: v })} optional hint="Budget level: give this or the G/T. Without the G/T, the sensitivity is estimated from the diameter." />
            <NumField label="Receive G/T" unit="dB/K" value={c.gt} onChange={(v) => update(c.key, { gt: v })} optional hint="Budget level: give this or the dish diameter. Its sensitivity in the band you chose." />
            <button type="button" className="link-remove" onClick={() => set({ custom: custom.filter((x) => x.key !== c.key) })} aria-label={`Remove antenna ${i + 1}`}>
              <IconTrash size={16} /> Remove
            </button>
          </fieldset>
        ))}
        {custom.length < 5 && (
          <button type="button" className="link-add" onClick={add}>
            Add an antenna
          </button>
        )}
      </div>
    </details>
  )
}
