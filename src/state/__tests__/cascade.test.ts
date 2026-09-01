/**
 * Deleting is the one edit that reaches further than the thing you clicked, so
 * these check both halves: what the prompt promises, and what the actions do.
 */
import { describe, it, expect } from 'vitest'
import { planDelete } from '@/state/cascade'
import { applyActions } from '@/state/flowActions'
import { validateFlow } from '@/engine/parseFlow'
import type { FlowDefinition } from '@/types/schema'

function flow(): FlowDefinition {
  return {
    meta: { title: 'Cascade' },
    layout: { grid: { cols: 12, rows: 8 } },
    zones: [
      { id: 'z_outer', label: 'Outer', color: '#3b82f6', bounds: { col: 0, row: 0, width: 8, height: 6 } },
      { id: 'z_inner', label: 'Inner', color: '#22c55e', parentId: 'z_outer', bounds: { col: 1, row: 1, width: 3, height: 2 } },
    ],
    components: [
      { id: 'web', label: 'Web',  type: 'client',  position: { col: 1, row: 1 } },
      { id: 'api', label: 'API',  type: 'service', position: { col: 4, row: 1 } },
      { id: 'db',  label: 'DB',   type: 'database', position: { col: 7, row: 1 } },
    ],
    connections: [
      { id: 'c_web_api', from: 'web', to: 'api', label: 'POST', route: 'auto' },
      { id: 'c_api_db',  from: 'api', to: 'db',  route: 'auto' },
    ],
    steps: [
      { id: 0, title: 'Overview', highlight: [], active_connections: [] },
      {
        id: 1, title: 'Request', name: 'Request arrives',
        highlight: ['web', 'api'],
        active_connections: ['c_web_api'],
        packet: { connection: 'c_web_api', shape: 'document' },
        annotations: [{ type: 'callout', target: 'web', text: 'starts here' }],
        camera: { focus: 'web' },
      },
      {
        id: 2, title: 'Query',
        highlight: ['db'],
        active_connections: ['c_api_db'],
        packets: [{ connection: 'c_api_db', shape: 'sphere' }],
        streams: [{ connection: 'c_api_db' }],
      },
    ],
  }
}

describe('planDelete — component', () => {
  it('lists the pipes and the steps that would change', () => {
    const plan = planDelete(flow(), null, 'component', 'web')
    expect(plan.blocked).toBeUndefined()
    expect(plan.referrers).toEqual([
      { where: 'Connection “POST”', what: 'starts here' },
      {
        where: 'Step 1 — Request arrives',
        what: 'highlights it, lights the connection, sends a packet down it, annotates it, focuses the camera on it',
      },
    ])
  })

  it('leaves a flow that still validates', () => {
    const def = flow()
    const out = applyActions(def, planDelete(def, null, 'component', 'web').actions)

    expect(out.components.map((c) => c.id)).toEqual(['api', 'db'])
    expect(out.connections.map((c) => c.id)).toEqual(['c_api_db'])
    expect(out.steps[1].highlight).toEqual(['api'])
    expect(out.steps[1].active_connections).toEqual([])
    expect('packet' in out.steps[1]).toBe(false)
    expect('packets' in out.steps[1]).toBe(false)
    expect('annotations' in out.steps[1]).toBe(false)
    expect('camera' in out.steps[1]).toBe(false)
    expect(() => validateFlow(out)).not.toThrow()
  })

  it('keeps a camera that still has a zoom, dropping only the focus', () => {
    const def = flow()
    def.steps[1].camera = { focus: 'web', zoom: 1.4 }
    const out = applyActions(def, planDelete(def, null, 'component', 'web').actions)
    expect(out.steps[1].camera).toEqual({ focus: null, zoom: 1.4 })
  })

  it('refuses to delete a component that owns a nested scene', () => {
    const def = flow()
    def.components[1].detail = { grid: { cols: 4, rows: 4 }, components: [], connections: [] }
    const plan = planDelete(def, null, 'component', 'api')
    expect(plan.blocked).toMatch(/nested scene/)
    expect(plan.actions).toEqual([])
  })
})

describe('planDelete — connection', () => {
  it('strips it from every step that used it', () => {
    const def = flow()
    const plan = planDelete(def, null, 'connection', 'c_api_db')
    expect(plan.referrers).toEqual([
      { where: 'Step 2 — Query', what: 'lights the connection, sends a packet down it, streams over it' },
    ])

    const out = applyActions(def, plan.actions)
    expect(out.connections.map((c) => c.id)).toEqual(['c_web_api'])
    expect(out.steps[2].active_connections).toEqual([])
    expect('packets' in out.steps[2]).toBe(false)
    expect('streams' in out.steps[2]).toBe(false)
    // The component it pointed at stays: only the pipe was deleted.
    expect(out.components.map((c) => c.id)).toContain('db')
    expect(() => validateFlow(out)).not.toThrow()
  })
})

describe('planDelete — zone', () => {
  it('reports the zones nested inside it and re-parents them', () => {
    const def = flow()
    const plan = planDelete(def, null, 'zone', 'z_outer')
    expect(plan.referrers).toEqual([{ where: 'Zone “Inner”', what: 'sits inside it' }])

    const out = applyActions(def, plan.actions)
    expect(out.zones.map((z) => z.id)).toEqual(['z_inner'])
    expect('parentId' in out.zones[0]).toBe(false)
    expect(() => validateFlow(out)).not.toThrow()
  })

  it('says so when nothing else is affected', () => {
    const plan = planDelete(flow(), null, 'zone', 'z_inner')
    expect(plan.referrers).toEqual([])
  })
})
