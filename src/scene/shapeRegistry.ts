import * as THREE from 'three'
import type { PacketShape, ComponentShape, ComponentType } from '@/types/schema'
import { buildSolidIconMeshes } from '@/scene/IconMesh'

// ── Packet geometry registry ──────────────────────────────────────────────────
// Each factory returns a fresh BufferGeometry. Add new shapes here.

export const PACKET_GEOMETRY_BUILDERS: Record<PacketShape, () => THREE.BufferGeometry> = {
  sphere:   () => new THREE.SphereGeometry(0.35, 16, 8),
  document: () => new THREE.BoxGeometry(0.65, 0.45, 0.12),
  token:    () => new THREE.CylinderGeometry(0.28, 0.28, 0.09, 16),
  blob: () => {
    const g = new THREE.SphereGeometry(0.38, 8, 6)
    g.scale(1.0, 0.7, 0.9)
    return g
  },
  envelope: () => new THREE.BoxGeometry(0.60, 0.42, 0.09),
}

export function buildPacketGeometry(shape: PacketShape): THREE.BufferGeometry {
  return PACKET_GEOMETRY_BUILDERS[shape]()
}

// ── Component shape registry ──────────────────────────────────────────────────
// Bodies are plain extruded prisms (see componentShapes.ts). The type-default
// icon is drawn on top when a component declares no icon of its own.

const TYPE_ICON: Record<ComponentType, string> = {
  client:   'laptop',
  service:  'server',
  function: 'bolt',
  database: 'database',
  queue:    'layerGroup',
  external: 'globe',
}

export function buildShapeMeshes(
  type:    ComponentType,
  shape:   ComponentShape | undefined,
  size:    THREE.Vector3,
  mat:     THREE.MeshStandardMaterial,
  iconMat: THREE.MeshBasicMaterial,
): THREE.Mesh[] {
  return buildSolidIconMeshes(TYPE_ICON[type] ?? 'cube', size, mat, iconMat, shape ?? 'cuboid')
}
