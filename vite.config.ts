import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { ViteDevServer } from 'vite'
// The app's own validator, so a save can never write a flow the app can't load.
// Only a type import reaches for the `@` alias, and those are erased at build.
import { parseFlowSchema } from './src/engine/flowSchema'

// Exposes `virtual:flows` — every flow under public/flows with its title and the
// path to fetch it from. Flows live in subdirectories: `examples/` ships with the
// repo, `custom/` is git-ignored for personal and product-specific flows.
// Read at module-load, so a newly added flow needs a dev-server restart.
const FLOW_ROOT = 'public/flows'

/** Every .json under public/flows, one level of subdirectory deep, as paths
 *  relative to public/flows (e.g. "examples/oauth.json"). */
function listFlowFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(FLOW_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(entry.name)
    } else if (entry.isDirectory()) {
      for (const inner of readdirSync(`${FLOW_ROOT}/${entry.name}`, { withFileTypes: true })) {
        if (inner.isFile() && inner.name.endsWith('.json')) out.push(`${entry.name}/${inner.name}`)
      }
    }
  }
  return out
}

function flowManifest() {
  const virtualId = 'virtual:flows'
  const resolvedId = '\0' + virtualId
  return {
    name: 'flow-manifest',
    resolveId(id: string) {
      return id === virtualId ? resolvedId : null
    },
    load(id: string) {
      if (id !== resolvedId) return null
      const flows = listFlowFiles().map((rel) => {
        const json = JSON.parse(readFileSync(`${FLOW_ROOT}/${rel}`, 'utf8')) as {
          meta?: { title?: string; description?: string }
        }
        const slug = rel.replace(/\.json$/, '').split('/').pop() as string
        return {
          // The id stays the bare filename so `?flow=oauth` keeps working
          // wherever the file sits; `path` is how the app fetches it.
          id: slug,
          path: rel,
          group: rel.includes('/') ? (rel.split('/')[0] as string) : '',
          title: json.meta?.title ?? slug,
          description: json.meta?.description ?? '',
        }
      })
      // Bundled examples first, then everything else, each alphabetical. The
      // sidebar draws a rule at the boundary, so the order has to be stable
      // rather than incidental.
      const rank = (group: string) => (group === 'examples' ? 0 : 1)
      flows.sort((a, b) => rank(a.group) - rank(b.group) || a.title.localeCompare(b.title))
      return `export const flows = ${JSON.stringify(flows)}`
    },

    // DELETE and PUT /api/flows/<id> remove or overwrite a flow file. Dev server
    // only — authoring happens locally, and a built static site has nobody to
    // serve it.
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/flows', (req, res, next) => {
        if (req.method !== 'DELETE' && req.method !== 'PUT') return next()

        const id = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        res.setHeader('Content-Type', 'application/json')

        // Only bare slugs: no dots, no slashes, so the id can't escape the folder.
        // The subdirectory is resolved here rather than sent by the client, which
        // keeps path traversal impossible by construction.
        if (!/^[A-Za-z0-9_-]+$/.test(id)) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: `Invalid flow id: ${id}` }))
        }

        const match = listFlowFiles().find((rel) => rel.split('/').pop() === `${id}.json`)
        if (!match) {
          res.statusCode = 404
          return res.end(JSON.stringify({ error: `No such flow: ${id}` }))
        }

        const invalidateManifest = () => {
          const mod = server.moduleGraph.getModuleById(resolvedId)
          if (mod) server.moduleGraph.invalidateModule(mod)
        }

        if (req.method === 'PUT') {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', () => {
            let parsed: unknown
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch (err) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: `Body is not JSON: ${String(err)}` }))
            }

            // Validate before writing. An edit-mode bug that produced a broken
            // flow would otherwise overwrite a good file with an unloadable one.
            const result = parseFlowSchema(parsed)
            if (!result.success) {
              res.statusCode = 422
              return res.end(JSON.stringify({ error: 'Invalid flow', errors: result.errors }))
            }

            try {
              writeFileSync(`${FLOW_ROOT}/${match}`, JSON.stringify(parsed, null, 2) + '\n')
            } catch (err) {
              res.statusCode = 500
              return res.end(JSON.stringify({ error: String(err) }))
            }

            invalidateManifest()
            res.statusCode = 200
            res.end(JSON.stringify({ saved: `${FLOW_ROOT}/${match}` }))
          })
          return
        }

        // examples/ is committed reference material shared by everyone. Deleting
        // one is almost always a misclick, and the UI hides the button — this is
        // the check that actually holds, including for a stray curl. Saving is
        // allowed: a bad save is one `git checkout` away, a delete is not.
        if (match.startsWith('examples/')) {
          res.statusCode = 403
          return res.end(JSON.stringify({
            error: `"${id}" is a bundled example and cannot be deleted. `
              + `Only flows in public/flows/custom/ can be removed.`,
          }))
        }

        try {
          rmSync(`${FLOW_ROOT}/${match}`)
        } catch (err) {
          res.statusCode = 500
          return res.end(JSON.stringify({ error: String(err) }))
        }

        invalidateManifest()
        res.statusCode = 200
        return res.end(JSON.stringify({ deleted: id }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), flowManifest()],
  resolve: {
    alias: { '@': '/src' }
  },
  server: {
    allowedHosts: ['.ngrok-free.app'],
    port: 5175
  },
  preview: {
    allowedHosts: ['.ngrok-free.app']
  }
})
