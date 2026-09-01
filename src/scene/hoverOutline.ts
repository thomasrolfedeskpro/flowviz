import * as THREE from 'three'
import { Tween, Easing } from '@tweenjs/tween.js'
import { tweenGroup } from '@/scene/tweenGroup'

/**
 * Hover outlines for everything grabbable in edit mode — zone corners, the zone
 * move grip, waypoint diamonds, pipe-label pads, zone label chips and the
 * components themselves.
 *
 * One mechanism for all of them, so hovering anything looks the same: an
 * outline says "this is what you would grab" without moving or resizing the
 * thing, which would misrepresent where it actually sits on the grid.
 *
 * The outline is parented to its target, so it inherits position and rotation
 * for free — nothing to keep in sync as zones resize or pipes move.
 */

/** The halo has to contrast with the page, not with the handle: white on a pale
 *  grid is nearly invisible, and near-black on a dark one likewise. */
const OUTLINE_COLOR: Record<'light' | 'dark', number> = {
  light: 0x101a2b,
  dark:  0xffffff,
}
let outlineTheme: 'light' | 'dark' = 'light'
const OUTLINE_OPACITY = 0.95
/** Ring thickness, in screen pixels. A fixed world-space inflate can't hold
 *  this: the same multiplier is a hairline at overview zoom and a fat box when
 *  zoomed in, which is how the halo ended up looking like a black slab. */
const OUTLINE_RING_PX = 2.5
/** Per-axis ceiling on the inflate — never let it become a slab, whatever the
 *  zoom maths says. Binds only on axes so short that a real ring would double
 *  their size (the 0.12-unit thickness of a label pad, say). */
const MAX_INFLATE = 1.35
const FADE_MS = 110

interface HoverState {
  outline: THREE.Mesh
  material: THREE.MeshBasicMaterial
  tween: Tween<{ o: number }> | null
  on: boolean
  /** Half-extents of the target's geometry, for turning a pixel width into a
   *  per-axis scale. A single uniform scale can't do it: 1.35× a 1.6-unit label
   *  pad adds 0.28 along its length and 0.02 across its depth, which reads as a
   *  box round the label rather than an outline of it. */
  half: THREE.Vector3
}

const states = new WeakMap<THREE.Mesh, HoverState>()
/** Live halo materials, so a theme change can recolour the ones already built. */
const liveMaterials = new Set<THREE.MeshBasicMaterial>()

export function setHoverOutlineTheme(theme: 'light' | 'dark'): void {
  outlineTheme = theme
  for (const mat of liveMaterials) mat.color.setHex(OUTLINE_COLOR[theme])
}

/** The blue the edit handles use. Reads as "interactive" on any background,
 *  which is what the near-black zone label chips need. */
export const EDIT_ACCENT = 0x4488ff

interface OutlineOptions {
  /**
   * For flat, single-sided targets — the zone label chips. A back-face hull is
   * invisible on a plane (its back face points away from the camera), so the
   * halo is a front-facing copy drawn *before* the target instead, which the
   * target then covers except for the margin sticking out around it.
   */
  flat?: boolean
  /**
   * Override the theme colour. Only worth it when the target itself is the thing
   * to contrast with: a near-black ring round the off-black zone label chip is
   * invisible however well it's sized.
   */
  color?: number
}

/** Give a mesh a hover outline, hidden until `setHoverOutline` turns it on. */
export function attachHoverOutline(handle: THREE.Mesh, opts: OutlineOptions = {}): void {
  // A back-face hull, not a wireframe: on a shape this small every edge of a
  // wireframe shows through the handle and reads as a snowflake. Rendering an
  // inflated copy inside-out leaves only a clean halo around the silhouette.
  // depthTest stays ON so the handle's own depth clips the hull: three.js draws
  // transparent materials after all opaque ones, so with the test off the halo
  // would paint straight over the handle and read as a white blob instead of a
  // ring around it. depthWrite off so it never occludes anything itself.
  const material = new THREE.MeshBasicMaterial({
    color: opts.color ?? OUTLINE_COLOR[outlineTheme],
    transparent: true,
    opacity: 0,
    side: opts.flat ? THREE.DoubleSide : THREE.BackSide,
    depthWrite: false,
    depthTest: !opts.flat,
  })
  const outline = new THREE.Mesh(handle.geometry, material)
  outline.renderOrder = (handle.renderOrder ?? 0) + (opts.flat ? -1 : 1)
  outline.visible = false
  handle.add(outline)
  // An explicit colour opts out of theme recolouring — it was chosen against the
  // target, which doesn't change with the theme.
  if (opts.color === undefined) liveMaterials.add(material)

  handle.geometry.computeBoundingBox()
  const box = handle.geometry.boundingBox
  const half = box
    ? box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
    : new THREE.Vector3(0.5, 0.5, 0.5)
  states.set(handle, { outline, material, tween: null, on: false, half })
}

/**
 * Keep the ring a constant few pixels wide on every side. `unitsPerPixel` comes
 * from the camera, so the caller re-applies this while the zoom changes.
 *
 * Each axis is scaled to add the *same world margin*, which is what makes the
 * ring even on stretched shapes; an axis with no extent (a plane's normal) is
 * left alone.
 */
export function setHoverOutlineScale(handle: THREE.Mesh, unitsPerPixel: number): void {
  const state = states.get(handle)
  if (!state || !state.on) return
  const ringWorld = OUTLINE_RING_PX * unitsPerPixel
  const axis = (half: number) =>
    half < 1e-4 ? 1 : 1 + Math.min(MAX_INFLATE - 1, ringWorld / half)
  state.outline.scale.set(axis(state.half.x), axis(state.half.y), axis(state.half.z))
}

export function setHoverOutline(handle: THREE.Mesh, on: boolean): void {
  const state = states.get(handle)
  if (!state || state.on === on) return
  state.on = on
  state.tween?.stop()
  if (on) state.outline.visible = true
  state.tween = new Tween({ o: state.material.opacity }, tweenGroup)
    .to({ o: on ? OUTLINE_OPACITY : 0 }, FADE_MS)
    .easing(Easing.Quadratic.Out)
    .onUpdate(({ o }) => { state.material.opacity = o })
    .onComplete(() => { if (!on) state.outline.visible = false })
    .start()
}

/** Drop the outline with no fade — used when a drag takes over from a hover. */
export function cancelHoverOutline(handle: THREE.Mesh): void {
  const state = states.get(handle)
  if (!state) return
  state.tween?.stop()
  state.tween = null
  state.on = false
  state.material.opacity = 0
  state.outline.visible = false
}

/** Free the outline that `attachHoverOutline` added. */
export function disposeHoverOutline(handle: THREE.Mesh): void {
  const state = states.get(handle)
  if (!state) return
  state.tween?.stop()
  handle.remove(state.outline)
  // geometry is shared with the handle, which disposes it itself
  liveMaterials.delete(state.material)
  state.material.dispose()
  states.delete(handle)
}
