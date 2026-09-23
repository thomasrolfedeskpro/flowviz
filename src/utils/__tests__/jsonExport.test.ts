/**
 * A downloaded flow is meant to be droppable into public/flows/custom/ and
 * loaded, so it has to come out in the same shape the dev server's save
 * endpoint writes — two-space indent, trailing newline, key order untouched.
 * Anything else shows up as a diff the first time the file is saved again.
 */

import { describe, it, expect } from 'vitest'
import { serializeFlow } from '@/utils/jsonExport'
import { validateFlow } from '@/engine/parseFlow'
import type { FlowDefinition } from '@/types/schema'

function flow(): FlowDefinition {
  return {
    meta: { title: 'Coffee — order to cup', description: 'Two steps and a pipe.' },
    layout: { grid: { cols: 12, rows: 6 } },
    zones: [{ id: 'shop', label: 'Shop', color: '#4a90d9', bounds: { col: 0, row: 0, width: 6, height: 4 } }],
    components: [
      { id: 'till',    label: 'Till',    type: 'service',  position: { col: 1, row: 1 } },
      { id: 'barista', label: 'Barista', type: 'service',  position: { col: 4, row: 1 } },
    ],
    connections: [{ id: 'order', from: 'till', to: 'barista', route: 'auto' }],
    steps: [
      {
        id: 0, title: 'Order taken', description: 'The till sends the order.',
        highlight: ['till'], active_connections: ['order'],
      },
    ],
  }
}

describe('serializeFlow', () => {
  it('formats exactly as the save endpoint writes the file', () => {
    const def = flow()
    // What vite.config.ts's PUT handler puts on disk, from the same definition.
    expect(serializeFlow(def)).toBe(JSON.stringify(def, null, 2) + '\n')
  })

  it('indents with two spaces and ends with one newline', () => {
    const text = serializeFlow(flow())
    expect(text.split('\n')[1]).toMatch(/^ {2}"meta": \{$/)
    expect(text.endsWith('}\n')).toBe(true)
  })

  it('keeps key order, so a save after a download is not a diff', () => {
    const text = serializeFlow(flow())
    const keys = Object.keys(JSON.parse(text) as object)
    expect(keys).toEqual(['meta', 'layout', 'zones', 'components', 'connections', 'steps'])
  })

  it('produces a file the app can load back', () => {
    const def = flow()
    expect(validateFlow(JSON.parse(serializeFlow(def)))).toEqual(def)
  })
})
