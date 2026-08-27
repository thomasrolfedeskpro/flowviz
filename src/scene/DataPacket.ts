import * as THREE from 'three'
import { Tween, Easing } from '@tweenjs/tween.js'
import { tweenGroup } from '@/scene/tweenGroup'
import type { PacketShape, ArrivalStyle } from '@/types/schema'
import { buildPacketGeometry } from '@/scene/shapeRegistry'
import { THEME_COLORS } from '@/scene/ThemeColors'
import type { Theme } from '@/scene/ThemeColors'

// Sphere fills the tube interior — matches TUBE_RADIUS in ConnectionPipe.ts.
const TRAVEL_SPHERE_RADIUS = 0.22

const ARRIVAL_COLORS: Record<ArrivalStyle, number> = {
  error:   0xff4444,
  success: 0x44ee88,
  warning: 0xffaa22,
}

export class DataPacket {
  mesh:         THREE.Mesh
  arrived:      boolean = false
  reversed:     boolean = false
  private travelGeo:    THREE.BufferGeometry
  private arrivalGeo:   THREE.BufferGeometry
  private curve:        THREE.Curve<THREE.Vector3> | null = null
  private startTime:    number = -1
  private duration:     number = 0
  private onDone:       (() => void) | null = null
  private arrivalColor: number | null = null

  constructor(scene: THREE.Object3D, shape: PacketShape, theme: Theme = 'dark') {
    const color = THEME_COLORS[theme].packetColor
    this.travelGeo  = new THREE.SphereGeometry(TRAVEL_SPHERE_RADIUS, 16, 12)
    this.arrivalGeo = buildPacketGeometry(shape)

    this.mesh = new THREE.Mesh(
      this.travelGeo,
      new THREE.MeshStandardMaterial({
        color,
        emissive:          new THREE.Color(color),
        emissiveIntensity: 2.5,  // bright enough to glow visibly through tube walls
        metalness:         0.1,
        roughness:         0.05,
        depthWrite:        true,  // packet always writes to depth buffer
      })
    )
    // Render packets before component meshes (renderOrder 0 < 1) so that when a
    // component goes semi-transparent (renderOrder 1, depthWrite false) the packet
    // is already in the depth buffer and won't be culled.
    this.mesh.renderOrder = 0
    scene.add(this.mesh)
  }

  setArrivalStyle(style: ArrivalStyle): void {
    this.arrivalColor = ARRIVAL_COLORS[style]
  }

  setTheme(theme: Theme): void {
    if (this.arrived && this.arrivalColor !== null) return
    const color = THEME_COLORS[theme].packetColor
    const mat   = this.mesh.material as THREE.MeshStandardMaterial
    mat.color.setHex(color)
    mat.emissive.setHex(color)
  }

  /** `delayMs` holds the packet hidden at the source before it sets off, so a
   *  burst of repeats leaves in sequence rather than all at once. */
  travel(curve: THREE.Curve<THREE.Vector3>, durationMs: number, reversed = false, delayMs = 0): Promise<void> {
    this.curve     = curve
    this.duration  = durationMs
    this.reversed  = reversed
    this.startTime = performance.now() + delayMs
    this.arrived   = false
    this.mesh.visible = delayMs <= 0

    // Ensure we're using the travel sphere while in the tube
    this.mesh.geometry = this.travelGeo
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = 2.5

    this.mesh.position.copy(curve.getPointAt(reversed ? 1 : 0))
    return new Promise(resolve => { this.onDone = resolve })
  }

  /** Milliseconds left before this packet lands — 0 once it has, including the
   *  wait a staggered burst member still has ahead of it. */
  remainingMs(now: number): number {
    if (this.arrived || this.startTime < 0) return 0
    return Math.max(0, this.startTime + this.duration - now)
  }

  update(now: number): void {
    if (!this.curve || this.startTime < 0 || this.arrived) return
    if (now < this.startTime) return   // still waiting its turn in a burst
    this.mesh.visible = true

    const elapsed = now - this.startTime
    const raw     = Math.min(elapsed / this.duration, 1)
    const eased   = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw
    const t       = this.reversed ? 1 - eased : eased

    const pos = this.curve.getPointAt(t)
    this.mesh.position.copy(pos)

    // Align sphere to curve tangent so it doesn't visibly rotate
    const tangent = this.curve.getTangentAt(t)
    if (tangent.lengthSq() > 0) {
      const dir = this.reversed ? tangent.negate() : tangent
      this.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.normalize()
      )
    }

    if (raw >= 1) {
      this.arrived = true

      // Swap to the original shape now that the packet has exited the tube
      this.mesh.geometry = this.arrivalGeo
      // Sit upright at the destination (path tangent orientation no longer makes sense)
      this.mesh.quaternion.identity()
      // Slightly lower glow intensity at rest so the shape reads clearly
      const mat = this.mesh.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 1.5

      if (this.arrivalColor !== null) {
        const target = new THREE.Color(this.arrivalColor)
        new Tween({ r: mat.color.r, g: mat.color.g, b: mat.color.b }, tweenGroup)
          .to({ r: target.r, g: target.g, b: target.b }, 400)
          .easing(Easing.Quadratic.Out)
          .onUpdate(({ r, g, b }) => {
            mat.color.setRGB(r, g, b)
            mat.emissive.setRGB(r * 0.6, g * 0.6, b * 0.6)
          })
          .start()
      }
      this.onDone?.()
    }
  }

  dispose(scene: THREE.Object3D): void {
    scene.remove(this.mesh)
    this.travelGeo.dispose()
    this.arrivalGeo.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
