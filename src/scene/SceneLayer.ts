import * as THREE from 'three'
import { ZoneRenderer } from '@/scene/ZoneRenderer'
import { ComponentMesh } from '@/scene/ComponentMesh'
import type { MeshState } from '@/scene/ComponentMesh'
import { ConnectionPipe } from '@/scene/ConnectionPipe'
import { DataPacket } from '@/scene/DataPacket'
import { ChevronStream } from '@/scene/ChevronStream'
import { THEME_COLORS } from '@/scene/ThemeColors'
import type { Theme } from '@/scene/ThemeColors'
import type { PacketMeshUserData } from '@/scene/meshUserData'
import type { InternalGraph } from '@/types/internal'
import type { ComponentShape, Step } from '@/types/schema'
import { CELL_SIZE, COMPONENT_GAP, COMPONENT_HEIGHT, gridToWorld } from '@/engine/layoutEngine'
import { PIPE_HEIGHT } from '@/engine/parseFlow'

const PACKET_TRAVEL_MS    = 2000
const PIPE_DIM_DELAY_MS   = 600
const PACKET_BURST_MAX    = 40    // hard cap on meshes for one repeat burst
const PACKET_BURST_WINDOW = 1400  // ms the whole burst is spread across
const WAYPOINT_HANDLE_Y   = PIPE_HEIGHT + 0.6
const LABEL_HANDLE_Y      = PIPE_HEIGHT + 0.05
const PHASE_MATERIAL_RATIO = 0.4

/** Hooks back to the owning FlowScene for things that are scene-wide, not per-layer. */
export interface SceneLayerHooks {
  addHoverTarget:    (mesh: THREE.Object3D) => void
  removeHoverTarget: (mesh: THREE.Object3D) => void
  onPacketArrival:   (componentId: string) => void
}

/**
 * One scene's worth of geometry: the components, pipes, zones, packets and edit
 * handles for a single graph, all parented to one Group so the whole layer can
 * be shown or hidden at once.
 *
 * A flow has one layer for its top-level scene plus one for every nested
 * `component.detail`, to any depth. Exactly one is active at a time; FlowScene
 * owns the camera, lighting, grid and pointer handling and drives the active
 * layer through these methods.
 */
export class SceneLayer {
  /** null for the top-level scene, otherwise the owning component's id. */
  readonly id: string | null
  readonly graph: InternalGraph
  readonly group: THREE.Group
  readonly depth: number
  /** Layers for this layer's own nested scenes, keyed by owning component id. */
  readonly children: Map<string, SceneLayer> = new Map()

  components:  Map<string, ComponentMesh> = new Map()
  pipes:       Map<string, ConnectionPipe> = new Map()
  zones:       ZoneRenderer[] = []
  zoneById:    Map<string, ZoneRenderer> = new Map()
  zoneLabelPositions: Map<string, THREE.Vector3> = new Map()
  waypointHandles: THREE.Mesh[] = []
  labelHandles:    THREE.Mesh[] = []

  activePackets:  DataPacket[] = []
  packetPipeMap:  Map<DataPacket, string> = new Map()
  arrivedPackets: Set<DataPacket> = new Set()
  penetratedIds:  Set<string> = new Set()
  activeStreams:  ChevronStream[] = []
  currentStep:    Step | null = null

  /** Camera framing that shows this layer's whole grid. */
  readonly overviewTarget: THREE.Vector3
  readonly overviewFrustum: number

  private hooks: SceneLayerHooks
  private theme: Theme
  private editMode = false

  constructor(
    parent: THREE.Object3D,
    graph: InternalGraph,
    id: string | null,
    theme: Theme,
    anisotropy: number,
    hooks: SceneLayerHooks,
    depth = 0,
  ) {
    this.id    = id
    this.graph = graph
    this.theme = theme
    this.hooks = hooks
    this.depth = depth

    this.group = new THREE.Group()
    this.group.name = `scene:${id ?? 'root'}`
    parent.add(this.group)

    this.zones = graph.zones.map(z => new ZoneRenderer(this.group, z, anisotropy))
    for (const z of this.zones) {
      this.zoneById.set(z.zone.id, z)
      // live reference, not a clone — the label moves when its zone is resized
      this.zoneLabelPositions.set(z.labelMesh.userData.zoneId as string, z.labelMesh.position)
    }

    for (const [cid, comp] of graph.components) {
      this.components.set(cid, new ComponentMesh(this.group, comp))
    }

    for (const [cid, conn] of graph.connections) {
      this.pipes.set(cid, new ConnectionPipe(this.group, conn))
    }

    this.buildWaypointHandles()
    this.buildLabelHandles()

    const { minX, maxX, minZ, maxZ } = graph.gridBounds
    const extentX = (maxX - minX) / 2 + CELL_SIZE
    const extentZ = (maxZ - minZ) / 2 + CELL_SIZE
    this.overviewTarget  = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
    this.overviewFrustum = Math.max(extentX, extentZ) * 1.2

    // Nested scenes build alongside, hidden until a step names them.
    for (const [childId, childGraph] of graph.scenes) {
      const child = new SceneLayer(parent, childGraph, childId, theme, anisotropy, hooks, depth + 1)
      child.setVisible(false)
      this.children.set(childId, child)
    }
  }

  /** Every layer in this subtree, including itself, shallowest first. */
  flatten(): SceneLayer[] {
    return [this as SceneLayer, ...[...this.children.values()].flatMap(c => c.flatten())]
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  get visible(): boolean {
    return this.group.visible
  }

  /** Meshes the shared HoverSystem should be watching while this layer is active. */
  hoverTargets(): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const cm of this.components.values()) out.push(cm.hitMesh)
    for (const z of this.zones) out.push(z.labelMesh)
    for (const p of this.activePackets) out.push(p.mesh)
    return out
  }

  setTheme(theme: Theme): void {
    this.theme = theme
    for (const pipe of this.pipes.values()) pipe.setTheme(theme)
    for (const packet of this.activePackets) packet.setTheme(theme)
  }

  setEditMode(enabled: boolean): void {
    this.editMode = enabled
    for (const z of this.zones) z.setHandlesVisible(enabled)
    for (const h of this.waypointHandles) h.visible = enabled
    for (const h of this.labelHandles) h.visible = enabled
    if (enabled) this.syncLabelHandles()
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  /** Drop packets, streams and penetration state — used on step change and when
   *  the layer is left for another scene. */
  clearStepState(phaseMaterial = 0): void {
    for (const [, pipeId] of this.packetPipeMap) {
      this.pipes.get(pipeId)?.setPacketTraversing(false, phaseMaterial)
    }
    for (const packet of this.activePackets) {
      this.hooks.removeHoverTarget(packet.mesh)
      packet.dispose(this.group)
    }
    this.activePackets  = []
    this.packetPipeMap  = new Map()
    this.arrivedPackets = new Set()
    for (const id of this.penetratedIds) this.components.get(id)?.setPenetrated(false)
    this.penetratedIds.clear()
    for (const s of this.activeStreams) s.dispose()
    this.activeStreams = []
  }

  applyStep(step: Step, durationMs: number): void {
    this.currentStep = step
    const phaseMaterial = durationMs * PHASE_MATERIAL_RATIO

    this.clearStepState(phaseMaterial)

    // Component materials
    for (const [id, mesh] of this.components) {
      const state: MeshState = step.highlight.includes(id)
        ? 'highlighted'
        : step.highlight.length > 0
          ? 'dimmed'
          : 'idle'
      mesh.transitionTo(state, phaseMaterial)
    }

    // Pipe materials (active_connections → medium brightness)
    for (const [id, pipe] of this.pipes) {
      pipe.setActive(step.active_connections.includes(id), phaseMaterial)
    }

    // Packets — each pipe flares to full brightness while one is on it
    const packetDefs = [
      ...(step.packet  ? [step.packet] : []),
      ...(step.packets ?? []),
    ]
    let packetIndex = 0
    for (const def of packetDefs) {
      const pipe = this.pipes.get(def.connection)
      if (!pipe) continue
      const conn = this.graph.connections.get(def.connection)

      // count > 1 repeats the same packet, staggered across a fixed window so a
      // burst of 3 and a burst of 30 both finish in about the same time.
      const requested = Math.max(1, Math.floor(def.count ?? 1))
      const burst     = Math.min(requested, PACKET_BURST_MAX)
      const stagger   = burst > 1 ? PACKET_BURST_WINDOW / (burst - 1) : 0

      for (let n = 0; n < burst; n++) {
        const packet = new DataPacket(this.group, def.shape, this.theme)
        const ud: PacketMeshUserData = {
          componentId: `__packet__${packetIndex++}`,
          packetLabel: conn?.label ?? def.connection,
          packetShape: def.shape,
          packetData:  def.data,
          packetCount: requested > 1 ? requested : undefined,
        }
        Object.assign(packet.mesh.userData, ud)
        if (def.arrivalStyle) packet.setArrivalStyle(def.arrivalStyle)
        this.hooks.addHoverTarget(packet.mesh)
        this.activePackets.push(packet)
        this.packetPipeMap.set(packet, def.connection)
        packet.travel(pipe.curve, PACKET_TRAVEL_MS, def.direction === 'reverse', n * stagger)
      }
      pipe.setPacketTraversing(true, 200)
    }

    // Chevron streams
    const streamDefs = [
      ...(step.stream  ? [step.stream] : []),
      ...(step.streams ?? []),
    ]
    for (const def of streamDefs) {
      const pipe = this.pipes.get(def.connection)
      if (!pipe) continue
      const color = def.color
        ? new THREE.Color(def.color).getHex()
        : THEME_COLORS[this.theme].packetColor
      this.activeStreams.push(new ChevronStream(this.group, pipe, color))
    }
  }

  /** How long until every packet in flight has landed. 0 when the scene is still. */
  remainingAnimationMs(now: number): number {
    let max = 0
    for (const p of this.activePackets) max = Math.max(max, p.remainingMs(now))
    return max
  }

  /** Per-frame work for the active layer. */
  update(now: number): void {
    if (this.editMode) this.syncLabelHandles()

    for (const s of this.activeStreams) s.update(now)

    for (const packet of this.activePackets) {
      packet.update(now)

      // Dim the pipe once this packet lands, but only if no other traveling
      // packet is still using the same connection.
      if (packet.arrived && !this.arrivedPackets.has(packet)) {
        this.arrivedPackets.add(packet)
        const pipeId = this.packetPipeMap.get(packet)
        if (pipeId) {
          const stillTraveling = this.activePackets.some(
            p => !p.arrived && this.packetPipeMap.get(p) === pipeId
          )
          if (!stillTraveling) this.pipes.get(pipeId)?.setPacketTraversing(false, PIPE_DIM_DELAY_MS)

          const conn   = this.graph.connections.get(pipeId)
          const destId = packet.reversed ? conn?.from.id : conn?.to.id
          if (destId) this.hooks.onPacketArrival(destId)
        }
      }
    }

    this.updatePenetration()
  }

  private updatePenetration(): void {
    if (this.activePackets.length === 0) {
      if (this.penetratedIds.size > 0) {
        for (const id of this.penetratedIds) this.components.get(id)?.setPenetrated(false)
        this.penetratedIds.clear()
      }
      return
    }

    // Union penetration test across all active packets
    const next = new Set<string>()
    for (const packet of this.activePackets) {
      if (!packet.mesh.visible) continue   // queued in a burst, not travelling yet
      const p = packet.mesh.position
      for (const [id] of this.components) {
        const ic = this.graph.components.get(id)
        if (!ic) continue
        const hx = ic.meshSize.x / 2
        const hz = ic.meshSize.z / 2
        if (
          p.x >= ic.center.x - hx && p.x <= ic.center.x + hx &&
          p.z >= ic.center.z - hz && p.z <= ic.center.z + hz
        ) {
          next.add(id)
        }
      }
    }

    for (const id of next) {
      if (!this.penetratedIds.has(id)) this.components.get(id)?.setPenetrated(true)
    }
    for (const id of this.penetratedIds) {
      if (!next.has(id)) this.components.get(id)?.setPenetrated(false)
    }
    this.penetratedIds = next
  }

  // ── Edit-mode geometry ────────────────────────────────────────────────────

  /** One handle per waypoint on every manually routed connection. */
  buildWaypointHandles(): void {
    for (const h of this.waypointHandles) this.disposeMesh(h)
    this.waypointHandles = []

    for (const [connId, conn] of this.graph.connections) {
      if (conn.route === 'auto') continue
      conn.route.forEach((wp, waypointIndex) => {
        const mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.62),
          new THREE.MeshBasicMaterial({ color: 0x00a389, depthTest: false }),
        )
        mesh.userData = { connId, waypointIndex }
        mesh.visible = this.editMode
        mesh.renderOrder = 12
        mesh.position.copy(gridToWorld(wp.col, wp.row).setY(WAYPOINT_HANDLE_Y))
        this.group.add(mesh)
        this.waypointHandles.push(mesh)
      })
    }
  }

  /** A flat pad under each pipe's label chip. The chip itself is an HTML overlay
   *  with pointer-events off — anything clickable up there would sit on top of
   *  the canvas and swallow presses meant for the scene. */
  buildLabelHandles(): void {
    for (const h of this.labelHandles) this.disposeMesh(h)
    this.labelHandles = []

    for (const [connId, conn] of this.graph.connections) {
      if (!conn.label) continue
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.12, 0.7),
        new THREE.MeshBasicMaterial({ color: 0x8892a0, transparent: true, opacity: 0.35, depthTest: false }),
      )
      mesh.userData = { connId }
      mesh.visible = this.editMode
      mesh.renderOrder = 12
      this.group.add(mesh)
      this.labelHandles.push(mesh)
    }
    this.syncLabelHandles()
  }

  /** Keep each pad under its label chip as pipes move. */
  syncLabelHandles(): void {
    for (const h of this.labelHandles) {
      const pipe = this.pipes.get(h.userData.connId as string)
      if (pipe) h.position.copy(pipe.midpoint).setY(LABEL_HANDLE_Y)
    }
  }

  /** Rebuild one component's mesh after a config change; the caller re-registers
   *  hover targets via the hooks. */
  rebuildComponent(
    id: string,
    patch: { size?: { w: number; h: number }; icon?: string; color?: string; shape?: ComponentShape },
  ): void {
    const ic  = this.graph.components.get(id)
    const old = this.components.get(id)
    if (!ic || !old) return

    if (patch.size) {
      ic.meshSize.set(
        patch.size.w * CELL_SIZE * COMPONENT_GAP,
        COMPONENT_HEIGHT[ic.type],
        patch.size.h * CELL_SIZE * COMPONENT_GAP,
      )
      ic.topCenter.set(ic.center.x, ic.meshSize.y, ic.center.z)
    }
    // Empty string clears the override and falls back to the type default.
    if (patch.icon  !== undefined) ic.icon  = patch.icon  || undefined
    if (patch.color !== undefined) ic.color = patch.color || undefined
    if (patch.shape !== undefined) ic.shape = patch.shape

    this.hooks.removeHoverTarget(old.hitMesh)
    old.dispose(this.group)
    const rebuilt = new ComponentMesh(this.group, ic)
    this.components.set(id, rebuilt)
    this.hooks.addHoverTarget(rebuilt.hitMesh)

    // A fresh mesh starts idle — put it back into the current step's state.
    const step = this.currentStep
    if (step) {
      const state: MeshState = step.highlight.includes(id)
        ? 'highlighted'
        : step.highlight.length > 0 ? 'dimmed' : 'idle'
      rebuilt.transitionTo(state, 0)
    }

    for (const [connId, conn] of this.graph.connections) {
      if (conn.from.id === id || conn.to.id === id) this.pipes.get(connId)?.update()
    }
  }

  private disposeMesh(m: THREE.Mesh): void {
    this.group.remove(m)
    m.geometry.dispose()
    ;(m.material as THREE.Material).dispose()
  }

  dispose(): void {
    for (const child of this.children.values()) child.dispose()
    this.children.clear()

    for (const z of this.zones) z.dispose(this.group)
    for (const cm of this.components.values()) cm.dispose(this.group)
    for (const pipe of this.pipes.values()) pipe.dispose(this.group)
    for (const packet of this.activePackets) {
      this.hooks.removeHoverTarget(packet.mesh)
      packet.dispose(this.group)
    }
    this.activePackets = []
    for (const s of this.activeStreams) s.dispose()
    this.activeStreams = []
    for (const h of [...this.waypointHandles, ...this.labelHandles]) this.disposeMesh(h)
    this.waypointHandles = []
    this.labelHandles = []
    this.penetratedIds.clear()
    this.group.parent?.remove(this.group)
  }
}
