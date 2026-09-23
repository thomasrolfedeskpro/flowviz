/**
 * The zoom buttons and the mouse wheel are the same move, so they must reach
 * the same places and stop at the same walls. Both call FlowScene.zoomBy, which
 * clamps through clampFrustum — the part that can be checked without a GL
 * context, and the part a second set of limits would silently disagree with.
 */

import { describe, it, expect } from 'vitest'
import { clampFrustum, ZOOM_STEP_IN, ZOOM_STEP_OUT } from '@/scene/FlowScene'

/** A scene's overview framing; every limit is a multiple of this. */
const OVERVIEW = 20

/** What zoomBy does to a frustum, minus the camera. */
function zoom(frustum: number, factor: number): number {
  return clampFrustum(frustum * factor, OVERVIEW)
}

/** Press a zoom button `times` times from the overview framing. */
function press(factor: number, times: number): number {
  let f = OVERVIEW
  for (let i = 0; i < times; i++) f = zoom(f, factor)
  return f
}

describe('zoom limits', () => {
  it('leaves a frustum inside the range alone', () => {
    expect(clampFrustum(OVERVIEW, OVERVIEW)).toBe(OVERVIEW)
  })

  it('zooming in closes the view and zooming out opens it', () => {
    expect(zoom(OVERVIEW, ZOOM_STEP_IN)).toBeLessThan(OVERVIEW)
    expect(zoom(OVERVIEW, ZOOM_STEP_OUT)).toBeGreaterThan(OVERVIEW)
  })

  it('stops at a quarter of the overview framing however long you hold it', () => {
    expect(press(ZOOM_STEP_IN, 200)).toBeCloseTo(OVERVIEW * 0.25)
  })

  it('stops at two and a half times the overview framing', () => {
    expect(press(ZOOM_STEP_OUT, 200)).toBeCloseTo(OVERVIEW * 2.5)
  })

  it('a step back out from the wall returns inside the range', () => {
    const atWall = press(ZOOM_STEP_IN, 200)
    expect(zoom(atWall, ZOOM_STEP_OUT)).toBeGreaterThan(atWall)
  })

  it('scales with the scene: limits are relative to its own overview framing', () => {
    expect(clampFrustum(1, 100)).toBe(25)
    expect(clampFrustum(1000, 100)).toBe(250)
  })
})

/**
 * What the playbar readout says. FlowScene.zoomLevel is
 * `overviewFrustum / currentFrustum`, so it is the reciprocal of the frustum
 * and the clamp decides the range a user can ever see.
 */
const level = (frustum: number) => OVERVIEW / frustum

describe('the zoom readout', () => {
  it('reads 100% at the framing a flow opens at', () => {
    expect(Math.round(level(OVERVIEW) * 100)).toBe(100)
  })

  it('runs from 40% to 400%, the walls the clamp puts up', () => {
    expect(Math.round(level(press(ZOOM_STEP_OUT, 200)) * 100)).toBe(40)
    expect(Math.round(level(press(ZOOM_STEP_IN,  200)) * 100)).toBe(400)
  })

  it('rises as you zoom in — a bigger number means closer', () => {
    expect(level(zoom(OVERVIEW, ZOOM_STEP_IN))).toBeGreaterThan(1)
    expect(level(zoom(OVERVIEW, ZOOM_STEP_OUT))).toBeLessThan(1)
  })

  it('means the same in a big flow as in a small one', () => {
    // 2x into a scene framed at 100 and one framed at 5 both read 200%.
    expect(100 / clampFrustum(50, 100)).toBe(2)
    expect(5 / clampFrustum(2.5, 5)).toBe(2)
  })
})
