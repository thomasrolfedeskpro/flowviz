export interface FlowMeta {
  title: string
  description?: string
  /** What the waterfall column measures — "Latency", "Cost", "Distance". Names
   *  the column and its toggle; omitted, both just say "Waterfall". */
  waterfallLabel?: string
  /** How fast this flow plays. Anything omitted uses the built-in default; the
   *  viewer's speed selector scales whatever ends up here. */
  timing?: {
    step?:       number
    packet?:     number
    transition?: number
    stream?:     number
  }
}

export interface LayoutConfig {
  grid: {
    cols: number
    rows: number
  }
}

export interface Zone {
  id: string
  label: string
  color: string
  parentId?: string
  outline?: 'solid' | 'dashed'
  bounds: {
    col: number
    row: number
    width: number
    height: number
  }
  meta?: {
    description?: string
    notes?: string
  }
}

export type ComponentType =
  | 'client'
  | 'service'
  | 'database'
  | 'queue'
  | 'function'
  | 'external'

/** Basic extruded prisms only — the icon on top carries the meaning. */
export type ComponentShape =
  | 'cuboid'
  | 'cylinder'
  | 'hexagon'
  | 'octagon'
  | 'triangle'

export interface Component {
  id: string
  label: string
  type: ComponentType
  shape?: ComponentShape
  logo?: string
  icon?: string
  color?: string
  position: { col: number; row: number; elevation?: number }
  size?: { w: number; h: number }
  meta?: {
    description?: string
    file?: string
    line?: number
    notes?: string
  }
  /** What is inside this component — a scene of its own, entered by any step
   *  tagged with this component's id. Nests to any depth. */
  detail?: SceneDetail
}

/**
 * A nested scene. Laid out in its own grid from its own origin, exactly like a
 * top-level flow, and shown only while a step names the component owning it.
 */
export interface SceneDetail {
  grid: { cols: number; rows: number }
  zones?: Zone[]
  components: Component[]
  connections: Connection[]
}

export interface WayPoint {
  col: number
  row: number
}

export interface Connection {
  id: string
  from: string
  to: string
  label?: string
  /** Overrides the theme's pipe colour. The glass stays glass: the same
   *  idle/active/traversing opacity ladder applies, in this hue. */
  color?: string
  route: 'auto' | WayPoint[]
}

export type AnnotationType  = 'callout' | 'transform'
export type AnnotationStyle = 'info' | 'success' | 'warning' | 'error'

export interface Annotation {
  type:   AnnotationType
  target: string
  text:   string
  style?: AnnotationStyle
}

export type PacketShape   = 'sphere' | 'document' | 'token' | 'blob' | 'envelope'
export type ArrivalStyle  = 'error' | 'success' | 'warning'

export interface StreamDef {
  connection: string
  color?:     string
}

export interface Packet {
  connection:    string
  shape:         PacketShape
  direction?:    'forward' | 'reverse'
  /** What the packet is carrying, shown when you hover it.
   *
   *  An object is read as labelled facts: keys are humanised and a trailing
   *  unit is lifted out of the name, so `drop_diameter_mm: 2.1` reads
   *  "Drop diameter — 2.1 mm". A string is shown as a sentence, which is the
   *  better form when the flow is not about messages at all. */
  data?:         Record<string, unknown> | string
  /** Force the payload to be shown as verbatim JSON. For flows where the
   *  payload really is a message and its punctuation is part of the point. */
  format?:       'raw'
  arrivalStyle?: ArrivalStyle
  /** Send this many packets down the pipe instead of one, staggered — for work
   *  that repeats (a query in a loop, a retry storm, a batch of messages). */
  count?:        number
}

/** Emphasis for a footer note. Tones reuse the annotation palette. */
export type NoteStyle = 'info' | 'success' | 'warning' | 'error'

/** A line of author-written commentary pinned under the step description.
 *  `text` supports inline **bold**, *italic* and `code`. */
export interface FooterNote {
  text:   string
  style?: NoteStyle
}

/** One bar in the optional waterfall view. `weight` and `start` are unitless —
 *  bars are scaled against the flow's full span, so they can be milliseconds,
 *  rows scanned, retries, cost, anything comparable. */
export interface WaterfallBar {
  weight: number
  /** Where the bar begins on the shared axis. Omit and it follows the previous
   *  bar's end, giving a sequential cascade; set it to show overlap. */
  start?: number
  label?: string
  color?: string
}

export interface Step {
  id: number
  title: string
  /** Component id whose `detail` scene this step happens inside. Omitted = the
   *  top-level scene. */
  scene?: string
  name?: string
  description?: string
  highlight: string[]
  active_connections: string[]
  camera?: {
    focus?: string | null
    zoom?: number
    /** Frame the whole scene again. The only way to undo an earlier focus:
     *  a step with no camera, or with `focus: null`, leaves the view alone. */
    fit?: boolean
  }
  annotations?: Annotation[]
  footer?: FooterNote[]
  waterfall?: WaterfallBar
  packet?: Packet | null
  packets?: Packet[]
  stream?:  StreamDef | null
  streams?: StreamDef[]
}

export interface FlowDefinition {
  meta: FlowMeta
  layout: LayoutConfig
  zones: Zone[]
  components: Component[]
  connections: Connection[]
  steps: Step[]
}
