# FlowViz — Design Document

A web application for creating and viewing animated isometric data flow diagrams,
defined by a structured JSON format and intended for use by developers to document
and communicate how data moves through a system.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [JSON Schema Specification](#2-json-schema-specification)
3. [Phase 1 — Infrastructure](#3-phase-1--infrastructure)
4. [Phase 2 — Visualization](#4-phase-2--visualization)
5. [Phase 3 — Claude Skill Integration](#5-phase-3--claude-skill-integration)

---

## 1. Project Overview

### Goals

- Accept a JSON flow definition file and render a navigable, animated isometric diagram
- Step forward and backward through a sequence of states with smooth animation between each
- Support autoplay through all steps at a configurable speed
- Allow viewers to hover components for metadata (description, file location, notes)
- Be entirely open source (MIT-licensed dependencies), deployable as a static site

### Non-goals (v1)

- A GUI editor for building flows (flows are hand-authored or LLM-generated JSON)
- Multiple simultaneous flows or a library/gallery view
- Server-side rendering or a backend

### Technology Stack

| Concern | Library | License |
|---|---|---|
| Bundler | Vite | MIT |
| UI framework | React 18 | MIT |
| Language | TypeScript | Apache 2.0 |
| 3D rendering | Three.js | MIT |
| Tweening / animation | @tweenjs/tween.js | MIT |
| Styling | Plain CSS modules | — |

No component library, no CSS framework. Keep the dependency surface small.

---

## 2. JSON Schema Specification

This section defines the complete input format. TypeScript types derived from this
schema live at `src/types/schema.ts` and are the authoritative reference for both
the parser and any LLM generating flow definitions.

### 2.1 Top-level structure

```typescript
interface FlowDefinition {
  meta:        FlowMeta
  layout:      LayoutConfig
  zones:       Zone[]
  components:  Component[]
  connections: Connection[]
  steps:       Step[]
}
```

### 2.2 `FlowMeta`

```typescript
interface FlowMeta {
  title:        string
  description?: string
}
```

### 2.3 `LayoutConfig`

```typescript
interface LayoutConfig {
  grid: {
    cols: number   // total grid width in cells
    rows: number   // total grid depth in cells
  }
}
```

The grid defines the coordinate space. All positions and zone bounds are expressed
as integer (col, row) values within this space. The engine maps these to Three.js
world coordinates deterministically — no layout algorithm runs at render time.

World coordinate mapping (see Section 4.1):
- `worldX = col * CELL_SIZE`
- `worldZ = row * CELL_SIZE`
- `worldY = elevation * ELEVATION_UNIT` (default 0)

`CELL_SIZE` is a constant (default `3.0` world units).
`ELEVATION_UNIT` is a constant (default `1.5` world units).

### 2.4 `Zone`

```typescript
interface Zone {
  id:     string
  label:  string
  color:  string   // hex colour for fill and border
  bounds: {
    col:    number  // top-left col of the zone rectangle
    row:    number  // top-left row of the zone rectangle
    width:  number  // width in cells
    height: number  // height in cells
  }
}
```

Zones are rendered as semi-transparent rectangles on the ground plane, sitting
just below components. Their label appears as an HTML overlay in the upper-left
corner of the zone's screen-space bounding box.

### 2.5 `Component`

```typescript
type ComponentType =
  | 'client'    // browser, mobile app, external consumer
  | 'service'   // backend service, API
  | 'database'  // any persistent store
  | 'queue'     // message broker, event bus, topic
  | 'function'  // serverless function, lambda, job
  | 'external'  // third-party system outside your control

interface Component {
  id:       string
  label:    string
  type:     ComponentType
  position: { col: number; row: number; elevation?: number }
  size?:    { w: number; h: number }  // in grid cells, defaults to { w: 1, h: 1 }
  meta?: {
    description?: string   // shown in hover tooltip
    file?:        string   // source file path, e.g. "src/auth/pkce.ts"
    line?:        number   // line number within that file
    notes?:       string   // freeform additional context
  }
}
```

`size.w` controls the component's footprint along the column axis.
`size.h` controls the footprint along the row axis.
The rendered mesh is sized to `(w * CELL_SIZE * 0.8)` × `(h * CELL_SIZE * 0.8)`
to leave gutters between adjacent components.

### 2.6 `Connection`

```typescript
interface Connection {
  id:     string
  from:   string         // component id
  to:     string         // component id
  label?: string         // shown as a billboard at the pipe midpoint
  route:  'auto' | WayPoint[]
}

interface WayPoint {
  col: number
  row: number
}
```

When `route` is `'auto'`, the engine generates a two-segment orthogonal path
(L-shape or Z-shape) from the center of the `from` component to the center of
the `to` component, routing at the midpoint column or row to avoid crossing
directly through unrelated components. Explicit waypoints override this entirely
and the pipe passes through each (col, row) in sequence.

### 2.7 `Step`

```typescript
interface Step {
  id:                 number
  title:              string
  description?:       string
  highlight:          string[]          // component ids to highlight; others are dimmed
  active_connections: string[]          // connection ids to illuminate
  camera?: {
    focus?: string | null               // component id, or null to return to overview
    zoom?:  number                      // multiplier on the default frustum size (default 1.0)
  }
  annotations?: Annotation[]
  popouts?:     Popout[]
  packet?:      Packet | null
}
```

#### Overview (rest) step

Every flow definition should begin with a step that has empty `highlight`,
`active_connections`, `annotations`, and no `packet`. This is the resting state — it
shows the full architecture with all components at equal weight before any event has
occurred. The step engine starts here on load. Example:

```json
{
  "id": 0,
  "title": "Telemetry Pipeline Overview",
  "description": "The full pipeline from browser event to ClickHouse storage.",
  "highlight": [],
  "active_connections": [],
  "camera": { "focus": null }
}
```

Steps that follow this one describe specific events or transitions. The overview step
has no annotations or packets so the viewer can orient themselves first.

### 2.8 `Annotation`

```typescript
type AnnotationType = 'callout' | 'transform'

interface Annotation {
  type:   AnnotationType
  target: string    // component id to anchor to
  text:   string
}
```

`callout` — a speech-bubble style overlay. Used for describing an event, trigger, or
action occurring at a component (e.g. a user interaction, an inbound request).

`transform` — a code-style callout (monospace, darker background). Used when
describing how a component transforms or processes data in-place (validation,
enrichment, encryption, etc.).

#### Rendering: leader-line callout cards

Annotations are rendered as floating HTML cards connected to their target component
by a thin SVG leader line. This keeps the text legible and spatially linked without
overlapping the component mesh.

**Card positioning** — Each card is placed at a fixed screen-space offset from the
target component's projected screen position. The offset direction is assigned by
annotation index to fan cards away from the component and avoid mutual overlap:

| Index | Offset direction |
|-------|-----------------|
| 0     | upper-right (dx: +130px, dy: −90px) |
| 1     | upper-left  (dx: −130px, dy: −90px) |
| 2     | lower-right (dx: +130px, dy: +60px) |
| 3     | lower-left  (dx: −130px, dy: +60px) |

Additional annotations beyond index 3 cycle back through these directions with
an additional vertical offset to prevent exact overlap.

**Leader line** — A single `<line>` element inside a full-viewport `<svg>` overlay
connects the component's projected screen position (its `topCenter`) to the near
edge of the card. The SVG is positioned `position: absolute; inset: 0; pointer-events: none`
so it sits above the canvas but does not capture mouse events.

**Fade transition** — Cards and their leader lines fade in via a CSS `opacity`
transition (200 ms ease-out) when a step with annotations becomes active, and fade
out when the step changes. This is driven by adding/removing a CSS class rather than
unmounting the component mid-transition.

**Per-frame tracking** — Card positions and line endpoints are updated every frame
via `useAnimationFrame` by re-projecting the target component's `topCenter` through
`OverlayBridge.worldToScreen`. Direct DOM style mutations (not React state) are used
to avoid flooding the React render cycle.

### 2.9 `Popout`

```typescript
interface Popout {
  title:  string
  anchor: string              // component id
  data:   Record<string, unknown>
}
```

A floating card showing structured key-value data, anchored near the component.
Intended for displaying the payload shape at a given point in the flow.

### 2.10 `Packet`

```typescript
type PacketShape = 'sphere' | 'document' | 'token' | 'blob' | 'envelope'

interface Packet {
  connection: string              // connection id to travel along
  shape:      PacketShape
  data?:      Record<string, unknown>   // shown in a small label on hover
}
```

Packet shape vocabulary:

| Shape | Geometry | Semantic meaning |
|---|---|---|
| `sphere` | `SphereGeometry(0.12, 16, 8)` | Generic event or message |
| `document` | `BoxGeometry(0.28, 0.03, 0.20)` | JSON body, HTTP request/response |
| `token` | `CylinderGeometry(0.10, 0.10, 0.025, 16)` | Auth token, JWT, session key |
| `blob` | `SphereGeometry(0.14, 8, 6)` scaled `(1.0, 0.7, 0.9)` | Binary data, file |
| `envelope` | `BoxGeometry(0.22, 0.025, 0.16)` | HTTP redirect, response envelope |

---

## 3. Phase 1 — Infrastructure

Phase 1 produces a running application with no visualization content — just the
scaffolding that Phase 2 builds on. At the end of Phase 1 the app should:

- Render a blank Three.js canvas with correct camera, lighting, and resize handling
- Load and parse a JSON flow file, validating it against the schema types
- Render a step controls UI (back / play-pause / forward) wired to a working step engine
- Show a heads-up display (step title, description, step counter) that updates correctly
- Project world positions to screen positions (the overlay bridge), verified with a debug marker

### 3.1 Project scaffold

```
flowviz/
  index.html
  vite.config.ts
  tsconfig.json
  package.json
  public/
    flows/
      example.json          # a sample flow definition for development
  src/
    main.tsx                # mounts React root
    App.tsx                 # top-level layout
    types/
      schema.ts             # JSON schema TypeScript types (Section 2)
      internal.ts           # runtime graph model types (Section 4.2)
    engine/
      parseFlow.ts          # FlowDefinition → InternalGraph
      layoutEngine.ts       # grid coords → world coords
      stepEngine.ts         # step state machine
    scene/
      SceneManager.ts       # Three.js setup and animation loop
      LightingSetup.ts      # adds lights to the scene
      OverlayBridge.ts      # world → screen coordinate projection
    components/
      CanvasContainer.tsx   # mounts canvas, owns SceneManager lifecycle
      StepControls.tsx      # back / play-pause / forward buttons
      StepHUD.tsx           # title, description, step N of M
    hooks/
      useStepEngine.ts      # React-facing step state
      useAnimationFrame.ts  # requestAnimationFrame subscription hook
    styles/
      global.css
      StepControls.module.css
      StepHUD.module.css
```

### 3.2 Vite configuration (`vite.config.ts`)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' }
  }
})
```

### 3.3 TypeScript configuration (`tsconfig.json`)

Strict mode on. `moduleResolution: bundler`. `paths` configured to match the
`@/` alias. `target: ES2022` for top-level await support.

### 3.4 Three.js scene setup (`scene/SceneManager.ts`)

`SceneManager` is a plain TypeScript class (not a React component). It owns the
Three.js renderer, camera, scene, and animation loop. React mounts it via
`CanvasContainer.tsx` and holds a ref to the instance.

```typescript
class SceneManager {
  renderer:  THREE.WebGLRenderer
  scene:     THREE.Scene
  camera:    THREE.OrthographicCamera
  clock:     THREE.Clock

  constructor(canvas: HTMLCanvasElement)
  dispose(): void
  resize(width: number, height: number): void
  startLoop(): void
  stopLoop(): void

  // Called every frame; subclasses / Phase 2 extend this
  protected onFrame(deltaMs: number): void
}
```

#### Renderer

```typescript
this.renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
})
this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
this.renderer.shadowMap.enabled = true
this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
this.renderer.setClearColor(0x1a1a2e)   // dark navy background
```

#### Isometric orthographic camera

The camera is positioned along the classic isometric axis: azimuth 45°, elevation
arctan(1 / √2) ≈ 35.26°. All three axes appear equal-length in projection.

```typescript
// frustum half-size — controls zoom level
const FRUSTUM = 12

const aspect = width / height
this.camera = new THREE.OrthographicCamera(
  -FRUSTUM * aspect,  // left
   FRUSTUM * aspect,  // right
   FRUSTUM,           // top
  -FRUSTUM,           // bottom
   0.1,               // near
   1000               // far
)

// Position along isometric axis
// The exact distance doesn't affect orthographic projection,
// but must be far enough from the scene to avoid near-clip issues.
const D = 50
this.camera.position.set(D, D, D)
this.camera.lookAt(0, 0, 0)
this.camera.up.set(0, 1, 0)
```

On `resize`, recalculate `left/right/top/bottom` using the new aspect ratio,
keeping the same `FRUSTUM` constant, then call `camera.updateProjectionMatrix()`.

#### Animation loop

```typescript
private rafId: number | null = null

startLoop(): void {
  const tick = () => {
    this.rafId = requestAnimationFrame(tick)
    const delta = this.clock.getDelta()
    TWEEN.update()                          // advance all active tweens
    this.onFrame(delta * 1000)              // delta in ms
    this.renderer.render(this.scene, this.camera)
  }
  this.clock.start()
  tick()
}

stopLoop(): void {
  if (this.rafId !== null) cancelAnimationFrame(this.rafId)
}
```

`TWEEN.update()` must be called every frame with no arguments so Tween.js uses
its internal clock. All animation in Phase 2 uses Tween.js instances that are
implicitly updated here.

### 3.5 Lighting (`scene/LightingSetup.ts`)

```typescript
export function setupLighting(scene: THREE.Scene): void {
  // Ambient: soft base fill, slightly warm
  const ambient = new THREE.AmbientLight(0xffeedd, 0.6)
  scene.add(ambient)

  // Key light: upper-left of the isometric view, casts shadows
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(-10, 20, 10)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 200
  key.shadow.camera.left = -40
  key.shadow.camera.right = 40
  key.shadow.camera.top = 40
  key.shadow.camera.bottom = -40
  scene.add(key)

  // Fill light: opposite side, dim, no shadows
  const fill = new THREE.DirectionalLight(0xaaccff, 0.4)
  fill.position.set(10, 10, -10)
  scene.add(fill)
}
```

### 3.6 Canvas container (`components/CanvasContainer.tsx`)

Owns the SceneManager lifecycle. Mounts to the DOM via a `<canvas>` ref.
Handles window resize via a `ResizeObserver`.

```typescript
export function CanvasContainer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef  = useRef<SceneManager | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const sm = new SceneManager(canvasRef.current)
    sceneRef.current = sm
    setupLighting(sm.scene)
    sm.startLoop()

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      sm.resize(width, height)
    })
    ro.observe(canvasRef.current.parentElement!)

    return () => {
      sm.stopLoop()
      sm.dispose()
      ro.disconnect()
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {/* Overlay portal target — Phase 2 renders overlays here */}
      <div id="overlay-root" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    </div>
  )
}
```

The `#overlay-root` div is where all HTML overlays (tooltips, annotations, popouts)
are portal'd in Phase 2. `pointerEvents: none` by default; individual overlay
components that need interaction override this locally.

### 3.7 Step engine (`engine/stepEngine.ts`)

Pure TypeScript, no React, no Three.js. Holds the authoritative step state. React
and the scene subscribe to it via callbacks.

```typescript
type StepEngineListener = (state: StepState) => void

interface StepState {
  currentIndex: number     // 0-based
  totalSteps:   number
  isPlaying:    boolean
  step:         Step       // the Step object at currentIndex
}

class StepEngine {
  private index:     number = 0
  private playing:   boolean = false
  private timer:     ReturnType<typeof setTimeout> | null = null
  private listeners: Set<StepEngineListener> = new Set()

  constructor(private steps: Step[], private playIntervalMs: number = 3000) {}

  subscribe(fn: StepEngineListener): () => void
  getState(): StepState

  next(): void
  prev(): void
  goTo(index: number): void
  play(): void
  pause(): void
  toggle(): void     // play if paused, pause if playing

  setPlayInterval(ms: number): void
  destroy(): void    // clear any active timer
}
```

On `next()` / `prev()` / `goTo()`:
1. Clamp index to `[0, steps.length - 1]`
2. Update `this.index`
3. Notify all listeners with the new `StepState`

On `play()`:
- If already at last step, wrap to 0 first
- Set `playing = true`, notify listeners
- Schedule `next()` via `setTimeout` every `playIntervalMs`
- Each scheduled `next()` re-schedules itself unless the new index is the last step,
  at which point `playing` is set to false automatically

On `pause()`:
- Clear timer, set `playing = false`, notify listeners

### 3.8 React step hook (`hooks/useStepEngine.ts`)

```typescript
function useStepEngine(engine: StepEngine | null): StepState | null {
  const [state, setState] = useState<StepState | null>(
    () => engine?.getState() ?? null
  )

  useEffect(() => {
    if (!engine) return
    setState(engine.getState())
    return engine.subscribe(setState)
  }, [engine])

  return state
}
```

`StepEngine` is instantiated in `App.tsx` once the flow JSON is loaded and parsed,
then passed down via context. Avoids prop drilling.

### 3.9 Step controls UI (`components/StepControls.tsx`)

```tsx
function StepControls({ engine }: { engine: StepEngine }) {
  const state = useStepEngine(engine)
  if (!state) return null

  return (
    <div className={styles.controls}>
      <button onClick={() => engine.prev()} disabled={state.currentIndex === 0}>
        ← Back
      </button>
      <button onClick={() => engine.toggle()}>
        {state.isPlaying ? 'Pause' : 'Play'}
      </button>
      <button onClick={() => engine.next()} disabled={state.currentIndex === state.totalSteps - 1}>
        Forward →
      </button>
      <span className={styles.counter}>
        {state.currentIndex + 1} / {state.totalSteps}
      </span>
    </div>
  )
}
```

Styled to sit at the bottom-center of the viewport, floating over the canvas.

### 3.10 Step HUD (`components/StepHUD.tsx`)

```tsx
function StepHUD({ engine }: { engine: StepEngine }) {
  const state = useStepEngine(engine)
  if (!state) return null

  return (
    <div className={styles.hud}>
      <h2 className={styles.title}>{state.step.title}</h2>
      {state.step.description && (
        <p className={styles.description}>{state.step.description}</p>
      )}
    </div>
  )
}
```

Positioned top-left. Transitions between steps use a CSS `opacity` fade —
when step changes, opacity goes to 0, content updates, opacity returns to 1.
Achieved by keying the component on `state.currentIndex`.

### 3.11 Flow loading

Flows are loaded from `/public/flows/<dir>/<name>.json`, where `<dir>` is
`examples/` (committed) or `custom/` (git-ignored); the manifest in
`vite.config.ts` resolves an id to its path. In development, the filename
is hardcoded. In a later iteration a URL query param (`?flow=oauth-pkce`) can
select which file to load.

```typescript
// App.tsx
async function loadFlow(name: string): Promise<FlowDefinition> {
  const res = await fetch(`/flows/${name}.json`)
  if (!res.ok) throw new Error(`Failed to load flow: ${res.status}`)
  const raw = await res.json()
  return validateFlow(raw)   // see below
}
```

`validateFlow` in `engine/parseFlow.ts` performs runtime checks that the JSON
matches the expected shape (required fields present, referenced IDs exist, etc.)
and throws descriptive errors. It does not use a validation library — plain
TypeScript guard functions are sufficient and keep the bundle small.

### 3.12 Overlay bridge (`scene/OverlayBridge.ts`)

Converts Three.js world positions to CSS pixel positions for HTML overlays.

```typescript
class OverlayBridge {
  constructor(
    private camera:   THREE.OrthographicCamera,
    private renderer: THREE.WebGLRenderer
  ) {}

  worldToScreen(worldPos: THREE.Vector3): { x: number; y: number } {
    const ndc = worldPos.clone().project(this.camera)
    const canvas = this.renderer.domElement
    return {
      x: (ndc.x + 1) / 2 * canvas.clientWidth,
      y: -(ndc.y - 1) / 2 * canvas.clientHeight,
    }
  }
}
```

The bridge instance is held by `SceneManager` and exposed so React components
can call `worldToScreen` during render or in a `useLayoutEffect` to position
overlays. Phase 2 calls this on every frame for any active overlay anchor.

### 3.13 Phase 1 completion checklist

- [x] `npm create vite@latest flowviz -- --template react-ts` runs cleanly
- [x] All dependencies installed (`three`, `@tweenjs/tween.js`, `@types/three`)
- [x] Canvas renders with the dark background, no console errors
- [x] Camera is at the correct isometric angle (verify by adding a `BoxGeometry` manually)
- [ ] Resize handler keeps the canvas filling its container correctly
- [x] `example.json` loaded from `/public/flows/example.json` and parsed without error
- [ ] `StepEngine` advances correctly; play/pause/wrap tested in isolation
- [ ] Step controls render and wire to the engine correctly
- [ ] HUD updates on step change
- [ ] `OverlayBridge.worldToScreen` verified: a debug `<div>` positioned at the origin tracks a cube placed at `(0,0,0)` in the scene as the window resizes

---

## 4. Phase 2 — Visualization

Phase 2 transforms the parsed `InternalGraph` into a live, animated Three.js scene.
By the end of Phase 2 the application should render a complete flow, step through
it with animation, support hover tooltips, camera focus, annotations, popouts,
and packet travel along pipes.

### 4.1 Layout engine (`engine/layoutEngine.ts`)

Translates the JSON grid coordinate system into Three.js world coordinates.
This is the single source of truth for all positioning — nothing else calculates
world positions from scratch.

```typescript
const CELL_SIZE      = 3.0    // world units per grid cell
const ELEVATION_UNIT = 1.5    // world units per elevation level
const COMPONENT_GAP  = 0.8    // fraction of cell occupied by component mesh

function gridToWorld(col: number, row: number, elevation = 0): THREE.Vector3 {
  return new THREE.Vector3(
    col * CELL_SIZE,
    elevation * ELEVATION_UNIT,
    row * CELL_SIZE
  )
}

function componentCenter(c: Component): THREE.Vector3 {
  const { col, row, elevation = 0 } = c.position
  const { w = 1, h = 1 } = c.size ?? {}
  // Center of the component's footprint
  return new THREE.Vector3(
    (col + w / 2) * CELL_SIZE,
    elevation * ELEVATION_UNIT,
    (row + h / 2) * CELL_SIZE
  )
}

function componentMeshSize(c: Component): THREE.Vector3 {
  const { w = 1, h = 1 } = c.size ?? {}
  return new THREE.Vector3(
    w * CELL_SIZE * COMPONENT_GAP,
    COMPONENT_HEIGHT[c.type],   // type-specific height constant
    h * CELL_SIZE * COMPONENT_GAP
  )
}
```

Component height by type:

```typescript
const COMPONENT_HEIGHT: Record<ComponentType, number> = {
  client:   0.8,
  service:  1.2,
  database: 1.6,
  queue:    0.6,
  function: 0.5,
  external: 1.0,
}
```

### 4.2 Internal graph model (`types/internal.ts`)

The parser converts the raw JSON into an `InternalGraph` that contains pre-computed
geometry inputs, resolved references, and baked world positions. This is what the
scene consumes — it never reads the raw `FlowDefinition` directly.

```typescript
interface InternalComponent {
  id:         string
  label:      string
  type:       ComponentType
  center:     THREE.Vector3      // world-space center (top face midpoint)
  meshSize:   THREE.Vector3      // x/y/z extents
  meta:       Component['meta']
}

interface InternalConnection {
  id:         string
  from:       InternalComponent
  to:         InternalComponent
  label?:     string
  curve:      THREE.CatmullRomCurve3   // pre-baked path
  tubePoints: THREE.Vector3[]          // points passed to TubeGeometry
}

interface InternalZone {
  id:     string
  label:  string
  color:  THREE.Color
  min:    THREE.Vector3   // world-space corner (min x,z)
  max:    THREE.Vector3   // world-space corner (max x,z)
}

interface InternalGraph {
  components:  Map<string, InternalComponent>
  connections: Map<string, InternalConnection>
  zones:       InternalZone[]
  steps:       Step[]                 // steps are passed through unmodified
  gridBounds:  { minX: number; maxX: number; minZ: number; maxZ: number }
}
```

### 4.3 Ground grid (`scene/GridFloor.ts`)

A subtle grid on the ground plane reinforces the isometric aesthetic.

```typescript
class GridFloor {
  private mesh: THREE.GridHelper

  constructor(scene: THREE.Scene, graph: InternalGraph) {
    const { minX, maxX, minZ, maxZ } = graph.gridBounds
    const sizeX = maxX - minX
    const sizeZ = maxZ - minZ
    const size  = Math.max(sizeX, sizeZ) + CELL_SIZE * 2   // padding

    this.mesh = new THREE.GridHelper(size, size / CELL_SIZE, 0x334455, 0x223344)
    this.mesh.position.set(
      (minX + maxX) / 2,
      -0.15,                  // just below the zone plane
      (minZ + maxZ) / 2
    )
    scene.add(this.mesh)
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh)
    this.mesh.geometry.dispose()
  }
}
```

### 4.4 Zone renderer (`scene/ZoneRenderer.ts`)

Each zone is a filled semi-transparent rectangle on the ground plane with a solid
border and a label overlay.

```typescript
class ZoneRenderer {
  private fillMesh:    THREE.Mesh
  private borderMesh:  THREE.LineSegments
  labelPosition:       THREE.Vector3   // top-left corner, used by overlay

  constructor(scene: THREE.Scene, zone: InternalZone) {
    const width  = zone.max.x - zone.min.x
    const depth  = zone.max.z - zone.min.z

    const geometry = new THREE.PlaneGeometry(width, depth)
    geometry.rotateX(-Math.PI / 2)                 // lay flat on XZ plane

    const fill = new THREE.MeshStandardMaterial({
      color:       zone.color,
      transparent: true,
      opacity:     0.12,
      depthWrite:  false,
    })
    this.fillMesh = new THREE.Mesh(geometry, fill)
    this.fillMesh.position.set(
      (zone.min.x + zone.max.x) / 2,
      -0.08,
      (zone.min.z + zone.max.z) / 2
    )
    this.fillMesh.receiveShadow = true
    scene.add(this.fillMesh)

    // Border
    const edges = new THREE.EdgesGeometry(geometry)
    this.borderMesh = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: zone.color, opacity: 0.6, transparent: true })
    )
    this.borderMesh.position.copy(this.fillMesh.position)
    this.borderMesh.position.y += 0.01
    scene.add(this.borderMesh)

    // Label anchor: top-left corner of the zone, slightly elevated
    this.labelPosition = new THREE.Vector3(zone.min.x, 0.2, zone.min.z)
  }
}
```

Zone labels are rendered as HTML overlays (not 3D text). A `ZoneLabels` React
component reads `labelPosition` from each `ZoneRenderer`, calls
`overlayBridge.worldToScreen`, and positions a `<div>` for each zone. Updates
on every animation frame via `useAnimationFrame`.

### 4.5 Component meshes (`scene/ComponentMesh.ts`)

Each component in the graph has a corresponding `ComponentMesh` instance that
manages its Three.js objects and material state.

#### Geometry by type

```typescript
function buildGeometry(type: ComponentType, size: THREE.Vector3): THREE.BufferGeometry {
  const { x: w, y: h, z: d } = size
  switch (type) {
    case 'client':
      return new THREE.BoxGeometry(w, h, d)

    case 'service':
      return new THREE.BoxGeometry(w, h, d)

    case 'database': {
      // Cylinder body + flat top cap, composed with a Group
      // For simplicity in Phase 2, use a CylinderGeometry
      // (a more elaborate merged geometry can be a future enhancement)
      return new THREE.CylinderGeometry(w / 2, w / 2, h, 24)
    }

    case 'queue':
      // Elongated box, wider than tall
      return new THREE.BoxGeometry(w, h * 0.5, d)

    case 'function':
      return new THREE.OctahedronGeometry(Math.min(w, d) * 0.45)

    case 'external':
      return new THREE.BoxGeometry(w, h, d)
  }
}
```

#### Materials and state colours

```typescript
const TYPE_COLOR: Record<ComponentType, number> = {
  client:   0x4a9edd,
  service:  0x5dbe8a,
  database: 0xe8a838,
  queue:    0xb06bcc,
  function: 0xe85d5d,
  external: 0x888888,
}

type MeshState = 'idle' | 'highlighted' | 'dimmed'

const STATE_EMISSIVE: Record<MeshState, number> = {
  idle:        0x000000,
  highlighted: 0x224422,   // faint green tint
  dimmed:      0x000000,
}

const STATE_OPACITY: Record<MeshState, number> = {
  idle:        1.0,
  highlighted: 1.0,
  dimmed:      0.25,
}
```

#### `ComponentMesh` class

```typescript
class ComponentMesh {
  mesh:       THREE.Mesh
  topCenter:  THREE.Vector3    // world position of top face center (for overlay anchor)
  id:         string

  constructor(scene: THREE.Scene, component: InternalComponent)

  // Tween to a new visual state over `durationMs`
  transitionTo(state: MeshState, durationMs: number): Promise<void>

  // Register/unregister with a Raycaster targets array
  addToRaycastTargets(targets: THREE.Object3D[]): void
  removeFromRaycastTargets(targets: THREE.Object3D[]): void

  dispose(scene: THREE.Scene): void
}
```

`transitionTo` uses Tween.js to animate `material.opacity` and `material.emissive`
simultaneously. It returns a `Promise<void>` that resolves when the tween completes,
which the step transition orchestrator uses to sequence animations.

```typescript
transitionTo(state: MeshState, durationMs: number): Promise<void> {
  return new Promise(resolve => {
    const mat = this.mesh.material as THREE.MeshStandardMaterial
    const targetOpacity  = STATE_OPACITY[state]
    const targetEmissive = new THREE.Color(STATE_EMISSIVE[state])

    new TWEEN.Tween({ opacity: mat.opacity, r: mat.emissive.r, g: mat.emissive.g, b: mat.emissive.b })
      .to({ opacity: targetOpacity, r: targetEmissive.r, g: targetEmissive.g, b: targetEmissive.b }, durationMs)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate(({ opacity, r, g, b }) => {
        mat.opacity = opacity
        mat.transparent = opacity < 1.0
        mat.emissive.setRGB(r, g, b)
      })
      .onComplete(resolve)
      .start()
  })
}
```

#### Labels

Each `ComponentMesh` has a label rendered as an HTML overlay. The label div is
absolutely positioned above the component's `topCenter` using `OverlayBridge`.
Labels always face the viewer (they're HTML, not 3D billboards), and their
opacity tracks the mesh's visual state (dimmed components get dimmed labels).

### 4.6 Connection pipes (`scene/ConnectionPipe.ts`)

Each connection is rendered as a tube following a pre-baked `CatmullRomCurve3`.

#### Route baking (in `parseFlow.ts`)

```typescript
function bakeRoute(
  from: InternalComponent,
  to:   InternalComponent,
  connection: Connection,
  allComponents: Map<string, InternalComponent>
): THREE.CatmullRomCurve3 {
  if (connection.route === 'auto') {
    return autoRoute(from, to)
  } else {
    const waypoints = connection.route.map(wp =>
      gridToWorld(wp.col, wp.row, 0).setY(PIPE_HEIGHT)
    )
    return new THREE.CatmullRomCurve3([
      from.center.clone().setY(PIPE_HEIGHT),
      ...waypoints,
      to.center.clone().setY(PIPE_HEIGHT),
    ])
  }
}

function autoRoute(from: InternalComponent, to: InternalComponent): THREE.CatmullRomCurve3 {
  const start = from.center.clone().setY(PIPE_HEIGHT)
  const end   = to.center.clone().setY(PIPE_HEIGHT)
  // L-shaped route: go to the midpoint column, then turn
  const mid = new THREE.Vector3(end.x, PIPE_HEIGHT, start.z)
  return new THREE.CatmullRomCurve3([start, mid, end])
}
```

`PIPE_HEIGHT` is a constant (default `0.5` world units) that keeps pipes visually
above component bases and zone fills.

#### Tube geometry

```typescript
const TUBE_SEGMENTS    = 64
const TUBE_RADIUS      = 0.06
const TUBE_RADIUS_SEGS = 8

class ConnectionPipe {
  mesh:  THREE.Mesh
  curve: THREE.CatmullRomCurve3
  id:    string

  // Midpoint in world space — used for label overlay anchor
  midpoint: THREE.Vector3

  constructor(scene: THREE.Scene, connection: InternalConnection)
  setActive(active: boolean, durationMs: number): Promise<void>
  dispose(scene: THREE.Scene): void
}
```

Idle material: `MeshStandardMaterial`, color `0x334455`, opacity `0.35`, transparent.
Active material: same color lightened, opacity `1.0`, `emissive: 0x1a3a5c`.

`setActive` tweens opacity and emissive, returning a Promise like `ComponentMesh.transitionTo`.

Connection labels are HTML overlays anchored to `midpoint`, shown only when the
connection is active.

### 4.7 Data packets (`scene/DataPacket.ts`)

A packet is a short-lived Three.js object that animates from `t = 0` to `t = 1`
along a `ConnectionPipe`'s curve.

```typescript
class DataPacket {
  mesh:   THREE.Mesh
  private t: number = 0

  constructor(scene: THREE.Scene, shape: PacketShape)

  // Animate from t=0 to t=1 along `curve` over `durationMs`
  // Returns a Promise that resolves when the animation is complete
  travel(curve: THREE.CatmullRomCurve3, durationMs: number): Promise<void>

  dispose(scene: THREE.Scene): void
}
```

#### Packet travel implementation

```typescript
travel(curve: THREE.CatmullRomCurve3, durationMs: number): Promise<void> {
  return new Promise(resolve => {
    const target = { t: 0 }
    new TWEEN.Tween(target)
      .to({ t: 1 }, durationMs)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate(() => {
        const pos = curve.getPointAt(target.t)
        this.mesh.position.copy(pos)

        // Orient the packet tangent to the curve for visual interest
        const tangent = curve.getTangentAt(target.t)
        this.mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          tangent.normalize()
        )

        // Gentle bob/spin
        this.mesh.rotation.z += 0.02
      })
      .onComplete(resolve)
      .start()
  })
}
```

Packet geometry and materials per shape:

```typescript
function buildPacketMesh(shape: PacketShape): THREE.Mesh {
  let geometry: THREE.BufferGeometry
  const color = PACKET_COLOR   // bright cyan: 0x00ffcc

  switch (shape) {
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.12, 16, 8)
      break
    case 'document':
      geometry = new THREE.BoxGeometry(0.28, 0.03, 0.20)
      break
    case 'token':
      geometry = new THREE.CylinderGeometry(0.10, 0.10, 0.025, 16)
      break
    case 'blob':
      geometry = new THREE.SphereGeometry(0.14, 8, 6)
      break
    case 'envelope':
      geometry = new THREE.BoxGeometry(0.22, 0.025, 0.16)
      break
  }

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      emissive:     new THREE.Color(color),
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.2,
    })
  )
}
```

### 4.8 Scene orchestrator (`scene/FlowScene.ts`)

`FlowScene` extends `SceneManager` and owns all rendered objects. It is the
bridge between the step engine and the Three.js scene.

```typescript
class FlowScene extends SceneManager {
  private graph:       InternalGraph
  private components:  Map<string, ComponentMesh>
  private pipes:       Map<string, ConnectionPipe>
  private zones:       ZoneRenderer[]
  private grid:        GridFloor
  private activePacket: DataPacket | null = null
  overlayBridge:       OverlayBridge

  constructor(canvas: HTMLCanvasElement, graph: InternalGraph)

  // Called by the step engine listener when the step changes
  applyStep(step: Step, prevStep: Step | null, durationMs: number): void

  // Called every frame by the animation loop
  protected onFrame(deltaMs: number): void
}
```

#### Camera overview position

On construction, compute the world-space center and extent of the full graph,
then position the camera to frame all components:

```typescript
private computeOverviewCamera(): void {
  const { minX, maxX, minZ, maxZ } = this.graph.gridBounds
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  const extentX = (maxX - minX) / 2 + CELL_SIZE
  const extentZ = (maxZ - minZ) / 2 + CELL_SIZE
  const frustumNeeded = Math.max(extentX, extentZ) * 1.2

  this.overviewTarget   = new THREE.Vector3(centerX, 0, centerZ)
  this.overviewFrustum  = frustumNeeded
}
```

Store `overviewTarget` and `overviewFrustum` as instance properties.

### 4.9 Step transition orchestration

`applyStep` is the core of the visualization. It computes the diff between the
previous step and the current step, then fires all necessary tweens.

```typescript
applyStep(step: Step, prevStep: Step | null, durationMs: number): void {
  const PHASE_MATERIAL  = durationMs * 0.4   // first 40% of duration
  const PHASE_PACKET    = durationMs * 0.8   // next 40%
  const PHASE_CAMERA    = durationMs * 0.3   // overlaps with material phase

  // 1. Dispose active packet from previous step
  if (this.activePacket) {
    this.activePacket.dispose(this.scene)
    this.activePacket = null
  }

  // 2. Transition component materials
  for (const [id, mesh] of this.components) {
    const state: MeshState = step.highlight.includes(id)
      ? 'highlighted'
      : step.highlight.length > 0
        ? 'dimmed'
        : 'idle'
    mesh.transitionTo(state, PHASE_MATERIAL)
  }

  // 3. Transition pipe materials
  for (const [id, pipe] of this.pipes) {
    const active = step.active_connections.includes(id)
    pipe.setActive(active, PHASE_MATERIAL)
  }

  // 4. Animate camera
  this.animateCamera(step.camera, PHASE_CAMERA)

  // 5. Animate packet (after a short delay so material transitions are visible first)
  if (step.packet) {
    const pipe = this.pipes.get(step.packet.connection)
    if (pipe) {
      setTimeout(() => {
        const packet = new DataPacket(this.scene, step.packet!.shape)
        this.activePacket = packet
        packet.travel(pipe.curve, PHASE_PACKET)
      }, PHASE_MATERIAL * 0.5)
    }
  }

  // 6. Overlay updates are driven by React re-rendering on step state change
  //    (annotations, popouts, hover tooltips are pure React state)
}
```

#### Camera animation

```typescript
private animateCamera(config: Step['camera'], durationMs: number): void {
  if (!config || config.focus === undefined) {
    this.tweenCameraToOverview(durationMs)
    return
  }

  if (config.focus === null) {
    this.tweenCameraToOverview(durationMs)
    return
  }

  const component = this.graph.components.get(config.focus)
  if (!component) return

  const zoom   = config.zoom ?? 1.0
  const target = component.center.clone()

  this.tweenCameraTo(target, this.overviewFrustum / zoom, durationMs)
}

private tweenCameraTo(
  target: THREE.Vector3,
  frustum: number,
  durationMs: number
): void {
  const aspect = this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight

  new TWEEN.Tween({
    tx: this.cameraTarget.x,
    tz: this.cameraTarget.z,
    f:  this.currentFrustum,
  })
    .to({ tx: target.x, tz: target.z, f: frustum }, durationMs)
    .easing(TWEEN.Easing.Cubic.InOut)
    .onUpdate(({ tx, tz, f }) => {
      this.cameraTarget.set(tx, 0, tz)
      this.currentFrustum = f

      // Reposition camera at isometric offset from target
      this.camera.position.set(tx + 50, 50, tz + 50)
      this.camera.lookAt(this.cameraTarget)

      // Resize frustum
      this.camera.left   = -f * aspect
      this.camera.right  =  f * aspect
      this.camera.top    =  f
      this.camera.bottom = -f
      this.camera.updateProjectionMatrix()
    })
    .start()
}
```

### 4.10 Hover system (`scene/HoverSystem.ts` + `hooks/useHover.ts`)

#### Three.js side

```typescript
class HoverSystem {
  private raycaster:   THREE.Raycaster = new THREE.Raycaster()
  private pointer:     THREE.Vector2   = new THREE.Vector2()
  private targets:     THREE.Object3D[] = []
  private onHoverChange: (id: string | null) => void

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.OrthographicCamera,
    onHoverChange: (id: string | null) => void
  )

  addTarget(mesh: THREE.Object3D): void
  removeTarget(mesh: THREE.Object3D): void
  update(): void      // called each frame from FlowScene.onFrame
  dispose(): void
}
```

On `mousemove`, update `this.pointer` with normalized device coordinates.
On `update()`, cast the ray and check intersections against `this.targets`.
On hover change, call `onHoverChange` with the intersected mesh's `userData.componentId`
or `null` if nothing is hit.

`userData.componentId` is set on each `ComponentMesh.mesh` in the constructor:
```typescript
this.mesh.userData.componentId = component.id
```

#### React side (`hooks/useHover.ts`)

```typescript
function useHover(graph: InternalGraph | null): {
  hoveredId:   string | null
  setHoveredId: (id: string | null) => void
} {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  return { hoveredId, setHoveredId }
}
```

`FlowScene` calls `setHoveredId` (passed in as a prop/callback) when the hover
changes. The React side reads `hoveredId` and renders the tooltip overlay.

### 4.11 Hover tooltip (`components/HoverTooltip.tsx`)

```tsx
function HoverTooltip({
  hoveredId,
  graph,
  bridge,
}: {
  hoveredId:   string | null
  graph:       InternalGraph
  bridge:      OverlayBridge
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useAnimationFrame(() => {
    if (!hoveredId) return
    const component = graph.components.get(hoveredId)
    if (!component) return
    setPos(bridge.worldToScreen(component.topCenter))
  }, [hoveredId])

  if (!hoveredId) return null
  const component = graph.components.get(hoveredId)
  if (!component) return null

  const { meta } = component
  return ReactDOM.createPortal(
    <div
      className={styles.tooltip}
      style={{ transform: `translate(${pos.x}px, ${pos.y - 20}px)` }}
    >
      <strong>{component.label}</strong>
      {meta?.description && <p>{meta.description}</p>}
      {meta?.file && (
        <code>{meta.file}{meta.line ? `:${meta.line}` : ''}</code>
      )}
      {meta?.notes && <p className={styles.notes}>{meta.notes}</p>}
    </div>,
    document.getElementById('overlay-root')!
  )
}
```

### 4.12 Annotations (`components/AnnotationOverlay.tsx`)

Annotations for the current step are rendered as leader-line callout cards. See § 2.8
for the full design rationale. Each card floats at a screen-space offset from its
target component with a thin SVG line connecting the two.

#### DOM structure

Two elements are portalled into `#overlay-root`:

1. **SVG layer** — a `<svg>` element covering the full viewport (`position: absolute; inset: 0`).
   Contains one `<line>` per annotation. `pointer-events: none`.
2. **Card layer** — one `<div>` per annotation. `position: absolute; top: 0; left: 0`.
   Positioned via `transform: translate(Xpx, Ypx)` updated per frame.

#### Offset directions

```typescript
const OFFSETS = [
  {  dx:  130, dy: -90 },   // index 0: upper-right
  {  dx: -130, dy: -90 },   // index 1: upper-left
  {  dx:  130, dy:  60 },   // index 2: lower-right
  {  dx: -130, dy:  60 },   // index 3: lower-left
]
```

For annotation `i`, the card screen position is:
```
cardX = anchorScreen.x + OFFSETS[i % 4].dx
cardY = anchorScreen.y + OFFSETS[i % 4].dy + Math.floor(i / 4) * 40
```

The leader line runs from `anchorScreen` (component `topCenter` projected to screen)
to the nearest corner of the card.

#### Per-frame updates (no React state)

All position updates are direct DOM style mutations inside `useAnimationFrame`,
identical to the pattern used by `ZoneLabels` and `HoverTooltip`:

```typescript
useAnimationFrame(() => {
  annotations.forEach((ann, i) => {
    const component = graph.components.get(ann.target)
    if (!component) return
    const anchor = bridge.worldToScreen(component.topCenter)

    const { dx, dy } = OFFSETS[i % 4]
    const extraY = Math.floor(i / 4) * 40
    const cardX  = anchor.x + dx
    const cardY  = anchor.y + dy + extraY

    cardRefs.current[i]?.style.setProperty('transform', `translate(${cardX}px, ${cardY}px)`)
    lineRefs.current[i]?.setAttribute('x1', String(anchor.x))
    lineRefs.current[i]?.setAttribute('y1', String(anchor.y))
    lineRefs.current[i]?.setAttribute('x2', String(cardX))
    lineRefs.current[i]?.setAttribute('y2', String(cardY))
  })
}, [annotations, graph, bridge])
```

#### Fade transition

Cards and lines carry a CSS class that controls `opacity`. On mount the class is
absent (opacity 0). After the first frame it is added (opacity 1, transition 200 ms).
On unmount the class is removed before the component is torn down, giving a 200 ms
fade-out (achieved by delaying the unmount with a `useEffect` cleanup timeout).

#### CSS

`.callout` — rounded card, semi-transparent dark background, coloured left border
matching the target component's type colour, regular weight text.

`.transform` — same card shape, monospace font, slightly darker background, cyan
left border. Visually signals "this is a code-level operation".

`.leaderLine` — `stroke: rgba(255,255,255,0.25)`, `stroke-width: 1`, `stroke-dasharray: 4 4`.
Dashed so it reads as a reference indicator rather than a data connection (which uses
solid TubeGeometry pipes).

### 4.13 Popout panels (`components/PopoutPanel.tsx`)

Popouts follow the same anchor-to-world-position pattern as annotations. They
display structured data in a card format with simple key-value syntax highlighting:

- Keys in a muted colour
- String values in green
- Number values in orange
- Boolean values in blue
- Nested objects rendered inline collapsed (expand on click — future enhancement)

Each popout is offset from the annotation anchor by a fixed pixel amount to avoid
overlap when both are active on the same component.

### 4.14 `useAnimationFrame` hook

Used by all overlay components to re-derive screen positions each frame:

```typescript
function useAnimationFrame(callback: () => void, deps: unknown[]): void {
  const savedCallback = useRef(callback)
  const rafRef        = useRef<number>()

  useEffect(() => { savedCallback.current = callback }, [callback])

  useEffect(() => {
    const loop = () => {
      savedCallback.current()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, deps)
}
```

### 4.15 Wiring everything together (`App.tsx`)

```tsx
function App(): JSX.Element {
  const [graph, setGraph]           = useState<InternalGraph | null>(null)
  const [engine, setEngine]         = useState<StepEngine | null>(null)
  const stepState                   = useStepEngine(engine)
  const { hoveredId, setHoveredId } = useHover(graph)
  const sceneRef                    = useRef<FlowScene | null>(null)
  const bridgeRef                   = useRef<OverlayBridge | null>(null)

  // Load flow on mount
  useEffect(() => {
    loadFlow('example').then(def => {
      const g = parseFlow(def)
      setGraph(g)
      setEngine(new StepEngine(def.steps))
    })
  }, [])

  // Wire step engine to scene
  useEffect(() => {
    if (!engine || !sceneRef.current) return
    return engine.subscribe(state => {
      sceneRef.current!.applyStep(state.step, null, 800)
    })
  }, [engine])

  if (!graph || !stepState) return <LoadingScreen />

  return (
    <div className={styles.app}>
      <CanvasContainer
        graph={graph}
        onSceneReady={(scene, bridge) => {
          sceneRef.current  = scene
          bridgeRef.current = bridge
          scene.setHoverCallback(setHoveredId)
          // Apply step 0 immediately with no animation duration
          scene.applyStep(stepState.step, null, 0)
        }}
      />

      {/* Overlays */}
      {stepState.step.annotations && bridgeRef.current && (
        <AnnotationOverlay
          annotations={stepState.step.annotations}
          graph={graph}
          bridge={bridgeRef.current}
        />
      )}
      {stepState.step.popouts && bridgeRef.current && (
        <PopoutPanel
          popouts={stepState.step.popouts}
          graph={graph}
          bridge={bridgeRef.current}
        />
      )}
      {hoveredId && bridgeRef.current && (
        <HoverTooltip
          hoveredId={hoveredId}
          graph={graph}
          bridge={bridgeRef.current}
        />
      )}

      {/* UI chrome */}
      <StepHUD engine={engine} />
      <StepControls engine={engine} />
    </div>
  )
}
```

### 4.16 Phase 2 completion checklist

- [ ] All components render at correct grid positions with correct geometry by type
- [ ] Component labels track their mesh positions on resize
- [ ] Zones render with correct bounds, fill, border, and label
- [ ] Ground grid renders below zones and components
- [ ] Pipes render between components using auto-route (L-shape) correctly
- [ ] Explicit waypoint routes render correctly
- [ ] Stepping forward highlights the correct components and dims others
- [ ] Stepping backward reverses the highlight state correctly
- [ ] Active connections illuminate when a step references them
- [ ] A `document`-shaped packet travels along a pipe and arrives at the correct component
- [ ] All five packet shapes render and travel correctly
- [ ] Camera focus tweens to the specified component and returns on `null`
- [ ] Camera zoom adjusts the frustum correctly at multiple zoom levels
- [ ] Hover tooltip appears over the correct component with correct metadata
- [ ] Tooltip disappears when the cursor leaves the component
- [ ] `callout` annotations render in the correct position for their target component
- [ ] `transform` annotations render with distinct visual treatment
- [ ] Popout panels appear and display structured data for the current step
- [ ] Autoplay steps through all steps and stops at the end
- [ ] Autoplay respects the step transition duration (next step not triggered until animation is complete)
- [ ] Resize correctly repositions all overlay elements
- [ ] Dispose chain: loading a new flow cleans up all Three.js objects without memory leaks

---

## 5. Example flow file

Save to `public/flows/example.json`. Used throughout development to exercise
all features.

```json
{
  "meta": {
    "title": "Telemetry Pipeline",
    "description": "How a button click becomes a row in ClickHouse"
  },
  "layout": {
    "grid": { "cols": 10, "rows": 6 }
  },
  "zones": [
    {
      "id": "z_client",
      "label": "Browser",
      "color": "#4a9edd",
      "bounds": { "col": 0, "row": 1, "width": 2, "height": 4 }
    },
    {
      "id": "z_ingest",
      "label": "Ingest Layer",
      "color": "#5dbe8a",
      "bounds": { "col": 3, "row": 0, "width": 4, "height": 6 }
    },
    {
      "id": "z_storage",
      "label": "Storage Layer",
      "color": "#e8a838",
      "bounds": { "col": 8, "row": 1, "width": 2, "height": 4 }
    }
  ],
  "components": [
    {
      "id": "browser",
      "label": "Browser Client",
      "type": "client",
      "position": { "col": 1, "row": 3 },
      "meta": {
        "description": "React SPA. Fires analytics events on user interaction.",
        "file": "src/analytics/client.ts",
        "line": 42,
        "notes": "Uses navigator.sendBeacon for reliability on page unload."
      }
    },
    {
      "id": "collector",
      "label": "Collector API",
      "type": "service",
      "position": { "col": 4, "row": 2 },
      "size": { "w": 2, "h": 1 },
      "meta": {
        "description": "Node.js HTTP service. Validates, batches, and forwards events.",
        "file": "services/collector/src/index.ts",
        "line": 1
      }
    },
    {
      "id": "kafka",
      "label": "Kafka Topic",
      "type": "queue",
      "position": { "col": 4, "row": 4 },
      "size": { "w": 2, "h": 1 },
      "meta": {
        "description": "telemetry-events topic. Partitioned by userId.",
        "notes": "Retention: 7 days. Replication factor: 3."
      }
    },
    {
      "id": "clickhouse",
      "label": "ClickHouse",
      "type": "database",
      "position": { "col": 9, "row": 3 },
      "meta": {
        "description": "Columnar store for event analytics.",
        "notes": "events table, partitioned by toYYYYMM(timestamp)."
      }
    }
  ],
  "connections": [
    { "id": "c1", "from": "browser",   "to": "collector", "label": "POST /events", "route": "auto" },
    { "id": "c2", "from": "collector", "to": "kafka",     "label": "produce()",    "route": "auto" },
    { "id": "c3", "from": "kafka",     "to": "clickhouse","label": "consumer",     "route": "auto" }
  ],
  "steps": [
    {
      "id": 1,
      "title": "User action fires event",
      "description": "A button click triggers analytics.track() in the browser.",
      "highlight": ["browser"],
      "active_connections": [],
      "camera": { "focus": "browser", "zoom": 1.5 },
      "annotations": [
        {
          "type": "callout",
          "target": "browser",
          "text": "analytics.track('button_click', { componentId: 'cta' })"
        }
      ],
      "popouts": [
        {
          "title": "Event payload",
          "anchor": "browser",
          "data": {
            "event": "button_click",
            "userId": "u_9f3a",
            "timestamp": 1718000000000,
            "properties": { "componentId": "cta" }
          }
        }
      ],
      "packet": null
    },
    {
      "id": 2,
      "title": "Event sent to Collector",
      "description": "SDK serializes the event and POSTs it to the collector endpoint.",
      "highlight": ["browser", "collector"],
      "active_connections": ["c1"],
      "camera": { "focus": null },
      "annotations": [],
      "popouts": [],
      "packet": {
        "connection": "c1",
        "shape": "document",
        "data": {
          "event": "button_click",
          "userId": "u_9f3a",
          "timestamp": 1718000000000
        }
      }
    },
    {
      "id": 3,
      "title": "Collector validates and batches",
      "description": "Collector checks schema, attaches server-side metadata, then produces to Kafka.",
      "highlight": ["collector"],
      "active_connections": [],
      "camera": { "focus": "collector", "zoom": 1.3 },
      "annotations": [
        {
          "type": "transform",
          "target": "collector",
          "text": "EventValidator.validate() + MetadataEnricher.enrich() → KafkaProducer.send()"
        }
      ],
      "popouts": [
        {
          "title": "Enriched event",
          "anchor": "collector",
          "data": {
            "event": "button_click",
            "userId": "u_9f3a",
            "timestamp": 1718000000000,
            "serverTimestamp": 1718000000041,
            "ip": "203.0.113.4",
            "sessionId": "sess_7c2d"
          }
        }
      ],
      "packet": null
    },
    {
      "id": 4,
      "title": "Event published to Kafka",
      "description": "Enriched event produced to the telemetry-events topic, keyed by userId.",
      "highlight": ["collector", "kafka"],
      "active_connections": ["c2"],
      "camera": { "focus": null },
      "annotations": [],
      "popouts": [],
      "packet": {
        "connection": "c2",
        "shape": "envelope",
        "data": {
          "topic": "telemetry-events",
          "partition": 3,
          "key": "u_9f3a"
        }
      }
    },
    {
      "id": 5,
      "title": "Consumer writes to ClickHouse",
      "description": "A Kafka consumer reads the event and inserts it into ClickHouse.",
      "highlight": ["kafka", "clickhouse"],
      "active_connections": ["c3"],
      "camera": { "focus": null },
      "annotations": [],
      "popouts": [],
      "packet": {
        "connection": "c3",
        "shape": "document",
        "data": {
          "event": "button_click",
          "userId": "u_9f3a"
        }
      }
    },
    {
      "id": 6,
      "title": "Data at rest",
      "description": "Event is now queryable in ClickHouse. End of the pipeline.",
      "highlight": ["clickhouse"],
      "active_connections": [],
      "camera": { "focus": "clickhouse", "zoom": 1.3 },
      "annotations": [
        {
          "type": "callout",
          "target": "clickhouse",
          "text": "SELECT count() FROM events WHERE event = 'button_click'"
        }
      ],
      "popouts": [],
      "packet": null
    }
  ]
}
```

---

## 5. Phase 3 — Claude Skill Integration

Phase 3 turns FlowViz into a Claude skill. A developer working in any codebase can
invoke the skill, point Claude at a code path or function, and receive a rendered
visualization immediately — no manual JSON authoring required.

### 5.1 Skill overview

The skill is a SKILL.md file that Claude Code loads when invoked. It instructs
Claude to:

1. Read the relevant source files identified by the developer.
2. Trace the data flow (function calls, HTTP requests, queue publishes, DB writes, etc.).
3. Generate a valid `FlowDefinition` JSON (§ 2) representing the flow.
4. Deliver a link the developer can open immediately to view the visualization.

The SKILL.md must embed the full schema (§ 2) as a reference block so Claude can
generate valid JSON without needing to guess field names or structure.

### 5.2 JSON generation guidelines (for the skill prompt)

These rules must appear in the skill prompt to guide Claude's output:

**Components**
- Map each distinct service, function, database, queue, or external system to a
  `Component` with the appropriate `type`.
- Use the actual file path and line number for `meta.file` and `meta.line` where
  determinable from source.
- Assign grid positions left-to-right following the data flow direction. Branches
  (e.g. success/error paths) go on separate rows.
- Use `size.w > 1` for components that are architecturally central or handle many connections.

**Connections**
- Create one `Connection` per distinct data transfer (HTTP call, function return,
  queue publish, DB query, etc.).
- Use `label` to name the operation (e.g. `"POST /api/events"`, `"INSERT INTO orders"`).
- Default to `route: "auto"` unless waypoints are needed to avoid visual crossings.
- Model return paths (responses, callbacks) as separate named connections travelling
  the opposite direction — do not use a direction flag.

**Steps**
- Each step should correspond to one meaningful moment in the flow: a call is made,
  data is transformed, a response is received.
- Highlight only the components active in that step; others are dimmed automatically.
- Choose packet shapes semantically:
  - `document` for HTTP request/response bodies, JSON payloads
  - `token` for auth tokens, JWTs, session keys
  - `sphere` for generic events or messages
  - `envelope` for HTTP redirects or wrapped responses
  - `blob` for binary data or file content
- Include an `annotation` of type `transform` on any step where a component
  meaningfully transforms the data (e.g. validation, enrichment, encryption).
- Include a `popout` showing the payload shape at any step where the data structure
  changes significantly.

**Zones**
- Group components that belong to the same service boundary, deployment unit, or
  trust boundary into a `Zone`.
- Zone bounds should encompass all components in the group with one cell of padding.

**Layout heuristic**
- Orient the grid so data flows left to right (increasing col) and forks go top/bottom
  (different rows). The grid need not be fully packed — leave empty cells to avoid
  visual crowding.

### 5.3 Delivery mechanism (TBD)

The primary open design question for Phase 3 is how the developer views the
visualization immediately after Claude generates the JSON. The method must work
inside a Claude Code session without requiring manual steps from the developer.

**Options under consideration:**

| Option | How it works | Pros | Cons |
|---|---|---|---|
| Local dev server | Skill spins up `vite preview` on the built app, opens browser | Full app experience | Requires built app on disk; port conflicts |
| Embedded HTML file | Skill generates a self-contained `.html` file with the JSON and a bundled version of the renderer baked in | Zero dependencies at view time | Requires bundling strategy; large file |
| Data URI / base64 | JSON encoded into a `?flow=<base64>` query param on a hosted instance | No local server needed | URL length limits; requires hosted instance |
| Hosted instance + URL | Skill writes the JSON to a known location; a hosted FlowViz instance reads it | Clean URL | Requires hosting infrastructure |
| Claude artifact | Skill renders the visualization as an HTML artifact inside Claude's UI | No external tooling | Limited to Claude UI; no sharing link |

The chosen approach will be documented here once determined. Phase 3 implementation
should not begin until Phase 2 is complete and the delivery mechanism is decided.

### 5.4 Phase 3 completion checklist

- [ ] Delivery mechanism chosen and documented in § 5.3
- [ ] SKILL.md written with full schema reference (§ 2) embedded
- [ ] Skill tested against at least two real codebases
- [ ] Generated JSON validates cleanly against the schema types in `schema.ts`
- [ ] Visualization opens immediately from the developer's Claude Code session
- [ ] Skill prompt produces consistent grid layouts (data flows left to right)
- [ ] Packet shapes are assigned correctly based on data type semantics
- [ ] Zones are generated correctly when service boundaries are evident in the code
