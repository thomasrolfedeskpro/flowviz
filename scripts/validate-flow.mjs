#!/usr/bin/env node
/**
 * Validate flow files against the app's own schema.
 *
 *   node scripts/validate-flow.mjs                       # every flow on disk
 *   node scripts/validate-flow.mjs public/flows/custom/x.json
 *   node scripts/validate-flow.mjs a.json b.json         # several at once
 *
 * The checks are the app's, not a copy of them: the schema and the graph
 * builder are loaded straight out of `src/` through Vite, so this can never
 * drift from what the browser accepts. Two passes, because they catch
 * different things:
 *
 *   parseFlowSchema  every schema and cross-reference error at once
 *   buildGraph       what the app actually runs on load, including the
 *                    geometry work the schema alone never exercises
 *
 * Runnable from any directory — the skill calls it from whatever repo you
 * happen to be working in — so paths resolve against your cwd, and the Vite
 * root is pinned to this checkout regardless.
 */

import { createServer } from 'vite'
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FLOWS = join(REPO, 'public', 'flows')
const args = process.argv.slice(2)

if (args.includes('-h') || args.includes('--help')) {
  console.log(`usage: validate-flow.mjs [--lint] [--strict] [flow.json ...]

  no paths   every flow under public/flows
  --lint     also report layout findings: overlaps, pipes sweeping through
             bystanders, zone spacing, wasted grid
  --strict   with --lint, exit non-zero on layout findings too. Off by default,
             because a finding is a judgement call, not a broken file.
  --tidy     re-lay each named flow left to right and write it back. Changes
             files: pass explicit paths, and have them committed first.`)
  process.exit(0)
}

const lint = args.includes('--lint')
const tidy = args.includes('--tidy')
const strict = args.includes('--strict')
const argv = args.filter((a) => !a.startsWith('--'))

/** Every .json one level deep under public/flows, as absolute paths. */
function allFlows() {
  if (!existsSync(FLOWS)) return []
  const out = []
  for (const entry of readdirSync(FLOWS, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) out.push(join(FLOWS, entry.name))
    else if (entry.isDirectory()) {
      for (const inner of readdirSync(join(FLOWS, entry.name), { withFileTypes: true })) {
        if (inner.isFile() && inner.name.endsWith('.json')) out.push(join(FLOWS, entry.name, inner.name))
      }
    }
  }
  return out.sort()
}

const targets = argv.length ? argv.map((a) => resolve(process.cwd(), a)) : allFlows()

if (targets.length === 0) {
  console.error('Nothing to validate: no paths given and no flows under public/flows.')
  process.exit(2)
}

for (const t of targets) {
  if (!existsSync(t) || !statSync(t).isFile()) {
    console.error(`Not a file: ${t}`)
    process.exit(2)
  }
}

// Relative paths in the Vite config (the flow manifest reads public/flows) are
// resolved against the cwd, so move there once the arguments are absolute.
process.chdir(REPO)

const server = await createServer({
  root: REPO,
  configFile: join(REPO, 'vite.config.ts'),
  logLevel: 'error',
  // No dev server is being served here: this is only a module loader.
  appType: 'custom',
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true },
})

let schemaMod, graphMod, lintMod, actionsMod
try {
  schemaMod = await server.ssrLoadModule('/src/engine/flowSchema.ts')
  graphMod  = await server.ssrLoadModule('/src/engine/parseFlow.ts')
  if (lint) lintMod = await server.ssrLoadModule('/src/engine/geometryLint.ts')
  if (tidy) actionsMod = await server.ssrLoadModule('/src/state/flowActions.ts')
} catch (err) {
  await server.close()
  console.error(`Could not load the app's validator from ${REPO}:\n${err}`)
  process.exit(2)
}

const label = (p) => relative(REPO, p) || p
let failed = 0
let warned = 0
let tidied = 0

for (const path of targets) {
  const errors = []
  let findings = []
  let parsed

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    errors.push(`Not valid JSON — ${err.message}`)
  }

  if (errors.length === 0 && tidy) {
    try {
      const before = JSON.stringify(parsed)
      parsed = actionsMod.flowReducer(parsed, { type: 'layout/tidy', scene: null })
      const after = JSON.stringify(parsed, null, 2) + '\n'
      if (before !== JSON.stringify(parsed)) {
        writeFileSync(path, after)
        tidied++
      }
    } catch (err) {
      errors.push(`Tidy failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (errors.length === 0) {
    const result = schemaMod.parseFlowSchema(parsed)
    if (!result.success) {
      errors.push(...result.errors)
    } else {
      // Only worth running once the shape is right; on a malformed flow it
      // would throw about something the schema has already explained better.
      try {
        graphMod.buildGraph(parsed)
      } catch (err) {
        errors.push(`Fails to build: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (lintMod && errors.length === 0) findings = lintMod.lintGeometry(parsed)
    }
  }

  if (errors.length) {
    failed++
    console.log(`FAIL  ${label(path)}`)
    for (const e of errors) console.log(`        ${e}`)
  } else if (findings.length) {
    warned++
    console.log(`warn  ${label(path)}`)
    for (const f of findings) console.log(`        ${lintMod.formatFinding(f)}`)
  } else {
    console.log(`ok    ${label(path)}`)
  }
}

await server.close()

const n = targets.length
const flows = n === 1 ? 'flow' : 'flows'
if (tidied) console.log(`\nRe-laid ${tidied} ${tidied === 1 ? 'flow' : 'flows'}.`)
if (failed) {
  console.log(`\n${failed} of ${n} ${flows} invalid${warned ? `, ${warned} with layout findings` : ''}.`)
} else if (warned) {
  console.log(`\n${n} ${flows} valid, ${warned} with layout findings.`)
} else {
  console.log(`\n${n} ${flows} valid.`)
}

// Layout findings are advisory unless asked otherwise: they describe a diagram
// that reads worse than intended, not a file that fails to load.
process.exit(failed || (strict && warned) ? 1 : 0)
