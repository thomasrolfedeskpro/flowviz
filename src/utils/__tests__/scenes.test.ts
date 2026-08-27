/**
 * The step list is flat and only names a scene id, so breadcrumbs and step
 * indentation both need the scene tree recovered from the components.
 */

import { describe, it, expect } from 'vitest'
import { sceneIndex, findSceneGraph } from '@/utils/scenes'
import { buildGraph } from '@/engine/parseFlow'
import type { FlowDefinition } from '@/types/schema'

function flow(): FlowDefinition {
  return {
    meta: { title: 'Food chain' },
    layout: { grid: { cols: 12, rows: 6 } },
    zones: [],
    components: [
      { id: 'farm', label: 'Farm', type: 'external', position: { col: 1, row: 1 } },
      {
        id: 'factory', label: 'Factory', type: 'service', position: { col: 5, row: 1 },
        detail: {
          grid: { cols: 8, rows: 4 },
          components: [
            { id: 'receiving', label: 'Receiving', type: 'queue', position: { col: 1, row: 1 } },
            {
              id: 'mill', label: 'Mill', type: 'function', position: { col: 4, row: 1 },
              detail: {
                grid: { cols: 6, rows: 4 },
                components: [{ id: 'grinder', label: 'Grinder', type: 'function', position: { col: 1, row: 1 } }],
                connections: [],
              },
            },
          ],
          connections: [],
        },
      },
    ],
    connections: [{ id: 'c_ff', from: 'farm', to: 'factory', route: 'auto' }],
    steps: [{ id: 0, title: 'Overview', highlight: [], active_connections: [] }],
  }
}

describe('sceneIndex', () => {
  it('indexes every nested scene with its depth and label path', () => {
    const index = sceneIndex(flow())
    expect([...index.keys()]).toEqual(['factory', 'mill'])
    expect(index.get('factory')).toMatchObject({ depth: 1, path: ['Factory'] })
    expect(index.get('mill')).toMatchObject({ depth: 2, path: ['Factory', 'Mill'] })
  })

  it('is empty for a flow with no nesting', () => {
    const flat = flow()
    delete flat.components[1].detail
    expect(sceneIndex(flat).size).toBe(0)
  })
})

describe('findSceneGraph', () => {
  it('finds a scene at any depth, and falls back to the root', () => {
    const root = buildGraph(flow())
    expect([...findSceneGraph(root, null).components.keys()]).toEqual(['farm', 'factory'])
    expect([...findSceneGraph(root, 'factory').components.keys()]).toEqual(['receiving', 'mill'])
    expect([...findSceneGraph(root, 'mill').components.keys()]).toEqual(['grinder'])
    // an unknown id must not blow up an overlay mid-render
    expect(findSceneGraph(root, 'nope')).toBe(root)
  })
})
