/**
 * Waterfall bars are placed on one shared axis: `start` when the author gives
 * one, otherwise the end of the previous bar so weight-only flows still cascade.
 */

import { describe, it, expect } from 'vitest'
import { waterfallLanes } from '@/utils/waterfall'
import type { Step } from '@/types/schema'

const step = (id: number, waterfall?: Step['waterfall']): Step => ({
  id,
  title: `Step ${id}`,
  highlight: [],
  active_connections: [],
  ...(waterfall ? { waterfall } : {}),
})

describe('waterfallLanes', () => {
  it('reports no span when nothing carries a bar', () => {
    const lanes = waterfallLanes([step(0), step(1)])
    expect(lanes.span).toBe(0)
    expect(lanes.byStep).toEqual({})
  })

  it('cascades sequentially when no starts are given', () => {
    const lanes = waterfallLanes([
      step(0, { weight: 100 }),
      step(1, { weight: 300 }),
    ])
    expect(lanes.span).toBe(400)
    expect(lanes.byStep[0]!.offsetPct).toBe(0)
    expect(lanes.byStep[0]!.widthPct).toBeCloseTo(25)
    expect(lanes.byStep[1]!.offsetPct).toBeCloseTo(25)
    expect(lanes.byStep[1]!.widthPct).toBeCloseTo(75)
  })

  it('honours explicit starts, including overlapping bars', () => {
    const lanes = waterfallLanes([
      step(0, { weight: 1000, start: 0 }),   // a parent span…
      step(1, { weight: 400, start: 200 }),  // …with a child inside it
    ])
    expect(lanes.span).toBe(1000)
    expect(lanes.byStep[1]!.offsetPct).toBeCloseTo(20)
    expect(lanes.byStep[1]!.widthPct).toBeCloseTo(40)
  })

  it('takes the span from the furthest bar end, not the largest weight', () => {
    const lanes = waterfallLanes([
      step(0, { weight: 100, start: 0 }),
      step(1, { weight: 50, start: 950 }),
    ])
    expect(lanes.span).toBe(1000)
  })

  it('skips steps without a bar and keeps the rest aligned to their index', () => {
    const lanes = waterfallLanes([step(0), step(1, { weight: 10 }), step(2)])
    expect(lanes.byStep[0]).toBeUndefined()
    expect(lanes.byStep[1]!.widthPct).toBeCloseTo(100)
    expect(lanes.byStep[2]).toBeUndefined()
  })

  it('keeps a hairline bar visible without overflowing the track', () => {
    const lanes = waterfallLanes([
      step(0, { weight: 10_000, start: 0 }),
      step(1, { weight: 1, start: 9_999 }),
    ])
    const tail = lanes.byStep[1]!
    expect(tail.widthPct).toBeGreaterThan(0)
    expect(tail.offsetPct + tail.widthPct).toBeLessThanOrEqual(100)
  })
})
