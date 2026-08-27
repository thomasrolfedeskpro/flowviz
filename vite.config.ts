import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import type { ViteDevServer } from 'vite'

// Exposes `virtual:flows` — every flow under public/flows with its title and the
// path to fetch it from. Flows live in subdirectories: `examples/` ships with the
// repo, `custom/` is git-ignored for personal and product-specific flows.
// ponytail: read at module-load, so a newly added flow needs a dev-server restart.
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
      flows.sort((a, b) => a.title.localeCompare(b.title))
      return `export const flows = ${JSON.stringify(flows)}`
    },

    // DELETE /api/flows/<id> removes public/flows/<id>.json. Dev server only —
    // authoring happens locally, and a built static site has nobody to serve it.
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/flows', (req, res, next) => {
        if (req.method !== 'DELETE') return next()

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

        try {
          rmSync(`${FLOW_ROOT}/${match}`)
        } catch (err) {
          res.statusCode = 500
          return res.end(JSON.stringify({ error: String(err) }))
        }

        // Drop the cached manifest so a reload sees the shorter list.
        const mod = server.moduleGraph.getModuleById(resolvedId)
        if (mod) server.moduleGraph.invalidateModule(mod)

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
