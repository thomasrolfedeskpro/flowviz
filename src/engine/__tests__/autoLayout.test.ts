import { describe, it, expect } from 'vitest'
import { tidyScene } from '@/engine/autoLayout'
import { lintGeometry } from '@/engine/geometryLint'
import { flowReducer } from '@/state/flowActions'
import type { Component, Connection, FlowDefinition, Zone } from '@/types/schema'

const comp = (id: string, col: number, row: number, size?: { w: number; h: number }): Component =>
  ({ id, label: id, type: 'service', position: { col, row }, ...(size ? { size } : {}) })

const conn = (id: string, from: string, to: string): Connection =>
  ({ id, from, to, route: 'auto' })

const zone = (id: string, col: number, row: number, width: number, height: number, parentId?: string): Zone =>
  ({ id, label: id, color: '#888', bounds: { col, row, width, height }, ...(parentId ? { parentId } : {}) })

const colOf = (r: { components: Component[] }, id: string) =>
  r.components.find((c) => c.id === id)!.position.col
const rowOf = (r: { components: Component[] }, id: string) =>
  r.components.find((c) => c.id === id)!.position.row

describe('tidyScene', () => {
  it('lays a linear chain out left to right', () => {
    const r = tidyScene({
      grid: { cols: 4, rows: 4 },
      zones: [],
      components: [comp('c', 0, 0), comp('a', 5, 5), comp('b', 2, 9)],
      connections: [conn('c1', 'a', 'b'), conn('c2', 'b', 'c')],
    })
    expect(colOf(r, 'a')).toBeLessThan(colOf(r, 'b'))
    expect(colOf(r, 'b')).toBeLessThan(colOf(r, 'c'))
  })

  it('puts a fan-out on separate rows in one column', () => {
    const r = tidyScene({
      grid: { cols: 4, rows: 4 },
      zones: [],
      components: [comp('src', 0, 0), comp('x', 0, 0), comp('y', 0, 0)],
      connections: [conn('c1', 'src', 'x'), conn('c2', 'src', 'y')],
    })
    expect(colOf(r, 'x')).toBe(colOf(r, 'y'))
    expect(rowOf(r, 'x')).not.toBe(rowOf(r, 'y'))
  })

  it('terminates on a cycle and says it found one', () => {
    const r = tidyScene({
      grid: { cols: 4, rows: 4 },
      zones: [],
      components: [comp('a', 0, 0), comp('b', 0, 0), comp('c', 0, 0)],
      connections: [conn('c1', 'a', 'b'), conn('c2', 'b', 'c'), conn('c3', 'c', 'a')],
    })
    expect(r.components).toHaveLength(3)
    expect(r.notes.join(' ')).toMatch(/loop back/)
  })

  it('never places anything in the corner the step card covers', () => {
    const r = tidyScene({
      grid: { cols: 4, rows: 4 },
      zones: [],
      components: [comp('a', 0, 0), comp('b', 1, 0)],
      connections: [conn('c1', 'a', 'b')],
    })
    for (const c of r.components) {
      const inCorner = c.position.col < 3 && c.position.row < 1
      expect(inCorner, `${c.id} is under the step card`).toBe(false)
    }
  })

  it('keeps a zone around its members and off its neighbours', () => {
    const input = {
      grid: { cols: 20, rows: 12 },
      zones: [zone('left', 0, 0, 4, 4), zone('right', 10, 0, 4, 4)],
      components: [comp('a', 1, 1), comp('b', 2, 2), comp('x', 11, 1), comp('y', 12, 2)],
      connections: [conn('c1', 'a', 'x'), conn('c2', 'b', 'y')],
    }
    const r = tidyScene(input)
    const def: FlowDefinition = {
      meta: { title: 'T' },
      layout: { grid: r.grid },
      zones: r.zones,
      components: r.components,
      connections: input.connections,
      steps: [{ id: 0, title: 'S', highlight: [], active_connections: [] }],
    }
    const found = lintGeometry(def).map((f) => f.rule)
    expect(found).not.toContain('zone-overlap')
    expect(found).not.toContain('zone-gap')
    expect(found).not.toContain('zone-padding')
  })

  it('keeps a child zone inside its parent', () => {
    const r = tidyScene({
      grid: { cols: 20, rows: 12 },
      zones: [zone('outer', 0, 0, 10, 8), zone('inner', 1, 1, 4, 4, 'outer')],
      components: [comp('in1', 2, 2), comp('in2', 3, 3), comp('out1', 7, 6)],
      connections: [conn('c1', 'in1', 'in2'), conn('c2', 'in2', 'out1')],
    })
    const outer = r.zones.find((z) => z.id === 'outer')!.bounds
    const inner = r.zones.find((z) => z.id === 'inner')!.bounds
    expect(inner.col).toBeGreaterThanOrEqual(outer.col)
    expect(inner.row).toBeGreaterThanOrEqual(outer.row)
    expect(inner.col + inner.width).toBeLessThanOrEqual(outer.col + outer.width)
    expect(inner.row + inner.height).toBeLessThanOrEqual(outer.row + outer.height)
  })

  it('leaves an empty zone alone and says so', () => {
    const r = tidyScene({
      grid: { cols: 20, rows: 12 },
      zones: [zone('empty', 14, 6, 3, 3)],
      components: [comp('a', 1, 1), comp('b', 4, 1)],
      connections: [conn('c1', 'a', 'b')],
    })
    expect(r.zones.find((z) => z.id === 'empty')!.bounds).toEqual({ col: 14, row: 6, width: 3, height: 3 })
    expect(r.notes.join(' ')).toMatch(/holds nothing/)
  })

  it('fits the grid to the content', () => {
    const r = tidyScene({
      grid: { cols: 80, rows: 80 },
      zones: [],
      components: [comp('a', 0, 0), comp('b', 0, 0)],
      connections: [conn('c1', 'a', 'b')],
    })
    expect(r.grid.cols).toBeLessThan(12)
    expect(r.grid.rows).toBeLessThan(12)
  })

  it('does nothing to an empty scene', () => {
    const input = { grid: { cols: 4, rows: 4 }, zones: [], components: [], connections: [] }
    expect(tidyScene(input).components).toBe(input.components)
  })

  it('is idempotent — tidying twice changes nothing the second time', () => {
    const first = tidyScene({
      grid: { cols: 20, rows: 12 },
      zones: [zone('z', 0, 0, 6, 6)],
      components: [comp('a', 1, 1), comp('b', 3, 2), comp('c', 9, 4)],
      connections: [conn('c1', 'a', 'b'), conn('c2', 'b', 'c')],
    })
    const second = tidyScene({
      grid: first.grid,
      zones: first.zones,
      components: first.components,
      connections: [conn('c1', 'a', 'b'), conn('c2', 'b', 'c')],
    })
    expect(second.components.map((c) => c.position)).toEqual(first.components.map((c) => c.position))
    expect(second.zones.map((z) => z.bounds)).toEqual(first.zones.map((z) => z.bounds))
  })

  describe('as an action', () => {
    const def = (): FlowDefinition => ({
      meta: { title: 'T' },
      layout: { grid: { cols: 30, rows: 20 } },
      zones: [],
      components: [comp('a', 9, 9), comp('b', 1, 1)],
      connections: [conn('c1', 'a', 'b')],
      steps: [{ id: 0, title: 'S', highlight: [], active_connections: [] }],
    })

    it('rewrites only layout, never the steps or connections', () => {
      const before = def()
      const after = flowReducer(before, { type: 'layout/tidy', scene: null })
      expect(after.steps).toBe(before.steps)
      expect(after.connections).toBe(before.connections)
      expect(after.components.map((c) => c.id)).toEqual(['a', 'b'])
    })

    it('tidies a nested scene without touching the outer one', () => {
      const before: FlowDefinition = {
        ...def(),
        components: [
          {
            ...comp('a', 9, 9),
            detail: {
              grid: { cols: 30, rows: 20 },
              components: [comp('i1', 8, 8), comp('i2', 1, 1)],
              connections: [conn('ic1', 'i1', 'i2')],
            },
          },
          comp('b', 1, 1),
        ],
      }
      const after = flowReducer(before, { type: 'layout/tidy', scene: 'a' })
      expect(after.components[0].position).toEqual(before.components[0].position)
      expect(after.components[1].position).toEqual(before.components[1].position)
      const inner = after.components[0].detail!.components
      expect(colOf({ components: inner }, 'i1')).toBeLessThan(colOf({ components: inner }, 'i2'))
    })
  })
})
