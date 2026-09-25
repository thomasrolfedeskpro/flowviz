/**
 * The dashed boundary drawn round a nested scene.
 *
 * It is derived, not authored: whatever bounds the scene's contents, plus a
 * margin. That only holds if it is re-fitted when something inside moves —
 * built once in the constructor it went stale the moment a component was
 * dragged, leaving a box that no longer contained its own scene.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'
import { SceneBoundary } from '@/scene/SceneBoundary'

/** The outline's extent in world units, read back off its geometry. */
function extent(parent: THREE.Object3D): { w: number; d: number; cx: number; cz: number } {
  const line = parent.getObjectByProperty('type', 'LineSegments') as THREE.LineSegments
  line.geometry.computeBoundingBox()
  const bb = line.geometry.boundingBox!
  return {
    w:  +(bb.max.x - bb.min.x).toFixed(3),
    d:  +(bb.max.z - bb.min.z).toFixed(3),
    cx: +line.position.x.toFixed(3),
    cz: +line.position.z.toFixed(3),
  }
}

const BOUNDS = { minX: 0, maxX: 30, minZ: 0, maxZ: 12 }

describe('SceneBoundary', () => {
  let parent: THREE.Object3D
  let boundary: SceneBoundary

  beforeEach(() => {
    // The scene's name is baked into a canvas texture and there is no DOM in
    // this runner. With no 2-D context `buildLabel` bails out, which leaves
    // exactly the outline these tests are about.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    parent = new THREE.Object3D()
    boundary = new SceneBoundary(parent, BOUNDS, 'The consumer unit', 'light', 1)
  })

  it('stands off the contents by a fixed margin on every side', () => {
    const { w, d, cx, cz } = extent(parent)
    // 1.4 cells of 3.0 world units, both sides: 8.4 wider and deeper than the
    // contents, centred on them.
    expect(w).toBe(30 + 8.4)
    expect(d).toBe(12 + 8.4)
    expect(cx).toBe(15)
    expect(cz).toBe(6)
  })

  it('re-fits when the contents grow', () => {
    boundary.setBounds({ minX: -9, maxX: 30, minZ: 0, maxZ: 21 })
    const { w, d, cx, cz } = extent(parent)
    expect(w).toBe(39 + 8.4)
    expect(d).toBe(21 + 8.4)
    expect(cx).toBe(10.5)
    expect(cz).toBe(10.5)
  })

  it('re-fits when the contents shrink', () => {
    boundary.setBounds({ minX: 6, maxX: 12, minZ: 3, maxZ: 6 })
    const { w, d } = extent(parent)
    expect(w).toBe(6 + 8.4)
    expect(d).toBe(3 + 8.4)
  })

  it('throws away the geometry it replaces', () => {
    const line = parent.getObjectByProperty('type', 'LineSegments') as THREE.LineSegments
    const first = line.geometry
    let disposed = false
    first.addEventListener('dispose', () => { disposed = true })
    boundary.setBounds({ minX: 0, maxX: 60, minZ: 0, maxZ: 24 })
    expect(disposed).toBe(true)
    expect(line.geometry).not.toBe(first)
  })
})
