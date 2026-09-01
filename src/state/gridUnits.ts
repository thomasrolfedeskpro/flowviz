import type { InternalComponent, InternalZone } from '@/types/internal'
import type { Zone } from '@/types/schema'
import { CELL_SIZE, COMPONENT_GAP } from '@/engine/layoutEngine'

/**
 * World units → grid cells, for the moment an edit is committed.
 *
 * The scene works in world units and the file in cells; this is the only place
 * that converts between them on the way out, so a drag and a zone resize can't
 * disagree about where cell zero is.
 */

export function componentGridSize(ic: InternalComponent): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(ic.meshSize.x / (CELL_SIZE * COMPONENT_GAP))),
    h: Math.max(1, Math.round(ic.meshSize.z / (CELL_SIZE * COMPONENT_GAP))),
  }
}

/** A component's `center` is its middle; the file stores its top-left cell. */
export function componentGridPosition(ic: InternalComponent): { col: number; row: number } {
  const w = ic.meshSize.x / (CELL_SIZE * COMPONENT_GAP)
  const h = ic.meshSize.z / (CELL_SIZE * COMPONENT_GAP)
  return {
    col: Math.round(ic.center.x / CELL_SIZE - w / 2),
    row: Math.round(ic.center.z / CELL_SIZE - h / 2),
  }
}

export function zoneGridBounds(iz: InternalZone): Zone['bounds'] {
  const col = Math.round(iz.min.x / CELL_SIZE)
  const row = Math.round(iz.min.z / CELL_SIZE)
  return {
    col,
    row,
    width:  Math.max(1, Math.round(iz.max.x / CELL_SIZE) - col),
    height: Math.max(1, Math.round(iz.max.z / CELL_SIZE) - row),
  }
}

export function gridFromBounds(bounds: { maxX: number; maxZ: number }): { cols: number; rows: number } {
  return {
    cols: Math.round(bounds.maxX / CELL_SIZE),
    rows: Math.round(bounds.maxZ / CELL_SIZE),
  }
}
