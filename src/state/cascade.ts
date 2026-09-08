import type { Connection, FlowDefinition, Step } from '@/types/schema'
import type { FlowAction, SceneId, StepPatch } from '@/state/flowActions'
import { sceneOf } from '@/utils/scenes'

/**
 * What else changes when something is deleted.
 *
 * Deleting a component is never just that: the pipes into it stop meaning
 * anything, and every step that highlighted it, sent a packet down one of those
 * pipes, or pinned an annotation to it would be left pointing at nothing — a
 * flow the schema refuses to load. The delete prompt shows this list before
 * anything happens, and the same pass produces the actions that carry it out.
 */

export interface Referrer {
  /** Where it is, in the terms the user sees: "Step 3 — Request arrives". */
  where: string
  /** What it does with the thing being deleted. */
  what: string
}

export interface DeletePlan {
  /** Everything besides the target that this delete would change. */
  referrers: Referrer[]
  /** The delete and its cascade, as one batch. */
  actions: FlowAction[]
  /** Set when the delete can't be offered at all, and why. */
  blocked?: string
}

const stepName = (step: Step, index: number) =>
  `Step ${index} — ${step.name ?? step.title}`

/** Packets and streams come in singular and plural spellings; read both. */
const packetsOf = (step: Step) => [...(step.packet ? [step.packet] : []), ...(step.packets ?? [])]
const streamsOf = (step: Step) => [...(step.stream ? [step.stream] : []), ...(step.streams ?? [])]

/**
 * Strip every reference to the given ids out of the steps.
 *
 * Written as one pass over the steps rather than per-id, so a step that loses
 * three references produces one patch rather than three.
 */
function stepCascade(
  def: FlowDefinition,
  componentIds: Set<string>,
  connectionIds: Set<string>,
): { actions: FlowAction[]; referrers: Referrer[] } {
  const actions: FlowAction[] = []
  const referrers: Referrer[] = []

  def.steps.forEach((step, index) => {
    const patch: StepPatch = {}
    const notes: string[] = []

    const highlight = step.highlight.filter((id) => !componentIds.has(id))
    if (highlight.length !== step.highlight.length) {
      patch.highlight = highlight
      notes.push('highlights it')
    }

    const active = step.active_connections.filter((id) => !connectionIds.has(id))
    if (active.length !== step.active_connections.length) {
      patch.active_connections = active
      notes.push('lights the connection')
    }

    const packets = packetsOf(step).filter((p) => !connectionIds.has(p.connection))
    if (packets.length !== packetsOf(step).length) {
      // Normalised to the plural form on the way out, as everywhere else.
      patch.packet = undefined
      patch.packets = packets.length ? packets : undefined
      notes.push('sends a packet down it')
    }

    const streams = streamsOf(step).filter((s) => !connectionIds.has(s.connection))
    if (streams.length !== streamsOf(step).length) {
      patch.stream = undefined
      patch.streams = streams.length ? streams : undefined
      notes.push('streams over it')
    }

    const annotations = step.annotations?.filter((a) => !componentIds.has(a.target))
    if (annotations && annotations.length !== step.annotations!.length) {
      patch.annotations = annotations.length ? annotations : undefined
      notes.push('annotates it')
    }

    if (step.camera?.focus && componentIds.has(step.camera.focus)) {
      const camera = { ...step.camera, focus: null }
      patch.camera = camera.zoom ? camera : undefined
      notes.push('focuses the camera on it')
    }

    if (notes.length) {
      actions.push({ type: 'step/patch', index, patch })
      referrers.push({ where: stepName(step, index), what: notes.join(', ') })
    }
  })

  return { actions, referrers }
}

export function planDelete(
  def: FlowDefinition,
  scene: SceneId,
  kind: 'component' | 'zone' | 'connection',
  id: string,
): DeletePlan {
  const contents = sceneOf(def, scene)
  if (!contents) return { referrers: [], actions: [], blocked: 'That scene is no longer in the flow.' }

  if (kind === 'zone') {
    const zone = contents.zones?.find((z) => z.id === id)
    if (!zone) return { referrers: [], actions: [], blocked: 'That zone is no longer in the flow.' }

    // Nothing in a step can name a zone, so the only fallout is nesting.
    const children = (contents.zones ?? []).filter((z) => z.parentId === id)
    return {
      referrers: children.map((z) => ({ where: `Zone “${z.label}”`, what: 'sits inside it' })),
      actions: [{ type: 'zone/remove', scene, id }],
    }
  }

  if (kind === 'connection') {
    const conn = contents.connections.find((c) => c.id === id)
    if (!conn) return { referrers: [], actions: [], blocked: 'That connection is no longer in the flow.' }

    const cascade = stepCascade(def, new Set(), new Set([id]))
    return {
      referrers: cascade.referrers,
      actions: [...cascade.actions, { type: 'connection/remove', scene, id }],
    }
  }

  const component = contents.components.find((c) => c.id === id)
  if (!component) return { referrers: [], actions: [], blocked: 'That component is no longer in the flow.' }

  // Deleting a component that owns a nested scene would delete the scene, every
  // step inside it, and everything those steps point at. Out of scope for now,
  // and far too much to hide behind one prompt.
  if (component.detail) {
    return {
      referrers: [],
      actions: [],
      blocked:
        `“${component.label}” contains a nested scene. Removing it would take the scene and its `
        + `steps with it — edit the flow file directly if that's what you want.`,
    }
  }

  const doomedConnections: Connection[] = contents.connections.filter(
    (c) => c.from === id || c.to === id,
  )
  const cascade = stepCascade(def, new Set([id]), new Set(doomedConnections.map((c) => c.id)))

  return {
    referrers: [
      ...doomedConnections.map((c) => ({
        where: `Connection ${c.label ? `“${c.label}”` : c.id}`,
        what:  c.from === id && c.to === id ? 'loops back to it' : c.from === id ? 'starts here' : 'ends here',
      })),
      ...cascade.referrers,
    ],
    actions: [
      ...cascade.actions,
      ...doomedConnections.map((c): FlowAction => ({ type: 'connection/remove', scene, id: c.id })),
      { type: 'component/remove', scene, id },
    ],
  }
}
