import * as THREE from 'three'
import type { ComponentShape } from '@/types/schema'

/**
 * Component bodies are all simple extruded prisms — a footprint polygon pulled
 * up to the component's height. No bespoke "server" / "cloud" / "phone" models:
 * they read as clutter at this scale and the icon on top already says what the
 * component is.
 */
export const COMPONENT_SHAPES: ComponentShape[] = [
  'cuboid',
  'cylinder',
  'hexagon',
  'octagon',
  'triangle',
]

/** Sides of the footprint polygon. Cylinder is just a high-sided prism. */
const SIDES: Record<Exclude<ComponentShape, 'cuboid'>, number> = {
  cylinder: 40,
  octagon:  8,
  hexagon:  6,
  triangle: 3,
}

/** How much of the footprint an icon face may cover without overhanging. */
const ICON_FIT: Record<ComponentShape, number> = {
  cuboid:   0.88,
  cylinder: 0.72,
  octagon:  0.74,
  hexagon:  0.70,
  triangle: 0.44,
}

export function iconFitRatio(shape: ComponentShape): number {
  return ICON_FIT[shape] ?? ICON_FIT.cuboid
}

/** Body geometry filling `size.x` × `size.z`, `height` tall, centred on origin. */
export function buildBodyGeometry(
  shape:  ComponentShape,
  size:   THREE.Vector3,
  height: number,
): THREE.BufferGeometry {
  if (shape === 'cuboid') return new THREE.BoxGeometry(size.x, height, size.z)

  // Unit-radius prism scaled to the footprint, so a non-square component
  // stretches its polygon rather than leaving gaps in its cell.
  const geo = new THREE.CylinderGeometry(0.5, 0.5, height, SIDES[shape])
  geo.scale(size.x, 1, size.z)
  return geo
}
