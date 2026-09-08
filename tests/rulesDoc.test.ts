/**
 * The rules doc is generated, so it can go stale the moment someone edits a
 * rule and forgets the script. This is the thing that notices.
 *
 * Lives outside src/ because it reads the filesystem, like flowCorpus.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { RULES } from '@/engine/geometryLint'
// @ts-expect-error — plain .mjs helper, shared with the generator script
import { renderRulesDoc } from '../scripts/rulesDoc.mjs'

const DOC = 'docs/flow-rules.md'

describe('docs/flow-rules.md', () => {
  it('matches the rule registry', () => {
    expect(existsSync(DOC)).toBe(true)
    expect(readFileSync(DOC, 'utf8')).toBe(renderRulesDoc(RULES))
  })

  it('documents every rule the linter can emit', () => {
    const doc = readFileSync(DOC, 'utf8')
    for (const rule of RULES) expect(doc).toContain(`\`${rule.id}\``)
  })

  it('gives every rule a reason, not just a restatement', () => {
    for (const rule of RULES) {
      expect(rule.requires.length, `${rule.id} requires`).toBeGreaterThan(10)
      expect(rule.because.length, `${rule.id} because`).toBeGreaterThan(10)
      expect(rule.because).not.toBe(rule.requires)
    }
  })
})
