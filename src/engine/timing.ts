import type { FlowDefinition } from '@/types/schema'

/**
 * How fast a flow plays, as the author set it.
 *
 * These were four constants in four files — the step interval in the engine,
 * packet travel in the scene layer, the material transition in the app, the
 * chevron loop in the stream. Nothing about pace could be authored or shared,
 * only felt by whoever happened to be watching.
 *
 * The viewer's speed selector still divides all of them. It stays a preference:
 * skimming a flow at 4× must not rewrite what its author chose.
 */
export interface Timing {
  /** How long a step holds before the walkthrough advances. */
  step: number
  /** How long a packet takes to cross a pipe. */
  packet: number
  /** Highlight and dim fades when a step changes. */
  transition: number
  /** One full lap of the chevrons on a streaming connection. */
  stream: number
}

export const DEFAULT_TIMING: Timing = {
  step:       3000,
  packet:     2000,
  transition:  800,
  stream:     3500,
}

/** The flow's timing, with anything it doesn't set falling back to the default. */
export function resolveTiming(def: Pick<FlowDefinition, 'meta'> | null | undefined): Timing {
  return { ...DEFAULT_TIMING, ...(def?.meta.timing ?? {}) }
}
