import { describe, it, expect } from 'vitest'
import {
  gridToWorld,
  worldToGrid,
  snapWaypoint,
  WAYPOINT_SNAP,
  componentCenter,
  componentMeshSize,
  CELL_SIZE,
  ELEVATION_UNIT,
  COMPONENT_GAP,
  COMPONENT_HEIGHT,
} from '@/engine/layoutEngine'
import type { Component } from '@/types/schema'

function component(overrides: Partial<Component> = {}): Component {
  return {
    id: 'x',
    label: 'X',
    type: 'service',
    position: { col: 0, row: 0 },
    ...overrides,
  }
}

// ── gridToWorld() ────────────────────────────────────────────────────────────

describe('gridToWorld()', () => {
  it('maps (0, 0) to the origin', () => {
    const v = gridToWorld(0, 0)
    expect(v.x).toBe(0)
    expect(v.y).toBe(0)
    expect(v.z).toBe(0)
  })

  it('scales col by CELL_SIZE into x', () => {
    expect(gridToWorld(3, 0).x).toBe(3 * CELL_SIZE)
  })

  it('scales row by CELL_SIZE into z', () => {
    expect(gridToWorld(0, 5).z).toBe(5 * CELL_SIZE)
  })

  it('applies elevation via ELEVATION_UNIT into y', () => {
    expect(gridToWorld(0, 0, 2).y).toBe(2 * ELEVATION_UNIT)
  })

  it('defaults elevation to 0', () => {
    expect(gridToWorld(1, 1).y).toBe(0)
  })
})

// ── worldToGrid() ────────────────────────────────────────────────────────────

describe('worldToGrid()', () => {
  it('is the exact inverse of gridToWorld for integer grid coords', () => {
    const pairs: Array<[number, number]> = [
      [0, 0],
      [1, 2],
      [3, 5],
      [7, 0],
      [0, 9],
      [4, 4],
    ]
    for (const [col, row] of pairs) {
      const v = gridToWorld(col, row)
      expect(worldToGrid(v.x, v.z)).toEqual({ col, row })
    }
  })

  it('rounds to the nearest cell', () => {
    expect(worldToGrid(2 * CELL_SIZE + 0.4, 0).col).toBe(2)
    // halfway rounds up
    expect(worldToGrid(2 * CELL_SIZE + CELL_SIZE / 2, 0).col).toBe(3)
    // just under halfway rounds down
    expect(worldToGrid(2 * CELL_SIZE + CELL_SIZE / 2 - 0.01, 0).col).toBe(2)
    expect(worldToGrid(0, 3 * CELL_SIZE + 0.4).row).toBe(3)
  })

  it('rounds negative coordinates correctly', () => {
    expect(worldToGrid(-CELL_SIZE, 0).col).toBe(-1)
    expect(worldToGrid(0, -2 * CELL_SIZE).row).toBe(-2)
    expect(worldToGrid(-CELL_SIZE - 0.4, 0).col).toBe(-1)
  })

  it('maps the origin to { col: 0, row: 0 }', () => {
    expect(worldToGrid(0, 0)).toEqual({ col: 0, row: 0 })
  })
})

// ── componentCenter() ────────────────────────────────────────────────────────

describe('componentCenter()', () => {
  it('centres a 1×1 component at (col+0.5, 0, row+0.5) × CELL_SIZE', () => {
    const v = componentCenter(component({ position: { col: 2, row: 3 } }))
    expect(v.x).toBeCloseTo(2.5 * CELL_SIZE)
    expect(v.z).toBeCloseTo(3.5 * CELL_SIZE)
    expect(v.y).toBe(0)
  })

  it('centres a 2×1 component at (col+1, 0, row+0.5) × CELL_SIZE', () => {
    const v = componentCenter(component({ position: { col: 4, row: 1 }, size: { w: 2, h: 1 } }))
    expect(v.x).toBeCloseTo(5 * CELL_SIZE)
    expect(v.z).toBeCloseTo(1.5 * CELL_SIZE)
  })

  it('centres a 1×3 component at (col+0.5, 0, row+1.5) × CELL_SIZE', () => {
    const v = componentCenter(component({ position: { col: 0, row: 0 }, size: { w: 1, h: 3 } }))
    expect(v.z).toBeCloseTo(1.5 * CELL_SIZE)
  })

  it('lifts centre by elevation × ELEVATION_UNIT', () => {
    const v = componentCenter(component({ position: { col: 0, row: 0, elevation: 2 } }))
    expect(v.y).toBe(2 * ELEVATION_UNIT)
  })

  it('defaults elevation to 0 when not specified', () => {
    const v = componentCenter(component({ position: { col: 0, row: 0 } }))
    expect(v.y).toBe(0)
  })
})

// ── componentMeshSize() ──────────────────────────────────────────────────────

describe('componentMeshSize()', () => {
  it('scales width and depth by CELL_SIZE × COMPONENT_GAP', () => {
    const v = componentMeshSize(component())
    expect(v.x).toBeCloseTo(CELL_SIZE * COMPONENT_GAP)
    expect(v.z).toBeCloseTo(CELL_SIZE * COMPONENT_GAP)
  })

  it('uses COMPONENT_HEIGHT for the component type', () => {
    const types = Object.keys(COMPONENT_HEIGHT) as Array<keyof typeof COMPONENT_HEIGHT>
    for (const type of types) {
      const v = componentMeshSize(component({ type }))
      expect(v.y).toBe(COMPONENT_HEIGHT[type])
    }
  })

  it('scales a 2×1 component to double width', () => {
    const v = componentMeshSize(component({ size: { w: 2, h: 1 } }))
    expect(v.x).toBeCloseTo(2 * CELL_SIZE * COMPONENT_GAP)
    expect(v.z).toBeCloseTo(1 * CELL_SIZE * COMPONENT_GAP)
  })

  it('scales a 1×3 component to triple depth', () => {
    const v = componentMeshSize(component({ size: { w: 1, h: 3 } }))
    expect(v.z).toBeCloseTo(3 * CELL_SIZE * COMPONENT_GAP)
  })
})

describe('snapWaypoint', () => {
  it('leaves a whole cell alone', () => {
    expect(snapWaypoint(7)).toBe(7)
  })

  it('leaves a half cell alone', () => {
    expect(snapWaypoint(7.5)).toBe(7.5)
  })

  it('pulls a coordinate to the nearer half', () => {
    expect(snapWaypoint(7.4)).toBe(7.5)
    expect(snapWaypoint(7.2)).toBe(7)
  })

  it('lands exactly on the lattice, so a saved route has no float dust', () => {
    for (let i = 0; i < 40; i++) {
      const snapped = snapWaypoint(i * 0.137)
      expect(snapped % WAYPOINT_SNAP).toBe(0)
      expect(String(snapped)).toMatch(/^-?\d+(\.5)?$/)
    }
  })

  it('snaps negatives the same way, so a re-base has nothing to tidy', () => {
    expect(snapWaypoint(-2.4)).toBe(-2.5)
  })
})
