import type { Step } from '@/types/schema'

interface Lane {
  offsetPct: number
  widthPct:  number
}

/**
 * Place each step's bar on one shared axis. `start` is honoured when given;
 * otherwise a bar begins where the previous one ended, so a flow that only
 * supplies weights still reads as a sequential cascade.
 */
export function waterfallLanes(steps: Step[]): { span: number; byStep: Record<number, Lane | undefined> } {
  const placed: Array<{ index: number; start: number; weight: number }> = []
  let cursor = 0
  steps.forEach((step, index) => {
    const bar = step.waterfall
    if (!bar) return
    const start = bar.start ?? cursor
    placed.push({ index, start, weight: bar.weight })
    cursor = start + bar.weight
  })

  const span = placed.reduce((max, p) => Math.max(max, p.start + p.weight), 0)
  const byStep: Record<number, Lane | undefined> = {}
  if (span <= 0) return { span: 0, byStep }

  for (const p of placed) {
    const offsetPct = (p.start / span) * 100
    // keep hairline bars visible without letting them overflow the track
    const widthPct = Math.min(100 - offsetPct, Math.max(1.5, (p.weight / span) * 100))
    byStep[p.index] = { offsetPct, widthPct }
  }
  return { span, byStep }
}
