import * as THREE from 'three'

const COUNT = 6

// Chevron ">" band shape, pointing in +X direction in local XZ space.
// Two arms of constant thickness meeting at a tip — no filled interior.
const W    = 0.20   // half-span (fits inside tube radius 0.22)
const BACK = 0.14   // how far behind center the tail sits
const TIP  = 0.22   // how far ahead of center the tip sits
const T    = 0.055  // arm band thickness

function buildChevronGeo(): THREE.BufferGeometry {
  // The arm half-angle determines how much to recess the inner tip
  // so arm width stays constant at T all the way to the point.
  const halfAngle = Math.atan2(W, TIP + BACK)
  const tipRecess = T / Math.sin(halfAngle)

  // Shape defined in XY plane (+X forward, +Y lateral).
  // Rotated to XZ plane below so it lies flat on the ground.
  const shape = new THREE.Shape()
  shape.moveTo(-BACK,            W)   // outer top tail
  shape.lineTo( TIP,             0)   // outer tip
  shape.lineTo(-BACK,           -W)   // outer bottom tail
  shape.lineTo(-BACK,      -W + T)    // inner bottom tail
  shape.lineTo( TIP - tipRecess, 0)   // inner tip (recessed for constant arm width)
  shape.lineTo(-BACK,       W - T)    // inner top tail
  shape.closePath()

  const geo = new THREE.ShapeGeometry(shape)
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
  return geo
}

export class ChevronStream {
  private meshes: THREE.Mesh[]
  private geo:    THREE.BufferGeometry
  private mat:    THREE.MeshBasicMaterial
  private scene:  THREE.Object3D
  /** The pipe itself, not its curve: a drag rebuilds the pipe with a *new*
   *  curve object, and chevrons must follow it rather than the stale one. */
  private source: { curve: THREE.Curve<THREE.Vector3> }
  /** One full lap, in ms — the flow's stream timing, already divided by the
   *  playback speed. Settable because both can change mid-step. */
  private period: number

  constructor(
    scene: THREE.Object3D,
    source: { curve: THREE.Curve<THREE.Vector3> },
    color: number,
    periodMs: number,
  ) {
    this.scene  = scene
    this.source = source
    this.period = Math.max(1, periodMs)

    this.geo = buildChevronGeo()
    this.mat = new THREE.MeshBasicMaterial({
      color,
      side:       THREE.DoubleSide,
      depthWrite: false,
    })

    this.meshes = Array.from({ length: COUNT }, () => {
      const m = new THREE.Mesh(this.geo, this.mat)
      m.renderOrder = 2
      scene.add(m)
      return m
    })
  }

  /** Speed and timing can both change mid-step, so the loop length is settable
   *  rather than fixed at construction — otherwise a running stream keeps its
   *  old pace. */
  setPeriod(periodMs: number): void {
    this.period = Math.max(1, periodMs)
  }

  update(now: number): void {
    const phase = (now % this.period) / this.period
    const curve = this.source.curve

    for (let i = 0; i < COUNT; i++) {
      const t   = (phase + i / COUNT) % 1
      const pos = curve.getPointAt(t)
      const tan = curve.getTangentAt(t)

      // Project tangent onto horizontal plane and rotate around Y axis
      // so the chevron arrow points in the direction of travel (flat in XZ plane)
      const angle = Math.atan2(-tan.z, tan.x)

      const mesh = this.meshes[i]
      mesh.position.copy(pos)
      mesh.rotation.set(0, angle, 0)
    }
  }

  dispose(): void {
    for (const m of this.meshes) this.scene.remove(m)
    this.geo.dispose()
    this.mat.dispose()
  }
}
