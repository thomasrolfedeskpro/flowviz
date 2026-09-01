import type { Component, Connection, FlowDefinition, Zone } from '@/types/schema'
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

/** One scene's contents as the file stores them — the root, or any `detail`. */
export interface SceneContents {
  grid:        { cols: number; rows: number }
  zones?:      Zone[]
  components:  Component[]
  connections: Connection[]
}

/** The scene a given id names, or null if nothing owns it. `null` id = the root. */
export function sceneOf(def: FlowDefinition, sceneId: string | null | undefined): SceneContents | null {
  if (!sceneId) {
    return {
      grid:        def.layout.grid,
      zones:       def.zones,
      components:  def.components,
      connections: def.connections,
    }
  }
  const find = (components: Component[]): Component | null => {
    for (const c of components) {
      if (c.id === sceneId) return c
      const hit = c.detail ? find(c.detail.components) : null
      if (hit) return hit
    }
    return null
  }
  const detail = find(def.components)?.detail
  return detail ?? null
}

export interface SceneChoices {
  components:  Array<{ id: string; label: string }>
  connections: Array<{ id: string; label: string }>
}

/**
 * What a step in this scene is allowed to reference.
 *
 * Read from the definition rather than the built graph: only one scene's meshes
 * exist on screen at a time, but the editor has to offer the contents of
 * whichever scene the step being edited belongs to.
 */
export function sceneChoices(def: FlowDefinition, sceneId: string | null | undefined): SceneChoices {
  const scene = sceneOf(def, sceneId)
  if (!scene) return { components: [], connections: [] }

  return {
    components: scene.components.map((c) => ({ id: c.id, label: c.label })),
    // A pipe's label is optional, so fall back to something a human can pick from.
    connections: scene.connections.map((c) => ({
      id:    c.id,
      label: c.label ? `${c.label} (${c.from} → ${c.to})` : `${c.from} → ${c.to}`,
    })),
  }
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
