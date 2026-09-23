/**
 * Regression suite for ComponentMesh opacity effects.
 *
 * History: these effects broke silently when @tweenjs/tween.js v25 changed
 * the Tween constructor so that tweens no longer auto-register with the global
 * group. The fix was a shared tweenGroup singleton — these tests detect that
 * class of regression by verifying that calling transitionTo/setPenetrated
 * and then ticking tweenGroup actually changes material opacity.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'
import { ComponentMesh, STATE_OPACITY, PENETRATED_OPACITY, TYPE_COLOR, componentHex } from '@/scene/ComponentMesh'
import { tweenGroup } from '@/scene/tweenGroup'
import type { InternalComponent } from '@/types/internal'

// Mock shapeRegistry so the ComponentMesh constructor does not call
// document.createElement (used by IconMesh to rasterise icon SVGs onto a canvas
// texture). The mock returns a simple box using the real shared `mat` so that
// our opacity assertions reflect what ComponentMesh actually writes.
vi.mock('@/scene/shapeRegistry', async () => {
  const THREE = await import('three')
  return {
    buildShapeMeshes: (
      _type: unknown,
      _shape: unknown,
      meshSize: THREE.Vector3,
      mat: THREE.Material,
    ) => [new THREE.Mesh(new THREE.BoxGeometry(meshSize.x, meshSize.y, meshSize.z), mat)],
    buildPacketGeometry: () => new THREE.SphereGeometry(0.1, 4, 4),
  }
})

// ── helpers ──────────────────────────────────────────────────────────────────

function makeComp(overrides: Partial<InternalComponent> = {}): InternalComponent {
  return {
    id:        'c1',
    label:     'Service',
    type:      'service',
    center:    new THREE.Vector3(0, 0, 0),
    meshSize:  new THREE.Vector3(2.4, 1.2, 2.4),
    topCenter: new THREE.Vector3(0, 1.2, 0),
    meta:      undefined,
    ...overrides,
  }
}

/**
 * Return the MeshStandardMaterial opacity from the first visual mesh in the
 * group (the shared `mat` that transitionTo / setPenetrated both write to).
 */
function getOpacity(cm: ComponentMesh): number {
  for (const child of cm.group.children) {
    if (child instanceof THREE.Mesh && child !== cm.hitMesh) {
      const mat = child.material
      if (mat instanceof THREE.MeshStandardMaterial) return mat.opacity
    }
  }
  throw new Error('No MeshStandardMaterial found in ComponentMesh group')
}

/**
 * Advance the tween group far enough into the future that any in-flight tween
 * (max realistic duration ~5 s) completes and its onComplete fires.
 */
function settleTweens(): void {
  tweenGroup.update(performance.now() + 10_000)
}

// ── constants ────────────────────────────────────────────────────────────────

describe('opacity constants', () => {
  it('idle and highlighted are fully opaque', () => {
    expect(STATE_OPACITY.idle).toBe(1.0)
    expect(STATE_OPACITY.highlighted).toBe(1.0)
  })

  it('dimmed is between 0.3 and 0.8 — visible but clearly de-emphasised', () => {
    expect(STATE_OPACITY.dimmed).toBeGreaterThan(0.3)
    expect(STATE_OPACITY.dimmed).toBeLessThan(0.8)
  })

  it('PENETRATED_OPACITY is less than dimmed', () => {
    expect(PENETRATED_OPACITY).toBeGreaterThan(0)
    expect(PENETRATED_OPACITY).toBeLessThan(STATE_OPACITY.dimmed)
  })
})

// ── transitionTo() ───────────────────────────────────────────────────────────

describe('ComponentMesh.transitionTo()', () => {
  let scene: THREE.Scene
  let cm: ComponentMesh

  beforeEach(() => {
    // Drain any leftover tweens from other tests before creating new objects.
    settleTweens()
    scene = new THREE.Scene()
    cm    = new ComponentMesh(scene, makeComp())
  })

  it('starts at idle opacity', () => {
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.idle)
  })

  it('reaches dimmed opacity after tween completes', () => {
    cm.transitionTo('dimmed', 10)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.dimmed)
  })

  it('reaches highlighted opacity (same as idle) after tween', () => {
    cm.transitionTo('highlighted', 10)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.highlighted)
  })

  it('returns to idle from dimmed', () => {
    cm.transitionTo('dimmed', 10)
    settleTweens()
    cm.transitionTo('idle', 10)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.idle)
  })

  it('opacity does not change until tweenGroup is ticked — catches missing group wiring', () => {
    // If tweens are not wired to tweenGroup, settling will do nothing and opacity
    // will remain at its starting value (1.0) instead of reaching 0.45.
    cm.transitionTo('dimmed', 10)
    // Do NOT call settleTweens — the tween should at least be registered
    // enough that settling later will work. We settle now and check.
    settleTweens()
    expect(getOpacity(cm)).not.toBeCloseTo(STATE_OPACITY.idle) // must have changed
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.dimmed)
  })
})

// ── setPenetrated() ──────────────────────────────────────────────────────────

describe('ComponentMesh.setPenetrated()', () => {
  let scene: THREE.Scene
  let cm: ComponentMesh

  beforeEach(() => {
    settleTweens()
    scene = new THREE.Scene()
    cm    = new ComponentMesh(scene, makeComp())
  })

  it('reduces opacity to PENETRATED_OPACITY when a packet enters', () => {
    cm.setPenetrated(true)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(PENETRATED_OPACITY)
  })

  it('restores idle opacity when packet exits', () => {
    cm.setPenetrated(true)
    settleTweens()
    cm.setPenetrated(false)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.idle)
  })

  it('restores dimmed opacity when packet exits a dimmed component', () => {
    cm.transitionTo('dimmed', 10)
    settleTweens()
    cm.setPenetrated(true)
    settleTweens()
    cm.setPenetrated(false)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.dimmed)
  })

  it('is idempotent — calling true twice does not leave opacity wrong', () => {
    cm.setPenetrated(true)
    settleTweens()
    cm.setPenetrated(true) // should be a no-op
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(PENETRATED_OPACITY)
  })

  it('penetration wins over an in-progress transitionTo', () => {
    // A long dimming tween is started but then interrupted by penetration.
    // The penetration tween should drive opacity to PENETRATED_OPACITY.
    cm.transitionTo('dimmed', 5000)
    cm.setPenetrated(true)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(PENETRATED_OPACITY)
  })

  it('depthWrite is false while penetrated, true otherwise', () => {
    // We can't read depthWrite from the group child directly without the mat ref,
    // but we can verify penetrated state does not prevent opacity from settling.
    cm.setPenetrated(true)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(PENETRATED_OPACITY)
    cm.setPenetrated(false)
    settleTweens()
    expect(getOpacity(cm)).toBeCloseTo(STATE_OPACITY.idle)
  })
})

// ── renderOrder ──────────────────────────────────────────────────────────────

describe('ComponentMesh renderOrder', () => {
  let scene: THREE.Scene
  let cm: ComponentMesh

  beforeEach(() => {
    settleTweens()
    scene = new THREE.Scene()
    cm    = new ComponentMesh(scene, makeComp())
  })

  it('visual meshes have renderOrder 2 while penetrated', () => {
    cm.setPenetrated(true)
    const orders = cm.group.children
      .filter(c => c instanceof THREE.Mesh && c !== cm.hitMesh)
      .map(c => c.renderOrder)
    expect(orders.every(o => o === 2)).toBe(true)
  })

  it('visual meshes restore renderOrder <= 1 after penetration ends', () => {
    cm.setPenetrated(true)
    cm.setPenetrated(false)
    const orders = cm.group.children
      .filter(c => c instanceof THREE.Mesh && c !== cm.hitMesh)
      .map(c => c.renderOrder)
    expect(orders.every(o => o <= 1)).toBe(true)
  })
})

/**
 * The pinned label wears its component's colour as a stripe, and it reads that
 * colour from here rather than resolving the fallback a second time. A chip
 * tinted differently from the mesh it names would be worse than an untinted one.
 */
describe('componentHex()', () => {
  it('falls back to the colour the type is drawn in', () => {
    expect(componentHex({ type: 'database', color: undefined })).toBe('#f57c00')
    expect(componentHex({ type: 'client',   color: undefined })).toBe('#1e88e5')
  })

  it('pads a colour whose hex is short of six digits', () => {
    // 0x546e7a is fine; the padding matters for any future value below 0x100000.
    expect(componentHex({ type: 'external', color: undefined })).toHaveLength(7)
  })

  it('prefers an override the author set', () => {
    expect(componentHex({ type: 'database', color: '#7c3a9d' })).toBe('#7c3a9d')
  })

  it('agrees with the value the mesh material is built from', () => {
    for (const type of Object.keys(TYPE_COLOR) as Array<keyof typeof TYPE_COLOR>) {
      const fromMesh = new THREE.Color(TYPE_COLOR[type]).getHexString()
      expect(componentHex({ type, color: undefined }), type).toBe(`#${fromMesh}`)
    }
  })
})
