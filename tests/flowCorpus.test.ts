/**
 * The reducer, run against every flow actually on this machine.
 *
 * Lives outside src/ because it reads the filesystem: the app compiles with
 * DOM types only, and node types don't belong in its tsconfig just for a test.
 *
 * The corpus is whatever is here — examples/ ships with the repo, custom/ is
 * git-ignored — so this also guards real flows that no other checkout has.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { applyActions, flowReducer } from '@/state/flowActions'
import type { FlowAction } from '@/state/flowActions'
import { componentGridPosition } from '@/state/gridUnits'
import { buildGraph } from '@/engine/parseFlow'
import type { FlowDefinition } from '@/types/schema'

/** Every path where two definitions differ, as dotted strings. The whole point
 *  of definition-first editing is that this stays tiny: one edit, one path. */
function changedPaths(a: unknown, b: unknown, path = ''): string[] {
  if (a === b) return []
  const bothObjects =
    typeof a === 'object' && typeof b === 'object' && a !== null && b !== null &&
    Array.isArray(a) === Array.isArray(b)
  if (!bothObjects) return [path || '(root)']
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
  return [...keys].flatMap((k) =>
    changedPaths(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      path ? `${path}.${k}` : k,
    ),
  )
}

function flowFiles(): string[] {
  return ['examples', 'custom'].flatMap((dir) => {
    const path = `public/flows/${dir}`
    if (!existsSync(path)) return []
    return readdirSync(path).filter((f) => f.endsWith('.json')).map((f) => `${path}/${f}`)
  })
}

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as FlowDefinition

describe('every flow on disk', () => {
  const files = flowFiles()

  it('has flows to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s: a commit with no actions changes nothing', (file) => {
    const def = read(file)
    expect(applyActions(def, [] as FlowAction[])).toBe(def)
  })

  it.each(files)('%s: moving one component touches only its position', (file) => {
    const def = read(file)
    const [id, ic] = [...buildGraph(def).components.entries()][0]
    const at = componentGridPosition(ic)
    const index = def.components.findIndex((c) => c.id === id)

    const out = flowReducer(def, {
      type: 'component/setPosition', scene: null, id, position: { col: at.col + 1, row: at.row },
    })
    expect(changedPaths(def, out)).toEqual([`components.${index}.position.col`])
  })
})
