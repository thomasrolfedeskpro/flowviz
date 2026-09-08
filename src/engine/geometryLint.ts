/**
 * Geometry lint — the rules the schema can't express.
 *
 * `flowSchema` answers "will this load?". This answers "will it look right?",
 * which is a different question and the one that actually goes wrong: a flow
 * with two components on the same cell, or a pipe sweeping through a bystander,
 * validates perfectly and draws badly. Those rules lived only in §9 of the
 * authoring guide, enforced by nothing but whoever was reading it.
 *
 * Everything here is measured against the same geometry the renderer uses —
 * `buildGraph`'s world-space centres, mesh sizes and baked curves — rather than
 * a second model of the layout that could disagree with what you see. The pipe
 * rule in particular replays the renderer's own penetration test (`SceneLayer.
 * updatePenetration`), so a finding is a prediction of the actual visual bug,
 * not a guess at one.
 *
 * Findings never block anything. A flow that trips every rule still loads and
 * still plays; the layout is just worse than the author probably intended.
 */

import type { FlowDefinition, Component, Zone, SceneDetail } from '@/types/schema'
import type { InternalGraph } from '@/types/internal'
import { buildGraph } from '@/engine/parseFlow'

export type LintSeverity = 'error' | 'warning'

export interface LintFinding {
  /** Stable kebab-case id, so a rule can be cited, muted or documented. */
  rule: string
  severity: LintSeverity
  message: string
  /** Which scene it is in: null for the top level, else the owning component. */
  scene: string | null
}

export interface LintRule {
  id: string
  severity: LintSeverity
  /** The invariant, imperative. This is the line the rules doc prints. */
  requires: string
  /** Why it matters — the observable consequence, not a restatement. */
  because: string
}

/**
 * The registry is the source of truth for the rules, in both directions:
 * severity is read from here rather than repeated at each call site, and
 * `docs/flow-rules.md` is generated from it. The prose cannot drift from the
 * behaviour, because there is only one copy of it.
 */
export const RULES: LintRule[] = [
  {
    id: 'component-overlap',
    severity: 'error',
    requires: 'No two components may occupy the same cells.',
    because: 'The meshes are drawn on top of one another and one becomes unreadable.',
  },
  {
    id: 'component-out-of-grid',
    severity: 'error',
    requires: 'A component must fit inside `layout.grid`, including its `size`.',
    because: 'The grid floor stops at its bounds; anything past it floats on blank space.',
  },
  {
    id: 'zone-not-in-parent',
    severity: 'error',
    requires: 'A zone with a `parentId` must sit entirely inside that parent.',
    because: 'Nesting is what the parent link means; a child hanging outside contradicts it.',
  },
  {
    id: 'pipe-through-component',
    severity: 'warning',
    requires:
      'No component may sit in the band a pipe sweeps, unless it is one of that pipe\'s ends.',
    because:
      'The renderer drops any component a packet passes over to 30% opacity, so a bystander '
      + 'fades for no reason the viewer can see.',
  },
  {
    id: 'zone-padding',
    severity: 'warning',
    requires: 'Leave one cell between a component and the edge of the zone holding it.',
    because:
      'Components are extruded boxes seen isometrically: their height projects them up and '
      + 'left, so a flush one visibly overhangs the boundary.',
  },
  {
    id: 'zone-gap',
    severity: 'warning',
    requires: 'Leave one empty cell between two zones that are not nested.',
    because: 'Touching borders merge into a single line and the boundary stops reading.',
  },
  {
    id: 'zone-overlap',
    severity: 'warning',
    requires: 'Zones should not overlap unless one contains the other.',
    because: 'Partially overlapping fills tint each other and neither region reads cleanly.',
  },
  {
    id: 'component-straddles-zone',
    severity: 'warning',
    requires: 'A component belongs fully inside a zone or fully outside it.',
    because: 'Half in reads as a mistake whichever way the viewer takes it.',
  },
  {
    id: 'top-left-occupied',
    severity: 'warning',
    requires: 'Keep cols 0–2 of row 0 clear.',
    because: 'The step title and description are drawn over that corner, hiding what is under them.',
  },
  {
    id: 'grid-slack',
    severity: 'warning',
    requires: 'The grid should not extend more than three cells past the content.',
    because: 'The surplus is drawn as empty floor and the diagram sits small in the frame.',
  },
]

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]))

/** Cells a component covers, half-open: [c0, c1) × [r0, r1). */
interface Rect { c0: number; r0: number; c1: number; r1: number }

const componentRect = (c: Component): Rect => ({
  c0: c.position.col,
  r0: c.position.row,
  c1: c.position.col + (c.size?.w ?? 1),
  r1: c.position.row + (c.size?.h ?? 1),
})

const zoneRect = (z: Zone): Rect => ({
  c0: z.bounds.col,
  r0: z.bounds.row,
  c1: z.bounds.col + z.bounds.width,
  r1: z.bounds.row + z.bounds.height,
})

const overlaps  = (a: Rect, b: Rect) => a.c0 < b.c1 && b.c0 < a.c1 && a.r0 < b.r1 && b.r0 < a.r1
const contains  = (outer: Rect, inner: Rect) =>
  inner.c0 >= outer.c0 && inner.c1 <= outer.c1 && inner.r0 >= outer.r0 && inner.r1 <= outer.r1
const area      = (r: Rect) => (r.c1 - r.c0) * (r.r1 - r.r0)

/** Empty cells between two rects on each axis; negative where they share span. */
function gap(a: Rect, b: Rect): { x: number; y: number } {
  const x = a.c1 <= b.c0 ? b.c0 - a.c1 : b.c1 <= a.c0 ? a.c0 - b.c1 : -1
  const y = a.r1 <= b.r0 ? b.r0 - a.r1 : b.r1 <= a.r0 ? a.r0 - b.r1 : -1
  return { x, y }
}

/**
 * The step card is pinned to the top-left of the canvas, roughly 400×300px, and
 * anything under it is hidden behind prose. Guide §9.1b.
 */
const HUD_RECT: Rect = { c0: 0, r0: 0, c1: 3, r1: 1 }

/** Unused cells on an axis before the grid counts as oversized. */
const GRID_SLACK = 4

/** How finely to walk a pipe when testing what it passes through, in world
 *  units. The mesh is 2.4 world units across, so this cannot step over one. */
const PIPE_SAMPLE_SPACING = 0.5
const PIPE_SAMPLE_CAP     = 600

interface SceneInput {
  id: string | null
  grid: { cols: number; rows: number }
  zones: Zone[]
  components: Component[]
  graph: InternalGraph
}

/** Every scene in the flow, paired with the built graph for the same scene. */
function scenes(def: FlowDefinition, graph: InternalGraph): SceneInput[] {
  const out: SceneInput[] = [{
    id: null,
    grid: def.layout.grid,
    zones: def.zones,
    components: def.components,
    graph,
  }]

  const walk = (comps: Component[], g: InternalGraph) => {
    for (const c of comps) {
      const detail: SceneDetail | undefined = c.detail
      const sub = g.scenes.get(c.id)
      if (!detail || !sub) continue
      out.push({
        id: c.id,
        grid: detail.grid,
        zones: detail.zones ?? [],
        components: detail.components,
        graph: sub,
      })
      walk(detail.components, sub)
    }
  }
  walk(def.components, graph)
  return out
}

export function lintGeometry(def: FlowDefinition, prebuilt?: InternalGraph): LintFinding[] {
  let graph: InternalGraph
  try {
    graph = prebuilt ?? buildGraph(def)
  } catch {
    // A flow that won't build has problems the schema will describe better.
    return []
  }

  const findings: LintFinding[] = []

  for (const scene of scenes(def, graph)) {
    // Severity comes from the registry, so a rule's tier is stated once.
    const add = (rule: string, message: string) =>
      findings.push({
        rule,
        severity: RULE_BY_ID.get(rule)?.severity ?? 'warning',
        message,
        scene: scene.id,
      })

    const where = scene.id ? ` (in ${scene.id})` : ''
    const label = (c: Component) => `"${c.label}"`

    // ── Components against each other and the grid ────────────────────────
    const comps = scene.components
    for (let i = 0; i < comps.length; i++) {
      const a = comps[i]
      const ra = componentRect(a)

      if (ra.c0 < 0 || ra.r0 < 0 || ra.c1 > scene.grid.cols || ra.r1 > scene.grid.rows) {
        add('component-out-of-grid',
          `${label(a)} sits outside the ${scene.grid.cols}×${scene.grid.rows} grid${where} — `
          + `it covers cols ${ra.c0}–${ra.c1 - 1}, rows ${ra.r0}–${ra.r1 - 1}.`)
      }

      if (overlaps(ra, HUD_RECT)) {
        add('top-left-occupied',
          `${label(a)} is under the step card${where} — the title and description are `
          + `drawn over the top-left corner, so keep cols 0–2 of row 0 clear.`)
      }

      for (let j = i + 1; j < comps.length; j++) {
        const b = comps[j]
        if (overlaps(ra, componentRect(b))) {
          add('component-overlap',
            `${label(a)} and ${label(b)} occupy the same cells${where}.`)
        }
      }
    }

    // ── Zones ─────────────────────────────────────────────────────────────
    const zoneById = new Map(scene.zones.map((z) => [z.id, z]))
    const isNested = (a: Zone, b: Zone) => {
      // Related if either is an ancestor of the other.
      for (const [x, y] of [[a, b], [b, a]] as const) {
        let p = x.parentId
        while (p) {
          if (p === y.id) return true
          p = zoneById.get(p)?.parentId
        }
      }
      return false
    }

    for (let i = 0; i < scene.zones.length; i++) {
      const z  = scene.zones[i]
      const rz = zoneRect(z)

      if (rz.c0 < 0 || rz.r0 < 0 || rz.c1 > scene.grid.cols || rz.r1 > scene.grid.rows) {
        add('zone-out-of-grid',
          `Zone "${z.label}" extends past the ${scene.grid.cols}×${scene.grid.rows} grid${where}.`)
      }

      const parent = z.parentId ? zoneById.get(z.parentId) : undefined
      if (parent && !contains(zoneRect(parent), rz)) {
        add('zone-not-in-parent',
          `Zone "${z.label}" is not inside its parent "${parent.label}"${where}.`)
      }

      for (let j = i + 1; j < scene.zones.length; j++) {
        const o  = scene.zones[j]
        const ro = zoneRect(o)
        if (isNested(z, o)) continue

        if (overlaps(rz, ro)) {
          add('zone-overlap',
            `Zones "${z.label}" and "${o.label}" overlap${where} but neither contains the other.`)
        } else {
          const g = gap(rz, ro)
          if (Math.max(g.x, g.y) < 1) {
            add('zone-gap',
              `Zones "${z.label}" and "${o.label}" touch${where} — leave an empty cell `
              + `between zone boundaries or the borders visually merge.`)
          }
        }
      }
    }

    // A component half in and half out of a zone reads as a mistake either way.
    for (const c of comps) {
      const rc = componentRect(c)
      for (const z of scene.zones) {
        const rz = zoneRect(z)
        if (overlaps(rc, rz) && !contains(rz, rc)) {
          add('component-straddles-zone',
            `${label(c)} crosses the edge of zone "${z.label}"${where} — put it fully `
            + `inside or fully outside.`)
        }
      }

      // Padding is judged against the smallest zone holding it: an outer zone is
      // allowed to be tight around an inner one.
      const holders = scene.zones.filter((z) => contains(zoneRect(z), rc))
      if (holders.length) {
        const inner = holders.reduce((s, z) => (area(zoneRect(z)) < area(zoneRect(s)) ? z : s))
        const rz = zoneRect(inner)
        const pad = Math.min(rc.c0 - rz.c0, rz.c1 - rc.c1, rc.r0 - rz.r0, rz.r1 - rc.r1)
        if (pad < 1) {
          // The mesh clears the boundary on the ground by 0.3 world units, but
          // it is an extruded box seen isometrically: its height projects it up
          // and left on screen, over the zone plane. Measured on a flush
          // component, the overhang is plainly visible.
          add('zone-padding',
            `${label(c)} sits flush against the edge of zone "${inner.label}"${where} — `
            + `an extruded box overhangs the boundary on screen; leave one cell of padding.`)
        }
      }
    }

    // ── Pipes sweeping through components they do not connect ─────────────
    //
    // This replays what the renderer does every frame: a packet's XZ position is
    // tested against each component's box, and any component it lands inside is
    // dropped to 30% opacity. Intended when the packet is arriving there, a bug
    // when the component is an unrelated bystander — which is exactly what the
    // guide's 2-cell clearance rule exists to prevent.
    for (const [, conn] of scene.graph.connections) {
      const length  = conn.curve.getLength()
      const samples = Math.min(PIPE_SAMPLE_CAP, Math.max(16, Math.ceil(length / PIPE_SAMPLE_SPACING)))
      const hit     = new Set<string>()

      for (let s = 0; s <= samples; s++) {
        const p = conn.curve.getPointAt(s / samples)
        for (const [id, ic] of scene.graph.components) {
          if (id === conn.from.id || id === conn.to.id || hit.has(id)) continue
          const hx = ic.meshSize.x / 2
          const hz = ic.meshSize.z / 2
          if (
            p.x >= ic.center.x - hx && p.x <= ic.center.x + hx &&
            p.z >= ic.center.z - hz && p.z <= ic.center.z + hz
          ) {
            hit.add(id)
          }
        }
      }

      for (const id of hit) {
        const c = scene.graph.components.get(id)
        add('pipe-through-component',
          `Pipe "${conn.id}" passes through "${c?.label ?? id}"${where}, which is not one of `
          + `its ends — packets on it will fade that component mid-flight. Move it clear, `
          + `or route the pipe around.`)
      }
    }

    // ── Grid much bigger than anything in it ──────────────────────────────
    const occupied = [
      ...comps.map(componentRect),
      ...scene.zones.map(zoneRect),
    ]
    if (occupied.length) {
      const maxCol = Math.max(...occupied.map((r) => r.c1))
      const maxRow = Math.max(...occupied.map((r) => r.r1))
      const slackC = scene.grid.cols - maxCol
      const slackR = scene.grid.rows - maxRow
      if (slackC >= GRID_SLACK || slackR >= GRID_SLACK) {
        add('grid-slack',
          `The grid is ${scene.grid.cols}×${scene.grid.rows} but nothing sits past `
          + `col ${maxCol - 1}, row ${maxRow - 1}${where} — the extra space is drawn as empty floor.`)
      }
    }
  }

  return findings
}

/** One line per finding, for a terminal. */
export function formatFinding(f: LintFinding): string {
  return `${f.severity === 'error' ? 'error' : 'warn '} ${f.rule}: ${f.message}`
}
