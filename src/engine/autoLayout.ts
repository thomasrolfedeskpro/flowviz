/**
 * Auto-layout — put a scene's components on a sensible grid.
 *
 * Opt-in, never automatic. Plenty of layouts here are deliberate: `monopoly` is
 * the London board and `uk-power` uses real cable positions, and rewriting
 * either would destroy the point of it. So this runs when someone asks, on one
 * scene, as a single undoable edit.
 *
 * The shape it produces is a layered left-to-right drawing, which is what the
 * guide asks authors for by hand (§9.1): sources at low columns, sinks at high
 * ones, parallel paths on separate rows.
 *
 *   1. break cycles, so "which way is forward" has an answer at all
 *   2. layer by longest path — a component sits one column right of its
 *      furthest-left input
 *   3. order within each layer by the barycentre of its neighbours, a few
 *      sweeps, which is the cheap standard way to cut crossings
 *   4. space the layers and rows so the geometry rules come out clean
 *   5. re-flow the zones around wherever their members ended up
 *
 * What it deliberately does not do: invent zone membership. A zone is a
 * rectangle, not a list, so membership is read from where components were
 * *before* the move and reapplied after. A zone that held nothing keeps the
 * bounds it had, and says so in `notes`.
 *
 * Known weakness: an edge spanning more than one layer crosses the columns of
 * the layers it skips, and can sweep whatever sits there — `pipe-through-
 * component` in the linter. Fixing it properly means routing long edges through
 * dummy nodes and emitting waypoints, which this does not do. Measured over the
 * flows in this repo, tidying still cuts total findings by about a quarter, but
 * it can add a pipe finding to a diagram that had none. It is opt-in and one
 * undo, so the trade is the author's to make.
 *
 * A local search over row assignments was tried and removed: scoring candidates
 * on the rectangle between a pipe's ends over-counts, because the path is a
 * curve rather than a filled box, and optimising that proxy made real findings
 * slightly worse.
 */

import { lintGeometry } from '@/engine/geometryLint'
import type { Component, Connection, Zone } from '@/types/schema'

export interface TidyInput {
  grid: { cols: number; rows: number }
  zones: Zone[]
  components: Component[]
  connections: Connection[]
}

export interface TidyResult {
  grid: { cols: number; rows: number }
  zones: Zone[]
  components: Component[]
  /** Anything it could not decide, for the caller to report. */
  notes: string[]
}

/** Empty columns between one layer and the next. Room for the pipe to turn. */
const LAYER_GAP = 2
/** Empty rows between components stacked in the same layer. */
const ROW_GAP = 1
/** Empty rows between one zone's band of rows and the next. Two clear cells
 *  once each zone's one-cell outline padding is taken off both sides. */
const BAND_GAP = 4
/** Cells of padding a zone keeps around its members. */
const ZONE_PAD = 1
/** How tight compaction may pull things before it stops trying. Low floors on
 *  purpose: the linter is the arbiter, so a candidate that actually breaks a
 *  rule is rejected on its merits rather than forbidden in advance. Measured
 *  over the flows in this repo, dropping the floors from 1/2 to 0/1 took total
 *  area from 13,344 cells to 9,584 and findings from 137 to 134. */
const MIN_LAYER_GAP = 0
const MIN_BAND_GAP  = 1
/** Ceiling on candidate layouts scored during compaction, so a large scene
 *  cannot turn one button press into a long pause. */
const COMPACTION_BUDGET = 150

/** Everything starts here: clear of the step card over cols 0–2 of row 0. */
const ORIGIN = { col: 1, row: 1 }

const width  = (c: Component) => c.size?.w ?? 1
const height = (c: Component) => c.size?.h ?? 1

interface Rect { c0: number; r0: number; c1: number; r1: number }

const rectOf = (c: Component): Rect => ({
  c0: c.position.col,
  r0: c.position.row,
  c1: c.position.col + width(c),
  r1: c.position.row + height(c),
})

const zoneRectOf = (z: Zone): Rect => ({
  c0: z.bounds.col,
  r0: z.bounds.row,
  c1: z.bounds.col + z.bounds.width,
  r1: z.bounds.row + z.bounds.height,
})

const containsRect = (outer: Rect, inner: Rect) =>
  inner.c0 >= outer.c0 && inner.c1 <= outer.c1 && inner.r0 >= outer.r0 && inner.r1 <= outer.r1

/** An id pair as one string. JSON rather than a separator character, because an
 *  id is an arbitrary string and any separator could appear inside one. */
const edgeKey = (from: string, to: string) => JSON.stringify([from, to])

/**
 * Edges that would make the graph cyclic, found by DFS on the grey stack.
 *
 * They are dropped for layering only — the connection itself stays exactly as
 * it was. Without this a loop (water-cycle, blood-circulation) has no valid
 * layering and the longest-path walk never terminates.
 */
function backEdges(ids: string[], out: Map<string, string[]>): Set<string> {
  const state = new Map<string, 0 | 1 | 2>()   // unseen / on stack / done
  const back = new Set<string>()

  const visit = (id: string) => {
    state.set(id, 1)
    for (const to of out.get(id) ?? []) {
      const s = state.get(to) ?? 0
      if (s === 1) back.add(edgeKey(id, to))
      else if (s === 0) visit(to)
    }
    state.set(id, 2)
  }

  for (const id of ids) if ((state.get(id) ?? 0) === 0) visit(id)
  return back
}

/** Longest-path layering over the acyclic remainder. */
function assignLayers(
  ids: string[],
  edges: Array<{ from: string; to: string }>,
): Map<string, number> {
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const id of ids) {
    incoming.set(id, [])
    outgoing.set(id, [])
  }
  for (const e of edges) {
    outgoing.get(e.from)!.push(e.to)
    incoming.get(e.to)!.push(e.from)
  }

  const layer = new Map<string, number>()
  // Kahn order, so every predecessor is settled before its successor.
  const pending = new Map(ids.map((id) => [id, incoming.get(id)!.length]))
  const queue = ids.filter((id) => pending.get(id) === 0)
  for (const id of queue) layer.set(id, 0)

  while (queue.length) {
    const id = queue.shift()!
    for (const to of outgoing.get(id)!) {
      layer.set(to, Math.max(layer.get(to) ?? 0, (layer.get(id) ?? 0) + 1))
      pending.set(to, pending.get(to)! - 1)
      if (pending.get(to) === 0) queue.push(to)
    }
  }

  // Anything still unsettled sat on a cycle the break missed; park it at 0.
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0)
  return layer
}

/**
 * Order each layer by the mean position of its neighbours in the layer next
 * door, alternating direction. Standard barycentre heuristic: cheap, and it
 * removes most crossings a layered drawing would otherwise have.
 */
function orderLayers(
  layers: string[][],
  edges: Array<{ from: string; to: string }>,
  sweeps = 4,
): string[][] {
  const out = layers.map((l) => l.slice())
  const neighbours = (id: string, dir: 'in' | 'out') =>
    edges.filter((e) => (dir === 'out' ? e.from === id : e.to === id))
         .map((e) => (dir === 'out' ? e.to : e.from))

  for (let sweep = 0; sweep < sweeps; sweep++) {
    const forward = sweep % 2 === 0
    const order = forward
      ? out.map((_, i) => i).slice(1)
      : out.map((_, i) => i).slice(0, -1).reverse()

    for (const i of order) {
      const ref = new Map(out[forward ? i - 1 : i + 1].map((id, idx) => [id, idx]))
      const key = new Map<string, number>()
      out[i].forEach((id, idx) => {
        const ns = neighbours(id, forward ? 'in' : 'out')
          .map((n) => ref.get(n))
          .filter((v): v is number => v !== undefined)
        // No neighbour to follow: hold position rather than drift to the top.
        key.set(id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : idx)
      })
      out[i].sort((a, b) => key.get(a)! - key.get(b)!)
    }
  }
  return out
}

export function tidyScene(input: TidyInput): TidyResult {
  const notes: string[] = []
  const byId = new Map(input.components.map((c) => [c.id, c]))
  const ids = input.components.map((c) => c.id)

  if (ids.length === 0) {
    return { grid: input.grid, zones: input.zones, components: input.components, notes }
  }

  // ── Zone membership, read before anything moves ─────────────────────────
  const membersOf = new Map<string, string[]>()
  for (const z of input.zones) {
    const zr = zoneRectOf(z)
    membersOf.set(z.id, input.components.filter((c) => containsRect(zr, rectOf(c))).map((c) => c.id))
  }

  // ── 1–2. Break cycles, then layer ───────────────────────────────────────
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const conn of input.connections) {
    if (byId.has(conn.from) && byId.has(conn.to)) out.get(conn.from)!.push(conn.to)
  }
  const back = backEdges(ids, out)
  const acyclic = input.connections
    .filter((c) => byId.has(c.from) && byId.has(c.to) && !back.has(edgeKey(c.from, c.to)))
    .map((c) => ({ from: c.from, to: c.to }))
  if (back.size) {
    notes.push(`${back.size} connection${back.size === 1 ? '' : 's'} loop back; laid out as if forward.`)
  }

  const layerOf = new Map(assignLayers(ids, acyclic))
  const depth = Math.max(...ids.map((id) => layerOf.get(id)!)) + 1
  const grouped: string[][] = Array.from({ length: depth }, () => [])
  // Seed each layer in the author's existing top-to-bottom order, so a tidy of
  // an already-sensible layout barely moves anything.
  for (const id of [...ids].sort((a, b) => byId.get(a)!.position.row - byId.get(b)!.position.row)) {
    grouped[layerOf.get(id)!].push(id)
  }

  // ── 3. Cut crossings ────────────────────────────────────────────────────
  const ordered = orderLayers(grouped, acyclic)

  // ── 4. Place: layers across, zone bands down ────────────────────────────
  //
  // Rows are partitioned by zone rather than filled in order. Laying out purely
  // by layer scatters a zone's members down the column, its re-flowed rectangle
  // then spans everything between them, and every zone ends up overlapping every
  // other — measured at 7 overlaps before, 61 after, on the flows in this repo.
  // Giving each zone a band of rows makes the rectangles disjoint by
  // construction, so both the overlap and the gap rule come out clean.
  const zoneById = new Map(input.zones.map((z) => [z.id, z]))
  const ancestry = (id: string | null): string[] => {
    const chain: string[] = []
    let cur = id
    while (cur) {
      chain.unshift(cur)
      cur = zoneById.get(cur)?.parentId ?? null
    }
    return chain
  }

  /** The smallest zone holding a component: the band it belongs to. */
  const bandOf = new Map<string, string | null>()
  for (const c of input.components) {
    const holders = input.zones.filter((z) => containsRect(zoneRectOf(z), rectOf(c)))
    const inner = holders.length
      ? holders.reduce((s, z) => {
          const a = (z.bounds.width * z.bounds.height)
          const b = (s.bounds.width * s.bounds.height)
          return a < b ? z : s
        })
      : null
    bandOf.set(c.id, inner?.id ?? null)
  }

  const bandKeys = [...new Set(input.components.map((c) => bandOf.get(c.id) ?? ''))]
  const meanRow = (key: string) => {
    const rows = input.components
      .filter((c) => (bandOf.get(c.id) ?? '') === key)
      .map((c) => c.position.row)
    return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0
  }
  // Every band under the same outermost zone has to be contiguous. A parent's
  // rectangle spans all of its children, so letting an unrelated band fall
  // between two of them makes the parent swallow it — which is exactly how
  // "AWS Cloud" came to overlap "Web / Mobile".
  //
  // Sorting needs one composite key rather than a comparator that switches
  // rule depending on the pair: that is not a total order, and it interleaves.
  const rootOf = (key: string) => ancestry(key || null)[0] ?? ''
  const rootMeanRow = new Map<string, number>()
  for (const root of new Set(bandKeys.map(rootOf))) {
    const rows = input.components
      .filter((c) => rootOf(bandOf.get(c.id) ?? '') === root)
      .map((c) => c.position.row)
    rootMeanRow.set(root, rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0)
  }
  bandKeys.sort((a, b) =>
    (rootMeanRow.get(rootOf(a))! - rootMeanRow.get(rootOf(b))!)
    || rootOf(a).localeCompare(rootOf(b))
    || (meanRow(a) - meanRow(b))
    || ancestry(a || null).join('/').localeCompare(ancestry(b || null).join('/')))

  // ── Zone re-flow, used both to score a candidate and to finish ─────────
  const childrenOf = new Map<string, Zone[]>()
  for (const z of input.zones) {
    if (!z.parentId) continue
    childrenOf.set(z.parentId, [...(childrenOf.get(z.parentId) ?? []), z])
  }

  const emptyZones = new Set<string>()

  /** Bounds enclosing a zone's members, and its children's bounds, with
   *  padding. Depth-first, so a parent encloses children already re-flowed. */
  function reflowZones(comps: Component[]): Zone[] {
    const movedById = new Map(comps.map((c) => [c.id, c]))
    const newBounds = new Map<string, Zone['bounds']>()

    const reflow = (z: Zone): Zone['bounds'] | null => {
      if (newBounds.has(z.id)) return newBounds.get(z.id)!

      const rects: Rect[] = (membersOf.get(z.id) ?? [])
        .map((id) => movedById.get(id))
        .filter((c): c is Component => Boolean(c))
        .map(rectOf)

      for (const child of childrenOf.get(z.id) ?? []) {
        const b = reflow(child)
        if (b) rects.push({ c0: b.col, r0: b.row, c1: b.col + b.width, r1: b.row + b.height })
      }

      if (rects.length === 0) {
        emptyZones.add(z.id)
        return null
      }

      const bounds = {
        col:    Math.min(...rects.map((r) => r.c0)) - ZONE_PAD,
        row:    Math.min(...rects.map((r) => r.r0)) - ZONE_PAD,
        width:  Math.max(...rects.map((r) => r.c1)) - Math.min(...rects.map((r) => r.c0)) + ZONE_PAD * 2,
        height: Math.max(...rects.map((r) => r.r1)) - Math.min(...rects.map((r) => r.r0)) + ZONE_PAD * 2,
      }
      newBounds.set(z.id, bounds)
      return bounds
    }

    for (const z of input.zones) reflow(z)
    return input.zones.map((z) => {
      const b = newBounds.get(z.id)
      return b ? { ...z, bounds: b } : z
    })
  }

  // Placement is a pure function of the gaps between layers and between bands,
  // so compaction below can try smaller ones and re-derive everything.
  const layerWidth = ordered.map((layer) => Math.max(...layer.map((id) => width(byId.get(id)!)), 1))
  const bandHeight = bandKeys.map((key) => {
    let tallest = 0
    for (const layer of ordered) {
      let h = 0
      for (const id of layer) {
        if ((bandOf.get(id) ?? '') === key) h += height(byId.get(id)!) + ROW_GAP
      }
      tallest = Math.max(tallest, h - ROW_GAP)
    }
    return Math.max(tallest, 0)
  })

  const place = (colGaps: number[], bandGaps: number[]) => {
    const cols: number[] = []
    let c = ORIGIN.col
    ordered.forEach((_, i) => {
      cols[i] = c
      c += layerWidth[i] + colGaps[i]
    })

    const tops: number[] = []
    let r = ORIGIN.row
    bandKeys.forEach((_, bi) => {
      tops[bi] = r
      if (bandHeight[bi] > 0) r += bandHeight[bi] + bandGaps[bi]
    })

    const at = new Map<string, { col: number; row: number }>()
    bandKeys.forEach((key, bi) => {
      ordered.forEach((layer, li) => {
        let row = tops[bi]
        for (const id of layer) {
          if ((bandOf.get(id) ?? '') !== key) continue
          at.set(id, { col: cols[li], row })
          row += height(byId.get(id)!) + ROW_GAP
        }
      })
    })
    return at
  }

  let colGaps  = ordered.map(() => LAYER_GAP)
  let bandGaps = bandKeys.map(() => BAND_GAP)
  let placed   = place(colGaps, bandGaps)

  // ── 4b. Compaction ──────────────────────────────────────────────────────
  //
  // Laying out to satisfy the rules spreads a diagram out, and spread is its
  // own kind of wrong: the first version of this produced diagrams three times
  // the area of the hand-made ones, which read worse despite scoring better.
  // So: pull each gap in one cell at a time and keep the change only when the
  // real findings do not get worse.
  //
  // Scored with the actual linter, not a cheaper approximation of it. An
  // earlier attempt scored candidates on the rectangle between a pipe's two
  // ends, which over-counts — the path is a curve, not a filled box — and
  // optimising that proxy made the real findings slightly worse.
  /**
   * Turn a placement into the finished article: components moved, zones
   * re-flowed around them, everything slid back on-grid if padding pushed a
   * bound negative, and the grid fitted to what is left.
   *
   * Compaction scores candidates through this same function, so what gets
   * measured is exactly what would be produced. An earlier version scored a
   * near-copy and returned Infinity for layouts needing a slide — which made
   * Infinity the baseline, so every candidate compared favourably and the pass
   * compacted to the minimum regardless of what it broke.
   */
  const finalise = (at: Map<string, { col: number; row: number }>) => {
    const moved = input.components.map((c) => ({
      ...c,
      position: { ...c.position, ...at.get(c.id)! },
    }))
    const grown = reflowZones(moved)

    const first = [...moved.map(rectOf), ...grown.map(zoneRectOf)]
    const shiftCol = Math.min(0, ...first.map((r) => r.c0))
    const shiftRow = Math.min(0, ...first.map((r) => r.r0))

    const components = shiftCol || shiftRow
      ? moved.map((c) => ({
          ...c,
          position: { ...c.position, col: c.position.col - shiftCol, row: c.position.row - shiftRow },
        }))
      : moved
    const zones = shiftCol || shiftRow
      ? grown.map((z) => ({
          ...z,
          bounds: { ...z.bounds, col: z.bounds.col - shiftCol, row: z.bounds.row - shiftRow },
        }))
      : grown

    const rects = [...components.map(rectOf), ...zones.map(zoneRectOf)]
    return {
      components,
      zones,
      grid: {
        cols: Math.max(...rects.map((r) => r.c1)) + 1,
        rows: Math.max(...rects.map((r) => r.r1)) + 1,
      },
    }
  }

  const score = (at: Map<string, { col: number; row: number }>): number => {
    const { components, zones, grid } = finalise(at)
    return lintGeometry({
      meta: { title: '' },
      layout: { grid },
      zones,
      components,
      connections: input.connections,
      steps: [],
    }).length
  }

  let budget = COMPACTION_BUDGET
  // Fixed, never re-baselined: every candidate is judged against the layout we
  // started from, so a run of individually-acceptable steps cannot creep worse.
  const best = score(placed)
  for (let round = 0; round < 4 && budget > 0; round++) {
    let improved = false

    for (let i = 0; i < colGaps.length && budget > 0; i++) {
      while (colGaps[i] > MIN_LAYER_GAP && budget-- > 0) {
        const trial = colGaps.slice()
        trial[i] -= 1
        const at = place(trial, bandGaps)
        if (score(at) > best) break
        colGaps = trial
        placed = at
        improved = true
      }
    }

    for (let i = 0; i < bandGaps.length && budget > 0; i++) {
      while (bandGaps[i] > MIN_BAND_GAP && budget-- > 0) {
        const trial = bandGaps.slice()
        trial[i] -= 1
        const at = place(colGaps, trial)
        if (score(at) > best) break
        bandGaps = trial
        placed = at
        improved = true
      }
    }

    if (!improved) break
  }

  const { components, zones, grid } = finalise(placed)

  for (const id of emptyZones) {
    const z = input.zones.find((x) => x.id === id)!
    notes.push(`Zone "${z.label}" holds nothing, so its bounds were left alone.`)
  }

  return { grid, zones, components, notes }
}
