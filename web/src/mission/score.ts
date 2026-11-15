/**
 * Client score of the suitability search (mission-design-spec.md section 9.3): the same arithmetic as the API's
 * `logic/suitability.score_from_quantized` + `score_u8`, so re-weighting in the browser gives the server's numbers
 * bit for bit. Float64, summation in layer order, rounding floor(x * 255 + 0.5), clip 1..255 for viable cells.
 *
 * Weights are rank order centroid weights over the planner's priority order (Barron and Barrett 1996, Management
 * Science 42(11) 1515-1523): w_k = (1/n) sum_{i=k..n} 1/i, k = 1 most important (mission-planner-ui-spec.md 6.2).
 */

/** Scored categories in the API's catalogue order (logic/suitability.SCORED_CATEGORIES). */
export const SCORED_CATEGORIES = ['power', 'earth', 'topography', 'science', 'radiation'] as const

export function rocWeights(n: number): number[] {
  const w: number[] = []
  for (let k = 1; k <= n; k++) {
    let s = 0
    for (let i = k; i <= n; i++) s += 1 / i
    w.push(s / n)
  }
  return w
}

/** Score (0 for non-viable cells, else 1..255) and limiting layer index (255 none) per cell, from the codes and the
 * quantised utility layers (0..250, 255 = no data) with the weights in the same order as `layers`. */
export function recompute(codes: Uint8Array, layers: Uint8Array[], w: number[]): { score: Uint8Array; limiting: Uint8Array } {
  const n = codes.length
  const score = new Uint8Array(n)
  const limiting = new Uint8Array(n).fill(255)
  for (let c = 0; c < n; c++) {
    const code = codes[c]
    if (code !== 3 && code !== 4) continue
    let num = 0
    let den = 0
    let worst = -1
    let wi = 255
    for (let i = 0; i < layers.length; i++) {
      const q = layers[i][c]
      if (q === 255) continue
      num += w[i] * (q / 250)
      den += w[i]
      const loss = w[i] * (1 - q / 250)
      if (loss > worst) {
        worst = loss
        wi = i
      }
    }
    if (layers.length > 0) limiting[c] = wi
    const s = layers.length === 0 ? 1 : den > 0 ? num / den : 0
    if (code === 3) score[c] = Math.min(255, Math.max(1, Math.floor(s * 255 + 0.5)))
  }
  return { score, limiting }
}

/** The displayed priority list: the planner's stored order restricted to the active scored categories, then any
 * active one not yet in it, in catalogue order (the API's `ordered_scored` does the same). */
export function priorityOrder(stored: readonly string[], active: readonly string[]): string[] {
  const on = new Set(active)
  const first = stored.filter((c) => on.has(c))
  return [...first, ...SCORED_CATEGORIES.filter((c) => on.has(c) && !first.includes(c))]
}

/** Moves item `i` of `list` by `delta` places (clamped); a new array. */
export function moveItem<T>(list: readonly T[], i: number, delta: number): T[] {
  const j = Math.max(0, Math.min(list.length - 1, i + delta))
  const out = [...list]
  if (i < 0 || i >= list.length || i === j) return out
  const [x] = out.splice(i, 1)
  out.splice(j, 0, x)
  return out
}

/** Indices of the answer's layers in the planner's priority order (layers whose category is not in `order` follow
 * in the answer's own order). */
export function layerOrder(layerCategories: readonly string[], order: readonly string[]): number[] {
  const idx = layerCategories.map((_, i) => i)
  const rank = (c: string) => {
    const k = order.indexOf(c)
    return k < 0 ? order.length : k
  }
  return idx.sort((a, b) => rank(layerCategories[a]) - rank(layerCategories[b]) || a - b)
}

/** Re-weights the answer by the planner's priority order: the layers reordered, ROC weights over them. Returns the
 * per-cell score and limiting index (index into the ANSWER's `layers`, 255 none) and the weight per category. */
export function reweight(
  codes: Uint8Array,
  layers: Uint8Array[],
  layerCategories: readonly string[],
  order: readonly string[],
): { score: Uint8Array; limiting: Uint8Array; weights: Record<string, number> } {
  const ord = layerOrder(layerCategories, order)
  const w = rocWeights(ord.length)
  const r = recompute(
    codes,
    ord.map((i) => layers[i]),
    w,
  )
  for (let c = 0; c < r.limiting.length; c++) if (r.limiting[c] !== 255) r.limiting[c] = ord[r.limiting[c]]
  const weights: Record<string, number> = {}
  ord.forEach((i, k) => (weights[layerCategories[i]] = w[k]))
  return { ...r, weights }
}
