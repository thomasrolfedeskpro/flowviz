/**
 * The flow definition itself, as a file.
 *
 * Downloaded from the definition held in memory, so unsaved edit-mode changes
 * come with it. The text is byte-for-byte what **Save to file** puts on disk —
 * two-space indent, trailing newline — so a downloaded file can be dropped
 * into `public/flows/custom/` and loaded without a diff appearing the first
 * time it is saved again.
 */

import type { FlowDefinition } from '@/types/schema'

export function serializeFlow(def: FlowDefinition): string {
  return JSON.stringify(def, null, 2) + '\n'
}

export function flowJsonBlob(def: FlowDefinition): Blob {
  return new Blob([serializeFlow(def)], { type: 'application/json' })
}
