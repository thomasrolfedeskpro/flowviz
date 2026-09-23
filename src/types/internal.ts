import * as THREE from 'three'
import type { ComponentType, ComponentShape, PinnedLabel, Step, Connection } from './schema'

export interface InternalComponent {
  id: string
  label: string
  type: ComponentType
  shape?: ComponentShape
  logo?: string
  icon?: string
  color?: string
  center: THREE.Vector3
  meshSize: THREE.Vector3
  topCenter: THREE.Vector3
  /** Always-visible label. Mutable so the inspector's preview can reach it
   *  without a graph rebuild, like `icon` and `color`. */
  pinnedLabel?: PinnedLabel
  meta: {
    description?: string
    file?: string
    line?: number
    notes?: string
  } | undefined
}

export interface InternalConnection {
  id: string
  from: InternalComponent
  to: InternalComponent
  label?: string
  /** Author's pipe colour, if they set one. */
  color?: string
  curve: THREE.Curve<THREE.Vector3>
  tubePoints: THREE.Vector3[]
  /** t-range [t0, t1] used for the visible TubeGeometry — clipped to component edges */
  renderTrim: { t0: number; t1: number }
  /** route definition ('auto' or waypoint array) — used to rebuild geometry after a move */
  route: Connection['route']
  /** fan-out offsets applied at the shared start/end attach points */
  portOffset: { start: THREE.Vector3; end: THREE.Vector3 }
}

export interface InternalZone {
  id: string
  label: string
  color: THREE.Color
  min: THREE.Vector3
  max: THREE.Vector3
  parentId?: string
  outline: 'solid' | 'dashed'
  depth: number
  meta?: { description?: string; notes?: string }
}

export interface InternalGraph {
  components: Map<string, InternalComponent>
  connections: Map<string, InternalConnection>
  zones: InternalZone[]
  steps: Step[]
  gridBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Nested scenes, keyed by the id of the component whose `detail` they are. */
  scenes: Map<string, InternalGraph>
}
