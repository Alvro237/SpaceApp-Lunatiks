/**
 * The place menu: a small popup at the point of a right click on a place (map or globe), or under the ⋯ button of a
 * place in the panels (the keyboard route). Rename the place, choose its pointer colour, or remove it.
 *
 * A non-modal dialog: the first action takes the focus, Escape or a click outside closes it, and the focus goes
 * back to where it came from. Removing still offers Undo (the toast in the navigator).
 */
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_PIN, PIN_COLOURS, type PlaceMenuTarget, placeKey, usePlaceStyles } from '../state/placeStyle'
import { useApp } from '../state/store'
import { useSites } from '../api/hooks'
import { useMasks } from '../time/hooks'
import { pointName } from '../time/place'
import { IconEdit, IconTrash } from '../ui/icons'
import { CloseButton } from '../ui/PanelNav'

export function PlaceMenu() {
  const menu = usePlaceStyles((s) => s.menu)
  if (!menu) return null
  // a new target is a fresh menu (draft, editing state)
  return <MenuBody key={`${placeKey(menu.sel)}@${menu.x},${menu.y}`} menu={menu} />
}

function MenuBody({ menu }: { menu: PlaceMenuTarget }) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const style = usePlaceStyles((s) => s.styles[placeKey(menu.sel)])
  const { rename, setColour, closeMenu } = usePlaceStyles.getState()
  const removePlace = useApp((s) => s.removePlace)
  // the original name (catalogue, or coordinates), whatever the place is called now
  const apiSites = useSites().data
  const masks = useMasks().data
  const sel = menu.sel
  const base =
    sel.kind === 'site'
      ? (apiSites?.sites.find((x) => x.id === sel.id)?.name ?? masks?.site(sel.id)?.name ?? menu.name)
      : pointName(sel.lat, sel.lon)
  const name = style?.name ?? base
  const colour = style?.colour ?? DEFAULT_PIN
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const close = (giveBack = true) => {
    closeMenu()
    if (giveBack) menu.returnTo?.focus()
  }

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('button, input')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) closeMenu()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [closeMenu])

  const save = (e: FormEvent) => {
    e.preventDefault()
    rename(menu.sel, draft.trim() === base ? '' : draft)
    setEditing(false)
  }

  return (
    <div
      ref={root}
      className="place-menu"
      role="dialog"
      aria-label={`Options for ${name}`}
      // open at the click, kept inside the window (the menu is about 250 px wide and 300 px tall)
      style={{ left: `min(${menu.x}px, calc(100vw - 262px))`, top: `min(${menu.y}px, calc(100vh - 310px))` }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (editing) setEditing(false)
          else close()
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="pm-head">
        <span className="pm-pin" style={{ background: colour }} aria-hidden="true" />
        <span className="pm-name" title={name}>
          {name}
        </span>
        <CloseButton label="Close the place menu" size={16} onClick={() => close()} />
      </div>

      {editing ? (
        <form className="pm-rename" onSubmit={save}>
          <label htmlFor={`${id}-n`}>Name</label>
          <input id={`${id}-n`} value={draft} maxLength={48} autoComplete="off" onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="pm-row">
            <button type="submit" className="primary small">
              Save
            </button>
            <button type="button" className="small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            type="button"
            className="pm-item"
            onClick={() => {
              setDraft(name)
              setEditing(true)
            }}
          >
            <IconEdit size={16} /> Rename
          </button>
          {style?.name && (
            <button type="button" className="pm-item pm-sub" onClick={() => rename(menu.sel, '')}>
              Restore “{base}”
            </button>
          )}
        </>
      )}

      <div className="pm-colours-wrap">
        <span id={`${id}-c`} className="pm-label">
          Pointer colour
        </span>
        <div className="pm-colours" role="radiogroup" aria-labelledby={`${id}-c`}>
          {PIN_COLOURS.map((c) => (
            <label key={c.id} className={`pm-swatch${colour === c.hex ? ' is-on' : ''}`} title={c.name} style={{ background: c.hex }}>
              <input
                type="radio"
                name={`${id}-colour`}
                checked={colour === c.hex}
                onChange={() => setColour(menu.sel, c.hex === DEFAULT_PIN ? null : c.hex)}
              />
              <span className="sr-only">{c.name}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="pm-item pm-danger"
        onClick={() => {
          removePlace(menu.sel, name)
          close()
        }}
      >
        <IconTrash size={16} /> Remove from the map
      </button>
    </div>
  )
}

/** Opens the place menu under a button (the ⋯ next to a place in the panels). */
export function openMenuFrom(el: HTMLElement, target: Pick<PlaceMenuTarget, 'sel' | 'name'>) {
  const r = el.getBoundingClientRect()
  usePlaceStyles.getState().openMenu({ ...target, x: Math.max(8, r.right - 250), y: r.bottom + 6, returnTo: el })
}
