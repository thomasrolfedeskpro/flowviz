/**
 * The card is sized in CSS pixels and the diagram is not, so what a card covers
 * depends entirely on the zoom. These pin the point at which it gives way.
 */

import { describe, it, expect } from 'vitest'
import { isCompactAtZoom, COMPACT_ZOOM_THRESHOLD } from '@/utils/cardDensity'
import { clampFrustum, ZOOM_STEP_OUT } from '@/scene/FlowScene'

describe('isCompactAtZoom', () => {
  it('leaves the card whole at the framing a flow opens at', () => {
    expect(isCompactAtZoom(1)).toBe(false)
  })

  it('leaves the card whole when zoomed in', () => {
    expect(isCompactAtZoom(4)).toBe(false)
  })

  it('compacts at the furthest the view can be pulled back', () => {
    // FRUSTUM_MAX_RATIO is 2.5, so the zoom floor is 1 / 2.5.
    expect(isCompactAtZoom(0.4)).toBe(true)
  })

  it('holds the card whole exactly on the threshold', () => {
    expect(isCompactAtZoom(COMPACT_ZOOM_THRESHOLD)).toBe(false)
  })

  it('does not sit between two wheel notches', () => {
    // A threshold landing inside a notch would be unreachable from the wheel:
    // the zoom would step straight over it. Walking the notches out from the
    // opening framing has to actually cross it.
    let zoom = 1
    const seen: boolean[] = []
    for (let i = 0; i < 12; i++) {
      zoom /= ZOOM_STEP_OUT
      seen.push(isCompactAtZoom(zoom))
    }
    expect(seen).toContain(true)
    expect(seen).toContain(false)
  })

  it('compacts before the zoom floor, not at it', () => {
    // The change has to be reachable while there is still room to pull back
    // further, or it only ever fires on the very last notch.
    const overview = 100
    const floorZoom = overview / clampFrustum(overview * 99, overview)
    expect(floorZoom).toBeLessThan(COMPACT_ZOOM_THRESHOLD)
  })
})
