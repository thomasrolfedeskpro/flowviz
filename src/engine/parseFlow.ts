import * as THREE from 'three'
import type { FlowDefinition, Component, Connection, Zone, Step } from '@/types/schema'
import type { InternalGraph, InternalComponent, InternalConnection, InternalZone } from '@/types/internal'
import { componentCenter, componentMeshSize, gridToWorld, CELL_SIZE } from '@/engine/layoutEngine'
import { parseFlowSchema } from '@/engine/flowSchema'

export const PIPE_HEIGHT = 0.5

export function validateFlow(raw: unknown): FlowDefinition {
  const result = parseFlowSchema(raw)
  if (!result.success) throw new Error(result.errors[0])
  return result.data
}

// Wide S-curve: control points pulled 75% of the way across — sweeping, flat on the ground plane.
function autoRoute(start: THREE.Vector3, end: THREE.Vector3): THREE.CubicBezierCurve3 {
  const dx  = end.x - start.x
  const cp1 = new THREE.Vector3(start.x + dx * 0.75, PIPE_HEIGHT, start.z)
  const cp2 = new THREE.Vector3(end.x   - dx * 0.75, PIPE_HEIGHT, end.z)
  return new THREE.CubicBezierCurve3(start, cp1, cp2, end)
}

function bakeRoute(
  route: Connection['route'],
  startPt: THREE.Vector3,
  endPt:   THREE.Vector3,
): THREE.Curve<THREE.Vector3> {
  if (route === 'auto') {
    return autoRoute(startPt, endPt)
  } else {
    const waypoints = route.map(wp =>
      gridToWorld(wp.col, wp.row, 0).setY(PIPE_HEIGHT)
    )
    return new THREE.CatmullRomCurve3([startPt, ...waypoints, endPt])
  }
}

/** Drop one waypoint from a route. An emptied route falls back to auto-routing. */
export function removeWaypoint(route: Connection['route'], index: number): Connection['route'] {
  if (route === 'auto') return 'auto'
  const next = route.filter((_, i) => i !== index)
  return next.length > 0 ? next : 'auto'
}

// ── Tube render-trim helpers ─────────────────────────────────────────────────
//
// The packet curve runs center-to-center so the packet can travel the full
// length, but we only render the tube between the component edges so it doesn't
// poke through the component meshes.

function outsideXZ(
  p: THREE.Vector3,
  cx: number, cz: number,
  hx: number, hz: number,
): boolean {
  return Math.abs(p.x - cx) > hx || Math.abs(p.z - cz) > hz
}

/** Find the t where the curve exits `comp` (searching forward from t=0). */
function findStartTrim(curve: THREE.Curve<THREE.Vector3>, comp: InternalComponent): number {
  const hx = comp.meshSize.x / 2
  const hz = comp.meshSize.z / 2
  const cx = comp.center.x
  const cz = comp.center.z

  // Coarse scan forward to bracket the exit point
  let lo = 0, hi = -1
  for (let i = 1; i <= 20; i++) {
    const t = i / 20
    if (outsideXZ(curve.getPoint(t), cx, cz, hx, hz)) { hi = t; break }
  }
  if (hi < 0) return 0  // never exits — keep full range

  // Binary refine
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (outsideXZ(curve.getPoint(mid), cx, cz, hx, hz)) hi = mid; else lo = mid
  }
  return hi
}

/** Find the t where the curve enters `comp` (searching backward from t=1). */
function findEndTrim(curve: THREE.Curve<THREE.Vector3>, comp: InternalComponent): number {
  const hx = comp.meshSize.x / 2
  const hz = comp.meshSize.z / 2
  const cx = comp.center.x
  const cz = comp.center.z

  // Coarse scan backward to bracket the entry point
  let hi = 1, lo = -1
  for (let i = 1; i <= 20; i++) {
    const t = 1 - i / 20
    if (outsideXZ(curve.getPoint(t), cx, cz, hx, hz)) { lo = t; break }
  }
  if (lo < 0) return 1  // never exits — keep full range

  // Binary refine
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (outsideXZ(curve.getPoint(mid), cx, cz, hx, hz)) lo = mid; else hi = mid
  }
  return lo
}

// ── Shared connection-geometry builder ───────────────────────────────────────
//
// Builds the center-to-center packet curve, its sampled points, and the
// render-trim t-range from the current component centers. Used both for the
// initial graph build and for rebuilding a pipe after its endpoints move.

export function buildConnectionGeometry(
  route: Connection['route'],
  from: InternalComponent,
  to: InternalComponent,
  portOffset: { start: THREE.Vector3; end: THREE.Vector3 },
): { curve: THREE.Curve<THREE.Vector3>; tubePoints: THREE.Vector3[]; renderTrim: { t0: number; t1: number } } {
  const startPt = from.center.clone().add(portOffset.start).setY(PIPE_HEIGHT)
  const endPt   = to.center.clone().add(portOffset.end).setY(PIPE_HEIGHT)
  const curve   = bakeRoute(route, startPt, endPt)
  const tubePoints = curve.getPoints(64)

  const t0 = findStartTrim(curve, from)
  const t1 = findEndTrim(curve, to)
  const renderTrim = { t0, t1: t1 > t0 ? t1 : 1 }

  return { curve, tubePoints, renderTrim }
}

// ── Port-spreading helpers ────────────────────────────────────────────────────
//
// When N connections share the same source or destination, their attachment
// points are spread perpendicularly so pipes fan out rather than stacking.

const PORT_SPREAD = 0.55  // world-unit gap between adjacent attachment points

type PortOffsets = Map<string, { start: THREE.Vector3; end: THREE.Vector3 }>

function computePortOffsets(
  def: { connections: Connection[] },
  components: Map<string, InternalComponent>,
): PortOffsets {
  const offsets: PortOffsets = new Map()
  const ensure = (id: string) => {
    if (!offsets.has(id))
      offsets.set(id, { start: new THREE.Vector3(), end: new THREE.Vector3() })
    return offsets.get(id)!
  }

  // Index connections by source and destination for O(1) lookups
  const connById  = new Map(def.connections.map(c => [c.id, c]))
  const byDest    = new Map<string, string[]>()
  const bySrc     = new Map<string, string[]>()
  for (const c of def.connections) {
    ;(byDest.get(c.to)  ?? (byDest.set(c.to,   []), byDest.get(c.to)!)).push(c.id)
    ;(bySrc.get(c.from) ?? (bySrc.set(c.from, []), bySrc.get(c.from)!)).push(c.id)
  }

  // Spread a group of connections at a shared attachment point.
  // `sortKey`  — center of the "other" component, used to order pipes spatially.
  // `applyFn`  — adds the computed offset to start or end of the named connection.
  // `avgDir`   — average travel direction (XZ) across the group; perpendicular
  //              to this is the spread axis.
  function spreadGroup(
    connIds:  string[],
    sortKey:  (id: string) => THREE.Vector3,
    applyFn:  (id: string, v: THREE.Vector3) => void,
    avgDir:   THREE.Vector2,
  ) {
    if (connIds.length < 2) return
    const n    = connIds.length
    const perp = new THREE.Vector2(-avgDir.y, avgDir.x).normalize()
    const sorted = [...connIds].sort((a, b) => sortKey(a).z - sortKey(b).z)
    sorted.forEach((id, i) => {
      const t = (i - (n - 1) / 2) * PORT_SPREAD
      applyFn(id, new THREE.Vector3(perp.x * t, 0, perp.y * t))
    })
  }

  function avgDirection(connIds: string[]): THREE.Vector2 {
    let ax = 0, az = 0
    for (const id of connIds) {
      const c    = connById.get(id)!
      const src  = components.get(c.from)!.center
      const dest = components.get(c.to)!.center
      const dx = dest.x - src.x
      const dz = dest.z - src.z
      const len = Math.max(Math.sqrt(dx * dx + dz * dz), 0.01)
      ax += dx / len
      az += dz / len
    }
    const len = Math.max(Math.sqrt(ax * ax + az * az), 0.01)
    return new THREE.Vector2(ax / len, az / len)
  }

  // Spread arrivals at each destination
  for (const [, ids] of byDest) {
    const dir = avgDirection(ids)
    spreadGroup(
      ids,
      id => components.get(connById.get(id)!.from)!.center,
      (id, v) => ensure(id).end.add(v),
      dir,
    )
  }

  // Spread departures from each source
  for (const [, ids] of bySrc) {
    const dir = avgDirection(ids)
    spreadGroup(
      ids,
      id => components.get(connById.get(id)!.to)!.center,
      (id, v) => ensure(id).start.add(v),
      dir,
    )
  }

  return offsets
}

export function buildGraph(def: FlowDefinition): InternalGraph {
  validateFlow(def)
  const graph = buildScene(def, def.steps)
  return graph
}

/** One scene's geometry. Called for the flow itself and for every nested
 *  `component.detail`, which is why it takes only the parts a scene has. */
function buildScene(
  def: {
    layout: { grid: { cols: number; rows: number } }
    zones?: Zone[]
    components: Component[]
    connections: Connection[]
  },
  steps: Step[],
): InternalGraph {
  const defZones = def.zones ?? []

  // Build InternalComponent map
  const components = new Map<string, InternalComponent>()
  for (const c of def.components) {
    const center    = componentCenter(c)
    const meshSize  = componentMeshSize(c)
    const topCenter = center.clone()
    topCenter.y += meshSize.y  // mesh bottom sits on ground; top = full height above ground

    const ic: InternalComponent = {
      id:        c.id,
      label:     c.label,
      type:      c.type,
      shape:     c.shape,
      logo:      c.logo,
      icon:      c.icon,
      color:     c.color,
      center,
      meshSize,
      topCenter,
      meta:      c.meta,
    }
    components.set(c.id, ic)
  }

  // Compute port-spread offsets so pipes fan out at shared attach points
  const portOffsets = computePortOffsets(def, components)

  // Build InternalConnection map
  const connections = new Map<string, InternalConnection>()
  for (const conn of def.connections) {
    const from  = components.get(conn.from)!
    const to    = components.get(conn.to)!
    const portOffset = portOffsets.get(conn.id)
      ?? { start: new THREE.Vector3(), end: new THREE.Vector3() }
    const { curve, tubePoints, renderTrim } =
      buildConnectionGeometry(conn.route, from, to, portOffset)

    const ic: InternalConnection = {
      id:    conn.id,
      from,
      to,
      label: conn.label,
      curve,
      tubePoints,
      renderTrim,
      route: conn.route,
      portOffset,
    }
    connections.set(conn.id, ic)
  }

  // Build InternalZone array
  const zoneDefById = new Map(defZones.map(z => [z.id, z]))
  function zoneDepth(id: string, visited = new Set<string>()): number {
    if (visited.has(id)) return 0
    visited.add(id)
    const parent = zoneDefById.get(id)?.parentId
    return parent ? 1 + zoneDepth(parent, visited) : 0
  }

  const zones: InternalZone[] = defZones.map(z => {
    const min = new THREE.Vector3(
      z.bounds.col * CELL_SIZE,
      0,
      z.bounds.row * CELL_SIZE
    )
    const max = new THREE.Vector3(
      (z.bounds.col + z.bounds.width)  * CELL_SIZE,
      0,
      (z.bounds.row + z.bounds.height) * CELL_SIZE
    )
    return {
      id:       z.id,
      label:    z.label,
      color:    new THREE.Color(z.color),
      min,
      max,
      parentId: z.parentId,
      outline:  z.outline ?? 'solid',
      depth:    zoneDepth(z.id),
      meta:     z.meta,
    }
  })

  // Auto-expand parent zones to enclose all their children with padding.
  // Process deepest zones first so multi-level nesting propagates correctly.
  const PARENT_PADDING = CELL_SIZE * 1.5  // 1.5 grid cells of space on every side
  const childrenByParent = new Map<string, InternalZone[]>()
  for (const z of zones) {
    if (z.parentId) {
      if (!childrenByParent.has(z.parentId)) childrenByParent.set(z.parentId, [])
      childrenByParent.get(z.parentId)!.push(z)
    }
  }
  const byDepthDesc = [...zones].sort((a, b) => b.depth - a.depth)
  for (const z of byDepthDesc) {
    const children = childrenByParent.get(z.id)
    if (!children?.length) continue
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const c of children) {
      minX = Math.min(minX, c.min.x);  minZ = Math.min(minZ, c.min.z)
      maxX = Math.max(maxX, c.max.x);  maxZ = Math.max(maxZ, c.max.z)
    }
    z.min.x = Math.min(z.min.x, minX - PARENT_PADDING)
    z.min.z = Math.min(z.min.z, minZ - PARENT_PADDING)
    z.max.x = Math.max(z.max.x, maxX + PARENT_PADDING)
    z.max.z = Math.max(z.max.z, maxZ + PARENT_PADDING)
  }

  // Compute gridBounds
  const cols = def.layout.grid.cols
  const rows = def.layout.grid.rows
  const gridBounds = {
    minX: 0,
    maxX: cols * CELL_SIZE,
    minZ: 0,
    maxZ: rows * CELL_SIZE,
  }

  // Nested scenes: each component's `detail` becomes a graph of its own, laid
  // out from its own origin. Steps live on the root graph only.
  const scenes = new Map<string, InternalGraph>()
  for (const c of def.components) {
    if (c.detail) {
      scenes.set(c.id, buildScene({ layout: { grid: c.detail.grid }, ...c.detail }, []))
    }
  }

  return {
    components,
    connections,
    zones,
    steps,
    gridBounds,
    scenes,
  }
}

export type { Component, Connection }
