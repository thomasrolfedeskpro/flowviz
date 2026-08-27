/**
 * Regression suite for the drag-and-drop pipe-rebuild path.
 *
 * When a component is dragged to a new cell, FlowScene mutates the
 * InternalComponent.center and calls ConnectionPipe.update() on every attached
 * pipe. update() must rebuild the tube curve from the new centers AND write the
 * fresh curve back onto the InternalConnection so packet travel (which reads
 * conn.curve) stays correct. These tests verify that contract without a browser.
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildGraph, PIPE_HEIGHT } from '@/engine/parseFlow'
import { ConnectionPipe } from '@/scene/ConnectionPipe'
import { CELL_SIZE } from '@/engine/layoutEngine'
import type { FlowDefinition } from '@/types/schema'

function twoNodeFlow(): FlowDefinition {
  return {
    meta: { title: 'Drag Test' },
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

describe('ConnectionPipe.update() — drag rebuild path', () => {
  it('curve end follows the to-component after its center moves', () => {
    const graph = buildGraph(twoNodeFlow())
    const scene = new THREE.Scene()
    const conn  = graph.connections.get('c_ab')!
    const pipe  = new ConnectionPipe(scene, conn)

    // Move component B two cells to the right (simulates a snapped drag)
    const b = graph.components.get('b')!
    const newX = b.center.x + 2 * CELL_SIZE
    b.center.set(newX, 0, b.center.z)
    b.topCenter.set(newX, b.meshSize.y, b.center.z)

    pipe.update()

    // The full curve (used by packets) must now reach the new center
    const end = pipe.curve.getPointAt(1)
    expect(end.x).toBeCloseTo(newX, 1)
    expect(end.z).toBeCloseTo(b.center.z, 1)
    expect(end.y).toBeCloseTo(PIPE_HEIGHT)
  })

  it('curve start follows the from-component after its center moves', () => {
    const graph = buildGraph(twoNodeFlow())
    const scene = new THREE.Scene()
    const conn  = graph.connections.get('c_ab')!
    const pipe  = new ConnectionPipe(scene, conn)

    const a = graph.components.get('a')!
    const newZ = a.center.z + 2 * CELL_SIZE
    a.center.set(a.center.x, 0, newZ)

    pipe.update()

    const start = pipe.curve.getPointAt(0)
    expect(start.x).toBeCloseTo(a.center.x, 1)
    expect(start.z).toBeCloseTo(newZ, 1)
  })

  it('writes the rebuilt curve back onto the InternalConnection (packet travel stays correct)', () => {
    const graph = buildGraph(twoNodeFlow())
    const scene = new THREE.Scene()
    const conn  = graph.connections.get('c_ab')!
    const pipe  = new ConnectionPipe(scene, conn)

    const before = conn.curve
    const b = graph.components.get('b')!
    b.center.set(b.center.x + 3 * CELL_SIZE, 0, b.center.z)

    pipe.update()

    // conn.curve must be the new curve object, and pipe.curve must match it
    expect(conn.curve).not.toBe(before)
    expect(pipe.curve).toBe(conn.curve)
    expect(conn.curve.getPointAt(1).x).toBeCloseTo(b.center.x, 1)
  })

  it('recomputes renderTrim so the tube still stops at the (moved) component edges', () => {
    const graph = buildGraph(twoNodeFlow())
    const scene = new THREE.Scene()
    const conn  = graph.connections.get('c_ab')!
    const pipe  = new ConnectionPipe(scene, conn)

    const b = graph.components.get('b')!
    b.center.set(b.center.x + 2 * CELL_SIZE, 0, b.center.z)
    pipe.update()

    // trim is still a valid clipped sub-range
    expect(conn.renderTrim.t0).toBeGreaterThan(0)
    expect(conn.renderTrim.t1).toBeLessThan(1)
    expect(conn.renderTrim.t0).toBeLessThan(conn.renderTrim.t1)

    // the point at t1 is outside the moved component's XZ bounds
    const pt = conn.curve.getPoint(conn.renderTrim.t1)
    const hx = b.meshSize.x / 2
    const hz = b.meshSize.z / 2
    const inside = Math.abs(pt.x - b.center.x) <= hx && Math.abs(pt.z - b.center.z) <= hz
    expect(inside).toBe(false)
  })

  it('updates midpoint in place so overlay labels holding the reference follow', () => {
    const graph = buildGraph(twoNodeFlow())
    const scene = new THREE.Scene()
    const conn  = graph.connections.get('c_ab')!
    const pipe  = new ConnectionPipe(scene, conn)

    const held   = pipe.midpoint            // what PipeLabels captures at scene-ready
    const beforeX = held.x

    graph.components.get('b')!.center.x += 3 * CELL_SIZE
    pipe.update()

    expect(pipe.midpoint).toBe(held)        // same object — reference stays live
    expect(held.x).not.toBeCloseTo(beforeX, 1)
    expect(held.x).toBeCloseTo(pipe.curve.getPointAt(0.5).x, 5)
  })

  it('disposes the old geometry on rebuild (no leak of the previous TubeGeometry)', () => {
    const graph = buildGraph(twoNodeFlow())
    const scene = new THREE.Scene()
    const conn  = graph.connections.get('c_ab')!
    const pipe  = new ConnectionPipe(scene, conn)

    const oldGeo = pipe.mesh.geometry
    let disposed = false
    oldGeo.addEventListener('dispose', () => { disposed = true })

    graph.components.get('b')!.center.x += CELL_SIZE
    pipe.update()

    expect(disposed).toBe(true)
    expect(pipe.mesh.geometry).not.toBe(oldGeo)
  })
})
