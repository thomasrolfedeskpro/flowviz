import * as THREE from 'three'

/**
 * Which way the camera looks at the flow.
 *
 * The projection is orthographic either way — the only thing that makes the
 * diagram isometric is where the camera sits relative to what it is looking at.
 * Moving it directly overhead gives a plan view of the same scene, with the
 * same meshes, pipes and packets.
 *
 * Plan view trades the 3D reading for a flat one: no occlusion, no diagonal,
 * and every ground label square-on instead of skewed, because zone names, scene
 * boundaries and icon faces are all drawn flat on the floor. What it gives up is
 * height — a component's extruded depth and its `elevation` both vanish when
 * you look straight down at it.
 */
export type ViewMode = 'isometric' | 'plan'

export interface ViewGeometry {
  /** Camera position relative to its target, before scaling by the distance. */
  offset: THREE.Vector3
  /** Which way is up on screen. */
  up: THREE.Vector3
}

/**
 * `up` cannot stay (0,1,0) in plan view: looking straight down makes it
 * parallel to the view direction, and `lookAt` has no basis to build from.
 * Pointing it along -Z puts world +X to screen-right, so a flow laid out left
 * to right still reads left to right.
 */
export const VIEW_GEOMETRY: Record<ViewMode, ViewGeometry> = {
  isometric: {
    offset: new THREE.Vector3(1, 1, 1),
    up:     new THREE.Vector3(0, 1, 0),
  },
  plan: {
    offset: new THREE.Vector3(0, 1, 0),
    up:     new THREE.Vector3(0, 0, -1),
  },
}

/**
 * The camera's placement part-way between the two views, for animating the
 * change rather than cutting to it.
 *
 * Straight lerps: the two `up` vectors are perpendicular, so the midpoint is a
 * sensible vector rather than a cancellation, and no intermediate leaves `up`
 * parallel to the view direction.
 */
export function blendedGeometry(blend: number): ViewGeometry {
  const iso  = VIEW_GEOMETRY.isometric
  const plan = VIEW_GEOMETRY.plan
  return {
    offset: iso.offset.clone().lerp(plan.offset, blend).normalize(),
    up:     iso.up.clone().lerp(plan.up, blend).normalize(),
  }
}

/**
 * World-space screen-right for a camera placed this way, flattened onto the
 * ground plane.
 *
 * Derived from the basis `lookAt` will build rather than hardcoded per view:
 * for the isometric camera it comes out as (1,0,-1)/√2, which is what the
 * composition code used to assume, and for plan view it is simply +X.
 */
export function groundScreenRight(geometry: ViewGeometry): THREE.Vector3 {
  const forward = geometry.offset.clone().normalize()
  const right   = new THREE.Vector3().crossVectors(geometry.up, forward)
  right.y = 0
  return right.lengthSq() > 1e-6 ? right.normalize() : new THREE.Vector3(1, 0, 0)
}
