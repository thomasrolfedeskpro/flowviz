/**
 * Nested scenes: a component's `detail` holds a scene of its own, to any depth,
 * and a step names the scene it happens inside. Ids are unique flow-wide so a
 * step can reference anything without qualification, and connections may not
 * cross a scene boundary.
 */

import { describe, it, expect } from 'vitest'
import { validateFlow, buildGraph } from '@/engine/parseFlow'
import type { FlowDefinition } from '@/types/schema'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function nestedFlow(): FlowDefinition {
  return {
    meta: { title: 'Food chain' },
    layout: { grid: { cols: 12, rows: 6 } },
    zones: [],
    components: [
      { id: 'farm', label: 'Farm', type: 'external', position: { col: 1, row: 2 } },
      {
        id: 'factory', label: 'Factory', type: 'service', position: { col: 5, row: 2 },
        detail: {
          grid: { cols: 10, rows: 6 },
          zones: [{ id: 'z_floor', label: 'Floor', color: '#888', bounds: { col: 0, row: 1, width: 8, height: 4 } }],
          components: [
            { id: 'receiving', label: 'Receiving', type: 'service', position: { col: 1, row: 2 } },
            {
              id: 'mill', label: 'Mill', type: 'function', position: { col: 5, row: 2 },
              detail: {
                grid: { cols: 6, rows: 4 },
                components: [{ id: 'grinder', label: 'Grinder', type: 'function', position: { col: 1, row: 1 } }],
                connections: [],
              },
            },
          ],
          connections: [{ id: 'c_recv_mill', from: 'receiving', to: 'mill', route: 'auto' }],
        },
      },
      { id: 'store', label: 'Store', type: 'client', position: { col: 9, row: 2 } },
    ],
    connections: [
      { id: 'c_farm_factory', from: 'farm', to: 'factory', route: 'auto' },
      { id: 'c_factory_store', from: 'factory', to: 'store', route: 'auto' },
    ],
    steps: [
      { id: 0, title: 'Overview', highlight: [], active_connections: [] },
      { id: 1, title: 'To the factory', highlight: ['farm', 'factory'], active_connections: ['c_farm_factory'] },
      { id: 2, scene: 'factory', title: 'Inside', highlight: ['receiving'], active_connections: ['c_recv_mill'] },
      { id: 3, scene: 'mill', title: 'Grinding', highlight: ['grinder'], active_connections: [] },
    ],
  }
}

describe('nested scenes', () => {
  it('accepts scenes nested to any depth', () => {
    expect(() => validateFlow(nestedFlow())).not.toThrow()
  })

  it('rejects a step naming a component with no detail scene', () => {
    const flow = clone(nestedFlow())
    flow.steps[2].scene = 'store'
    expect(() => validateFlow(flow)).toThrow(/no detail scene/)
  })

  it('rejects a step naming a scene that does not exist', () => {
    const flow = clone(nestedFlow())
    flow.steps[2].scene = 'warehouse'
    expect(() => validateFlow(flow)).toThrow(/unknown scene/)
  })

  it('rejects a step highlighting a component from another scene', () => {
    const flow = clone(nestedFlow())
    flow.steps[1].highlight = ['farm', 'receiving']
    expect(() => validateFlow(flow)).toThrow(/not in the top-level scene/)
  })

  it('rejects a step activating a connection from another scene', () => {
    const flow = clone(nestedFlow())
    flow.steps[2].active_connections = ['c_farm_factory']
    expect(() => validateFlow(flow)).toThrow(/not in scene "factory"/)
  })

  it('rejects a connection that crosses a scene boundary', () => {
    const flow = clone(nestedFlow())
    flow.components[1].detail!.connections.push(
      { id: 'c_escape', from: 'receiving', to: 'store', route: 'auto' },
    )
    expect(() => validateFlow(flow)).toThrow(/cannot cross scenes/)
  })

  it('rejects an id reused in a nested scene', () => {
    const flow = clone(nestedFlow())
    flow.components[1].detail!.components[0].id = 'store'
    expect(() => validateFlow(flow)).toThrow(/Duplicate id "store"/)
  })

  it('rejects a nested zone parented outside its own scene', () => {
    const flow = clone(nestedFlow())
    flow.zones = [{ id: 'z_top', label: 'Top', color: '#888', bounds: { col: 0, row: 0, width: 4, height: 2 } }]
    flow.components[1].detail!.zones![0].parentId = 'z_top'
    expect(() => validateFlow(flow)).toThrow(/outside this scene/)
  })

  it('still accepts a flat flow with no scenes at all', () => {
    const flow = clone(nestedFlow())
    delete flow.components[1].detail
    flow.steps = flow.steps.slice(0, 2)
    expect(() => validateFlow(flow)).not.toThrow()
  })
})

describe('buildGraph — nested scenes', () => {
  it('builds nested scene graphs', () => {
    const flow: FlowDefinition = {
      meta: { title: 'n' },
      layout: { grid: { cols: 10, rows: 6 } },
      zones: [],
      components: [
        { id: 'a', label: 'A', type: 'client', position: { col: 1, row: 1 } },
        { id: 'b', label: 'B', type: 'service', position: { col: 5, row: 1 },
          detail: { grid: { cols: 8, rows: 4 },
            components: [
              { id: 'in', label: 'In', type: 'service', position: { col: 1, row: 1 } },
              { id: 'deep', label: 'Deep', type: 'function', position: { col: 4, row: 1 },
                detail: { grid: { cols: 4, rows: 3 }, components: [{ id: 'x', label: 'X', type: 'function', position: { col: 1, row: 1 } }], connections: [] } },
            ],
            connections: [{ id: 'c_in_deep', from: 'in', to: 'deep', route: 'auto' }] } },
      ],
      connections: [{ id: 'c_ab', from: 'a', to: 'b', route: 'auto' }],
      steps: [
        { id: 0, title: 'root', highlight: [], active_connections: [] },
        { id: 1, scene: 'b', title: 'inside', highlight: ['in'], active_connections: ['c_in_deep'] },
        { id: 2, scene: 'deep', title: 'deeper', highlight: ['x'], active_connections: [] },
      ],
    }
    const g = buildGraph(flow)
    expect([...g.components.keys()]).toEqual(['a', 'b'])
    expect(g.steps).toHaveLength(3)
    const b = g.scenes.get('b')!
    expect([...b.components.keys()]).toEqual(['in', 'deep'])
    expect([...b.connections.keys()]).toEqual(['c_in_deep'])
    expect(b.steps).toEqual([])
    expect(b.gridBounds.maxX).toBe(8 * 3)
    const deep = b.scenes.get('deep')!
    expect([...deep.components.keys()]).toEqual(['x'])
    // a flow with no detail anywhere keeps an empty scene map
    const flat = clone(flow)
    delete flat.components[1].detail
    flat.steps = [flat.steps[0]]
    expect(buildGraph(flat).scenes.size).toBe(0)
  })
})
