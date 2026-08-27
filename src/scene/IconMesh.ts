import * as THREE from 'three'
import * as brandIcons from '@fortawesome/free-brands-svg-icons'
import * as solidIcons from '@fortawesome/free-solid-svg-icons'
import { buildBodyGeometry, iconFitRatio } from '@/scene/componentShapes'
import type { ComponentShape } from '@/types/schema'

type FAIconTuple = [number, number, string[], string, string | string[]]
type FAIconEntry = { icon: FAIconTuple }

const BOX_H = 0.30  // fixed height for all icon-box components

/** Every Font Awesome free-solid icon name, in the camelCase form flows use. */
const SOLID_PACK = solidIcons as unknown as Record<string, { icon?: unknown }>

export const SOLID_ICON_NAMES: string[] = Object.keys(SOLID_PACK)
  .filter(key => key.startsWith('fa') && Array.isArray(SOLID_PACK[key]?.icon))
  .map(key => key.charAt(2).toLowerCase() + key.slice(3))
  .sort()

function resolveIcon(
  name: string,
  pack: Record<string, unknown>,
): { paths: string[]; width: number; height: number } | null {
  const key   = `fa${name.charAt(0).toUpperCase()}${name.slice(1)}`
  const entry = pack[key] as FAIconEntry | undefined
  if (!entry?.icon) return null
  const [width, height, , , svgPathData] = entry.icon
  const paths = Array.isArray(svgPathData) ? svgPathData : [svgPathData]
  return { paths, width, height }
}

/**
 * Build a thin coloured box with a flat white icon face on top.
 *
 * Uses a canvas texture on a PlaneGeometry rather than floating ShapeGeometry,
 * which eliminates z-fighting entirely (the orthographic camera near=0.1/far=1000
 * gives too few depth levels for a sub-unit gap in swiftshader).
 *
 * boxMat  — component colour material (used for the box body)
 * iconMat — white icon material (receives the canvas texture map)
 */
const TEX_SIZE = 256

function buildIconBoxMeshes(
  svgPaths: string[],
  vbW:     number,
  vbH:     number,
  meshSize: THREE.Vector3,
  boxMat:  THREE.MeshStandardMaterial,
  iconMat: THREE.MeshBasicMaterial,
  shape:   ComponentShape,
): THREE.Mesh[] {
  // Use the full component height so tubes appear to enter the box naturally.
  // Group origin is at center.y + meshSize.y/2, so local y=0 puts the box
  // center at that point; bottom lands at world y=0 (ground), top at meshSize.y.
  const box  = buildBox(meshSize, boxMat, shape, 0, meshSize.y)
  if (svgPaths.length === 0) return [box]

  // Draw FA paths onto a 2-D canvas using the browser Path2D API.
  // The canvas context handles the evenodd fill rule correctly, avoiding
  // the winding / hole misinterpretation that THREE.SVGLoader can produce.
  const canvas = document.createElement('canvas')
  canvas.width  = TEX_SIZE
  canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = `#${iconMat.color.getHexString()}`

  const fill = 0.78
  const s    = Math.min(TEX_SIZE * fill / vbW, TEX_SIZE * fill / vbH)
  const ox   = (TEX_SIZE - vbW * s) / 2
  const oy   = (TEX_SIZE - vbH * s) / 2

  ctx.save()
  ctx.translate(ox, oy)
  ctx.scale(s, s)
  for (const d of svgPaths) ctx.fill(new Path2D(d), 'evenodd')
  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace

  // Apply texture to the shared iconMat (each ComponentMesh has its own instance).
  // polygonOffset pushes the face forward in the depth buffer, defeating any
  // residual z-fighting even when both box and icon are in the transparent pass.
  iconMat.map                = tex
  iconMat.polygonOffset      = true
  iconMat.polygonOffsetFactor = -2
  iconMat.polygonOffsetUnits  = -2
  iconMat.needsUpdate        = true

  // PlaneGeometry lying flat on top of the box, face up.
  // Use the shorter dimension so the square canvas texture is never stretched
  // on wide or deep rectangular components.
  const iconSize = Math.min(meshSize.x, meshSize.z) * iconFitRatio(shape)
  const planeY   = meshSize.y / 2 + 0.01
  const face     = new THREE.Mesh(
    new THREE.PlaneGeometry(iconSize, iconSize),
    iconMat,
  )
  face.rotation.x  = -Math.PI / 2
  face.position.y  = planeY
  face.renderOrder = 1

  return [box, face]
}

function buildBox(
  meshSize:  THREE.Vector3,
  mat:       THREE.MeshStandardMaterial,
  shape:     ComponentShape = 'cuboid',
  localY  = 0,
  boxHeight = BOX_H,
): THREE.Mesh {
  const m = new THREE.Mesh(buildBodyGeometry(shape, meshSize, boxHeight), mat)
  m.position.y = localY
  return m
}

// ── Public builders ───────────────────────────────────────────────────────────

export function buildBrandIconMeshes(
  logoName: string,
  meshSize: THREE.Vector3,
  boxMat:  THREE.MeshStandardMaterial,
  iconMat: THREE.MeshBasicMaterial,
  shape:   ComponentShape = 'cuboid',
): THREE.Mesh[] {
  const resolved = resolveIcon(logoName, brandIcons as Record<string, unknown>)
  if (!resolved) {
    console.warn(`[IconMesh] Unknown brand icon: "${logoName}"`)
    return [buildBox(meshSize, boxMat, shape, 0, meshSize.y)]
  }
  return buildIconBoxMeshes(resolved.paths, resolved.width, resolved.height, meshSize, boxMat, iconMat, shape)
}

export function buildSolidIconMeshes(
  iconName: string,
  meshSize: THREE.Vector3,
  boxMat:  THREE.MeshStandardMaterial,
  iconMat: THREE.MeshBasicMaterial,
  shape:   ComponentShape = 'cuboid',
): THREE.Mesh[] {
  const resolved = resolveIcon(iconName, solidIcons as Record<string, unknown>)
  if (!resolved) {
    console.warn(`[IconMesh] Unknown solid icon: "${iconName}"`)
    return [buildBox(meshSize, boxMat, shape, 0, meshSize.y)]
  }
  return buildIconBoxMeshes(resolved.paths, resolved.width, resolved.height, meshSize, boxMat, iconMat, shape)
}
