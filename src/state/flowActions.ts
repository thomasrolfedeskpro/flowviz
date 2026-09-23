import { tidyScene } from '@/engine/autoLayout'
import type {
  Component,
  ComponentShape,
  ComponentType,
  Connection,
  FlowDefinition,
  FlowMeta,
  SceneDetail,
  Step,
  Zone,
} from '@/types/schema'

/**
 * Every edit to a flow, as data.
 *
 * The flow definition is the source of truth: the scene mutates its own graph
 * during a gesture so dragging stays at frame rate, then commits one action
 * here on pointerup. Saving is then `JSON.stringify(def)` — no reconstruction
 * from the live scene, so a field this file has never heard of survives a save
 * untouched, and saving a flow nobody edited rewrites nothing.
 *
 * Actions carry values already in JSON units (grid cells), not world units.
 * `gridUnits.ts` owns that conversion, so it happens once, at the commit.
 */

/** null = the top-level scene; otherwise the id of the component owning the
 *  `detail` scene the edit happened in. Same addressing the schema uses. */
export type SceneId = string | null

export interface ComponentPatch {
  label?:     string
  type?:      ComponentType
  size?:      { w: number; h: number }
  icon?:      string
  logo?:      string
  color?:     string
  shape?:     ComponentShape
  meta?:      Component['meta']
  /** Always-visible name. An explicit `undefined` takes it off again. */
  pinnedLabel?: Component['pinnedLabel']
  /** Height off the ground, in cells. Lives inside `position` in the file. */
  elevation?: number
}

export interface ZonePatch {
  label?:    string
  color?:    string
  outline?:  'solid' | 'dashed'
  parentId?: string
  meta?:     Zone['meta']
  bounds?:   Zone['bounds']
}

export interface ConnectionPatch {
  label?: string
  from?:  string
  to?:    string
  color?: string
}

export type FlowAction =
  | { type: 'component/setPosition'; scene: SceneId; id: string; position: { col: number; row: number } }
  | { type: 'component/patch';       scene: SceneId; id: string; patch: ComponentPatch }
  | { type: 'component/add';         scene: SceneId; component: Omit<Component, 'id'>; id?: string }
  | { type: 'component/remove';      scene: SceneId; id: string }
  // Wholesale replacements, for the JSON hatch: a patch merges, so it could
  // never remove a key that the edited text dropped.
  | { type: 'component/replace';     scene: SceneId; id: string; component: Component }
  | { type: 'zone/replace';          scene: SceneId; id: string; zone: Zone }
  | { type: 'connection/replace';    scene: SceneId; id: string; connection: Connection }
  | { type: 'step/replace';          index: number; step: Step }
  | { type: 'zone/add';              scene: SceneId; zone: Omit<Zone, 'id'>; id?: string }
  | { type: 'zone/remove';           scene: SceneId; id: string }
  | { type: 'connection/add';        scene: SceneId; connection: Omit<Connection, 'id'>; id?: string }
  | { type: 'connection/remove';     scene: SceneId; id: string }
  | { type: 'zone/setBounds';        scene: SceneId; id: string; bounds: Zone['bounds'] }
  | { type: 'zone/patch';            scene: SceneId; id: string; patch: ZonePatch }
  | { type: 'connection/patch';      scene: SceneId; id: string; patch: ConnectionPatch }
  | { type: 'meta/patch';            patch: Partial<FlowMeta> }
  | { type: 'zone/setLabel';         scene: SceneId; id: string; label: string }
  | { type: 'connection/setLabel';   scene: SceneId; id: string; label: string }
  | { type: 'connection/setRoute';   scene: SceneId; id: string; route: Connection['route'] }
  | { type: 'layout/setGrid';        scene: SceneId; grid: { cols: number; rows: number } }
  // Re-lay one scene. One action, so it is one undo.
  | { type: 'layout/tidy';           scene: SceneId }
  // Steps live at the root whatever scene they play in, so they need no address.
  | { type: 'step/patch';   index: number; patch: StepPatch }
  | { type: 'step/insert';  index: number; step: Omit<Step, 'id'> }
  | { type: 'step/remove';  index: number }
  | { type: 'step/reorder'; from: number; to: number }

/** A partial step, where an explicit `undefined` removes the field. That's how
 *  the editor clears an optional thing — a footer, a packet — rather than
 *  writing `"footer": null` and leaving the renderer to interpret it. */
export type StepPatch = { [K in keyof Step]?: Step[K] | undefined }

/** One scene's editable contents, whether it's the root or a nested `detail`.
 *  The two have different shapes in the file; this is the shape edits see. */
interface SceneSlice {
  grid:        { cols: number; rows: number }
  zones?:      Zone[]
  components:  Component[]
  connections: Connection[]
}

/** Replace one item by id, leaving the array alone if it isn't there. */
function patchById<T extends { id: string }>(list: T[], id: string, fn: (item: T) => T): T[] {
  const i = list.findIndex((x) => x.id === id)
  if (i === -1) return list
  const next = list.slice()
  next[i] = fn(list[i])
  return next
}

/** An action that resolved to no change returns the definition it was given,
 *  rather than an equal copy — so "nothing happened" stays observable. */
function unchanged(before: SceneSlice, after: SceneSlice): boolean {
  return (
    before.grid === after.grid &&
    before.zones === after.zones &&
    before.components === after.components &&
    before.connections === after.connections
  )
}

function writeDetail(detail: SceneDetail, slice: SceneSlice): SceneDetail {
  // Spread first so untouched keys keep their original order in the file, and
  // `zones` is only written back if the scene had one — adding an empty array
  // to a scene that never declared zones is a diff for nothing.
  const next: SceneDetail = {
    ...detail,
    grid:        slice.grid,
    components:  slice.components,
    connections: slice.connections,
  }
  if (slice.zones) next.zones = slice.zones
  return next
}

/** Apply `fn` to the components of nested scenes, finding `sceneId` at any depth.
 *  Returns the original array unchanged when the scene isn't in this subtree. */
function mapNestedScene(
  components: Component[],
  sceneId: string,
  fn: (slice: SceneSlice) => SceneSlice,
): Component[] {
  let changed = false
  const next = components.map((comp) => {
    if (!comp.detail) return comp

    if (comp.id === sceneId) {
      const current = {
        grid:        comp.detail.grid,
        zones:       comp.detail.zones,
        components:  comp.detail.components,
        connections: comp.detail.connections,
      }
      const slice = fn(current)
      if (unchanged(current, slice)) return comp
      changed = true
      return { ...comp, detail: writeDetail(comp.detail, slice) }
    }

    const inner = mapNestedScene(comp.detail.components, sceneId, fn)
    if (inner === comp.detail.components) return comp
    changed = true
    return { ...comp, detail: { ...comp.detail, components: inner } }
  })
  return changed ? next : components
}

/** Apply `fn` to whichever scene the edit happened in. */
function mapScene(
  def: FlowDefinition,
  sceneId: SceneId,
  fn: (slice: SceneSlice) => SceneSlice,
): FlowDefinition {
  if (sceneId === null) {
    const current = {
      grid:        def.layout.grid,
      zones:       def.zones,
      components:  def.components,
      connections: def.connections,
    }
    const slice = fn(current)
    if (unchanged(current, slice)) return def
    return {
      ...def,
      layout:      { ...def.layout, grid: slice.grid },
      zones:       slice.zones ?? def.zones,
      components:  slice.components,
      connections: slice.connections,
    }
  }

  const components = mapNestedScene(def.components, sceneId, fn)
  return components === def.components ? def : { ...def, components }
}

/**
 * Fields left at their default are dropped rather than written out.
 *
 * Not cosmetic: without it, opening a component's editor and pressing nothing
 * would still stamp `"shape": "cuboid"` and `"size": {"w":1,"h":1}` onto every
 * component it touched, and a hand-authored flow would grow on every save.
 */
function pruneDefaults(next: Component, original: Component): Component {
  const out = { ...next }
  if (!out.icon) delete out.icon
  if (!out.color) delete out.color
  if (!out.shape || out.shape === 'cuboid') delete out.shape
  if (!original.size && out.size && out.size.w === 1 && out.size.h === 1) delete out.size
  if (!out.logo) delete out.logo
  if (out.meta && !Object.values(out.meta).some((v) => v !== undefined && v !== '')) delete out.meta
  // `{}` is a valid pinned label — it means "use the component's own name" —
  // so only an absent one is dropped, and an empty text falls back to that.
  if (!out.pinnedLabel) delete out.pinnedLabel
  else if (!out.pinnedLabel.text) {
    const pin = { ...out.pinnedLabel }
    delete pin.text
    out.pinnedLabel = pin
  }
  return out
}

/** Every id in the flow, from every scene. The schema requires them unique
 *  across the whole file, not just within a scene. */
export function allIds(def: FlowDefinition): Set<string> {
  const ids = new Set<string>()
  const walk = (scene: { zones?: Zone[]; components: Component[]; connections: Connection[] }) => {
    for (const z of scene.zones ?? []) ids.add(z.id)
    for (const c of scene.connections) ids.add(c.id)
    for (const c of scene.components) {
      ids.add(c.id)
      if (c.detail) walk(c.detail)
    }
  }
  walk(def)
  return ids
}

/** `prefix_1`, `prefix_2`, … skipping anything already taken. Exported because
 *  the caller often needs the id it is about to create — to open its editor. */
export function nextId(def: FlowDefinition, prefix: string): string {
  const taken = allIds(def)
  let n = 1
  while (taken.has(`${prefix}_${n}`)) n++
  return `${prefix}_${n}`
}

export function flowReducer(def: FlowDefinition, action: FlowAction): FlowDefinition {
  switch (action.type) {
    case 'layout/tidy':
      return mapScene(def, action.scene, (s) => {
        const tidied = tidyScene({
          grid: s.grid,
          zones: s.zones ?? [],
          components: s.components,
          connections: s.connections,
        })
        return {
          ...s,
          grid: tidied.grid,
          zones: s.zones ? tidied.zones : s.zones,
          components: tidied.components,
        }
      })

    case 'component/setPosition':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        components: patchById(s.components, action.id, (c) => ({
          // Spread the old position so `elevation` survives a drag.
          ...c,
          position: { ...c.position, ...action.position },
        })),
      }))

    case 'component/patch':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        components: patchById(s.components, action.id, (c) => {
          const { elevation, ...fields } = action.patch
          const next: Component = { ...c, ...fields }
          // Elevation is a field of `position` in the file but a field of its
          // own in the form; zero is the floor, which is what omitting it means.
          if ('elevation' in action.patch) {
            const position = { ...c.position, elevation }
            // Zero is the floor, which is what leaving the field out means.
            if (!elevation) delete position.elevation
            next.position = position
          }
          return pruneDefaults(next, c)
        }),
      }))

    case 'component/add': {
      const id = action.id ?? nextId(def, 'comp')
      return mapScene(def, action.scene, (s) => ({
        ...s,
        components: [...s.components, { id, ...action.component }],
      }))
    }

    case 'component/replace':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        components: patchById(s.components, action.id, () => action.component),
      }))

    case 'zone/replace':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        zones: s.zones && patchById(s.zones, action.id, () => action.zone),
      }))

    case 'connection/replace':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        connections: patchById(s.connections, action.id, () => action.connection),
      }))

    case 'step/replace': {
      if (!def.steps[action.index]) return def
      const steps = def.steps.slice()
      steps[action.index] = action.step
      return { ...def, steps }
    }

    case 'component/remove':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        components: s.components.filter((c) => c.id !== action.id),
      }))

    case 'zone/add': {
      const id = action.id ?? nextId(def, 'zone')
      return mapScene(def, action.scene, (s) => ({
        ...s,
        // A scene with no zones has no `zones` key; adding one creates it.
        zones: [...(s.zones ?? []), { id, ...action.zone }],
      }))
    }

    case 'zone/remove':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        zones: s.zones && s.zones
          .filter((z) => z.id !== action.id)
          // A zone nested in the one being deleted comes back up a level rather
          // than pointing at something that no longer exists.
          .map((z) => {
            if (z.parentId !== action.id) return z
            const next = { ...z }
            delete next.parentId
            return next
          }),
      }))

    case 'connection/add': {
      const id = action.id ?? nextId(def, 'conn')
      return mapScene(def, action.scene, (s) => ({
        ...s,
        connections: [...s.connections, { id, ...action.connection }],
      }))
    }

    case 'connection/remove':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        connections: s.connections.filter((c) => c.id !== action.id),
      }))

    case 'zone/setBounds':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        zones: s.zones && patchById(s.zones, action.id, (z) => ({ ...z, bounds: action.bounds })),
      }))

    case 'zone/patch':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        zones: s.zones && patchById(s.zones, action.id, (z) => {
          const next: Zone = { ...z, ...action.patch }
          if (!next.parentId) delete next.parentId
          if (!next.outline || next.outline === 'solid') delete next.outline
          if (next.meta && !next.meta.description && !next.meta.notes) delete next.meta
          return next
        }),
      }))

    case 'connection/patch':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        connections: patchById(s.connections, action.id, (c) => {
          const next: Connection = { ...c, ...action.patch }
          if (!next.label) delete next.label
          if (!next.color) delete next.color
          return next
        }),
      }))

    case 'meta/patch': {
      const meta = { ...def.meta, ...action.patch }
      if (!meta.description) delete meta.description
      if (!meta.waterfallLabel) delete meta.waterfallLabel
      // Timing left entirely at the defaults is not written out: a flow that
      // never expressed an opinion about pace shouldn't gain one on save.
      if (meta.timing && !Object.values(meta.timing).some((v) => v !== undefined)) delete meta.timing
      return { ...def, meta }
    }

    case 'zone/setLabel':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        zones: s.zones && patchById(s.zones, action.id, (z) => ({ ...z, label: action.label })),
      }))

    case 'connection/setLabel':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        connections: patchById(s.connections, action.id, (c) => ({ ...c, label: action.label })),
      }))

    case 'connection/setRoute':
      return mapScene(def, action.scene, (s) => ({
        ...s,
        connections: patchById(s.connections, action.id, (c) => ({
          // Copied, not referenced: the scene mutates its own route array in
          // place as you drag a waypoint, and sharing it would let the next
          // drag silently rewrite what was already committed.
          ...c,
          route: action.route === 'auto' ? 'auto' : action.route.map((wp) => ({ ...wp })),
        })),
      }))

    case 'step/patch': {
      const step = def.steps[action.index]
      if (!step) return def
      const next = { ...step, ...action.patch }
      // `{...a, ...b}` writes the key with `undefined` rather than dropping it,
      // which would put `"packet": undefined` through JSON.stringify as nothing
      // at all in some places and `null` in others. Drop it properly.
      for (const key of Object.keys(action.patch) as (keyof Step)[]) {
        if (action.patch[key] === undefined) delete next[key]
      }
      const steps = def.steps.slice()
      steps[action.index] = next
      return { ...def, steps }
    }

    case 'step/insert': {
      // Ids are assigned here, not by the caller: the schema doesn't check them
      // for uniqueness and the sidebar uses them as React keys, so a duplicate
      // would show up as two rows fighting over one identity.
      const id = def.steps.reduce((max, s) => Math.max(max, s.id), -1) + 1
      const at = Math.max(0, Math.min(action.index, def.steps.length))
      const steps = def.steps.slice()
      // id first, so a step made here looks like every hand-authored one.
      steps.splice(at, 0, { id, ...action.step })
      return { ...def, steps }
    }

    case 'step/remove': {
      if (!def.steps[action.index]) return def
      // A flow with no steps has nothing to render and won't validate.
      if (def.steps.length === 1) return def
      const steps = def.steps.slice()
      steps.splice(action.index, 1)
      return { ...def, steps }
    }

    case 'step/reorder': {
      const { from, to } = action
      if (from === to || !def.steps[from] || to < 0 || to >= def.steps.length) return def
      const steps = def.steps.slice()
      const [moved] = steps.splice(from, 1)
      steps.splice(to, 0, moved)
      return { ...def, steps }
    }

    case 'layout/setGrid':
      // Every zone gesture reports the grid, whether or not it grew — so check
      // before rebuilding, or a resize that changed nothing still churns state.
      return mapScene(def, action.scene, (s) =>
        s.grid.cols === action.grid.cols && s.grid.rows === action.grid.rows
          ? s
          : { ...s, grid: action.grid },
      )
  }
}

/** A gesture can touch several objects at once — moving a zone carries its
 *  components — so commits arrive as a batch and fold in order. */
export function applyActions(def: FlowDefinition, actions: FlowAction[]): FlowDefinition {
  return actions.reduce(flowReducer, def)
}
