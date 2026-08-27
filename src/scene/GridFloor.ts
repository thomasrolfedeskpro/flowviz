import * as THREE from 'three'
import { CELL_SIZE } from '@/engine/layoutEngine'
import { THEME_COLORS } from '@/scene/ThemeColors'
import type { Theme } from '@/scene/ThemeColors'

/** How many cells make one heavier "major" line. */
const MAJOR_EVERY = 5

/** Side length of the ground quad. Two triangles — the size costs nothing to
 *  draw; it only has to outrun how far the camera can be panned. */
const PLANE_SIZE = 20000

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

// Lines are drawn procedurally from world coordinates, so the grid is infinite
// without any geometry: one quad, no rebuilds on pan or zoom. fwidth() gives
// each line a constant on-screen width (~1px) at any zoom level, which is what
// keeps it from shimmering.
const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uMinor;
  uniform vec3  uMajor;
  uniform float uCell;
  uniform float uMajorEvery;
  varying vec3 vWorld;

  float gridLine(vec2 pos, float cell) {
    vec2 coord = pos / cell;
    vec2 dist  = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    return 1.0 - min(min(dist.x, dist.y), 1.0);
  }

  void main() {
    float minor = gridLine(vWorld.xz, uCell);
    float major = gridLine(vWorld.xz, uCell * uMajorEvery);
    float alpha = max(minor * 0.14, major * 0.26);
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(mix(uMinor, uMajor, major), alpha);
  }
`

export class GridFloor {
  private mesh:     THREE.Mesh
  private material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene, theme: Theme = 'light') {
    const c = THEME_COLORS[theme]
    this.material = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent:    true,
      depthWrite:     false,
      uniforms: {
        uMinor:      { value: new THREE.Color(c.gridSecondary) },
        uMajor:      { value: new THREE.Color(c.gridPrimary) },
        uCell:       { value: CELL_SIZE },
        uMajorEvery: { value: MAJOR_EVERY },
      },
    })

    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)
    geo.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.position.y = -0.15
    this.mesh.renderOrder = -1
    scene.add(this.mesh)
  }

  setTheme(theme: Theme): void {
    const c = THEME_COLORS[theme]
    ;(this.material.uniforms.uMinor.value as THREE.Color).setHex(c.gridSecondary)
    ;(this.material.uniforms.uMajor.value as THREE.Color).setHex(c.gridPrimary)
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
