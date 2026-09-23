/**
 * Placing a pinned label against a component.
 *
 * The anchor is resolved in *screen* space, off the component's projected
 * bounding box, rather than in world space. A world-space corner would swing
 * around the component as the camera turns and would mean something different
 * again in plan view; a projected box keeps "top-left" at the top left of what
 * the viewer can see, at every zoom and in both view modes.
 */

import type { LabelAnchor } from '@/types/schema'

export interface ScreenBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * How far the chip pulls back from its anchor point, as a fraction of its own
 * size. `-100%` puts its far edge on the point, `0%` its near edge. Percentages
 * rather than pixels so nothing has to measure the chip after it has rendered.
 */
const SELF_OFFSET: Record<LabelAnchor, { x: string; y: string }> = {
  'top-left':      { x: '-100%', y: '-100%' },
  'top-center':    { x: '-50%',  y: '-100%' },
  'top-right':     { x: '0%',    y: '-100%' },
  'middle-left':   { x: '-100%', y: '-50%'  },
  'center':        { x: '-50%',  y: '-50%'  },
  'middle-right':  { x: '0%',    y: '-50%'  },
  'bottom-left':   { x: '-100%', y: '0%'    },
  'bottom-center': { x: '-50%',  y: '0%'    },
  'bottom-right':  { x: '0%',    y: '0%'    },
}

/** The screen-space extent of a set of projected points. */
export function screenBox(points: Array<{ x: number; y: number }>): ScreenBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, maxX, minY, maxY }
}

/**
 * Where the chip's own origin goes, in CSS pixels.
 *
 * `center` is the one anchor that sits on the component, so it takes no gap.
 * The other eight are pushed clear of the edge they hang off, which is what
 * keeps the mesh, its icon and its colour unobscured.
 */
export function anchorPoint(
  box:    ScreenBox,
  anchor: LabelAnchor,
  gap:    number,
): { x: number; y: number } {
  const left   = anchor.endsWith('-left')
  const right  = anchor.endsWith('-right')
  const top    = anchor.startsWith('top-')
  const bottom = anchor.startsWith('bottom-')

  return {
    x: left ? box.minX - gap : right  ? box.maxX + gap : (box.minX + box.maxX) / 2,
    y: top  ? box.minY - gap : bottom ? box.maxY + gap : (box.minY + box.maxY) / 2,
  }
}

/** The finished `transform`, anchor point and self-offset together. */
export function anchorTransform(
  box:    ScreenBox,
  anchor: LabelAnchor,
  gap:    number,
): string {
  const { x, y } = anchorPoint(box, anchor, gap)
  const self = SELF_OFFSET[anchor]
  return `translate(calc(${x}px + ${self.x}), calc(${y}px + ${self.y}))`
}
