/**
 * "Mission planner inputs" (mission-planner-ui-spec.md section 3.1): a floating panel, always shown on the left
 * in mission mode (it replaces the "Mission filters" popover, which used to cover the timeline — P2). Its top
 * and bottom are measured at runtime by `usePlannerBounds` (the same pattern as `useMeasureInsets`) so it never
 * overlaps the timeline, the caption, or the map's legend and stats.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './planner.css'
import { useAreas } from '../state/areas'
import { usePanels } from '../state/panels'
import { useApp } from '../state/store'
import { IconChevron } from '../ui/icons'
import { AdvancedInputs } from './AdvancedInputs'
import { PlannerBasics } from './PlannerBasics'
import { EXAMPLE_MISSION } from '../panels/missionFilters'
import { DatePill } from '../panels/DatePill'
import { Tip } from '../ui/Tip'
import { PREVIEW_SAMPLES, usePlannerSearch } from './usePlannerSearch'

/** Elements at the bottom of the screen the panel must stay clear of (3.1): the timeline, the caption, the map's
 * legend and stats. Measured against the panel's own horizontal column, recomputed on resize and content change. */
function usePlannerBounds(open: boolean) {
  useLayoutEffect(() => {
    const nav = document.querySelector('.navigator') as HTMLElement | null
    if (!nav) return
    const measure = () => {
      const planner = nav.querySelector('.planner-panel') as HTMLElement | null
      const bar = nav.querySelector('.top-left') as HTMLElement | null
      if (!planner) return
      const left = planner.getBoundingClientRect().left
      const right = planner.getBoundingClientRect().right
      let top = window.innerHeight
      for (const sel of ['.float-bottom', '.globe-caption', '.legend-chip']) {
        for (const el of nav.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          // the timeline spans the whole width in mission mode: it always counts; the others only in the column
          if (!el.classList.contains('float-bottom') && (r.right < left || r.left > right)) continue
          top = Math.min(top, r.top)
        }
      }
      nav.style.setProperty('--planner-bottom', `${Math.max(0, window.innerHeight - top)}px`)
      // below the map tools (the toolbar group at the top left), whatever their height after wrapping
      // (its own box, not its open menus, so opening a menu does not push the panel down)
      const strip = bar?.querySelector('.toolstrip') as HTMLElement | null
      const sr = strip?.getBoundingClientRect()
      if (sr && sr.height > 0) nav.style.setProperty('--planner-top', `${sr.bottom + 8}px`)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    nav.querySelectorAll('.float-bottom, .globe-caption, .legend-chip, .planner-panel, .top-left, .toolstrip').forEach((el) => ro?.observe(el))
    const mo = new MutationObserver(measure)
    mo.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [open])
}

export function PlannerPanel() {
  const [open, setOpen] = useState(true)
  const a = useAreas()
  const { set: setApp } = useApp()
  const rootRef = useRef<HTMLDivElement>(null)
  usePlannerBounds(open)
  const search = usePlannerSearch()
  const [example, setExample] = useState(false)
  const resultsOpen = usePanels((s) => s.resultsOpen)

  // Escape cancels "Pick on the Moon" (3.8); a click elsewhere disarms it on its own (GlobeView/TerrainView).
  useEffect(() => {
    if (!a.pickArmed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') a.set({ pickArmed: false })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.pickArmed])

  const loadExample = () => {
    const ex = EXAMPLE_MISSION
    a.set({
      center: ex.center,
      radiusKm: ex.radiusKm,
      cellMode: ex.cellKm,
      landingRadiusKm: ex.landingRadiusKm,
      categoriesOn: { power: true, earth: true, topography: true },
      plannerValues: { ...a.plannerValues, battery_autonomy: '48', max_slope: '10', landing_radius: ex.landingRadiusKm },
    })
    a.setSuit(null)
    // no look(): the centre and radius changing frame the whole region (TerrainView, GlobeView)
    setApp({ durationH: ex.durationH })
    setExample(true)
  }

  const footer = search.error
    ? search.error
    : search.pending
      ? 'Updating…'
      : !a.suit
        ? 'No search yet'
        : !search.hasWindow
          ? 'Up to date'
          : search.isPreview
            ? `Preview · ${search.seconds?.toFixed(1)} s · ${PREVIEW_SAMPLES} horizons`
            : `Full detail · ${search.seconds?.toFixed(1)} s · ${a.suit.window?.samples ?? 300} horizons`

  return (
    <section ref={rootRef} className={`float float-left planner-panel${open ? '' : ' is-closed'}`} aria-labelledby="planner-h">
      <div className="float-head">
        <h2 id="planner-h">Mission planner inputs</h2>
        {open && (
          <label className="ios-row-top planner-landings-toggle">
            <input type="checkbox" checked={a.showLandings} onChange={(e) => a.set({ showLandings: e.target.checked })} /> Past landings
          </label>
        )}
        <button type="button" className="icon" aria-expanded={open} aria-label={open ? 'Hide panel' : 'Show panel'} onClick={() => setOpen(!open)}>
          <IconChevron size={16} />
        </button>
      </div>
      {open && (
        // The same date pill Study shows at the top left, moved here (outside the scrolling body, so its panel
        // opens over the inputs instead of being clipped by them).
        <div className="planner-date">
          <div className="ios-row-top">
            <span className="ios-label">Landing date and mission duration</span>
            <Tip label="landing date and mission duration">
              When the lander touches down (UTC) and how long it must work on the surface. Sunlight and Earth contact are checked over this whole
              window.
            </Tip>
          </div>
          <DatePill />
        </div>
      )}
      {open && (
        <div className="float-body planner-body">
          <button type="button" className="small" onClick={loadExample}>
            Load example mission
          </button>
          {example && (
            <p className="note" role="status">
              Example values to try the planner, not mission requirements.
            </p>
          )}
          <PlannerBasics />
          <AdvancedInputs />
        </div>
      )}
      {open && (
        <div className="float-foot planner-foot">
          <p className="planner-status" role="status">
            {footer}
          </p>
          {!resultsOpen && (
            <button type="button" className="small" onClick={() => usePanels.getState().setResultsOpen(true)}>
              Show candidate sites
            </button>
          )}
          <button type="button" className="primary" disabled={!search.hasWindow || search.pending} onClick={search.simulate}>
            Simulate full detail
          </button>
        </div>
      )}
    </section>
  )
}
