# FlowViz — Requirements Summary

A record of all product requirements gathered during the initial design conversation.

---

## What it is

A web application for creating and viewing animated isometric data flow diagrams.
The primary audience is software developers who need to communicate how data moves
through a system — for example, when adding telemetry, documenting an auth flow,
or onboarding colleagues to a new code path.

---

## Core concept

A developer (or LLM) authors a flow definition in JSON. Another developer opens
the app, loads that definition, and steps through an animated isometric diagram
that shows where data originates, where it travels, and where it ends up — with
enough context at each step to understand what is happening in the code.

---

## Constraints

- All dependencies must be open source (MIT or equivalent). No paid libraries.
- Deployable as a static site. No required backend.
- Built with Claude Code assistance.

---

## Visualization

### Rendering style
- Isometric 3D view (orthographic camera, not perspective).
- Components rendered as distinct 3D shapes on a grid.
- Components connected by pipe geometry.
- A subtle isometric grid on the ground plane.

### Components
- Each component represents a service, client, database, queue, function, or
  external system.
- Components are hoverable. Hovering reveals a tooltip showing:
  - What the component is
  - Where it lives in code (file path and line number, if applicable)
  - Freeform notes
- Components can be highlighted individually or as a group to draw attention.
  Non-highlighted components are dimmed.
- Components can vary in size on the grid to reflect architectural importance.

### Service boundaries (zones)
- Rectangular regions drawn on the isometric ground plane can group components
  into named service boundaries (e.g. "Frontend", "Auth Service", "External IdP").
- Zones are semi-transparent filled rectangles with a coloured border and label.

### Data packets
- A packet is an object that animates along a pipe from one component to another
  to represent data in transit.
- Packets have different visual shapes to convey the type of data being moved:
  - Sphere — generic event or message
  - Document (flat tablet) — JSON body, HTTP request/response
  - Token (thin disc) — auth token, JWT, session key
  - Blob (irregular sphere) — binary data, file content
  - Envelope — HTTP redirect, response envelope
- A packet carries a payload (key-value data) visible during transit.

### Connections
- Pipes connect components along a route defined in the flow config.
- Routes can be auto-generated (orthogonal L-shape from source to target) or
  explicitly specified as a sequence of grid waypoints.
- Connections are bidirectional by design: a return journey (e.g. an OAuth
  redirect back to the client) is modelled as a separate named connection
  travelling the other way, not a direction flag.
- Active connections illuminate when a step references them.

### Annotations
- Per-step text overlays anchored to a specific component.
- Two types:
  - Callout — general descriptive note in a speech-bubble style.
  - Transform — code-style callout (monospace) describing how a class or
    function transforms the data at that point.
- Appear for the duration of the step they belong to.

---

## Navigation and animation

- A back / play-pause / forward control lets the viewer step through the flow
  manually or let it run automatically.
- There is no scroll-locking. Navigation is driven entirely by the step controls.
- Transitions between steps are animated:
  - Component highlight/dim states fade in and out.
  - Pipe active states illuminate smoothly.
  - Data packets animate along their connection curve.
  - All transitions run concurrently over a fixed duration.
- Autoplay advances to the next step automatically after each transition
  completes, then stops at the last step.

### Camera
- Each step can optionally move the camera to focus on a specific component,
  with a configurable zoom level.
- When no focus is specified the camera returns to an overview position that
  frames the entire grid.
- Camera movement is animated (smooth tween).

---

## Input format

- Flow definitions are JSON files.
- The schema is opinionated and explicit: component positions, zone bounds, and
  connection routes are all defined in the config rather than computed by the
  engine. This makes the spatial layout intentional and the output predictable.
- Layout uses a 2D grid coordinate system (col, row) rather than raw world
  coordinates, making it natural to reason about.
- The schema is designed so that a language model can generate a valid flow
  definition from a stack trace or code path analysis without needing spatial
  reasoning beyond "data flows left to right".

### Key schema elements
- `meta` — title and description
- `layout.grid` — defines the grid dimensions (cols × rows)
- `zones` — named service boundary rectangles with explicit grid bounds
- `components` — nodes with type, grid position, optional size, and metadata
  (description, file, line number, notes)
- `connections` — edges with source, target, label, and route (auto or waypoints)
- `steps` — ordered sequence, each with:
  - highlight (component ids)
  - active_connections (connection ids)
  - camera focus and zoom
  - annotations (callout or transform)
  - packet (shape, connection, payload)

---

## Future direction (discussed but out of scope for v1)

- A GUI editor for authoring flows without hand-writing JSON.
- A library or gallery view for multiple saved flows.

---

## Phase 3 — Claude skill integration

### Goal

FlowViz should be usable as a Claude skill. A developer working in another codebase
can invoke the skill, point Claude at a file, function, or code path, and receive
a rendered visualization immediately — without manually writing any JSON.

### User journey

1. Developer invokes the FlowViz skill inside a Claude session (e.g. via Claude Code).
2. Developer describes the code path to visualize (e.g. "map the auth flow starting
   from `handleLogin` in `src/auth/pkce.ts`").
3. Claude reads the relevant source files, traces the data flow, and generates a
   valid `FlowDefinition` JSON conforming to the schema in `flowviz-design.md` § 2.
4. Claude provides the developer with a link to view the visualization immediately,
   without any manual setup step.

### Constraints

- The skill must work inside Claude Code (the primary context a developer uses it).
- JSON generation must conform exactly to the schema in § 2. The skill prompt must
  include the schema as reference so Claude can generate valid output without hallucinating fields.
- The method used to serve the visualization immediately is **TBD** — this is the
  primary open design question for Phase 3 (see `flowviz-design.md` § 5 for options).
- The skill should not require the developer to have a running local server unless
  that turns out to be the best delivery mechanism.

### What Claude generates

Claude is responsible for:
- Identifying the components (services, functions, databases, etc.) involved in the
  code path, including their types, grid positions, and any available metadata
  (file path, line number, description).
- Identifying the connections between them, with appropriate labels and routes.
- Identifying logical service boundaries and mapping them to zones.
- Constructing a step sequence that narrates the data flow from origin to destination.
- Assigning appropriate packet shapes based on what is being passed (HTTP request →
  `document`, token → `token`, event → `sphere`, etc.).

### Open questions

- **Delivery mechanism**: how does the developer view the visualization immediately?
  Options include: a local dev server, an embedded HTML file with the JSON baked in,
  a data URI, a hosted instance with the JSON passed as a query parameter, or
  something else. To be determined in Phase 3 design.
