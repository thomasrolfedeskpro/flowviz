#!/usr/bin/env node
/**
 * Validate a flow file against the FlowViz checkout's *own* schema.
 *
 * Why go through the repo rather than reimplementing the checks here: the schema
 * is TypeScript inside the repo and it changes. A copy living in this skill
 * would drift and start rejecting valid flows (or passing invalid ones) the
 * moment someone's checkout moves. So this writes a throwaway vitest file into
 * the repo, runs it with the repo's own vitest, and deletes it — the errors you
 * get back are the app's errors, whatever version is on disk.
 *
 *   node flowviz-validate.mjs /path/to/flowviz public/flows/my-flow.json
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, resolve, isAbsolute, join } from 'node:path'

const [repoArg, flowArg] = process.argv.slice(2)
if (!repoArg || !flowArg) {
  console.error('usage: flowviz-validate.mjs /path/to/flowviz public/flows/my-flow.json')
  process.exit(2)
}

const repo = resolve(repoArg)
const flowPath = isAbsolute(flowArg) ? flowArg : join(repo, flowArg)

for (const [label, path] of [['checkout', repo], ['flow file', flowPath]]) {
  if (!existsSync(path)) {
    console.error(`${label} not found: ${path}`)
    process.exit(2)
  }
}
if (!existsSync(join(repo, 'node_modules'))) {
  console.error('node_modules is missing — install dependencies first (pnpm install / npm install)')
  process.exit(2)
}

// Live under src/ so it is picked up whatever the vitest include pattern is, and
// name it obviously in case a crash ever leaves it behind.
const testDir = join(repo, 'src', '__generated__')
// Named per-process: several validations can be in flight at once (an agent
// per flow, say), and a shared filename means they overwrite each other's test
// and report someone else's errors.
const testFile = join(testDir, `flowviz-skill-validate.${process.pid}.test.mts`)

const testSource = `
// Temporary file written by the flowviz skill. Safe to delete.
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

it('flow is valid', async () => {
  const raw = JSON.parse(readFileSync(process.env.FLOWVIZ_FLOW!, 'utf8'))

  // Report every schema error at once when the checkout exposes the raw parser;
  // one error per run makes fixing a new flow tediously slow.
  try {
    const schema = await import('@/engine/flowSchema')
    if (typeof schema.parseFlowSchema === 'function') {
      const result = schema.parseFlowSchema(raw)
      if (!result.success) {
        throw new Error('Schema errors:\\n  - ' + result.errors.join('\\n  - '))
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Schema errors:')) throw err
    // No flowSchema module in this version — buildGraph below still validates.
  }

  // buildGraph is what the app calls on load: it validates and then lays the
  // whole thing out, so it catches structural problems the schema alone misses.
  const { buildGraph } = await import('@/engine/parseFlow')
  buildGraph(raw)
})
`.trimStart()

mkdirSync(testDir, { recursive: true })
writeFileSync(testFile, testSource)

// process.exit() skips finally blocks, so decide the code, clean up, then exit —
// otherwise a failed validation leaves a stray test file in the user's repo.
let exitCode = 0
try {
  const run = spawnSync(
    'npx',
    // No --reporter: the flag names changed across vitest majors and the default
    // output is fine once filtered below.
    ['vitest', 'run', `src/__generated__/${basename(testFile)}`],
    {
      cwd: repo,
      env: { ...process.env, FLOWVIZ_FLOW: flowPath, CI: '1' },
      encoding: 'utf8',
    },
  )

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`

  if (run.status === 0) {
    console.log(`VALID: ${flowPath}`)
    console.log('Schema and graph build both clean — it will load in the app.')
  } else {
    exitCode = 1
    console.log(`INVALID: ${flowPath}\n`)
    // Surface the assertion text rather than the whole vitest banner.
    const lines = output.split('\n')
    const start = lines.findIndex(l => /Error:|Schema errors:|AssertionError/.test(l))
    console.log((start >= 0 ? lines.slice(start, start + 40) : lines).join('\n').trim())
  }
} finally {
  try { unlinkSync(testFile) } catch { /* already gone */ }
  try { rmdirSync(testDir) } catch { /* not empty, or never created — leave it */ }
}

process.exit(exitCode)
