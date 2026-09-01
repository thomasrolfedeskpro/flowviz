import * as THREE from 'three'
import { THEME_COLORS } from '@/scene/ThemeColors'
import type { Theme } from '@/scene/ThemeColors'
import { CELL_SIZE } from '@/engine/layoutEngine'

/**
 * The edge of a nested scene, drawn on the ground, and its name written beside it.
 *
 * Diving into a `component.detail` used to leave nothing on screen saying where
 * you were: the transition told you that you had gone somewhere, and a second
 * later you were looking at an unfamiliar set of boxes on the same endless grid
 * as the top level. The breadcrumb in the prose panel was the only answer, and
 * reading is not what the eye does first.
 *
 * This was first tried as a tinted slab, which worked but cast its colour over
 * everything standing on it and made the whole scene look muddy. So: no fill at
 * all. A dashed rectangle bounding the scene's contents says *you are inside
 * something*, the name on its near edge says *which*, and nothing between them
 * touches the colour of the components at all.
 */

/** Between the infinite grid (-0.15) and the zone fills (-0.08): above the grid
 *  so the boundary is not just another grid line lost among them, below the
 *  zones so it never cuts across one. */
const LINE_Y = -0.115
/** How far the boundary stands off the scene's contents, in cells. */
const MARGIN = 1.4
const LABEL_HEIGHT = 1.5
const DASH = 1.15
const GAP = 0.6

export class SceneBoundary {
  private group = new THREE.Group()
  private outline: THREE.LineSegments
  private label: THREE.Mesh | null = null
  private text: string

  constructor(
    parent: THREE.Object3D,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    text: string,
    theme: Theme,
    anisotropy: number,
  ) {
    this.text = text

    const pad = MARGIN * CELL_SIZE
    const width = bounds.maxX - bounds.minX + pad * 2
    const span = bounds.maxZ - bounds.minZ + pad * 2
    const cx = (bounds.minX + bounds.maxX) / 2
    const cz = (bounds.minZ + bounds.maxZ) / 2

    const plane = new THREE.PlaneGeometry(width, span).rotateX(-Math.PI / 2)
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(plane),
      new THREE.LineDashedMaterial({
        color: this.lineColor(theme),
        dashSize: DASH,
        gapSize: GAP,
        transparent: true,
        opacity: 0.9,
      }),
    )
    // Dashes are computed from vertex distances, so this is not optional.
    this.outline.computeLineDistances()
    this.outline.position.set(cx, LINE_Y, cz)
    plane.dispose()
    this.group.add(this.outline)

    this.buildLabel(cx, cz + span / 2, width, theme, anisotropy)
    parent.add(this.group)
  }

  /** Deliberately darker than the grid it sits on. Drawn in the grid's own
   *  colour it read as one more grid line and disappeared. */
  private lineColor(theme: Theme): THREE.Color {
    const grid = new THREE.Color(THEME_COLORS[theme].gridPrimary)
    const ink = new THREE.Color(theme === 'dark' ? 0xa8c0dd : 0x51607a)
    return grid.lerp(ink, 0.85)
  }

  /** The name, lying just inside the near edge — the one closest to the camera,
   *  where there is always empty apron and never a component. */
  private buildLabel(
    cx: number,
    nearZ: number,
    boundaryWidth: number,
    theme: Theme,
    anisotropy: number,
  ): void {
    if (!this.text) return

    const dpr = 4
    const fontPx = 34
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const caps = this.text.toUpperCase()
    // Letter-spacing has to be applied by hand: canvas has no such property in
    // every browser we care about, so the string is drawn character by character.
    const tracking = fontPx * 0.18
    ctx.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`
    const textWidth = [...caps].reduce((w, ch) => w + ctx.measureText(ch).width + tracking, 0)

    canvas.width = Math.ceil((textWidth + fontPx) * dpr)
    canvas.height = Math.ceil(fontPx * 2 * dpr)
    ctx.scale(dpr, dpr)
    ctx.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textBaseline = 'middle'
    // Quiet on purpose: this is ambient orientation, not a heading competing
    // with the zone labels standing on the same floor.
    ctx.fillStyle = theme === 'dark' ? 'rgba(233,238,247,0.58)' : 'rgba(24,32,48,0.45)'

    let x = fontPx / 2
    for (const ch of caps) {
      ctx.fillText(ch, x, fontPx)
      x += ctx.measureText(ch).width + tracking
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = anisotropy
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true

    const height = LABEL_HEIGHT
    const width = Math.min((canvas.width / canvas.height) * height, boundaryWidth * 0.9)
    const geo = new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2)
    this.label = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    )
    this.label.position.set(cx, LINE_Y + 0.02, nearZ - height * 0.75)
    this.label.renderOrder = 3
    this.group.add(this.label)
  }

  setTheme(theme: Theme, anisotropy: number): void {
    ;(this.outline.material as THREE.LineDashedMaterial).color.copy(this.lineColor(theme))

    // The label is baked into a texture, so its colour only changes by redrawing.
    if (this.label) {
      const { x, z } = this.label.position
      const width = (this.label.geometry as THREE.PlaneGeometry).parameters.width
      this.disposeLabel()
      this.buildLabel(x, z + LABEL_HEIGHT * 0.75, width / 0.9, theme, anisotropy)
    }
  }

  private disposeLabel(): void {
    if (!this.label) return
    this.group.remove(this.label)
    this.label.geometry.dispose()
    const mat = this.label.material as THREE.MeshBasicMaterial
    mat.map?.dispose()
    mat.dispose()
    this.label = null
  }

  dispose(): void {
    this.disposeLabel()
    this.group.remove(this.outline)
    this.outline.geometry.dispose()
    ;(this.outline.material as THREE.Material).dispose()
    this.group.parent?.remove(this.group)
  }
}
