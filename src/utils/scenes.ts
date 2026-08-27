import type { Component, FlowDefinition } from '@/types/schema'
import type { InternalGraph } from '@/types/internal'

export interface SceneInfo {
  /** Component id that owns this scene. */
  id: string
  /** That component's label, for breadcrumbs. */
  label: string
  /** 1 for a scene inside the top level, 2 for one inside that, and so on. */
  depth: number
  /** Labels from the top level down to and including this scene. */
  path: string[]
}

/**
 * Flatten every nested scene in a flow, keyed by the id of the component whose
 * `detail` it is. Used for breadcrumbs and for indenting the step list — both
 * need to know where a scene sits in the tree, which the flat step list doesn't
 * say on its own.
 */
export function sceneIndex(def: Pick<FlowDefinition, 'components'>): Map<string, SceneInfo> {
  const out = new Map<string, SceneInfo>()

  const walk = (components: Component[], depth: number, path: string[]) => {
    for (const c of components) {
      if (!c.detail) continue
      const nextPath = [...path, c.label]
      out.set(c.id, { id: c.id, label: c.label, depth, path: nextPath })
      walk(c.detail.components, depth + 1, nextPath)
    }
  }

  walk(def.components, 1, [])
  return out
}

/** The graph for a scene id, searched depth-first. `undefined` id = the root. */
export function findSceneGraph(root: InternalGraph, sceneId: string | null | undefined): InternalGraph {
  if (!sceneId) return root
  const seen = new Set<InternalGraph>()
  const search = (graph: InternalGraph): InternalGraph | null => {
    if (seen.has(graph)) return null
    seen.add(graph)
    const direct = graph.scenes.get(sceneId)
    if (direct) return direct
    for (const child of graph.scenes.values()) {
      const hit = search(child)
      if (hit) return hit
    }
    return null
  }
  return search(root) ?? root
}
