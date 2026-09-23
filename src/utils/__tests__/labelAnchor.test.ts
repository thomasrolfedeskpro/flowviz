import { describe, it, expect } from 'vitest'
import { anchorPoint, anchorTransform, screenBox } from '@/utils/labelAnchor'
import type { LabelAnchor } from '@/types/schema'

// A component projecting to a 100×60 box with its top-left at (200, 100).
const BOX = { minX: 200, maxX: 300, minY: 100, maxY: 160 }
const GAP = 8

describe('screenBox()', () => {
  it('bounds every projected corner', () => {
    expect(screenBox([
      { x: 12, y: 40 },
      { x: -3, y: 9 },
      { x: 7,  y: 22 },
    ])).toEqual({ minX: -3, maxX: 12, minY: 9, maxY: 40 })
  })
})

describe('anchorPoint()', () => {
  it('puts the centre anchor on the middle of the component', () => {
    expect(anchorPoint(BOX, 'center', GAP)).toEqual({ x: 250, y: 130 })
  })

  it('pushes every other anchor clear of the edge it hangs off', () => {
    expect(anchorPoint(BOX, 'top-left',      GAP)).toEqual({ x: 192, y: 92 })
    expect(anchorPoint(BOX, 'top-center',    GAP)).toEqual({ x: 250, y: 92 })
    expect(anchorPoint(BOX, 'top-right',     GAP)).toEqual({ x: 308, y: 92 })
    expect(anchorPoint(BOX, 'middle-left',   GAP)).toEqual({ x: 192, y: 130 })
    expect(anchorPoint(BOX, 'middle-right',  GAP)).toEqual({ x: 308, y: 130 })
    expect(anchorPoint(BOX, 'bottom-left',   GAP)).toEqual({ x: 192, y: 168 })
    expect(anchorPoint(BOX, 'bottom-center', GAP)).toEqual({ x: 250, y: 168 })
    expect(anchorPoint(BOX, 'bottom-right',  GAP)).toEqual({ x: 308, y: 168 })
  })

  // The whole point of the feature: a screenshot must show the mesh, not a
  // chip sitting on top of it.
  it('leaves the component uncovered for every anchor but the centre', () => {
    const outside: LabelAnchor[] = [
      'top-left', 'top-center', 'top-right',
      'middle-left', 'middle-right',
      'bottom-left', 'bottom-center', 'bottom-right',
    ]
    for (const anchor of outside) {
      const { x, y } = anchorPoint(BOX, anchor, GAP)
      const inside = x > BOX.minX && x < BOX.maxX && y > BOX.minY && y < BOX.maxY
      expect(inside, anchor).toBe(false)
    }
  })
})

describe('anchorTransform()', () => {
  // Percentages, not pixels: nothing measures the chip after it renders.
  it('pulls the chip back by its own size so its far edge meets the point', () => {
    expect(anchorTransform(BOX, 'top-left', GAP))
      .toBe('translate(calc(192px + -100%), calc(92px + -100%))')
  })

  it('centres the chip on both axes for the centre anchor', () => {
    expect(anchorTransform(BOX, 'center', GAP))
      .toBe('translate(calc(250px + -50%), calc(130px + -50%))')
  })

  it('leaves the chip forward of the point on the right and bottom', () => {
    expect(anchorTransform(BOX, 'bottom-right', GAP))
      .toBe('translate(calc(308px + 0%), calc(168px + 0%))')
  })
})
