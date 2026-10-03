import * as THREE from 'three'
import type { Component, ComponentType } from '@/types/schema'

export const CELL_SIZE      = 3.0
export const ELEVATION_UNIT = 1.5
export const COMPONENT_GAP  = 0.8

export const COMPONENT_HEIGHT: Record<ComponentType, number> = {
  client:   0.8,
  service:  1.2,
  database: 1.6,
  queue:    0.80,
  function: 0.80,
  external: 1.0,
}

export function gridToWorld(col: number, row: number, elevation = 0): THREE.Vector3 {
  return new THREE.Vector3(
    col * CELL_SIZE,
    elevation * ELEVATION_UNIT,
    row * CELL_SIZE
  )
}

export function worldToGrid(x: number, z: number): { col: number; row: number } {
  return {
    col: Math.round(x / CELL_SIZE),
    row: Math.round(z / CELL_SIZE),
  }
}

/**
 * How finely a routing waypoint lands. Components sit on whole cells, but a
 * pipe routed around one usually wants to run *between* two columns rather
 * than down the middle of either, so waypoints get the half-cell lattice.
 */
export const WAYPOINT_SNAP = 0.5

/** Rounds a grid coordinate onto the waypoint lattice. Multiples of a half are
 *  exact in binary floating point, so this never writes 7.000000001 to a file. */
export function snapWaypoint(value: number): number {
  return Math.round(value / WAYPOINT_SNAP) * WAYPOINT_SNAP
}

export function componentCenter(c: Component): THREE.Vector3 {
  const { col, row, elevation = 0 } = c.position
  const { w = 1, h = 1 } = c.size ?? {}
  return new THREE.Vector3(
    (col + w / 2) * CELL_SIZE,
    elevation * ELEVATION_UNIT,
    (row + h / 2) * CELL_SIZE
  )
}

export function componentMeshSize(c: Component): THREE.Vector3 {
  const { w = 1, h = 1 } = c.size ?? {}
  return new THREE.Vector3(
    w * CELL_SIZE * COMPONENT_GAP,
    COMPONENT_HEIGHT[c.type],
    h * CELL_SIZE * COMPONENT_GAP
  )
}
