import * as THREE from 'three'
import { buildBrandIconMeshes } from '@/scene/IconMesh'
import type { ComponentShape } from '@/types/schema'

export function buildLogoMeshes(
  logoName: string,
  meshSize: THREE.Vector3,
  boxMat:  THREE.MeshStandardMaterial,
  iconMat: THREE.MeshBasicMaterial,
  shape:   ComponentShape = 'cuboid',
): THREE.Mesh[] {
  return buildBrandIconMeshes(logoName, meshSize, boxMat, iconMat, shape)
}
