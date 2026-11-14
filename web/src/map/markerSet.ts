/**
 * Places drawn inside the WebGL scene (sprites and crater outlines), so they move with the terrain in the same
 * frame instead of trailing behind it as HTML overlays did. The canvas is not where keyboard and screen-reader
 * users pick places: the site list and the panels are, with the same information as text.
 *
 * Three styles (mock-ups): `pin` (a map pin, the tip on the place), `crater` (the named feature's real
 * diameter as an outline, coloured by the screening), `cross` (a plus sign centred on the place).
 */
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { MarkerStyle } from '../state/store'
import { type Art, PIN, RING_COLOURS, crossArt, dotArt, labelArt, pinArt } from './markerArt'
import type { MapSite } from './useMapSites'

/** Where a place sits in the scene, and (crater style) its outline. */
export interface Placement {
  anchor: (s: MapSite) => THREE.Vector3 | null
  ring: (s: MapSite) => Float32Array | null
}

interface Entry {
  site: MapSite
  anchor: THREE.Vector3
  icon: THREE.Sprite
  iconArt: Art
  label: THREE.Sprite
  labelArt: Art
  ring: Line2 | null
}

const PICK_RADIUS_PX = 22

function sprite(art: Art, order: number): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map: art.texture, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true })
  const s = new THREE.Sprite(m)
  s.center.set(art.cx, art.cy)
  s.renderOrder = order
  return s
}

export class MarkerSet {
  readonly group = new THREE.Group()
  private entries: Entry[] = []
  private readonly projected = new THREE.Vector3()

  /** Rebuild the markers for a new list of places or a new style. */
  set(sites: MapSite[], style: MarkerStyle, place: Placement): void {
    this.clear()
    for (const site of sites) {
      const anchor = place.anchor(site)
      if (!anchor) continue
      const iconArt =
        style === 'pin'
          ? pinArt({ selected: site.current, number: site.compared, muted: site.pass === false })
          : style === 'cross'
            ? crossArt({ selected: site.current, number: site.compared, pass: site.pass })
            : dotArt(site.current ? RING_COLOURS.selected : site.pass ? RING_COLOURS.pass : RING_COLOURS.neutral)
      const icon = sprite(iconArt, 20)
      icon.position.copy(anchor)
      const text = site.compared !== null ? `${site.compared} · ${site.name}` : site.name
      const labelArtV = labelArt(text, style === 'pin' ? PIN.w / 2 + 3 : 14, style === 'pin' ? PIN.h * 0.62 : 0)
      const label = sprite(labelArtV, 21)
      label.position.copy(anchor)
      let ring: Line2 | null = null
      const pts = style === 'crater' ? place.ring(site) : null
      if (pts) {
        const g = new LineGeometry()
        g.setPositions(pts)
        const colour = site.current ? RING_COLOURS.selected : site.pass ? RING_COLOURS.pass : RING_COLOURS.neutral
        const m = new LineMaterial({ color: colour, linewidth: site.current ? 3 : 2, depthTest: false, transparent: true })
        ring = new Line2(g, m)
        ring.renderOrder = 19
        ring.computeLineDistances()
        this.group.add(ring)
      }
      this.group.add(icon, label)
      this.entries.push({ site, anchor, icon, iconArt, label, labelArt: labelArtV, ring })
    }
  }

  /**
   * Per frame: keep icons a constant size on screen, show labels when asked (or for the selected and compared
   * places), hide places the caller says are out of sight (the far side of the globe).
   */
  update(cam: THREE.PerspectiveCamera, viewW: number, viewH: number, showLabels: boolean, inSight?: (p: THREE.Vector3) => boolean): void {
    // with sizeAttenuation off, a sprite of scale s spans s / tan(fov / 2) × viewH / 2 pixels
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / viewH
    for (const e of this.entries) {
      const visible = inSight ? inSight(e.anchor) : true
      e.icon.visible = visible
      e.icon.scale.set(e.iconArt.w * k, e.iconArt.h * k, 1)
      e.label.visible = visible && (showLabels || e.site.current || e.site.compared !== null)
      e.label.scale.set(e.labelArt.w * k, e.labelArt.h * k, 1)
      if (e.ring) {
        e.ring.visible = visible
        ;(e.ring.material as LineMaterial).resolution.set(viewW, viewH)
      }
    }
  }

  /** The place under a screen point (CSS pixels), the nearest within reach, or null. */
  pick(px: number, py: number, cam: THREE.PerspectiveCamera, viewW: number, viewH: number): MapSite | null {
    let best: MapSite | null = null
    let bestD = PICK_RADIUS_PX
    for (const e of this.entries) {
      if (!e.icon.visible) continue
      this.projected.copy(e.anchor).project(cam)
      if (this.projected.z > 1) continue
      const sx = ((this.projected.x + 1) / 2) * viewW
      // the pin's head is above its tip
      const sy = ((1 - this.projected.y) / 2) * viewH - (e.iconArt.cy === 0 ? e.iconArt.h * 0.6 : 0)
      const d = Math.hypot(sx - px, sy - py)
      if (d < bestD) {
        bestD = d
        best = e.site
      }
    }
    return best
  }

  private clear(): void {
    for (const e of this.entries) {
      for (const s of [e.icon, e.label]) {
        s.material.map?.dispose()
        s.material.dispose()
      }
      if (e.ring) {
        e.ring.geometry.dispose()
        ;(e.ring.material as LineMaterial).dispose()
      }
    }
    this.group.clear()
    this.entries = []
  }

  dispose(): void {
    this.clear()
  }
}
