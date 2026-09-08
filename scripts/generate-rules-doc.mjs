#!/usr/bin/env node
/**
 * Write `docs/flow-rules.md` from the lint registry.
 *
 *   node scripts/generate-rules-doc.mjs            # rewrite the file
 *   node scripts/generate-rules-doc.mjs --check    # fail if it is out of date
 *
 * The rules used to live as prose in the authoring guide and as code in the
 * linter, which is two copies of the same claim and one of them was wrong — §9.7
 * described a curve the renderer does not draw. Now the code is the only copy
 * and the doc is a build artefact, so the guide can't drift from what is
 * actually enforced.
 */

import { createServer } from 'vite'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { renderRulesDoc } from './rulesDoc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT  = join(REPO, 'docs', 'flow-rules.md')

const server = await createServer({
  root: REPO,
  configFile: join(REPO, 'vite.config.ts'),
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true },
})

let rendered
try {
  const { RULES } = await server.ssrLoadModule('/src/engine/geometryLint.ts')
  rendered = renderRulesDoc(RULES)
} finally {
  await server.close()
}

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== rendered) {
    console.error('docs/flow-rules.md is out of date — run: node scripts/generate-rules-doc.mjs')
    process.exit(1)
  }
  console.log('docs/flow-rules.md is up to date.')
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, rendered)
console.log(`Wrote ${OUT}`)
