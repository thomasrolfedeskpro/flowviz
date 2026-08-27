import * as THREE from 'three'
import type { InternalGraph, InternalZone } from '@/types/internal'
import type { ZoneLabelMeshUserData } from '@/scene/meshUserData'
import { CELL_SIZE } from '@/engine/layoutEngine'

/** Corner ids: 'n' = min z edge, 'w' = min x edge. */
export type ZoneCorner = 'nw' | 'ne' | 'sw' | 'se'

export const ZONE_CORNERS: ZoneCorner[] = ['nw', 'ne', 'sw', 'se']

const HANDLE_SIZE = 0.55
const HANDLE_Y    = 0.2
const GRIP_LENGTH = 2.2   // move-grip bar, sits just outside the zone's north edge
const GRIP_OFFSET = 0.7

/**
 * Move one corner of a zone to (x, z). If the corner is dragged past its
 * opposite edge the bounds are swapped back into min < max order, and the id of
 * the corner the pointer is now holding is returned so the drag can continue.
 */
export function applyZoneCorner(
  zone: InternalZone,
  corner: ZoneCorner,
  x: number,
  z: number,
): ZoneCorner {
  let west  = corner === 'nw' || corner === 'sw'
  let north = corner === 'nw' || corner === 'ne'

  if (west) zone.min.x = x
  else zone.max.x = x
  if (north) zone.min.z = z
  else zone.max.z = z

  if (zone.min.x > zone.max.x) {
    const t = zone.min.x
    zone.min.x = zone.max.x
    zone.max.x = t
    west = !west
  }
  if (zone.min.z > zone.max.z) {
    const t = zone.min.z
    zone.min.z = zone.max.z
    zone.max.z = t
    north = !north
  }

  return `${north ? 'n' : 's'}${west ? 'w' : 'e'}` as ZoneCorner
}

/** Snap zone bounds to whole grid cells, keeping the zone at least one cell wide/deep. */
export function snapZoneToGrid(zone: InternalZone): void {
  // Clamped at 0: the grid starts at the origin and component positions are
  // non-negative cells, so a zone reaching past it could never be dropped into.
  const snap = (v: number) => Math.max(0, Math.round(v / CELL_SIZE) * CELL_SIZE)
  zone.min.x = snap(zone.min.x)
  zone.min.z = snap(zone.min.z)
  zone.max.x = Math.max(snap(zone.max.x), zone.min.x + CELL_SIZE)
  zone.max.z = Math.max(snap(zone.max.z), zone.min.z + CELL_SIZE)
}

/** Ids of every component whose centre sits inside the zone's XZ bounds. */
export function componentsInZone(graph: InternalGraph, zone: InternalZone): string[] {
  const ids: string[] = []
  for (const [id, c] of graph.components) {
    if (
      c.center.x >= zone.min.x && c.center.x <= zone.max.x &&
      c.center.z >= zone.min.z && c.center.z <= zone.max.z
    ) ids.push(id)
  }
  return ids
}

/** Round a drag delta to whole cells, so a moved zone stays grid-aligned. */
export function snapDelta(delta: number): number {
  return Math.round(delta / CELL_SIZE) * CELL_SIZE
}

export class ZoneRenderer {
  zone: InternalZone
  labelMesh!: THREE.Mesh   // public: registered with HoverSystem by FlowScene
  handles: THREE.Mesh[] = []  // public: raycast by FlowScene — 4 corners + 1 move grip

  private scene:      THREE.Object3D
  private anisotropy: number
  private fillMesh!:   THREE.Mesh
  private borderMesh!: THREE.LineSegments

  /** `anisotropy` should be the renderer's max — the label lies flat on the
   *  ground and is viewed at ~35°, where isotropic filtering blurs the text. */
  constructor(scene: THREE.Object3D, zone: InternalZone, anisotropy: number = 1) {
    this.scene      = scene
    this.zone       = zone
    this.anisotropy = anisotropy

    this.buildSurfaces()

    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    this.labelMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
    this.labelMesh.userData = { zoneId: zone.id } satisfies ZoneLabelMeshUserData
    // Zone labels sit low over the ground alongside other depthWrite:false,
    // transparent surfaces (glass pipes, zone fills, dimmed components). Those
    // all share one draw bucket sorted by approximate camera distance, so a
    // translucent surface can occasionally paint after the label and wash out
    // its "pure white" text with whatever color is underneath. A high
    // renderOrder forces the label to always draw last — i.e. on top — so its
    // text stays fully opaque white.
    this.labelMesh.renderOrder = 10
    scene.add(this.labelMesh)
    this.paintLabel()

    this.buildHandles()
  }

  /** Regenerate fill, border, label placement and handles after the bounds change. */
  rebuild(): void {
    this.disposeSurfaces()
    this.buildSurfaces()
    this.positionLabel()
    this.positionHandles()
  }

  setLabel(text: string): void {
    this.zone.label = text
    this.paintLabel()
  }

  setHandlesVisible(visible: boolean): void {
    for (const h of this.handles) h.visible = visible
  }

  private buildSurfaces(): void {
    const zone  = this.zone
    const width = zone.max.x - zone.min.x
    const depth = zone.max.z - zone.min.z

    const geometry = new THREE.PlaneGeometry(width, depth)
    geometry.rotateX(-Math.PI / 2)

    // Child zones float slightly above parents so they don't z-fight
    const fillY       = -0.08 + zone.depth * 0.04
    const fillOpacity = 0.12  + zone.depth * 0.04
    const centerX     = (zone.min.x + zone.max.x) / 2
    const centerZ     = (zone.min.z + zone.max.z) / 2

    const fill = new THREE.MeshStandardMaterial({
      color:       zone.color,
      transparent: true,
      opacity:     fillOpacity,
      depthWrite:  false,
    })
    this.fillMesh = new THREE.Mesh(geometry, fill)
    this.fillMesh.position.set(centerX, fillY, centerZ)
    this.fillMesh.receiveShadow = true
    this.scene.add(this.fillMesh)

    // Border — solid or dashed
    const edges         = new THREE.EdgesGeometry(geometry)
    const borderOpacity = 0.6 + zone.depth * 0.1

    if (zone.outline === 'dashed') {
      const mat = new THREE.LineDashedMaterial({
        color:       zone.color,
        opacity:     borderOpacity,
        transparent: true,
        dashSize:    0.8,
        gapSize:     0.4,
      })
      this.borderMesh = new THREE.LineSegments(edges, mat)
      this.borderMesh.computeLineDistances()
    } else {
      this.borderMesh = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color:       zone.color,
          opacity:     borderOpacity,
          transparent: true,
        }),
      )
    }
    this.borderMesh.position.set(centerX, fillY + 0.01, centerZ)
    this.scene.add(this.borderMesh)
  }

  private buildHandles(): void {
    for (const corner of ZONE_CORNERS) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(HANDLE_SIZE, HANDLE_SIZE, HANDLE_SIZE),
        new THREE.MeshBasicMaterial({ color: 0x4488ff }),
      )
      mesh.userData = { zoneId: this.zone.id, zoneCorner: corner }
      mesh.visible  = false   // edit mode only
      mesh.renderOrder = 11
      this.scene.add(mesh)
      this.handles.push(mesh)
    }

    // Move grip — a flat amber bar centred on the zone's north edge, drags the
    // whole zone (and everything inside it) at once.
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(GRIP_LENGTH, HANDLE_SIZE * 0.6, HANDLE_SIZE),
      new THREE.MeshBasicMaterial({ color: 0xffa726 }),
    )
    grip.userData = { zoneId: this.zone.id, zoneMove: true }
    grip.visible  = false
    grip.renderOrder = 11
    this.scene.add(grip)
    this.handles.push(grip)

    this.positionHandles()
  }

  private positionHandles(): void {
    for (const h of this.handles) {
      if (h.userData.zoneMove) {
        h.position.set((this.zone.min.x + this.zone.max.x) / 2, HANDLE_Y, this.zone.min.z - GRIP_OFFSET)
        continue
      }
      const corner = h.userData.zoneCorner as ZoneCorner
      h.position.set(
        corner === 'nw' || corner === 'sw' ? this.zone.min.x : this.zone.max.x,
        HANDLE_Y,
        corner === 'nw' || corner === 'ne' ? this.zone.min.z : this.zone.max.z,
      )
    }
  }

  /** Redraw the label texture (after a rename) and resize its plane to match. */
  private paintLabel(): void {
    const DPR    = 4   // supersample the chip so the text stays crisp when zoomed in
    const fontPx = 22 * DPR
    const padX   = 14 * DPR
    const padY   = 8  * DPR
    const font      = `400 ${fontPx}px system-ui, -apple-system, sans-serif`
    const labelText = this.zone.label.toUpperCase()

    // Measure on a throwaway canvas so the real canvas is sized before its
    // context is obtained — setting canvas.width/height resets context state,
    // which can leave drawing properties in an indeterminate state when ctx
    // was obtained on an unsized canvas.
    const tmp    = document.createElement('canvas')
    const tmpCtx = tmp.getContext('2d')!
    tmpCtx.font  = font
    const textW  = tmpCtx.measureText(labelText).width

    const canvas  = document.createElement('canvas')
    canvas.width  = Math.ceil(textW) + padX * 2
    canvas.height = fontPx + padY * 2
    const ctx     = canvas.getContext('2d')!

    // Background chip — always off-black, so white text keeps its contrast
    // regardless of the zone's own color.
    ctx.fillStyle   = '#14161a'
    ctx.globalAlpha = 0.92
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // White label text
    ctx.globalAlpha  = 1
    ctx.font         = font
    ctx.fillStyle    = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.shadowColor  = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur   = 4 * DPR
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 1 * DPR
    ctx.fillText(labelText, padX, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = this.anisotropy
    texture.minFilter  = THREE.LinearMipmapLinearFilter
    texture.magFilter  = THREE.LinearFilter
    texture.generateMipmaps = true

    const mat = this.labelMesh.material as THREE.MeshBasicMaterial
    mat.map?.dispose()
    mat.map = texture
    mat.needsUpdate = true

    const labelH = 0.75
    const labelW = (canvas.width / canvas.height) * labelH
    const geo = new THREE.PlaneGeometry(labelW, labelH)
    geo.rotateX(-Math.PI / 2)   // lies flat on the ground plane
    this.labelMesh.geometry.dispose()
    this.labelMesh.geometry = geo

    this.positionLabel()
  }

  /** Sits just outside the zone's near corner, on the ground. */
  private positionLabel(): void {
    const params = (this.labelMesh.geometry as THREE.PlaneGeometry).parameters
    const labelW = params?.width  ?? 0
    const labelH = params?.height ?? 0
    this.labelMesh.position.set(
      this.zone.min.x + labelW / 2 + 0.05,
      0.02,
      this.zone.min.z - labelH / 2,
    )
  }

  private disposeSurfaces(): void {
    this.scene.remove(this.fillMesh)
    this.scene.remove(this.borderMesh)
    this.fillMesh.geometry.dispose()
    ;(this.fillMesh.material as THREE.Material).dispose()
    this.borderMesh.geometry.dispose()
    ;(this.borderMesh.material as THREE.Material).dispose()
  }

  dispose(scene: THREE.Object3D): void {
    this.disposeSurfaces()
    scene.remove(this.labelMesh)
    this.labelMesh.geometry.dispose()
    ;(this.labelMesh.material as THREE.MeshBasicMaterial).map?.dispose()
    ;(this.labelMesh.material as THREE.Material).dispose()
    for (const h of this.handles) {
      scene.remove(h)
      h.geometry.dispose()
      ;(h.material as THREE.Material).dispose()
    }
    this.handles = []
  }
}
