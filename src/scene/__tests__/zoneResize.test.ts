/**
 * Zone corner-resize maths: dragging a corner in edit mode mutates the
 * InternalZone bounds, and the drag survives being dragged past the opposite
 * edge. Release snaps back onto whole grid cells.
 */

import { describe, it, expect } from 'vitest'
import { applyZoneCorner, snapZoneToGrid, componentsInZone, snapDelta } from '@/scene/ZoneRenderer'
import { buildGraph, removeWaypoint } from '@/engine/parseFlow'
import { flowReducer } from '@/state/flowActions'
import { CELL_SIZE } from '@/engine/layoutEngine'
import type { FlowDefinition } from '@/types/schema'

function zonedFlow(): FlowDefinition {
  return {
    meta: { title: 'Zone Test' },
    layout: { grid: { cols: 12, rows: 8 } },
    zones: [
      { id: 'z1', label: 'Edge', color: '#3b82f6', bounds: { col: 1, row: 1, width: 4, height: 3 } },
    ],
    components: [
      { id: 'a', label: 'A', type: 'client', position: { col: 1, row: 1 } },
    ],
    connections: [],
    steps: [{ id: 0, title: 'Overview', highlight: [], active_connections: [] }],
  }
}

const zone = () => buildGraph(zonedFlow()).zones[0]

describe('applyZoneCorner', () => {
  it('moves only the two edges the dragged corner owns', () => {
    const z = zone()
    const { x: maxX, z: maxZ } = z.max
    applyZoneCorner(z, 'nw', 3, 4)
    expect(z.min.x).toBe(3)
    expect(z.min.z).toBe(4)
    expect(z.max.x).toBe(maxX)
    expect(z.max.z).toBe(maxZ)
  })

  it('se corner drives the max edges', () => {
    const z = zone()
    const { x: minX, z: minZ } = z.min
    applyZoneCorner(z, 'se', 30, 25)
    expect(z.max.x).toBe(30)
    expect(z.max.z).toBe(25)
    expect(z.min.x).toBe(minX)
    expect(z.min.z).toBe(minZ)
  })

  it('keeps min < max and hands back the flipped corner when dragged past the opposite edge', () => {
    const z = zone()
    const originalMaxX = z.max.x
    const originalMaxZ = z.max.z

    const next = applyZoneCorner(z, 'nw', originalMaxX + 5, originalMaxZ + 5)

    expect(next).toBe('se')
    expect(z.min.x).toBeLessThan(z.max.x)
    expect(z.min.z).toBeLessThan(z.max.z)
    expect(z.max.x).toBe(originalMaxX + 5)
    expect(z.max.z).toBe(originalMaxZ + 5)
  })
})

describe('snapZoneToGrid', () => {
  it('rounds all four edges onto cell boundaries', () => {
    const z = zone()
    applyZoneCorner(z, 'se', 4.4 * CELL_SIZE, 6.6 * CELL_SIZE)
    snapZoneToGrid(z)
    for (const v of [z.min.x, z.min.z, z.max.x, z.max.z]) {
      expect(v % CELL_SIZE).toBeCloseTo(0)
    }
    expect(z.max.x).toBeCloseTo(4 * CELL_SIZE)
    expect(z.max.z).toBeCloseTo(7 * CELL_SIZE)
  })

  it('never collapses a zone below one cell', () => {
    const z = zone()
    applyZoneCorner(z, 'se', z.min.x + 0.01, z.min.z + 0.01)
    snapZoneToGrid(z)
    expect(z.max.x - z.min.x).toBeCloseTo(CELL_SIZE)
    expect(z.max.z - z.min.z).toBeCloseTo(CELL_SIZE)
  })
})

describe('whole-zone move helpers', () => {
  it('finds the components sitting inside a zone', () => {
    const graph = buildGraph(zonedFlow())
    expect(componentsInZone(graph, graph.zones[0])).toEqual(['a'])

    // move the zone away from the component and it no longer claims it
    graph.zones[0].min.set(30, 0, 30)
    graph.zones[0].max.set(40, 0, 40)
    expect(componentsInZone(graph, graph.zones[0])).toEqual([])
  })

  it('snaps a drag delta to whole cells', () => {
    expect(snapDelta(CELL_SIZE * 1.4)).toBeCloseTo(CELL_SIZE)
    expect(snapDelta(-CELL_SIZE * 0.6)).toBeCloseTo(-CELL_SIZE)
    expect(snapDelta(CELL_SIZE * 0.2)).toBe(0)
  })
})

describe('waypoint editing', () => {
  function routedFlow(): FlowDefinition {
    return {
      meta: { title: 'Routed' },
      layout: { grid: { cols: 12, rows: 8 } },
      zones: [],
      components: [
        { id: 'a', label: 'A', type: 'client',  position: { col: 1, row: 1 } },
        { id: 'b', label: 'B', type: 'service', position: { col: 8, row: 1 } },
      ],
      connections: [
        { id: 'c_ab', from: 'a', to: 'b', route: [{ col: 4, row: 5 }, { col: 6, row: 5 }] },
      ],
      steps: [{ id: 0, title: 'Overview', highlight: [], active_connections: [] }],
    }
  }

  it('drops one waypoint and keeps the rest', () => {
    const route = routedFlow().connections[0].route
    expect(removeWaypoint(route, 0)).toEqual([{ col: 6, row: 5 }])
  })

  it('falls back to auto-routing when the last waypoint goes', () => {
    expect(removeWaypoint([{ col: 4, row: 5 }], 0)).toBe('auto')
    expect(removeWaypoint('auto', 0)).toBe('auto')
  })

  it('commits edited and deleted waypoints to the definition', () => {
    const def   = routedFlow()
    const graph = buildGraph(def)
    const conn  = graph.connections.get('c_ab')!

    conn.route = [{ col: 3, row: 7 }, { col: 6, row: 5 }]   // dragged the first one
    const dragged = flowReducer(def, {
      type: 'connection/setRoute', scene: null, id: 'c_ab', route: conn.route,
    })
    expect(dragged.connections[0].route).toEqual([{ col: 3, row: 7 }, { col: 6, row: 5 }])

    conn.route = removeWaypoint(removeWaypoint(conn.route, 0), 0)
    const cleared = flowReducer(dragged, {
      type: 'connection/setRoute', scene: null, id: 'c_ab', route: conn.route,
    })
    expect(cleared.connections[0].route).toBe('auto')
  })
})

describe('the grid origin', () => {
  /**
   * Zones used to be clamped here, which meant a zone starting at col 0 could
   * never be resized outward and a whole-zone drag stopped dead at the edge.
   * A negative edge is now a legitimate intermediate state: the scene re-bases
   * on release, so the file never keeps one.
   */
  it('keeps a resized edge past the origin instead of rounding it to zero', () => {
    const z = zone()
    applyZoneCorner(z, 'nw', -9, -6)
    snapZoneToGrid(z)
    expect(z.min.x).toBe(-9)
    expect(z.min.z).toBe(-6)
  })

  it('still rounds a negative edge onto a cell boundary', () => {
    const z = zone()
    applyZoneCorner(z, 'nw', -CELL_SIZE * 1.4, -CELL_SIZE * 2.6)
    snapZoneToGrid(z)
    expect(z.min.x).toBeCloseTo(-CELL_SIZE)
    expect(z.min.z).toBeCloseTo(-CELL_SIZE * 3)
  })

  it('never collapses a zone below one cell, even across the origin', () => {
    const z = zone()
    applyZoneCorner(z, 'nw', z.max.x - 0.01, z.max.z - 0.01)
    snapZoneToGrid(z)
    expect(z.max.x - z.min.x).toBeCloseTo(CELL_SIZE)
    expect(z.max.z - z.min.z).toBeCloseTo(CELL_SIZE)
  })
})
