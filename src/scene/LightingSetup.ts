import * as THREE from 'three'
import { THEME_COLORS } from '@/scene/ThemeColors'
import type { Theme } from '@/scene/ThemeColors'

export interface SceneLights {
  ambient: THREE.AmbientLight
  /** The only light that casts. Exposed so the view can turn shadows off. */
  key:     THREE.DirectionalLight
  fill:    THREE.DirectionalLight
}

export function setupLighting(scene: THREE.Scene, theme: Theme = 'light'): SceneLights {
  const c = THEME_COLORS[theme]

  const ambient = new THREE.AmbientLight(c.ambientColor, c.ambientIntensity)
  scene.add(ambient)

  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(-10, 20, 10)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 200
  key.shadow.camera.left = -40
  key.shadow.camera.right = 40
  key.shadow.camera.top = 40
  key.shadow.camera.bottom = -40
  scene.add(key)

  const fill = new THREE.DirectionalLight(c.fillColor, c.fillIntensity)
  fill.position.set(10, 10, -10)
  scene.add(fill)

  return { ambient, key, fill }
}

/**
 * Shadows are drawn by the isometric view and dropped by the plan view.
 *
 * The key light sits off to one side, so a component's shadow falls beside it.
 * Seen at an angle that reads as depth; seen from directly overhead it reads as
 * a second, blurred copy of the component offset from the real one — noise on a
 * diagram whose whole point in that view is to be flat.
 *
 * Toggling `castShadow` rather than `renderer.shadowMap.enabled`: the number of
 * shadow-casting lights is part of the renderer's lights state, so three
 * rebuilds the affected programs itself instead of leaving materials compiled
 * against a shadow map that is no longer written.
 */
export function setShadowsEnabled(lights: SceneLights, enabled: boolean): void {
  lights.key.castShadow = enabled
}

export function updateLighting(lights: SceneLights, theme: Theme): void {
  const c = THEME_COLORS[theme]
  lights.ambient.color.setHex(c.ambientColor)
  lights.ambient.intensity = c.ambientIntensity
  lights.fill.color.setHex(c.fillColor)
  lights.fill.intensity = c.fillIntensity
}
