import * as THREE from 'three'
import { Tween, Easing } from '@tweenjs/tween.js'
import { tweenGroup } from '@/scene/tweenGroup'
import type { InternalConnection } from '@/types/internal'
import { buildConnectionGeometry } from '@/engine/parseFlow'
import { THEME_COLORS } from '@/scene/ThemeColors'
import type { Theme } from '@/scene/ThemeColors'

const TUBE_SEGMENTS    = 64
const TUBE_RADIUS      = 0.22
const TUBE_RADIUS_SEGS = 12

/** Wraps a curve and exposes only the [t0, t1] sub-range as [0, 1]. */
class TrimmedCurve extends THREE.Curve<THREE.Vector3> {
  inner: THREE.Curve<THREE.Vector3>
  t0: number
  t1: number
  constructor(inner: THREE.Curve<THREE.Vector3>, t0: number, t1: number) {
    super()
    this.inner = inner
    this.t0    = t0
    this.t1    = t1
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    return this.inner.getPoint(this.t0 + t * (this.t1 - this.t0), target)
  }
}

const OPACITY_IDLE       = 0.12  // nearly invisible glass at rest
const OPACITY_ACTIVE     = 0.28  // lit but still transparent
const OPACITY_TRAVERSING = 0.50  // glowing glass — still see-through

export class ConnectionPipe {
  mesh:     THREE.Mesh
  curve:    THREE.Curve<THREE.Vector3>
  id:       string
  midpoint: THREE.Vector3

  private conn:              InternalConnection
  private idleColor:         number
  private activeColor:       number
  private activeEmissive:    number
  private currentActive:     boolean = false
  private packetTraversing:  boolean = false

  constructor(scene: THREE.Object3D, connection: InternalConnection) {
    this.conn  = connection
    this.id    = connection.id
    this.curve = connection.curve

    const c = THEME_COLORS['light']
    this.idleColor      = c.pipeIdle
    this.activeColor    = c.pipeActive
    this.activeEmissive = c.pipeActiveEmissive

    const { t0, t1 } = connection.renderTrim
    const renderCurve = new TrimmedCurve(connection.curve, t0, t1)
    const geo = new THREE.TubeGeometry(
      renderCurve,
      TUBE_SEGMENTS,
      TUBE_RADIUS,
      TUBE_RADIUS_SEGS,
      false
    )
    const mat = new THREE.MeshStandardMaterial({
      color:       this.idleColor,
      transparent: true,
      opacity:     OPACITY_IDLE,
      roughness:   0,              // smooth glass surface
      metalness:   0,
      side:        THREE.DoubleSide,  // renders inner + outer wall → hollow cylinder illusion
      depthWrite:  false,          // prevents z-sort artifacts between overlapping tubes
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.castShadow    = false
    this.mesh.receiveShadow = false
    scene.add(this.mesh)

    this.midpoint = connection.curve.getPointAt(0.5)
  }

  /** Rebuild tube geometry after either endpoint component has moved. Reads the
   *  current from/to centers via the stored connection. */
  update(): void {
    const { curve, tubePoints, renderTrim } =
      buildConnectionGeometry(this.conn.route, this.conn.from, this.conn.to, this.conn.portOffset)
    // write back so packet travel (which uses conn.curve) stays correct
    this.conn.curve      = curve
    this.conn.tubePoints = tubePoints
    this.conn.renderTrim = renderTrim
    this.curve = curve
    // Mutate in place — overlays (PipeLabels) hold this Vector3 by reference.
    this.midpoint.copy(curve.getPointAt(0.5))
    const { t0, t1 } = renderTrim
    const renderCurve = new TrimmedCurve(curve, t0, t1)
    const oldGeo = this.mesh.geometry
    this.mesh.geometry = new THREE.TubeGeometry(renderCurve, TUBE_SEGMENTS, TUBE_RADIUS, TUBE_RADIUS_SEGS, false)
    oldGeo.dispose()
  }

  setTheme(theme: Theme): void {
    const c = THEME_COLORS[theme]
    this.idleColor      = c.pipeIdle
    this.activeColor    = c.pipeActive
    this.activeEmissive = c.pipeActiveEmissive

    const mat = this.mesh.material as THREE.MeshStandardMaterial
    mat.color.setHex(this.packetTraversing || this.currentActive ? this.activeColor : this.idleColor)
    mat.emissive.setHex(this.packetTraversing ? this.activeEmissive : 0x000000)
    mat.opacity = this.packetTraversing ? OPACITY_TRAVERSING
                : this.currentActive    ? OPACITY_ACTIVE
                :                         OPACITY_IDLE
  }

  setActive(active: boolean, durationMs: number): Promise<void> {
    this.currentActive = active
    return this.tweenTo(durationMs)
  }

  setPacketTraversing(traversing: boolean, durationMs: number): void {
    this.packetTraversing = traversing
    this.tweenTo(durationMs)
  }

  private tweenTo(durationMs: number): Promise<void> {
    const mat = this.mesh.material as THREE.MeshStandardMaterial

    const targetOpacity  = this.packetTraversing ? OPACITY_TRAVERSING
                         : this.currentActive    ? OPACITY_ACTIVE
                         :                         OPACITY_IDLE
    const targetColor    = new THREE.Color(
      this.packetTraversing || this.currentActive ? this.activeColor : this.idleColor
    )
    const targetEmissive = new THREE.Color(
      this.packetTraversing ? this.activeEmissive : 0x000000
    )

    return new Promise(resolve => {
      new Tween({
        r:       mat.color.r,
        g:       mat.color.g,
        b:       mat.color.b,
        opacity: mat.opacity,
        er:      mat.emissive.r,
        eg:      mat.emissive.g,
        eb:      mat.emissive.b,
      }, tweenGroup)
        .to({
          r:       targetColor.r,
          g:       targetColor.g,
          b:       targetColor.b,
          opacity: targetOpacity,
          er:      targetEmissive.r,
          eg:      targetEmissive.g,
          eb:      targetEmissive.b,
        }, durationMs)
        .easing(Easing.Quadratic.InOut)
        .onUpdate(({ r, g, b, opacity, er, eg, eb }) => {
          mat.color.setRGB(r, g, b)
          mat.opacity      = opacity
          mat.transparent  = opacity < 1.0
          mat.emissive.setRGB(er, eg, eb)
        })
        .onComplete(() => resolve())
        .start()
    })
  }

  dispose(scene: THREE.Object3D): void {
    scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
