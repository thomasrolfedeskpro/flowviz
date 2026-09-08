import { describe, it, expect } from 'vitest'
import { lintGeometry } from '@/engine/geometryLint'
import type { FlowDefinition, Component, Zone } from '@/types/schema'

/** A minimal valid flow, with pieces swapped in per test. */
function flow(over: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    meta: { title: 'T' },
    layout: { grid: { cols: 12, rows: 6 } },
    zones: [],
    components: [
      comp('a', 1, 3),
      comp('b', 8, 3),
    ],
    connections: [{ id: 'c1', from: 'a', to: 'b', route: 'auto' }],
    steps: [{ id: 0, title: 'S', highlight: [], active_connections: [] }],
    ...over,
  }
}

function comp(id: string, col: number, row: number, size?: { w: number; h: number }): Component {
  return { id, label: id.toUpperCase(), type: 'service', position: { col, row }, ...(size ? { size } : {}) }
}

function zone(id: string, col: number, row: number, width: number, height: number, parentId?: string): Zone {
  return { id, label: id, color: '#888', bounds: { col, row, width, height }, ...(parentId ? { parentId } : {}) }
}

const rules = (f: FlowDefinition) => lintGeometry(f).map((x) => x.rule)
const of    = (f: FlowDefinition, rule: string) => lintGeometry(f).filter((x) => x.rule === rule)

describe('geometryLint', () => {
  it('passes a well-spaced flow', () => {
    expect(lintGeometry(flow())).toEqual([])
  })

  it('flags two components on the same cells', () => {
    const f = flow({ components: [comp('a', 4, 3), comp('b', 4, 3)] })
    expect(of(f, 'component-overlap')).toHaveLength(1)
    expect(of(f, 'component-overlap')[0].severity).toBe('error')
  })

  it('counts a partial overlap of multi-cell components', () => {
    const f = flow({ components: [comp('a', 2, 2, { w: 3, h: 2 }), comp('b', 4, 3, { w: 2, h: 2 })] })
    expect(of(f, 'component-overlap')).toHaveLength(1)
  })

  it('allows components that merely touch', () => {
    const f = flow({ components: [comp('a', 2, 2, { w: 2, h: 1 }), comp('b', 4, 2)] })
    expect(of(f, 'component-overlap')).toEqual([])
  })

  it('flags a component past the edge of the grid', () => {
    const f = flow({
      layout: { grid: { cols: 6, rows: 6 } },
      components: [comp('a', 5, 1, { w: 3, h: 1 }), comp('b', 1, 1)],
      connections: [],
    })
    expect(of(f, 'component-out-of-grid')).toHaveLength(1)
  })

  it('flags a child zone that escapes its parent', () => {
    const f = flow({
      zones: [zone('outer', 0, 0, 6, 6), zone('inner', 4, 4, 5, 5, 'outer')],
      components: [],
      connections: [],
      steps: [{ id: 0, title: 'S', highlight: [], active_connections: [] }],
    })
    expect(of(f, 'zone-not-in-parent')).toHaveLength(1)
    expect(of(f, 'zone-not-in-parent')[0].severity).toBe('error')
  })

  it('does not treat proper nesting as an overlap', () => {
    const f = flow({
      zones: [zone('outer', 0, 0, 8, 8), zone('inner', 2, 2, 3, 3, 'outer')],
      components: [],
      connections: [],
    })
    expect(rules(f)).not.toContain('zone-overlap')
    expect(rules(f)).not.toContain('zone-gap')
  })

  it('flags sibling zones with no gap between them', () => {
    const f = flow({
      zones: [zone('l', 0, 0, 4, 4), zone('r', 4, 0, 4, 4)],
      components: [],
      connections: [],
    })
    expect(of(f, 'zone-gap')).toHaveLength(1)
  })

  it('accepts sibling zones one clear cell apart', () => {
    const f = flow({
      zones: [zone('l', 0, 0, 4, 4), zone('r', 5, 0, 4, 4)],
      components: [],
      connections: [],
    })
    expect(of(f, 'zone-gap')).toEqual([])
  })

  it('flags a component flush with its zone edge, but not a padded one', () => {
    const flush  = flow({ zones: [zone('z', 1, 2, 3, 3)], components: [comp('a', 1, 3)], connections: [] })
    const padded = flow({ zones: [zone('z', 0, 2, 4, 4)], components: [comp('a', 1, 3)], connections: [] })
    expect(of(flush,  'zone-padding')).toHaveLength(1)
    expect(of(padded, 'zone-padding')).toEqual([])
  })

  it('flags a component half in and half out of a zone', () => {
    const f = flow({
      zones: [zone('z', 0, 0, 4, 4)],
      components: [comp('a', 3, 1, { w: 3, h: 1 })],
      connections: [],
    })
    expect(of(f, 'component-straddles-zone')).toHaveLength(1)
  })

  it('flags the top-left corner where the step card is drawn', () => {
    const f = flow({ components: [comp('a', 0, 0), comp('b', 8, 3)], connections: [] })
    expect(of(f, 'top-left-occupied')).toHaveLength(1)
  })

  it('flags a grid far larger than its content', () => {
    const f = flow({
      layout: { grid: { cols: 30, rows: 8 } },
      components: [comp('a', 1, 3), comp('b', 4, 3)],
      connections: [],
    })
    expect(of(f, 'grid-slack')).toHaveLength(1)
  })

  /**
   * Auto-routing is a cubic Bezier whose control points sit at the endpoints'
   * own rows, so the path is monotonic in z: it stays strictly within the band
   * between the two endpoint rows and never overshoots. A same-row pipe is a
   * straight line down that row.
   *
   * Guide §9.7 says otherwise — that the curve "bulges widest at its midpoint",
   * with a worked example of a same-row A→B pipe dipping a row to fade a
   * bystander. That cannot happen. These tests pin the real behaviour, so the
   * rule stays honest about which components are actually at risk.
   */
  describe('pipe-through-component', () => {
    const bystander = (col: number, row: number, size?: { w: number; h: number }) => flow({
      layout: { grid: { cols: 14, rows: 12 } },
      components: [comp('a', 1, 2), comp('b', 7, 4), comp('c', col, row, size)],
      connections: [{ id: 'c1', from: 'a', to: 'b', route: 'auto' }],
    })

    it('flags a bystander inside the band the pipe sweeps', () => {
      const hits = of(bystander(4, 3), 'pipe-through-component')
      expect(hits).toHaveLength(1)
      expect(hits[0].message).toContain('"C"')
    })

    it('never flags the pipe\'s own endpoints', () => {
      const f = flow({
        components: [comp('a', 1, 2), comp('b', 7, 4)],
        connections: [{ id: 'c1', from: 'a', to: 'b', route: 'auto' }],
      })
      expect(of(f, 'pipe-through-component')).toEqual([])
    })

    it('clears once the bystander is out of the band', () => {
      expect(of(bystander(4, 3), 'pipe-through-component')).toHaveLength(1)
      expect(of(bystander(4, 8), 'pipe-through-component')).toEqual([])
    })

    it('reports a component once per pipe, not once per sample', () => {
      expect(of(bystander(4, 3, { w: 2, h: 2 }), 'pipe-through-component')).toHaveLength(1)
    })

    it('leaves the neighbour of a same-row pipe alone — the path never leaves the row', () => {
      const f = flow({
        components: [comp('a', 1, 2), comp('b', 7, 2), comp('c', 4, 3)],
        connections: [{ id: 'c1', from: 'a', to: 'b', route: 'auto' }],
      })
      expect(of(f, 'pipe-through-component')).toEqual([])
    })
  })

  it('reports findings inside a nested scene against that scene', () => {
    const f = flow({
      components: [
        {
          ...comp('a', 1, 3),
          detail: {
            grid: { cols: 8, rows: 6 },
            components: [comp('inner1', 2, 2), comp('inner2', 2, 2)],
            connections: [],
          },
        },
        comp('b', 8, 3),
      ],
    })
    const hits = of(f, 'component-overlap')
    expect(hits).toHaveLength(1)
    expect(hits[0].scene).toBe('a')
  })

  it('returns nothing for a flow that cannot be built', () => {
    const broken = { ...flow(), components: [] } as unknown as FlowDefinition
    expect(lintGeometry(broken)).toEqual([])
  })
})
