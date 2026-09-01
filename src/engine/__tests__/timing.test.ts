import { describe, it, expect } from 'vitest'
import { DEFAULT_TIMING, resolveTiming } from '@/engine/timing'
import { parseFlowSchema } from '@/engine/flowSchema'
import { flowReducer } from '@/state/flowActions'
import type { FlowDefinition } from '@/types/schema'

const flow = (): FlowDefinition => ({
  meta: { title: 'T' },
  layout: { grid: { cols: 4, rows: 4 } },
  zones: [],
  components: [{ id: 'a', label: 'A', type: 'client', position: { col: 0, row: 0 } }],
  connections: [],
  steps: [{ id: 0, title: 'One', highlight: [], active_connections: [] }],
})

describe('resolveTiming', () => {
  it('falls back to the defaults when a flow says nothing', () => {
    expect(resolveTiming(flow())).toEqual(DEFAULT_TIMING)
    expect(resolveTiming(null)).toEqual(DEFAULT_TIMING)
  })

  it('takes only the fields the flow sets', () => {
    const def = flow()
    def.meta.timing = { step: 5000 }
    expect(resolveTiming(def)).toEqual({ ...DEFAULT_TIMING, step: 5000 })
  })
})

describe('timing in the schema', () => {
  it('accepts a partial timing block', () => {
    const def = flow()
    def.meta.timing = { packet: 1200, stream: 800 }
    expect(parseFlowSchema(def).success).toBe(true)
  })

  it('rejects a zero or negative duration, which would read as a bug', () => {
    const def = flow()
    def.meta.timing = { step: 0 }
    const result = parseFlowSchema(def)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errors[0]).toMatch(/must be above zero/)
  })
})

describe('editing timing', () => {
  it('writes what the author set', () => {
    const out = flowReducer(flow(), { type: 'meta/patch', patch: { timing: { step: 4500 } } })
    expect(out.meta.timing).toEqual({ step: 4500 })
  })

  it('does not give a flow an opinion about pace it never had', () => {
    const out = flowReducer(flow(), { type: 'meta/patch', patch: { timing: {} } })
    expect('timing' in out.meta).toBe(false)
  })
})

describe('step camera semantics', () => {
  // The renderer only acts on a named focus; these encode why, so the rule
  // survives the next person who wonders what focus: null is for.
  const moves = (camera: unknown) => Boolean((camera as { focus?: string | null })?.focus)

  it('moves for a named component', () => {
    expect(moves({ focus: 'api', zoom: 1.4 })).toBe(true)
  })

  it('leaves the view alone for focus: null — half the steps in the flows say that', () => {
    expect(moves({ focus: null })).toBe(false)
  })

  it('leaves the view alone when there is no camera at all', () => {
    expect(moves(undefined)).toBe(false)
  })

  it('does nothing for a zoom with nothing to zoom in on', () => {
    expect(moves({ zoom: 2 })).toBe(false)
  })
})
