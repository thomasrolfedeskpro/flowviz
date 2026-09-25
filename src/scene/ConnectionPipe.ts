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

/** The dashed line a connection wears when its component's relations are being
 *  shown. Drawn like the stream chevrons — flat markers threaded down the
 *  middle of the tube — rather than as anything applied to the glass itself, so
 *  it never competes with the pipe's own lit/idle colour. Its colour comes from
 *  the theme, in `pipeTrace`. */
const DASH_LEN    = 0.34
const DASH_GAP    = 0.26
/** About a quarter of the tube's width. Thin enough to read as a line down the
 *  middle rather than a fill, thick enough to survive a zoomed-out view, where
 *  a whole flow is on screen and a tube is only a few pixels across. */
const DASH_WIDTH  = 0.12

const OPACITY_IDLE       = 0.12  // nearly invisible glass at rest
const OPACITY_ACTIVE     = 0.28  // lit but still transparent
const OPACITY_TRAVERSING = 0.50  // glowing glass — still see-through

export class ConnectionPipe {
  mesh:     THREE.Mesh
  curve:    THREE.Curve<THREE.Vector3>
  id:       string
  midpoint: THREE.Vector3

  private conn:              InternalConnection
  // Assigned by applyPalette in the constructor, before anything reads them.
  private idleColor:         number = 0
  private activeColor:       number = 0
  private activeEmissive:    number = 0
  /** Author's colour, if the connection names one. It replaces the theme's
   *  three pipe colours but not the opacity ladder — a coloured pipe is still
   *  glass you can see a packet travelling inside. */
  private authored:          THREE.Color | null
  private currentActive:     boolean = false
  private packetTraversing:  boolean = false
  /** The scene this pipe lives in, so an outline can be added to it later. */
  private parent:            THREE.Object3D
  /** The dashes down the middle of the tube. Built on first use. */
  private trace:             THREE.Group | null = null
  private traced:            boolean = false
  /** Kept because the trace is built lazily, long after the theme was set. */
  private traceColor:        number = 0

  constructor(scene: THREE.Object3D, connection: InternalConnection) {
    this.parent = scene
    this.conn  = connection
    this.id    = connection.id
    this.curve = connection.curve

    this.authored = connection.color ? new THREE.Color(connection.color) : null
    this.applyPalette('light')

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

    // The dashes are positioned along the route, so a moved pipe needs them
    // laid out again rather than nudged.
    if (this.trace) {
      const wasVisible = this.trace.visible
      this.disposeTrace()
      this.trace = this.buildTrace()
      this.trace.visible = wasVisible
      this.parent.add(this.trace)
    }
  }

  /**
   * Work out the three colours this pipe uses.
   *
   * An authored colour is taken at face value for the lit states and mixed
   * halfway to the theme's resting colour for idle, so a scene of coloured
   * pipes still reads as calm until a step lights one up. The emissive is the
   * same hue darkened rather than the theme's — a red pipe should glow red.
   */
  private applyPalette(theme: Theme): void {
    const c = THEME_COLORS[theme]
    // Not affected by an authored pipe colour: the trace has to stay legible
    // against whatever hue the author chose, so it answers to the theme alone.
    this.traceColor = c.pipeTrace
    if (!this.authored) {
      this.idleColor      = c.pipeIdle
      this.activeColor    = c.pipeActive
      this.activeEmissive = c.pipeActiveEmissive
      return
    }
    this.activeColor    = this.authored.getHex()
    this.idleColor      = this.authored.clone().lerp(new THREE.Color(c.pipeIdle), 0.5).getHex()
    this.activeEmissive = this.authored.clone().multiplyScalar(0.45).getHex()
  }

  setTheme(theme: Theme): void {
    this.applyPalette(theme)

    const dash = this.trace?.children[0] as THREE.Mesh | undefined
    if (dash) (dash.material as THREE.MeshBasicMaterial).color.setHex(this.traceColor)

    const mat = this.mesh.material as THREE.MeshStandardMaterial
    mat.color.setHex(this.packetTraversing || this.currentActive ? this.activeColor : this.idleColor)
    mat.emissive.setHex(this.packetTraversing ? this.activeEmissive : 0x000000)
    mat.opacity = this.packetTraversing ? OPACITY_TRAVERSING
                : this.currentActive    ? OPACITY_ACTIVE
                :                         OPACITY_IDLE
  }

  /** Hide the tube itself. Packets and chevrons are separate meshes, so they
   *  keep running the route with the glass taken away. */
  setVisible(visible: boolean): void {
    this.mesh.visible = visible
    if (this.trace) this.trace.visible = visible && this.traced
  }

  /**
   * Dashes threaded down the middle of the tube.
   *
   * Flat markers laid in the ground plane and turned to follow the route, which
   * is exactly how the stream chevrons are drawn — so a traced pipe reads as
   * something running through the glass rather than as the glass itself having
   * changed colour. That distinction is the whole point: the step decides what
   * the pipe's own colour says, and this has to be legible on top of it either
   * way.
   */
  private buildTrace(): THREE.Group {
    const { t0, t1 } = this.conn.renderTrim
    const curve  = new TrimmedCurve(this.conn.curve, t0, t1)
    const length = curve.getLength()
    const count  = Math.max(1, Math.round(length / (DASH_LEN + DASH_GAP)))

    // One flat dash, long side along +X, laid into the ground plane — the same
    // two steps the chevron geometry takes, so the same tangent maths orients it.
    const geo = new THREE.PlaneGeometry(DASH_LEN, DASH_WIDTH)
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
    const mat = new THREE.MeshBasicMaterial({
      color:      this.traceColor,
      side:       THREE.DoubleSide,
      depthWrite: false,
    })

    const group = new THREE.Group()
    for (let i = 0; i < count; i++) {
      const t   = (i + 0.5) / count
      const pos = curve.getPointAt(t)
      const tan = curve.getTangentAt(t)
      const dash = new THREE.Mesh(geo, mat)
      dash.position.copy(pos)
      dash.rotation.set(0, Math.atan2(-tan.z, tan.x), 0)
      // Above the tube's own glass, like a chevron in a stream.
      dash.renderOrder = 2
      group.add(dash)
    }
    return group
  }

  private disposeTrace(): void {
    if (!this.trace) return
    this.parent.remove(this.trace)
    const first = this.trace.children[0] as THREE.Mesh | undefined
    first?.geometry.dispose()
    ;(first?.material as THREE.Material | undefined)?.dispose()
    this.trace = null
  }

  /**
   * Mark this pipe as one of a component's connections.
   *
   * Deliberately independent of `setActive`: a step lighting this pipe and you
   * asking to see what a component connects to are different statements, and
   * both can be true at once.
   */
  setTraced(on: boolean): void {
    if (this.traced === on) return
    this.traced = on
    if (on && !this.trace) {
      this.trace = this.buildTrace()
      this.parent.add(this.trace)
    }
    if (this.trace) this.trace.visible = on && this.mesh.visible
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
    this.disposeTrace()
  }
}
