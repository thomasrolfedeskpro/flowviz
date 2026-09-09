import { z } from 'zod'
import type { FlowDefinition } from '@/types/schema'

// ── Valid value sets (shared with parseFlow.ts) ───────────────────────────────

const COMPONENT_TYPES  = ['client', 'service', 'database', 'queue', 'function', 'external'] as const
const COMPONENT_SHAPES = ['cuboid', 'cylinder', 'hexagon', 'octagon', 'triangle'] as const
const PACKET_SHAPES    = ['sphere', 'document', 'token', 'blob', 'envelope'] as const
const ANNOTATION_TYPES = ['callout', 'transform'] as const
const ANNOTATION_STYLES= ['info', 'success', 'warning', 'error'] as const
const ARRIVAL_STYLES   = ['error', 'success', 'warning'] as const
const DIRECTIONS       = ['forward', 'reverse'] as const
const PACKET_FORMATS   = ['raw'] as const

// ── Helper ────────────────────────────────────────────────────────────────────

// Produces a string field that validates against a fixed set and emits a human-
// readable error containing `label` so callers can match on it.
function enumStr<T extends string>(valid: readonly T[], label: string): z.ZodType<T> {
  return z.string().superRefine((v, ctx) => {
    if (!(valid as readonly string[]).includes(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: ${v}` })
    }
  }) as unknown as z.ZodType<T>
}

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const ZoneSchema = z.object({
  id:       z.string(),
  label:    z.string(),
  color:    z.string(),
  parentId: z.string().optional(),
  outline:  z.enum(['solid', 'dashed']).optional(),
  bounds: z.object({
    col:    z.number(),
    row:    z.number(),
    width:  z.number(),
    height: z.number(),
  }),
  meta: z.object({
    description: z.string().optional(),
    notes:       z.string().optional(),
  }).optional(),
})

type ComponentInput = {
  id: string
  detail?: { grid: { cols: number; rows: number }; zones?: unknown[]; components: ComponentInput[]; connections: unknown[] }
  [key: string]: unknown
}

const ComponentSchema: z.ZodType<ComponentInput> = z.lazy(() => z.object({
  id:       z.string(),
  label:    z.string(),
  type:     enumStr(COMPONENT_TYPES,  'Invalid component type'),
  shape:    enumStr(COMPONENT_SHAPES, 'Invalid component shape').optional(),
  logo:     z.string().optional(),
  icon:     z.string().optional(),
  color:    z.string().optional(),
  position: z.object({
    col:       z.number(),
    row:       z.number(),
    elevation: z.number().optional(),
  }),
  size: z.object({ w: z.number(), h: z.number() }).optional(),
  meta: z.object({
    description: z.string().optional(),
    file:        z.string().optional(),
    line:        z.number().optional(),
    notes:       z.string().optional(),
  }).optional(),
  detail: z.object({
    grid:        z.object({ cols: z.number(), rows: z.number() }),
    zones:       z.array(ZoneSchema).optional(),
    components:  z.array(ComponentSchema),
    connections: z.array(ConnectionSchema),
  }).optional(),
})) as unknown as z.ZodType<ComponentInput>

const WayPointSchema = z.object({ col: z.number(), row: z.number() })

const ConnectionSchema = z.object({
  id:    z.string(),
  from:  z.string(),
  to:    z.string(),
  label: z.string().optional(),
  color: z.string().optional(),
  route: z.union([z.literal('auto'), z.array(WayPointSchema)]),
})

const AnnotationSchema = z.object({
  type:   enumStr(ANNOTATION_TYPES,  'Invalid annotation type'),
  target: z.string(),
  text:   z.string(),
  style:  enumStr(ANNOTATION_STYLES, 'Invalid annotation style').optional(),
})

// Two packet schemas so arrival-style errors carry the correct label.
// step.packet  → "Invalid packet arrivalStyle"
// step.packets → "Invalid packets[].arrivalStyle"
// A payload is either fields or a sentence; both are rendered, neither is
// coerced into the other.
const PacketDataSchema = z.union([z.record(z.string(), z.unknown()), z.string()])

const PacketSchema = z.object({
  connection:   z.string(),
  shape:        enumStr(PACKET_SHAPES,  'Invalid packet shape'),
  direction:    enumStr(DIRECTIONS,     'Invalid packet direction').optional(),
  data:         PacketDataSchema.optional(),
  format:       enumStr(PACKET_FORMATS, 'Invalid packet format').optional(),
  arrivalStyle: enumStr(ARRIVAL_STYLES, 'Invalid packet arrivalStyle').optional(),
  count:        z.number().int().positive().optional(),
})

const MultiPacketSchema = z.object({
  connection:   z.string(),
  shape:        enumStr(PACKET_SHAPES,  'Invalid packet shape'),
  direction:    enumStr(DIRECTIONS,     'Invalid packet direction').optional(),
  data:         PacketDataSchema.optional(),
  format:       enumStr(PACKET_FORMATS, 'Invalid packet format').optional(),
  arrivalStyle: enumStr(ARRIVAL_STYLES, 'Invalid packets[].arrivalStyle').optional(),
  count:        z.number().int().positive().optional(),
})

const NOTE_STYLES = ['info', 'success', 'warning', 'error'] as const

const FooterNoteSchema = z.object({
  text:  z.string(),
  style: enumStr(NOTE_STYLES, 'Invalid footer note style').optional(),
})

const WaterfallSchema = z.object({
  weight: z.number().nonnegative('waterfall.weight must be zero or more'),
  start:  z.number().nonnegative('waterfall.start must be zero or more').optional(),
  label:  z.string().optional(),
  color:  z.string().optional(),
})

const StreamDefSchema = z.object({
  connection: z.string(),
  color:      z.string().optional(),
})

const StepSchema = z.object({
  id:                 z.number(),
  title:              z.string(),
  scene:              z.string().optional(),
  name:               z.string().optional(),
  description:        z.string().optional(),
  highlight:          z.array(z.string()),
  active_connections: z.array(z.string()),
  camera: z.object({
    focus: z.string().nullable().optional(),
    zoom:  z.number().optional(),
    fit:   z.boolean().optional(),
  }).optional(),
  annotations: z.array(AnnotationSchema).optional(),
  footer:      z.array(FooterNoteSchema).optional(),
  waterfall:   WaterfallSchema.optional(),
  packet:      PacketSchema.nullable().optional(),
  packets:     z.array(MultiPacketSchema).optional(),
  stream:      StreamDefSchema.nullable().optional(),
  streams:     z.array(StreamDefSchema).optional(),
})

// ── Root schema with cross-reference checks ───────────────────────────────────

export const FlowDefinitionSchema = z.object({
  meta: z.object({
    title:          z.string(),
    description:    z.string().optional(),
    waterfallLabel: z.string().optional(),
    // Durations in milliseconds. Zero would mean "instant", which reads as a
    // rendering bug rather than a choice, so they have to be positive.
    timing: z.object({
      step:       z.number().positive('meta.timing.step must be above zero').optional(),
      packet:     z.number().positive('meta.timing.packet must be above zero').optional(),
      transition: z.number().positive('meta.timing.transition must be above zero').optional(),
      stream:     z.number().positive('meta.timing.stream must be above zero').optional(),
    }).optional(),
  }),
  layout:      z.object({ grid: z.object({ cols: z.number(), rows: z.number() }) }),
  zones:       z.array(ZoneSchema),
  components:  z.array(ComponentSchema),
  connections: z.array(ConnectionSchema),
  steps:       z.array(StepSchema),
}).superRefine((flow, ctx) => {
  // ── Scene walk ────────────────────────────────────────────────────────────
  // Every component may carry a nested `detail` scene, to any depth. Ids are
  // required unique across the whole flow so a step can name any scene, and any
  // component or connection inside it, without qualification.
  interface SceneInfo {
    /** null for the top-level scene, otherwise the owning component's id */
    id:             string | null
    path:           (string | number)[]
    componentIds:   Set<string>
    connectionIds:  Set<string>
  }

  const scenes: SceneInfo[] = []
  const sceneById = new Map<string | null, SceneInfo>()
  const seenIds = new Map<string, string>()   // id → where it was first declared

  const claim = (id: string, where: string, path: (string | number)[]) => {
    const first = seenIds.get(id)
    if (first) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path,
        message: `Duplicate id "${id}" — already used by ${first}. Ids must be unique across every scene.`,
      })
      return
    }
    seenIds.set(id, where)
  }

  type RawScene = {
    zones?: { id: string; parentId?: string }[]
    components: { id: string; detail?: RawScene }[]
    connections: { id: string; from: string; to: string }[]
  }

  function walk(scene: RawScene, id: string | null, path: (string | number)[]) {
    const info: SceneInfo = {
      id,
      path,
      componentIds:  new Set(scene.components.map(c => c.id)),
      connectionIds: new Set(scene.connections.map(c => c.id)),
    }
    scenes.push(info)
    sceneById.set(id, info)

    const label = id === null ? 'the top-level scene' : `scene "${id}"`
    const zoneIds = new Set((scene.zones ?? []).map(z => z.id))

    ;(scene.zones ?? []).forEach((zone, i) => {
      claim(zone.id, `a zone in ${label}`, [...path, 'zones', i, 'id'])
      if (zone.parentId && !zoneIds.has(zone.parentId)) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    [...path, 'zones', i, 'parentId'],
          message: `References a zone outside this scene: ${zone.parentId}`,
        })
      }
    })

    scene.components.forEach((comp, i) => {
      claim(comp.id, `a component in ${label}`, [...path, 'components', i, 'id'])
    })

    // A connection may only join components in its own scene — v1 has no
    // cross-scene pipes, and silently drawing nothing would be worse.
    scene.connections.forEach((conn, i) => {
      claim(conn.id, `a connection in ${label}`, [...path, 'connections', i, 'id'])
      for (const end of ['from', 'to'] as const) {
        if (!info.componentIds.has(conn[end])) {
          ctx.addIssue({
            code:    z.ZodIssueCode.custom,
            path:    [...path, 'connections', i, end],
            message: seenIds.has(conn[end])
              ? `References a component in another scene: ${conn[end]}. Connections cannot cross scenes.`
              : `References unknown component: ${conn[end]}`,
          })
        }
      }
    })

    scene.components.forEach((comp, i) => {
      if (comp.detail) walk(comp.detail, comp.id, [...path, 'components', i, 'detail'])
    })
  }

  walk(flow as unknown as RawScene, null, [])

  // ── Step references, resolved against the step's own scene ────────────────
  flow.steps.forEach((step, si) => {
    const scene = sceneById.get(step.scene ?? null)
    if (!scene) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path:    ['steps', si, 'scene'],
        message: seenIds.has(step.scene as string)
          ? `"${step.scene}" has no detail scene — only a component with "detail" can hold steps`
          : `References unknown scene: ${step.scene}`,
      })
      return
    }

    const inScene = (id: string) => scene.componentIds.has(id)
    const hasConn = (id: string) => scene.connectionIds.has(id)
    const where = step.scene ? `scene "${step.scene}"` : 'the top-level scene'

    step.highlight.forEach((id, hi) => {
      if (!inScene(id)) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    ['steps', si, 'highlight', hi],
          message: seenIds.has(id)
            ? `Component "${id}" is not in ${where}`
            : `References unknown component: ${id}`,
        })
      }
    })

    const connRef = (id: string, path: (string | number)[]) => {
      if (hasConn(id)) return
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path,
        message: seenIds.has(id)
          ? `Connection "${id}" is not in ${where}`
          : `References unknown connection: ${id}`,
      })
    }

    step.active_connections.forEach((id, ai) => connRef(id, ['steps', si, 'active_connections', ai]))
    if (step.packet) connRef(step.packet.connection, ['steps', si, 'packet', 'connection'])
    step.packets?.forEach((pkt, pi) => connRef(pkt.connection, ['steps', si, 'packets', pi, 'connection']))
    if (step.stream) connRef(step.stream.connection, ['steps', si, 'stream', 'connection'])
    step.streams?.forEach((st, sti) => connRef(st.connection, ['steps', si, 'streams', sti, 'connection']))

    step.annotations?.forEach((a, ai) => {
      if (!inScene(a.target)) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    ['steps', si, 'annotations', ai, 'target'],
          message: seenIds.has(a.target)
            ? `Annotation target "${a.target}" is not in ${where}`
            : `References unknown component: ${a.target}`,
        })
      }
    })
  })
})

// ── Public API ────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { success: true;  data: FlowDefinition }
  | { success: false; errors: string[] }

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * Validates a raw JSON value against the FlowDefinition schema.
 * Returns a result object — never throws.
 * Errors are human-readable strings in the form "path.to.field: what went wrong".
 */
export function parseFlowSchema(raw: unknown): ValidationResult {
  const result = FlowDefinitionSchema.safeParse(raw)
  if (result.success) return { success: true, data: result.data as unknown as FlowDefinition }
  return { success: false, errors: result.error.issues.map(formatIssue) }
}
