/**
 * "Pipes off" hides the tubes for a screenshot, and has to survive everything
 * that happens to a pipe afterwards: a step lighting it, a theme change, and a
 * drag rebuilding its geometry. Each of those writes to the same mesh, so the
 * visibility flag is exactly the kind of thing one of them could clear.
 *
 * FlowScene itself needs a GL context, so what is checked here is the contract
 * it drives: ConnectionPipe.setVisible, and the mesh staying in the scene so it
 * comes straight back when the pipes are turned on again.
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildGraph } from '@/engine/parseFlow'
import { ConnectionPipe } from '@/scene/ConnectionPipe'
import { CELL_SIZE } from '@/engine/layoutEngine'
import type { FlowDefinition } from '@/types/schema'

function twoNodeFlow(): FlowDefinition {
  return {
    meta: { title: 'Pipe Visibility Test' },
    layout: { grid: { cols: 12, rows: 6 } },
    zones: [],
    components: [
      { id: 'a', label: 'A', type: 'client',  position: { col: 1, row: 1 } },
      { id: 'b', label: 'B', type: 'service', position: { col: 5, row: 1 } },
    ],
    connections: [
      { id: 'c_ab', from: 'a', to: 'b', route: 'auto' },
    ],
    steps: [
      { id: 0, title: 'Overview', highlight: [], active_connections: [] },
    ],
  }
}

function buildPipe(): { pipe: ConnectionPipe; scene: THREE.Scene; graph: ReturnType<typeof buildGraph> } {
  const graph = buildGraph(twoNodeFlow())
  const scene = new THREE.Scene()
  const pipe  = new ConnectionPipe(scene, graph.connections.get('c_ab')!)
  return { pipe, scene, graph }
}

describe('ConnectionPipe.setVisible() — pipes off', () => {
  it('starts visible', () => {
    const { pipe } = buildPipe()
    expect(pipe.mesh.visible).toBe(true)
  })

  it('hides and shows the tube mesh', () => {
    const { pipe } = buildPipe()
    pipe.setVisible(false)
    expect(pipe.mesh.visible).toBe(false)
    pipe.setVisible(true)
    expect(pipe.mesh.visible).toBe(true)
  })

  it('leaves the mesh in the scene, so showing it again needs no rebuild', () => {
    const { pipe, scene } = buildPipe()
    pipe.setVisible(false)
    expect(scene.children).toContain(pipe.mesh)
  })

  it('stays hidden through a step lighting the connection', () => {
    const { pipe } = buildPipe()
    pipe.setVisible(false)
    pipe.setActive(true, 0)
    pipe.setPacketTraversing(true, 0)
    expect(pipe.mesh.visible).toBe(false)
  })

  it('stays hidden through a theme change', () => {
    const { pipe } = buildPipe()
    pipe.setVisible(false)
    pipe.setTheme('dark')
    expect(pipe.mesh.visible).toBe(false)
  })

  it('stays hidden through the drag rebuild, which replaces the geometry', () => {
    const { pipe, graph } = buildPipe()
    pipe.setVisible(false)

    const b = graph.components.get('b')!
    b.center.set(b.center.x + 2 * CELL_SIZE, 0, b.center.z)
    pipe.update()

    expect(pipe.mesh.visible).toBe(false)
  })
})
