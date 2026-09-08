/**
 * The flow definition is the source of truth, so these tests carry the weight
 * the old graph-to-definition serializer tests used to: an edit lands in the
 * right scene, in the right units, and nothing else in the file moves.
 */
import { describe, it, expect } from 'vitest'
import { applyActions, flowReducer } from '@/state/flowActions'
import { zoneGridBounds } from '@/state/gridUnits'
import { buildGraph, validateFlow } from '@/engine/parseFlow'
import { applyZoneCorner, snapZoneToGrid } from '@/scene/ZoneRenderer'
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
    connections: [{ id: 'c_ab', from: 'a', to: 'a', route: 'auto' }],
    steps: [{ id: 0, title: 'Overview', highlight: [], active_connections: [] }],
  }
}

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
              id: 'mill', label: 'Mill', type: 'service', position: { col: 5, row: 2 },
              detail: {
                grid: { cols: 8, rows: 4 },
                components: [{ id: 'grinder', label: 'Grinder', type: 'function', position: { col: 1, row: 1 } }],
                connections: [],
              },
            },
          ],
          connections: [{ id: 'c_rm', from: 'receiving', to: 'mill', route: 'auto' }],
        },
      },
    ],
    connections: [{ id: 'c_ff', from: 'farm', to: 'factory', route: 'auto' }],
    steps: [{ id: 0, title: 'Overview', highlight: [], active_connections: [] }],
  }
}

/** Every path where two definitions differ, as dotted strings. The point of the
 *  inversion is that this stays tiny — one edit, one path. */
function changedPaths(a: unknown, b: unknown, path = ''): string[] {
  if (a === b) return []
  const bothObjects =
    typeof a === 'object' && typeof b === 'object' && a !== null && b !== null &&
    Array.isArray(a) === Array.isArray(b)
  if (!bothObjects) return [path || '(root)']
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
  return [...keys].flatMap((k) =>
    changedPaths(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      path ? `${path}.${k}` : k,
    ),
  )
}

describe('flowReducer — zones', () => {
  it('writes resized bounds in grid cells', () => {
    const def   = zonedFlow()
    const graph = buildGraph(def)
    const z     = graph.zones[0]

    applyZoneCorner(z, 'se', 8 * CELL_SIZE, 5 * CELL_SIZE)
    snapZoneToGrid(z)

    const out = flowReducer(def, {
      type: 'zone/setBounds', scene: null, id: 'z1', bounds: zoneGridBounds(z),
    })
    expect(out.zones[0].bounds).toEqual({ col: 1, row: 1, width: 7, height: 4 })
  })

  it('renames a zone without touching anything else', () => {
    const def = zonedFlow()
    const out = flowReducer(def, { type: 'zone/setLabel', scene: null, id: 'z1', label: 'Renamed' })
    expect(out.zones[0].label).toBe('Renamed')
    expect(changedPaths(def, out)).toEqual(['zones.0.label'])
  })
})

describe('flowReducer — components and connections', () => {
  it('writes size, icon and colour from a patch', () => {
    const def = zonedFlow()
    const out = flowReducer(def, {
      type: 'component/patch', scene: null, id: 'a',
      patch: { size: { w: 3, h: 1 }, icon: 'database', color: '#e91e63' },
    })
    expect(out.components[0]).toMatchObject({
      size: { w: 3, h: 1 }, icon: 'database', color: '#e91e63',
    })
  })

  it('drops cleared icon/colour overrides instead of writing undefined', () => {
    const def = zonedFlow()
    def.components[0].icon  = 'database'
    def.components[0].color = '#ffffff'

    const out = flowReducer(def, {
      type: 'component/patch', scene: null, id: 'a', patch: { icon: undefined, color: undefined },
    })
    expect('icon' in out.components[0]).toBe(false)
    expect('color' in out.components[0]).toBe(false)
  })

  it('does not stamp defaults onto a component it patches', () => {
    const def = zonedFlow()
    const out = flowReducer(def, {
      type: 'component/patch', scene: null, id: 'a', patch: { shape: 'cuboid', size: { w: 1, h: 1 } },
    })
    expect(changedPaths(def, out)).toEqual([])
  })

  it('keeps elevation when a drag moves a component', () => {
    const def = zonedFlow()
    def.components[0].position = { col: 1, row: 1, elevation: 2 }
    const out = flowReducer(def, {
      type: 'component/setPosition', scene: null, id: 'a', position: { col: 4, row: 3 },
    })
    expect(out.components[0].position).toEqual({ col: 4, row: 3, elevation: 2 })
  })

  it('renames a connection', () => {
    const def = zonedFlow()
    const out = flowReducer(def, {
      type: 'connection/setLabel', scene: null, id: 'c_ab', label: 'renamed pipe',
    })
    expect(out.connections[0].label).toBe('renamed pipe')
    expect(changedPaths(def, out)).toEqual(['connections.0.label'])
  })

  it('takes a copy of a route, so later graph edits cannot rewrite history', () => {
    const def = zonedFlow()
    const route = [{ col: 4, row: 5 }]
    const out = flowReducer(def, { type: 'connection/setRoute', scene: null, id: 'c_ab', route })

    route[0].col = 99   // the scene keeps mutating its own array after the commit
    expect(out.connections[0].route).toEqual([{ col: 4, row: 5 }])
  })
})

describe('flowReducer — inspector fields', () => {
  it('writes a component label, type and meta', () => {
    const def = zonedFlow()
    const out = flowReducer(def, {
      type: 'component/patch', scene: null, id: 'a',
      patch: { label: 'Renamed', type: 'database', meta: { description: 'Holds the tickets' } },
    })
    expect(out.components[0]).toMatchObject({
      label: 'Renamed', type: 'database', meta: { description: 'Holds the tickets' },
    })
  })

  it('folds elevation into position, and drops it at floor level', () => {
    const def = zonedFlow()
    const raised = flowReducer(def, {
      type: 'component/patch', scene: null, id: 'a', patch: { elevation: 3 },
    })
    expect(raised.components[0].position).toEqual({ col: 1, row: 1, elevation: 3 })

    const lowered = flowReducer(raised, {
      type: 'component/patch', scene: null, id: 'a', patch: { elevation: 0 },
    })
    expect(lowered.components[0].position).toEqual({ col: 1, row: 1 })
  })

  it('drops an empty meta rather than writing an empty object', () => {
    const def = zonedFlow()
    const out = flowReducer(def, {
      type: 'component/patch', scene: null, id: 'a', patch: { meta: { description: '', notes: '' } },
    })
    expect('meta' in out.components[0]).toBe(false)
  })

  it('writes zone colour, border and parent', () => {
    const def = zonedFlow()
    def.zones.push({ id: 'z2', label: 'Inner', color: '#fff', bounds: { col: 2, row: 2, width: 1, height: 1 } })
    const out = flowReducer(def, {
      type: 'zone/patch', scene: null, id: 'z2',
      patch: { color: '#ff0000', outline: 'dashed', parentId: 'z1' },
    })
    expect(out.zones[1]).toMatchObject({ color: '#ff0000', outline: 'dashed', parentId: 'z1' })
  })

  it('drops a solid border and an empty parent, which are the defaults', () => {
    const def = zonedFlow()
    def.zones[0].outline = 'dashed'
    def.zones[0].parentId = 'z0'
    const out = flowReducer(def, {
      type: 'zone/patch', scene: null, id: 'z1', patch: { outline: 'solid', parentId: '' },
    })
    expect('outline' in out.zones[0]).toBe(false)
    expect('parentId' in out.zones[0]).toBe(false)
  })

  it('re-points a connection at different components', () => {
    const def = zonedFlow()
    def.components.push({ id: 'b', label: 'B', type: 'service', position: { col: 4, row: 1 } })
    const out = flowReducer(def, {
      type: 'connection/patch', scene: null, id: 'c_ab', patch: { from: 'a', to: 'b', label: 'POST' },
    })
    expect(out.connections[0]).toMatchObject({ from: 'a', to: 'b', label: 'POST' })
  })

  it('drops a connection label cleared to empty', () => {
    const def = zonedFlow()
    def.connections[0].label = 'POST'
    const out = flowReducer(def, {
      type: 'connection/patch', scene: null, id: 'c_ab', patch: { label: '' },
    })
    expect('label' in out.connections[0]).toBe(false)
  })

  it('edits flow title and description', () => {
    const def = zonedFlow()
    const out = flowReducer(def, {
      type: 'meta/patch', patch: { title: 'New title', description: 'Why it exists' },
    })
    expect(out.meta).toEqual({ title: 'New title', description: 'Why it exists' })
    expect(changedPaths(def, out)).toEqual(['meta.title', 'meta.description'])
  })

  it('drops a description cleared to empty', () => {
    const def = { ...zonedFlow(), meta: { title: 'T', description: 'D' } }
    const out = flowReducer(def, { type: 'meta/patch', patch: { description: undefined } })
    expect('description' in out.meta).toBe(false)
  })

  it('sets and clears the waterfall label', () => {
    const def = { ...zonedFlow(), meta: { title: 'T' } }
    const named = flowReducer(def, { type: 'meta/patch', patch: { waterfallLabel: 'Cost' } })
    expect(named.meta.waterfallLabel).toBe('Cost')
    // Blank means "no label", not an empty heading, so the key goes.
    const cleared = flowReducer(named, { type: 'meta/patch', patch: { waterfallLabel: '' } })
    expect('waterfallLabel' in cleared.meta).toBe(false)
  })
})

describe('flowReducer — steps', () => {
  const threeSteps = (): FlowDefinition => ({
    ...zonedFlow(),
    steps: [
      { id: 0, title: 'One',   highlight: [], active_connections: [] },
      { id: 1, title: 'Two',   highlight: ['a'], active_connections: [], footer: [{ text: 'note' }] },
      { id: 2, title: 'Three', highlight: [], active_connections: [] },
    ],
  })

  it('patches fields on one step', () => {
    const def = threeSteps()
    const out = flowReducer(def, {
      type: 'step/patch', index: 1, patch: { title: 'Renamed', highlight: ['a'] },
    })
    expect(out.steps[1].title).toBe('Renamed')
    expect(changedPaths(def, out)).toEqual(['steps.1.title'])
  })

  it('removes a field the patch sets to undefined', () => {
    const def = threeSteps()
    const out = flowReducer(def, { type: 'step/patch', index: 1, patch: { footer: undefined } })
    expect('footer' in out.steps[1]).toBe(false)
  })

  it('gives an inserted step an id nothing else is using', () => {
    const def = threeSteps()
    const out = flowReducer(def, {
      type: 'step/insert', index: 1, step: { title: 'New', highlight: [], active_connections: [] },
    })
    expect(out.steps.map((s) => s.title)).toEqual(['One', 'New', 'Two', 'Three'])
    expect(new Set(out.steps.map((s) => s.id)).size).toBe(4)
    expect(out.steps[1].id).toBe(3)
  })

  it('inserts at the end when the index runs past it', () => {
    const def = threeSteps()
    const out = flowReducer(def, {
      type: 'step/insert', index: 99, step: { title: 'Last', highlight: [], active_connections: [] },
    })
    expect(out.steps[3].title).toBe('Last')
  })

  it('removes a step', () => {
    const out = flowReducer(threeSteps(), { type: 'step/remove', index: 0 })
    expect(out.steps.map((s) => s.title)).toEqual(['Two', 'Three'])
  })

  it('refuses to remove the last step, which would leave nothing to render', () => {
    const def = { ...zonedFlow(), steps: [{ id: 0, title: 'Only', highlight: [], active_connections: [] }] }
    expect(flowReducer(def, { type: 'step/remove', index: 0 })).toBe(def)
  })

  it('reorders without renumbering — ids stay with their step', () => {
    const out = flowReducer(threeSteps(), { type: 'step/reorder', from: 2, to: 0 })
    expect(out.steps.map((s) => s.title)).toEqual(['Three', 'One', 'Two'])
    expect(out.steps.map((s) => s.id)).toEqual([2, 0, 1])
  })

  it('ignores a reorder that goes nowhere or off the end', () => {
    const def = threeSteps()
    expect(flowReducer(def, { type: 'step/reorder', from: 1, to: 1 })).toBe(def)
    expect(flowReducer(def, { type: 'step/reorder', from: 1, to: 9 })).toBe(def)
  })
})

describe('flowReducer — no-ops', () => {
  it('hands back the same definition when an action changes nothing', () => {
    const def = zonedFlow()
    // Every zone gesture reports the grid, changed or not.
    const out = flowReducer(def, { type: 'layout/setGrid', scene: null, grid: { cols: 12, rows: 8 } })
    expect(out).toBe(def)
  })

  it('hands back the same definition when the target is missing', () => {
    const def = zonedFlow()
    expect(flowReducer(def, { type: 'zone/setLabel', scene: null, id: 'nope', label: 'x' })).toBe(def)
  })
})

describe('flowReducer — nested scenes', () => {
  it('lands an edit in the right scene, at any depth', () => {
    const def = nestedFlow()
    const out = applyActions(def, [
      { type: 'component/setPosition', scene: null,      id: 'farm',      position: { col: 4, row: 2 } },
      { type: 'component/setPosition', scene: 'factory', id: 'receiving', position: { col: 5, row: 3 } },
      { type: 'component/patch',       scene: 'factory', id: 'receiving', patch: { color: '#ff0000' } },
      { type: 'zone/setLabel',         scene: 'factory', id: 'z_floor',   label: 'Renamed floor' },
      { type: 'component/setPosition', scene: 'mill',    id: 'grinder',   position: { col: 3, row: 1 } },
      { type: 'component/patch',       scene: 'mill',    id: 'grinder',   patch: { shape: 'cylinder' } },
    ])

    expect(out.components.find((c) => c.id === 'farm')!.position).toMatchObject({ col: 4, row: 2 })

    const factory   = out.components.find((c) => c.id === 'factory')!
    const receiving = factory.detail!.components.find((c) => c.id === 'receiving')!
    expect(receiving.position).toMatchObject({ col: 5, row: 3 })
    expect(receiving.color).toBe('#ff0000')
    expect(factory.detail!.zones![0].label).toBe('Renamed floor')

    const mill    = factory.detail!.components.find((c) => c.id === 'mill')!
    const grinder = mill.detail!.components.find((c) => c.id === 'grinder')!
    expect(grinder.position).toMatchObject({ col: 3, row: 1 })
    expect(grinder.shape).toBe('cylinder')
  })

  it('changes exactly one path, however deep the scene', () => {
    const def = nestedFlow()
    const out = flowReducer(def, {
      type: 'component/setPosition', scene: 'mill', id: 'grinder', position: { col: 3, row: 1 },
    })
    expect(changedPaths(def, out)).toEqual([
      'components.1.detail.components.1.detail.components.0.position.col',
    ])
  })

  it('leaves the definition alone when the scene does not exist', () => {
    const def = nestedFlow()
    const out = flowReducer(def, {
      type: 'component/setPosition', scene: 'no_such_scene', id: 'x', position: { col: 0, row: 0 } },
    )
    expect(out).toBe(def)
  })

  it('still validates after an edit, with steps and meta untouched', () => {
    const def = nestedFlow()
    const out = flowReducer(def, {
      type: 'component/setPosition', scene: null, id: 'factory', position: { col: 6, row: 2 },
    })
    expect(() => validateFlow(out)).not.toThrow()
    expect(out.steps).toBe(def.steps)
    expect(out.meta).toBe(def.meta)
  })
})

describe('flowReducer — wholesale replacement, for the JSON hatch', () => {
  it('replaces a component rather than merging, so dropped keys are dropped', () => {
    const def = zonedFlow()
    def.components[0].icon = 'database'
    const out = flowReducer(def, {
      type: 'component/replace', scene: null, id: 'a',
      component: { id: 'a', label: 'A', type: 'client', position: { col: 2, row: 2 } },
    })
    expect('icon' in out.components[0]).toBe(false)
    expect(out.components[0].position).toEqual({ col: 2, row: 2 })
  })

  it('replaces a step in place', () => {
    const def = zonedFlow()
    const out = flowReducer(def, {
      type: 'step/replace', index: 0,
      step: { id: 0, title: 'Rewritten', highlight: ['a'], active_connections: [] },
    })
    expect(out.steps[0].title).toBe('Rewritten')
    expect(out.steps).toHaveLength(1)
  })

  it('ignores a replacement aimed at something that is not there', () => {
    const def = zonedFlow()
    expect(flowReducer(def, {
      type: 'step/replace', index: 9,
      step: { id: 9, title: 'Nope', highlight: [], active_connections: [] },
    })).toBe(def)
  })
})
