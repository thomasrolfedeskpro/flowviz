# FlowViz — Flow Authoring Guide for LLMs

This document is the authoritative reference for generating valid FlowViz flow
definition JSON files. Read it fully before producing any JSON. The schema is
strict — invalid field names or values will silently break the visualisation.

---

## 1. What FlowViz renders

FlowViz produces an animated isometric 3D diagram. The viewer steps forward and
backward through a sequence of states. At each step:

- A subset of **components** (boxes, cylinders, logos, etc.) are highlighted; others dim.
- A subset of **connections** (pipes between components) illuminate.
- An optional **packet** (a glowing shape) travels along one connection and, on
  arrival, flashes a colour that reflects the outcome (success / error / warning).
- Optional **annotation cards** appear with leader lines pointing to specific components.
- The camera may pan and zoom to focus on a specific component.

The goal is to tell a clear story about how data moves through a system — one
meaningful event per step.

---

## 1b. Where a flow file lives

Flows live under `public/flows/` in one of two directories, and which one you
pick matters because only one of them is committed:

| Directory | Committed? | For |
|---|---|---|
| `public/flows/examples/` | yes | Reference flows that ship with the repo |
| `public/flows/custom/` | **no — git-ignored** | Your own work, and anything specific to your product |

**Write new flows to `public/flows/custom/<slug>.json`** unless you have been
asked for a shipped example. Product-specific diagrams end up naming internal
services, file paths and customers; keeping them out of git is deliberate.

The filename is the flow's id, and the id is what `?flow=` takes — it does not
include the directory, so `?flow=my-flow` finds `custom/my-flow.json`. Two flows
in different directories cannot share a filename.

---

## 2. Top-level structure

```json
{
  "meta":        { "title": "...", "description": "..." },
  "layout":      { "grid": { "cols": 10, "rows": 6 } },
  "zones":       [...],
  "components":  [...],
  "connections": [...],
  "steps":       [...]
}
```

Every field is required. `zones` may be an empty array if zones are not needed.

---

## 3. `meta`

```json
{
  "title":       "OAuth 2.0 PKCE Flow",
  "description": "How a browser-based app obtains an access token without a client secret."
}
```

`title` is shown in the step HUD. `description` is optional context.

---

## 4. `layout`

```json
{ "grid": { "cols": 12, "rows": 6 } }
```

The grid defines the coordinate space. All positions are integer (col, row) values.
`cols` controls width (left-to-right), `rows` controls depth (top-to-bottom in
screen space).

**Sizing guidance:**
- Default cell size is 3.0 world units. The camera auto-frames the full grid.
- Use enough cols for the flow to spread horizontally. 8–16 is typical.
- Use enough rows to separate parallel tracks. 4–10 is typical.
- Leave empty cells — crowding is worse than padding.

---

## 5. `zones`

Zones are semi-transparent coloured regions on the ground plane that group
related components. Each zone gets a label rendered as a flat coloured plate just
outside the zone's top edge (folder-tab style).

```json
{
  "id":     "z_browser",
  "label":  "Browser",
  "color":  "#4a9edd",
  "bounds": { "col": 0, "row": 1, "width": 3, "height": 4 }
}
```

| Field      | Type   | Notes |
|------------|--------|-------|
| `id`       | string | Unique. Referenced by child zones via `parentId`. |
| `label`    | string | Short (1–3 words). Rendered as a flat plate on the ground plane outside the zone's near edge. |
| `color`    | string | Hex colour. Used for fill, border, and label background. |
| `bounds`   | object | `col`/`row` = top-left corner. `width`/`height` in grid cells. |
| `parentId` | string | Optional. ID of a parent zone. Nested zones render inside the parent with a slightly raised ground plane and independent label. Use to model sub-zones within a larger boundary (e.g. AZs inside a VPC). |
| `outline`  | string | Optional. `"dashed"` draws the border as a dashed line instead of solid. Useful for logical boundaries (VPCs, cloud regions) that don't have a physical enclosure. |
| `meta`     | object | Optional. `description` and `notes` strings shown in future tooltip UI. |

**Zone sizing rule:** bounds should enclose all member components with at least
one cell of padding on each side. This prevents the zone border from touching
component meshes.

**Zone gap rule (critical):** Adjacent zones that are side-by-side MUST have at
least **1 empty grid column** between them. If zone A ends at col X (i.e.
`col + width - 1 = X`) and zone B starts immediately after at `col X + 1`, the
isometric 3D renderer will make their walls visually overlap. Always leave a
blank column gap:

```
WRONG — zones touch (col 0 width 2 ends at 1; col 2 starts immediately):
  z_clients: { "col": 0, "width": 2 }   → occupies cols 0–1
  z_aws:     { "col": 2, "width": 13 }  → occupies cols 2–14  ← OVERLAPS VISUALLY

CORRECT — one empty column between (col 2 is the gap):
  z_clients: { "col": 0, "width": 2 }   → occupies cols 0–1
  z_aws:     { "col": 3, "width": 13 }  → occupies cols 3–15  ← clear gap at col 2
```

When you add a gap column you must also expand `layout.grid.cols` by the same
amount and shift every zone, sub-zone, and component that lives to the right of
the gap by +1 column. This rule applies between ANY two sibling zones —
including between an external zone and the main cloud zone.

**Nesting example:**
```json
{ "id": "z_aws",  "label": "AWS Cloud", "color": "#d45b00", "outline": "dashed",
  "bounds": { "col": 2, "row": 0, "width": 16, "height": 10 } },
{ "id": "z_app",  "label": "App Layer", "color": "#2d9f6a", "parentId": "z_aws",
  "bounds": { "col": 5, "row": 1, "width": 6, "height": 8 } }
```

---

## 6. `components`

Each component maps to a 3D mesh in the scene.

```json
{
  "id":       "auth_server",
  "label":    "Auth Server",
  "type":     "service",
  "shape":    "cylinder",
  "color":    "#7c3a9d",
  "position": { "col": 5, "row": 2 },
  "size":     { "w": 2, "h": 1 },
  "meta": {
    "description": "Issues authorization codes and access tokens.",
    "file":        "services/auth/src/server.ts",
    "line":        1,
    "notes":       "Uses RS256 for token signing."
  }
}
```

### 6.1 Component types

| `type`     | Default geometry | Visual height | Use for |
|------------|-----------------|---------------|---------|
| `client`   | Box             | Short (0.8)   | Browser, mobile app, CLI tool, external consumer |
| `service`  | Box             | Medium (1.2)  | Backend API, microservice, HTTP server |
| `database` | Cylinder        | Tall (1.6)    | Any persistent store: SQL, NoSQL, cache, object storage |
| `queue`    | Flat box        | Very flat (0.6) | Message broker, topic, event bus, FIFO queue |
| `function` | Octahedron      | Minimal (0.5) | Serverless function, Lambda, background job, cron |
| `external` | Box             | Standard (1.0)| Third-party system outside your control |

Default colours per type (overridable with `color`):
- `client` → bright blue
- `service` → green
- `database` → amber/orange
- `queue` → purple
- `function` → red
- `external` → slate blue-grey

### 6.2 `shape` (optional)

Sets the component's footprint. Every body is a plain extruded prism filling the
component's cells — there are no bespoke "server" or "cloud" models. What the
component *is* is carried by its `icon` or `logo`, drawn on the top face; the
shape is only there to group things visually (e.g. every cache a cylinder).

| `shape`    | Footprint | Notes |
|------------|-----------|-------|
| `cuboid`   | Rectangle | The default when `shape` is omitted |
| `cylinder` | Circle    | Reads well for stores and caches |
| `octagon`  | 8-sided   | |
| `hexagon`  | 6-sided   | |
| `triangle` | 3-sided   | Smallest icon face — use sparingly |

Non-square components stretch their footprint to fill `size`, so a `2 × 1`
cylinder is an ellipse rather than a circle in a gap.

`shape` combines with `icon` and `logo` — the prism is the body, the icon sits on
top of it.

### 6.3 `logo` (optional)

Renders a Font Awesome **brands** icon as a flat 2D logo on the top face of the
component body, filling ~88% of the shorter dimension on a `cuboid` (less on the
rounder shapes, so it never overhangs). Takes precedence over `icon`.

```json
{ "logo": "stripe" }
{ "logo": "aws" }
{ "logo": "github" }
{ "logo": "slack" }
{ "logo": "google" }
{ "logo": "nginx" }
{ "logo": "php" }
{ "logo": "nodeJs" }
{ "logo": "react" }
{ "logo": "docker" }
{ "logo": "kubernetes" }
```

- Value must match a Font Awesome **brands** icon key in **camelCase** without the
  `fa` prefix (e.g. `"nodeJs"` → `faNodeJs`, `"aws"` → `faAws`, `"stripe"` → `faStripe`).
- The logo uses the same material colour as the component (controlled by `color`
  or the default for the `type`). Set `color` to the brand's hex colour for
  authentic branding.
- Do not specify `icon` alongside `logo` — `logo` takes precedence. `shape` is
  fine: it sets the body the logo sits on.
- Sizing: `size` defaults to `{ "w": 1, "h": 1 }`. On rectangular components the
  logo is square-fitted to avoid distortion.

**Example — Stripe payment processor:**
```json
{
  "id": "stripe", "label": "Stripe", "type": "external",
  "logo": "stripe", "color": "#635BFF",
  "position": { "col": 12, "row": 3 }
}
```

### 6.4a `icon` (optional)

Renders a Font Awesome **solid** icon on the top face of the component box as a
white glyph on the component's colour. Use when there is no brand logo but you
want a recognisable pictogram.

```json
{ "icon": "server" }
{ "icon": "database" }
{ "icon": "networkWired" }
{ "icon": "magnifyingGlass" }
{ "icon": "mobileScreen" }
{ "icon": "shield" }
{ "icon": "bolt" }
{ "icon": "key" }
{ "icon": "envelopeOpen" }
{ "icon": "chartLine" }
```

- Value is a Font Awesome **solid** icon key in **camelCase** without the `fa` prefix
  (e.g. `"magnifyingGlass"` → `faMagnifyingGlass`, `"networkWired"` → `faNetworkWired`).
- The glyph is always white; the component's `color` (or type default) provides
  the background. On rectangular components the icon is square-fitted.
- `logo` takes precedence over `icon` if both are set.

**Example — Elasticsearch node:**
```json
{
  "id": "elasticsearch", "label": "Elasticsearch", "type": "database",
  "icon": "magnifyingGlass", "color": "#1e7eb0",
  "position": { "col": 14, "row": 4 }, "size": { "w": 2, "h": 2 }
}
```

### 6.4 `color` (optional)

A CSS colour string that overrides the default type-based colour for this component.

```json
{ "color": "#FF9900" }
```

- Accepts any CSS hex string: `"#rgb"`, `"#rrggbb"`.
- Use for brand colours on `logo` components, or to visually distinguish components
  of the same type.
- The color applies to the mesh material — it affects the component's 3D geometry
  and all highlight/dim transitions.

### 6.5 `position`

`col` and `row` are the top-left corner of the component's footprint.

`elevation` (optional, default 0) raises the component on the Y axis. Rarely
needed — only use it for components that are conceptually "above" others (e.g. an
API gateway hovering over backend services in an architectural diagram).

### 6.6 `size`

Optional. `w` is width in grid cells (along the col axis). `h` is depth in grid
cells (along the row axis). Both default to 1.

Use `size.w > 1` for components that are architecturally central, handle many
connections, or need visual prominence. `{ "w": 2, "h": 1 }` is a common choice
for services with multiple inbound connections.

### 6.7 `meta`

All fields optional. Shown in the hover tooltip when the user hovers the component.

- `description` — one sentence explaining what the component does.
- `file` — source file path relative to the repo root.
- `line` — line number in that file (entry point or primary handler).
- `notes` — additional context, constraints, or gotchas.

---

### 6.8 `detail` — a scene inside a component (optional)

A component can contain a whole scene of its own. Give it `detail` and any step
tagged with that component's id is rendered *inside* it: the camera dives into
the component, the outer scene is replaced by the inner one, and stepping back
out reverses it. The breadcrumb in the top-left panel shows where you are, and
the step list indents the steps that happen inside.

```jsonc
{
  "id": "factory", "label": "Factory", "type": "service",
  "position": { "col": 7, "row": 3 },
  "detail": {
    "grid": { "cols": 14, "rows": 8 },
    "zones":       [ /* … */ ],
    "components":  [ /* … */ ],
    "connections": [ /* … */ ]
  }
}
```

A `detail` scene is laid out exactly like a top-level flow — its own grid from
its own origin, its own zones, components and connections — and nests to any
depth: a component inside a `detail` can carry a `detail` of its own.

**Rules:**
- **Ids are unique across the entire flow**, not per scene. A component,
  connection or zone id used twice is a validation error, wherever the two live.
  That is what lets a step name any scene, and anything inside it, unqualified.
- **Connections cannot cross a scene boundary.** A pipe joins two components in
  the same scene. Drawing the parent's incoming pipe as if it continued inside is
  not supported yet.
- A `detail` scene has no `steps` of its own — see § 8.14.
- Reach for this when the inner detail would wreck the outer layout. If it fits
  in the main grid, put it there: one scene the reader can see at once beats two
  they have to navigate.

---

## 7. `connections`

Each connection is rendered as a pipe (tube geometry) between two components.
The `label` is shown as a small HTML overlay at the pipe's midpoint.

```json
{
  "id":    "c_code_exchange",
  "from":  "browser",
  "to":    "auth_server",
  "label": "POST /token",
  "route": "auto"
}
```

| Field   | Notes |
|---------|-------|
| `id`    | Unique. Referenced in steps (`active_connections`) and packets (`connection`). |
| `from`  | Component id. |
| `to`    | Component id. |
| `label` | Optional. Names the protocol or operation (e.g. `"POST /api/events"`, `"INSERT INTO orders"`). Rendered at the pipe midpoint, always visible. |
| `route` | `"auto"` for smooth S-curve routing, or an array of `{ "col": n, "row": n }` waypoints. |

**Routing guidance:**
- `"auto"` produces a smooth cubic-Bezier S-curve: the pipe exits the source
  horizontally in X, curves, and arrives at the destination along Z. This avoids
  the diagonal kink that a corner-waypoint approach produces.
- Add explicit waypoints only when the auto route visually crosses through an
  unrelated component. Waypoints are intermediate grid positions the pipe must
  pass through (CatmullRom through all points).
- Model each direction of data transfer as a separate connection. If A calls B
  and B responds to A, use two connections: `a_to_b` and `b_to_a`.

---

## 8. `steps`

Steps are the animation sequence. The engine presents them one at a time.

### 8.1 Step 0: the overview (required)

**Always include a step with id `0` as the first step.** It should have no
highlights, no annotations, no packet, and no camera focus. This is the resting
state — the viewer sees the full architecture before anything happens.

```json
{
  "id":          0,
  "title":       "System Overview",
  "description": "Brief description of the system before any events occur.",
  "highlight":   [],
  "active_connections": [],
  "camera":      { "focus": null }
}
```

### 8.2 Full step schema

```json
{
  "id":                 2,
  "name":               "Auth redirect",
  "title":              "Browser requests authorisation",
  "description":        "The app constructs the authorisation URL and redirects the user.",
  "highlight":          ["browser", "auth_server"],
  "active_connections": ["c_auth_redirect"],
  "camera":             { "focus": "browser", "zoom": 1.4 },
  "annotations": [
    {
      "type":   "callout",
      "target": "browser",
      "text":   "window.location.href = authUrl"
    }
  ],
  "packet": {
    "connection":   "c_auth_redirect",
    "shape":        "envelope",
    "arrivalStyle": "success",
    "count":        1,
    "data": {
      "response_type":  "code",
      "client_id":      "app_123",
      "code_challenge": "S256..."
    }
  },
  "footer":    [{ "text": "**42 ms** — cached redirect", "style": "info" }],
  "waterfall": { "weight": 42, "label": "42 ms" }
}
```

### 8.3 `name` — sidebar label (optional)

`name` is the short label shown in the **step navigation sidebar** on the right side of the screen. Users click it to jump directly to that step.

- **Optional.** If omitted the sidebar falls back to `title`.
- **Keep it short** — 2–4 words at most. The sidebar column is narrow (≈250 px).
  Long names wrap and make the list harder to scan, and are trimmed to one line
  while the waterfall column is open (§ 8.13).
- `title` should still be a complete, descriptive sentence shown in the HUD.
  `name` is the abbreviated version for quick navigation.

| Field   | Where shown          | Ideal length     | Example |
|---------|----------------------|------------------|---------|
| `title` | Step HUD (top-left)  | Full sentence    | `"App generates PKCE params and redirects"` |
| `name`  | Sidebar step list    | 2–4 words        | `"PKCE & redirect"` |

**Good `name` values:**
```
"Overview"          ← step 0
"User action"       ← first trigger
"Send to Collector" ← data in flight
"Validate & batch"  ← transformation step
"Publish to Kafka"  ← next hop
"Data at rest"      ← final state
```

**Anti-patterns to avoid:**
- Repeating the full title: `"User clicks Sign in with Google"` — too long.
- Generic labels: `"Step 1"`, `"Next"` — meaningless out of context.
- Omitting `name` when `title` is long — the sidebar will show the full title,
  which wraps and looks cluttered.

### 8.4 `highlight`

Array of component ids. Highlighted components appear at full brightness.
All other components dim to 25% opacity.

- Include all components that are **actively involved** in this step.
- If the step is a pure data-in-flight moment (packet traveling), highlight
  the source and destination of that transfer.
- If the step is a transformation inside one component, highlight only that component.
- Empty array = all components at full brightness (use for overview step only).

### 8.5 `active_connections`

Array of connection ids. Active pipes illuminate with a brighter colour.

- Include only the connection(s) carrying data in this step.
- Should match the packet's `connection` when a packet is present.
- An empty array is valid (e.g. a transformation step with no data transfer).

### 8.6 `camera`

Optional. Controls camera position for this step.

```json
{ "focus": "component_id", "zoom": 1.4 }
```

- `focus: null` — returns to the full-scene overview.
- `focus: "id"` — pans to centre on that component.
- `zoom` — multiplier on the default frustum. `1.0` = overview size. `1.5` = 50%
  closer. `2.0` = twice as close. Keep between `1.2` and `2.5`.
- Omitting `camera` entirely is equivalent to `{ "focus": null }`.

**When to zoom:** focus + zoom on a component when the step is about an internal
process (transformation, validation, decision). Return to overview (`focus: null`)
for data-in-flight steps where the packet's journey across the scene is the story.

### 8.7 `annotations`

Array of annotation cards. Each card floats near its target component with a
dashed leader line. Multiple annotations fan out automatically to avoid overlap.

```json
{
  "type":   "callout",
  "target": "browser",
  "text":   "analytics.track('button_click', { id: 'cta' })"
}
```

| `type`      | When to use | Visual style |
|-------------|-------------|--------------|
| `callout`   | An event, trigger, or action occurring at the component. User interactions, inbound requests, system events. | White text, blue left border |
| `transform` | Code-level processing inside the component: validation, enrichment, encryption, format conversion. | Monospace font, cyan left border |

**`style` (optional):**

Overrides the card's accent colour and adds an icon badge to signal the outcome
of the action being annotated.

| `style`     | Colour | Icon | When to use |
|-------------|--------|------|-------------|
| `"info"`    | Blue   | ℹ    | Default; neutral context or informational state |
| `"success"` | Green  | ✓    | Action completed successfully |
| `"warning"` | Amber  | ⚠    | Partial success, rate-limited, degraded state |
| `"error"`   | Red    | ✕    | Failure, rejection, exception thrown |

Omit `style` for neutral annotations (the card uses the type's default colour).
Pair `style` with `arrivalStyle` on the accompanying packet when you want both
the annotation card and the packet arrival to communicate the same outcome.

**Annotation text guidelines:**
- For `callout`: write as the actual code or event that fires, not a prose
  description. `"user.signIn({ provider: 'google' })"` not `"User signs in"`.
- For `transform`: write as a function call chain or arrow expression.
  `"validate() → enrich() → produce()"` not `"The data is validated and enriched"`.
- Keep text under ~80 characters so it fits the card without wrapping excessively.
- Use at most 2–3 annotations per step. More than that creates visual noise.

### 8.8 `popouts`

Array of data popout panels. Each shows a structured key-value payload anchored
to a component. **Currently not rendered in the UI — reserve for future use.**

```json
{
  "title":  "Event payload",
  "anchor": "browser",
  "data": {
    "event":     "button_click",
    "userId":    "u_9f3a",
    "timestamp": 1718000000000
  }
}
```

Include popouts for completeness in the JSON even if they are not yet displayed.
They will be rendered in a future release.

### 8.9 `packet`

A glowing shape that travels along a connection pipe. Stays at the destination
after arrival until the next step. The user can hover it to inspect the payload.

```json
{
  "connection":   "c1",
  "shape":        "document",
  "direction":    "forward",
  "arrivalStyle": "success",
  "data": {
    "event":     "button_click",
    "userId":    "u_9f3a",
    "timestamp": 1718000000000
  }
}
```

Use `null` (or omit the field) for steps with no data-in-flight.

**`direction` (optional, default `"forward"`):**

Controls which end of the pipe the packet departs from.

| `direction`  | Packet travels |
|--------------|----------------|
| `"forward"`  | `from` → `to` (default) |
| `"reverse"`  | `to` → `from` |

`direction: "reverse"` lets a response travel back along the same connection,
so you do not need a separate return connection. Use it when the request and
response logically share the same pipe (e.g. a client calls a server and the
server responds). For architecturally distinct directions — different protocols,
different endpoints — define a separate connection with `from`/`to` swapped.

**`count` (optional, default 1):**

Sends the packet that many times down the same pipe instead of once, staggered so
the burst leaves in sequence, and marks the pipe label with `×N`. Use it when one
step really is the *same* operation happening repeatedly:

```json
"packet": { "connection": "c_orm_db", "shape": "token", "count": 25 }
```

- 25 queries in a loop, 12 retries, a batch of 40 messages, 200 rows synced —
  anything countable that is genuinely the *same* operation each time.
- Nothing to do with duration. `count` is how many times, not how long.
- The renderer caps a burst at 40 meshes; a larger `count` still shows the true
  number in the `×N` marker and the tooltip, it just stops adding geometry.
- Do **not** use `count` for a stream (§ 8.11). A burst is N discrete transfers;
  a stream is one connection held open.

**Packet shape vocabulary:**

| `shape`    | Geometry       | Semantic meaning |
|------------|----------------|-----------------|
| `sphere`   | Sphere         | Generic event, message, or notification |
| `document` | Flat box       | JSON body, HTTP request/response, structured record |
| `token`    | Flat disk      | Auth token, JWT, session key, API key |
| `blob`     | Squashed sphere| Binary data, file content, image |
| `envelope` | Wide flat box  | HTTP redirect, wrapped response, message envelope |

**`arrivalStyle` (optional):**

When the packet arrives at its destination, its colour animates from the
default cyan/green to a semantic colour reflecting the outcome:

| `arrivalStyle` | Arrival colour | When to use |
|----------------|---------------|-------------|
| `"success"`    | Bright green  | Request accepted, validation passed, event written |
| `"error"`      | Bright red    | Request rejected, validation failed, connection refused |
| `"warning"`    | Amber/orange  | Rate-limited, quota exceeded, partial success |

Omit `arrivalStyle` (or set to `null`) when the transfer outcome is neutral or
context-independent.

**`data` field:** include the actual representative payload structure. Keys and
values are shown verbatim in the hover tooltip. Use realistic values, not
placeholders like `"<user_id>"`. Real data makes the diagram more instructive.

### 8.10 `packets` — multiple simultaneous packets

Use `packets` (plural) when several data flows happen in the same step — for
example a fan-out from one source to three consumers, or a two-sided handshake.
Each item uses the same schema as `packet`.

```json
"packets": [
  { "connection": "c_fanout_a", "shape": "sphere", "arrivalStyle": "success" },
  { "connection": "c_fanout_b", "shape": "sphere" },
  { "connection": "c_fanout_c", "shape": "sphere", "arrivalStyle": "warning" }
]
```

- `packets` and `packet` are mutually exclusive per step — use one or the other,
  not both.
- All packets in the array launch simultaneously and travel in parallel.
- Each packet may have its own `connection`, `shape`, `direction`, `arrivalStyle`,
  and `data`.
- The `active_connections` array for the step should include every connection
  referenced across the entire `packets` array.

### 8.11 `streams` / `stream` — continuous data stream animation

Streams render as a continuous river of chevron arrows flowing along a connection pipe.

**A stream means the connection stays open for a long time and data flows down it continuously** — streamed video or audio, a WebSocket held open, a telemetry feed. That open, long-lived connection is the *only* thing the chevrons are for.

**A stream is not how you show data moving.** Showing data move is already the job of the pipe and the packet travelling along it. If your reason for adding a stream is "this step should look like something is being sent", use `packet` instead — the chevrons say something different, and using them for ordinary traffic makes the diagram lie about how the system works.

**Correct uses — the connection is held open and data flows down it:**
- Video or audio live-stream delivery (encoder → CDN → viewer)
- A WebSocket (or SSE) connection kept open to push data for as long as the client is connected
- Telemetry / sensor data pumped continuously from a device
- Kafka topic consuming events at a constant rate
- A Kinesis Data Stream or similar ingestion pipeline
- Log aggregation pipelines (Fluentd / Logstash → Elasticsearch)

**Incorrect uses — do not use streams for:**
- Anything whose point is just "data moves from A to B" (use `packet`)
- HTTP request/response cycles (use `packet`)
- Scheduled triggers or cron jobs (use `packet`)
- A single WebSocket broadcast — one discrete message over an open socket is a `packet`; the open socket itself is the stream
- "Overview" decoration to make a diagram look busier
- General API traffic between services

```json
"stream": { "connection": "c_encoder_cdn", "color": "#e53935" }
```

```json
"streams": [
  { "connection": "c_sensor_kinesis", "color": "#e57010" },
  { "connection": "c_kinesis_lambda", "color": "#e57010" }
]
```

| Field        | Notes |
|--------------|-------|
| `connection` | Required. ID of the connection to animate. |
| `color`      | Optional hex string. Defaults to the theme's packet colour if omitted. |

**Rules:**
- `stream` (singular) and `streams` (array) are both valid and can coexist in the same step — the engine merges them.
- Include stream connections in `active_connections` so the pipe illuminates.
- Streams do **not** interact with `packet` / `packets` — both can coexist in the same step.
- Streams travel in the `from` → `to` direction only (no `direction` field).
- If in doubt, use `packet` instead. A packet that loops back in the next step communicates rhythm without misrepresenting discrete events as continuous flows.

---

### 8.12 `footer` — emphasised notes under the step description (optional)

`description` is prose. `footer` is for the one or two facts you want a viewer to
not miss: a measurement, a warning, a conclusion. Notes render under the
description in the top-left panel, each on its own tinted line.

```json
"footer": [
  { "text": "**Slow step — 3,180 ms** across 25 identical queries", "style": "error" },
  { "text": "Collapse with an `IN (...)` batch to save ~3 s",        "style": "warning" }
]
```

| Field   | Notes |
|---------|-------|
| `text`  | Required. Supports inline `**bold**`, `*italic*` and `` `code` `` — nothing else. |
| `style` | Optional: `info` (default), `success`, `warning`, `error`. Sets the tint and left bar. |

**Example use cases**

| Flow is about | Footer note |
|---|---|
| A slow request | `"**Slow step — 3,180 ms** across 25 identical queries"` |
| A cost breakdown | `"**£0.42 per 1k calls** — the most expensive hop"` |
| A security review | `"Token is **unencrypted** in transit here"` |
| A migration runbook | `"**Not reversible** past this point"` |
| A teaching diagram | `"This is the bit people get wrong: the hash is *not* the query"` |

**Rules:**
- One or two notes per step. A footer with five lines is just a second description.
- Put the number in the note, with its unit — the renderer never formats or
  interprets it. `"**4,570 ms**"`, `"**18 MB** transferred"`, `"**3 retries**"`.
- `error` / `warning` should mean something is genuinely wrong or costly, not
  just interesting. Reserve them so they keep their weight.

### 8.13 `waterfall` — a measured bar beside each step

Give steps a `waterfall` bar and the Steps sidebar gains a small chart toggle.
Turning it on slides a waterfall column out from behind the sidebar, with each
bar level with the step it measures, offset and scaled on one shared axis — read
top to bottom in step order.

- Hovering either column highlights the pair and reveals that bar's label.
- Clicking a bar jumps to its step, exactly like clicking the step row.
- The two columns scroll together, so a bar never drifts from its step.
- With no `waterfall` data anywhere in the flow, the toggle does not appear.

```json
"waterfall": { "start": 240, "weight": 3180, "label": "3,180 ms · ×25", "color": "#ef4444" }
```

| Field    | Notes |
|----------|-------|
| `weight` | Required, zero or more: how long/big the bar is. **Unitless.** |
| `start`  | Optional, zero or more, on the same scale: where the bar begins. Omit it and the bar starts where the previous *measured* bar ended, giving a plain sequential cascade. |
| `label`  | Optional text, shown as a tooltip when you hover the row. This is where the unit goes — tracks stay a fixed width so the axis holds. |
| `color`  | Optional hex. Use it to grade or group bars (red for the step you want blamed, one colour per service, …). |

Bars are scaled against the flow's full span — the furthest `start + weight` —
so `weight` and `start` can be milliseconds, rows scanned, bytes, retries,
pounds, story points: whatever the flow is about. Nothing in the renderer
assumes time.

**`start` is what makes it a waterfall.** Use it to show:

- **Overlap** — two steps that ran concurrently start at the same offset.
- **Containment** — a parent step spanning 0–1000 with its children sitting
  inside it, so you can see the parent is mostly waiting.
- **Gaps** — dead time between two steps shows as empty track.

Omit `start` everywhere and you get a stacked cascade, which is right for a
strictly sequential pipeline.

**Partial coverage is fine.** Steps with no `waterfall` keep their row in the
column, just without a bar — useful for a narration step that measures nothing.
They are skipped when the implicit cascade is worked out, so the next bar
continues from the last measured one rather than leaving a hole.

**Example use cases**

| Flow is about | `weight` | `label` | Reading |
|---|---|---|---|
| A slow HTTP request | span duration | `"3,180 ms"` | Which step ate the budget |
| An ETL job | rows processed | `"1.2M rows"` | Which stage carries the volume |
| A deploy pipeline | stage duration | `"4 min 12 s"` | Where the pipeline stalls |
| An API bill | requests or cost | `"£38 / day"` | Which call is expensive |
| A migration | records touched | `"84k records"` | Which table dominates |

**Rules:**
- Every `weight` in one flow must measure the same thing, or the bars are
  meaningless. Same for `start`.
- Only add bars where comparing steps is useful. If every step costs the same,
  a waterfall says nothing.
- Bars are relative, so one huge step flattens the rest. That is usually the
  point — but do not add a "total" bar spanning everything *and* the steps that
  make it up unless the containment is what you want to show.
- Very small bars are widened to a hairline so they stay visible, so the tiniest
  bars are not strictly to scale. Put the real figure in `label`.
- Keep `name` short (§ 8.3): while the column is open, step names are trimmed to
  one line to hold the rows level with their bars.

### 8.14 `scene` — which scene a step happens in

Steps stay one flat list in flow order. A step tagged with `scene` happens inside
that component's `detail`; a step with no `scene` is at the top level.

```jsonc
"steps": [
  { "id": 0, "title": "Farm to shelf",  "highlight": [], "active_connections": [] },
  { "id": 1, "title": "Grain ships",    "highlight": ["farm", "factory"], "active_connections": ["c_farm_factory"] },
  { "id": 2, "scene": "factory", "title": "Into receiving", "highlight": ["receiving"], "active_connections": ["c_recv_mill"] },
  { "id": 3, "scene": "mill",    "title": "Grinding",       "highlight": ["hopper", "grinder"], "active_connections": ["c_hop_grind"] },
  { "id": 4, "scene": "factory", "title": "Packing",        "highlight": ["packing"], "active_connections": ["c_mill_pack"] },
  { "id": 5, "title": "To the shelf", "highlight": ["factory", "store"], "active_connections": ["c_factory_store"] }
]
```

Entering and leaving is implied by consecutive steps — there is no "enter" or
"exit" step to write. Playback, the step list, waterfall bars and footers all
work the same inside a scene as outside it.

The transition waits for the outgoing step to finish before it starts, up to
about 1.6 s, so a packet still in flight is not cut off mid-animation. You do not
need to pad a scene's last step to protect it.

**Rules:**
- Everything a step names — `highlight`, `active_connections`, packets, streams,
  annotation targets — must live in **that step's** scene. Referencing something
  one scene over is a validation error, not a silent no-op.
- `scene` must name a component that actually has a `detail`.
- Group a scene's steps together. Bouncing in and out on alternating steps means
  a camera dive on every step change.
- Give the outer scene a step before and after the excursion, so the reader sees
  where they went in and came back to.

### 8.15 Aggregating repeated work

A trace or log with hundreds of repeated operations must not become hundreds of
steps. Collapse them:

- One step per *kind* of repeated operation, with `packet.count` carrying how
  many times it happened — not one step per repeat.
- Put the aggregate in the `footer` (`"**25 queries**, 3,180 ms total"`) and the
  spread in a `popout` if it matters (min / median / max).
- Keep a repeat as its own step when it is the point of the diagram (an N+1
  problem deserves its own step); fold it into a neighbouring step when it is
  incidental.
- Two repeats is not a storm. Below about five, just describe it.

---

## 9. Layout heuristics

### 9.1 Grid orientation

Orient data flow **left to right** (increasing col). The viewer reads the diagram
like a flowchart. Source systems go in low cols, destination systems in high cols.

### 9.2 Branching

Use **rows** for parallel paths. If a request can succeed or fail, put the success
path on one row and the error path on a different row.

### 9.3 Grouping by trust/deployment boundary

Put components that belong to the same service boundary, deployment unit, or
trust zone in the same zone. A zone should contain 1–5 components. More than
that is a sign the zone is too broad.

### 9.4 Spacing

Leave at least one empty cell of gap between zone boundaries. Components placed
at the very edge of a zone will visually clip the zone border.

### 9.5 Connection crossings

Auto-routing produces smooth S-curves. Crossings are inevitable when flows
branch back leftward. To reduce crossings:
- Route "return" connections (responses) above or below the "request" connections.
- Use `size.h > 1` on components that need space for multiple ports.
- Add waypoints only as a last resort.

### 9.6 Grid size formula

A reliable starting formula:

```
cols = max_parallel_components_in_flow * 2 + 2
rows = max_parallel_tracks + 2
```

For a simple linear pipeline with 4 components: `cols = 10, rows = 4`.
For a flow with a 3-way fan-out: `cols = 10, rows = 6`.

### 9.7 Component spacing and pipe clearance

**The problem.** FlowViz routes connections as cubic-Bezier S-curves: the pipe
exits the source component horizontally (along the column/X axis), curves, and
arrives at the destination along the row/Z axis. A packet travelling this curve
sweeps a wide arc in world space. Each frame, the engine tests every active
packet's XZ position against every component's XZ bounding box — if the packet
is inside a component's footprint, that component goes semi-transparent (30%
opacity) to simulate the packet "passing through" it. This is intentional when
the packet is actually bound for that component, but it is a visual bug when the
component is unrelated to the active connection.

When components are packed tightly — for example, two service boxes separated by
only 1 empty cell with a third component positioned nearby — the S-curve
connecting the first two can arc through the bounding box of the third, making it
unintentionally go semi-transparent mid-animation.

**The S-curve bulges widest at its midpoint.** The lateral deviation of the curve
is greatest halfway between the source and destination. Components near the
midpoint of a long connection are therefore at highest risk, even if they appear
to be "off to the side" on the grid.

**Minimum spacing rule.** Leave at least **2 empty grid cells** between any
component and a pipe path that does not terminate at it. One cell is not enough —
the S-curve control points extend into adjacent cells and the bounding box test
operates in world units (each cell = 3.0 world units; each component mesh
occupies 2.4 × 2.4 world units within its cell), so a 1-cell gap still puts the
curve within the bounding box at the midpoint.

**Row separation for parallel tracks.** Components on different flow paths
(different rows/tracks) whose column range overlaps with an active connection
should be separated by at least **1 empty row**, preferably **2**, from the
connection's start and end rows. If a connection runs from row 2 to row 4 (a
2-row drop), a component at row 3 whose column falls near the midpoint of that
connection is almost certain to trigger the transparency effect.

**WRONG — component too close to a crossing pipe:**

```
Cols:   0    1    2    3    4    5    6
Row 1:  [A]                          [B]
Row 2:            [C]
```

Component C is at col 2, row 2. The auto-route S-curve from A (col 0, row 1) to
B (col 5, row 1) exits A horizontally, dips toward row 2 near the midpoint
(around col 2–3), then returns to row 1 to arrive at B. C sits exactly where the
curve bulges — it will go semi-transparent when a packet travels A→B even though
C has nothing to do with that connection.

**CORRECT — 2-cell row gap between the pipe path and the bystander component:**

```
Cols:   0    1    2    3    4    5    6
Row 1:  [A]                          [B]
Row 2:       (empty)
Row 3:       (empty)
Row 4:            [C]
```

C is now 3 rows below A and B. The S-curve's lateral swing never reaches row 4.

**Also CORRECT — place the bystander in a different column range entirely:**

```
Cols:   0    1    2    3    4    5    6    7    8
Row 1:  [A]                          [B]
Row 2:                                         [C]
```

C is beyond the column range of the A→B connection, so the curve never sweeps
near its bounding box.

**Use zone sub-regions to enforce track separation.** If your flow has two
parallel tracks that share a column range (e.g. a request path on row 2 and a
notification path on row 5), place them in separate named sub-zones with a 2-row
gap between zone boundaries. The zone visual boundary acts as a reminder to
preserve clearance, and future authors editing the flow can see at a glance which
rows are in use.

```json
{ "id": "z_request_track",  "label": "Request Path",  "color": "#2d9f6a",
  "bounds": { "col": 3, "row": 1, "width": 10, "height": 2 } },
{ "id": "z_notify_track",   "label": "Notify Path",   "color": "#9f7a2d",
  "bounds": { "col": 3, "row": 5, "width": 10, "height": 2 } }
```

The 2-row gap between these zones (rows 3 and 4 are empty) ensures that an
S-curve on the request track (rows 1–2) cannot reach a component on the notify
track (rows 5–6).

**Quick diagnostic.** If a component goes semi-transparent during a step where
it is not highlighted and its connection is not active, a crossing pipe is the
cause. Fix it by moving the component further from the crossing connection's
midpoint column or by adding explicit waypoints to the connection to route it
away from the bystander.

---

## 10. Step sequencing patterns

### Pattern 1: Linear pipeline

Each step covers exactly one hop in the data flow.

```
Step 0: Overview (all components, no highlights)
Step 1: Source fires (highlight source, callout annotation)
Step 2: Data travels to next component (highlight both, packet)
Step 3: Processing at receiver (highlight receiver, transform annotation)
Step 4: Data travels onward (highlight both, packet)
...
Step N: Final state (highlight destination, camera zoom)
```

### Pattern 2: Request-response

```
Step 0: Overview
Step 1: Client sends request (highlight client + server, packet: document, arrivalStyle: success)
Step 2: Server processes (highlight server, transform annotation)
Step 3: Server responds (highlight server + client, packet: envelope, direction: "reverse" on the
        same connection — or a separate return connection if the directions are architecturally distinct)
Step 4: Client handles response (highlight client, callout annotation)
```

### Pattern 3: Fan-out

```
Step 0: Overview
Step 1: Event fires at source
Step 2: Source publishes to queue (packet: sphere/envelope)
Step 3: Multiple consumers receive (highlight queue + all consumers, multiple active_connections)
Step 4: Each consumer processes independently (separate steps per consumer)
```

### Pattern 4: Error path

```
Step N:   Happy path (packet with arrivalStyle: success)
Step N+1: Error condition triggers (highlight failing component, callout annotation)
Step N+2: Error response returned (packet with arrivalStyle: error)
Step N+3: Retry or fallback (packet with arrivalStyle: warning)
```

---

## 11. Common mistakes to avoid

1. **Missing overview step.** Always include step id=0 with empty `highlight` and
   `active_connections`. The viewer is disoriented if the first thing they see is
   already in mid-action.

2. **Overhighlighting.** Only highlight components that are *directly* involved in
   this step. Highlighting 5 out of 6 components defeats the purpose of dimming.

3. **Packet without active_connection.** If you include a `packet`, its `connection`
   should also appear in `active_connections`. Otherwise the pipe stays dark while
   the packet travels it.

4. **Prose in annotation text.** Annotations are not tooltips — they describe
   *what is happening in code* at this moment. Write code, not prose.

5. **Zone bounds that are too tight.** If `bounds.col + bounds.width` exactly
   equals a component's right edge col, there is no padding and it looks clipped.
   Always add at least 1 cell of padding.

6. **Steps with no visual change.** Every step must change at least one of:
   highlight, active_connections, camera, annotations, or packet. A step that
   changes nothing confuses the viewer.

7. **Too many steps.** Aim for 6–12 steps per flow. More than 14 is hard to
   follow. If the flow has more meaningful events, split it into multiple flows.

8. **Return-path design.** Two valid approaches for packets that travel back to
   the caller:
   - **`direction: "reverse"` on the packet** — packet uses the same connection
     but travels `to` → `from`. Best when the call and response are two sides of
     the same logical exchange (e.g. REST request + response).
   - **Separate connection** with `from`/`to` swapped — best when the two
     directions are architecturally distinct (different protocols, different
     endpoints, different semantics).
   Do not omit the return step entirely — viewers will miss the acknowledgement.

9. **`logo` without `color`.** Logo components render using the type's default
   colour, which may not match the brand. Always pair `logo` with the brand's hex
   `color` (e.g. Stripe → `"#635BFF"`, AWS → `"#FF9900"`, Slack → `"#4A154B"`).

10. **Missing `arrivalStyle` on outcome steps.** When a packet represents a
    request that could succeed or fail, always set `arrivalStyle` to `"success"`,
    `"error"`, or `"warning"`. Omitting it leaves the packet colour neutral, which
    misses an opportunity to communicate the outcome visually.

11. **Wrong case for `logo` / `icon` values.** Both fields use **camelCase** Font
    Awesome key names with the `fa` prefix stripped. `"node-js"`, `"node_js"`, and
    `"nodejs"` are all wrong — the correct value is `"nodeJs"`. When in doubt,
    look up the Font Awesome icon name and remove the leading `fa`, keeping the
    rest in camelCase.

12. **Using `streams` to show data moving.** Chevrons mean a long-lived open
    connection carrying data continuously (streamed video, a WebSocket, a
    telemetry feed) — nothing else. Movement of data is what the pipe and its
    packet already show, so a step that just needs "something goes from A to B"
    wants `packet` / `packets`. Don't add streams to a pause, an internal
    transformation, or a camera-focus moment either.

13. **`stream.connection` missing from `active_connections`.** If a step declares
    a stream on a connection, that connection should also appear in
    `active_connections` so the pipe illuminates while the stream runs.

---

## 12. Worked example — Telemetry Pipeline

A minimal but complete example illustrating all features.

```json
{
  "meta": {
    "title": "Telemetry Pipeline",
    "description": "How a button click becomes a row in ClickHouse"
  },
  "layout": { "grid": { "cols": 10, "rows": 6 } },
  "zones": [
    {
      "id": "z_client", "label": "Browser", "color": "#4a9edd",
      "bounds": { "col": 0, "row": 1, "width": 2, "height": 4 }
    },
    {
      "id": "z_ingest", "label": "Ingest Layer", "color": "#5dbe8a",
      "bounds": { "col": 3, "row": 0, "width": 4, "height": 6 }
    },
    {
      "id": "z_storage", "label": "Storage Layer", "color": "#e8a838",
      "bounds": { "col": 8, "row": 1, "width": 2, "height": 4 }
    }
  ],
  "components": [
    {
      "id": "browser", "label": "Browser Client", "type": "client",
      "position": { "col": 1, "row": 3 },
      "meta": { "description": "React SPA. Fires analytics events on user interaction." }
    },
    {
      "id": "collector", "label": "Collector API", "type": "service",
      "position": { "col": 4, "row": 2 }, "size": { "w": 2, "h": 1 },
      "meta": { "description": "Node.js service. Validates, batches, and forwards events." }
    },
    {
      "id": "kafka", "label": "Kafka Topic", "type": "queue",
      "position": { "col": 4, "row": 4 }, "size": { "w": 2, "h": 1 },
      "meta": { "description": "telemetry-events topic. Partitioned by userId." }
    },
    {
      "id": "clickhouse", "label": "ClickHouse", "type": "database",
      "position": { "col": 9, "row": 3 },
      "meta": { "description": "Columnar store for event analytics." }
    }
  ],
  "connections": [
    { "id": "c1", "from": "browser",   "to": "collector",  "label": "POST /events", "route": "auto" },
    { "id": "c2", "from": "collector", "to": "kafka",      "label": "produce()",    "route": "auto" },
    { "id": "c3", "from": "kafka",     "to": "clickhouse", "label": "consumer",     "route": "auto" }
  ],
  "steps": [
    {
      "id": 0, "name": "Overview",
      "title": "Telemetry Pipeline Overview",
      "description": "A button click in the browser travels through a collector API and Kafka topic before landing in ClickHouse.",
      "highlight": [], "active_connections": [],
      "camera": { "focus": null }
    },
    {
      "id": 1, "name": "User action",
      "title": "User action fires event",
      "description": "A button click triggers analytics.track() in the browser.",
      "highlight": ["browser"], "active_connections": [],
      "camera": { "focus": "browser", "zoom": 1.5 },
      "annotations": [
        { "type": "callout", "target": "browser", "text": "analytics.track('button_click', { id: 'cta' })" }
      ],
      "packet": null
    },
    {
      "id": 2, "name": "Send to Collector",
      "title": "Event sent to Collector",
      "description": "SDK serializes the event and POSTs it to the collector endpoint.",
      "highlight": ["browser", "collector"], "active_connections": ["c1"],
      "camera": { "focus": null },
      "packet": {
        "connection": "c1", "shape": "document",
        "arrivalStyle": "success",
        "data": { "event": "button_click", "userId": "u_9f3a", "timestamp": 1718000000000 }
      }
    },
    {
      "id": 3, "name": "Validate & batch",
      "title": "Collector validates and batches",
      "description": "Collector checks schema, attaches server-side metadata, then produces to Kafka.",
      "highlight": ["collector"], "active_connections": [],
      "camera": { "focus": "collector", "zoom": 1.3 },
      "annotations": [
        { "type": "transform", "target": "collector", "text": "validate() → enrich({ ip, serverTs }) → produce()" }
      ],
      "packet": null
    },
    {
      "id": 4, "name": "Publish to Kafka",
      "title": "Event published to Kafka",
      "description": "Enriched event produced to the telemetry-events topic, keyed by userId.",
      "highlight": ["collector", "kafka"], "active_connections": ["c2"],
      "camera": { "focus": null },
      "packet": {
        "connection": "c2", "shape": "envelope",
        "arrivalStyle": "success",
        "data": { "topic": "telemetry-events", "partition": 3, "key": "u_9f3a" }
      }
    },
    {
      "id": 5, "name": "Write to ClickHouse",
      "title": "Consumer writes to ClickHouse",
      "description": "A Kafka consumer reads the event and inserts it into ClickHouse.",
      "highlight": ["kafka", "clickhouse"], "active_connections": ["c3"],
      "camera": { "focus": null },
      "packet": {
        "connection": "c3", "shape": "document",
        "arrivalStyle": "success",
        "data": { "event": "button_click", "userId": "u_9f3a" }
      }
    },
    {
      "id": 6, "name": "Data at rest",
      "title": "Data at rest",
      "description": "Event is now queryable in ClickHouse. End of the pipeline.",
      "highlight": ["clickhouse"], "active_connections": [],
      "camera": { "focus": "clickhouse", "zoom": 1.3 },
      "annotations": [
        { "type": "callout", "target": "clickhouse", "text": "SELECT count() FROM events WHERE event = 'button_click'" }
      ],
      "packet": null
    }
  ]
}
```

---

## 13. Iterating in the browser

You do not have to get the layout right in JSON on the first pass. Load the flow
(`?flow=<file-name-without-json>`), press **Edit layout**, and the diagram becomes
editable:

| Action | How |
|---|---|
| Move a component | Drag it; it snaps to the grid on release |
| Resize a zone | Drag any of its four corner handles |
| Move a zone and everything in it | Drag the amber grip on its top edge |
| Rename a zone | Click its label chip |
| Rename a pipe | Click its label chip |
| Change a component's size, shape, colour or icon | Click the component |
| Move a routing waypoint | Drag the teal diamond on the pipe |
| Delete a waypoint | Right-click the diamond — the route falls back to `auto` when the last one goes |

Then press **Copy JSON** and paste over the flow file. The export carries
component positions and sizes, zone bounds and labels, pipe labels, icons,
colours, shapes and waypoints — so a layout worked out by hand in the browser
survives as source.

Two things worth knowing before you trust the round-trip:

- Parent zones are auto-expanded to enclose their children when a flow loads, so
  exporting a parent writes back the *expanded* bounds, not what you typed.
- Editing is dev-server only. A built static site has nothing to write files.

## 14. Validation checklist

Before returning a flow JSON, verify each of these:

- [ ] Step `id: 0` exists with `highlight: []`, `active_connections: []`, `camera: { "focus": null }`
- [ ] Every `connection.from` and `connection.to` references an existing component `id`
- [ ] Every `step.highlight` entry references an existing component `id`
- [ ] Every `step.active_connections` entry references an existing connection `id`
- [ ] Every `step.packet.connection` references an existing connection `id`
- [ ] Every `annotation.target` references an existing component `id`
- [ ] Every `popout.anchor` references an existing component `id`
- [ ] Zone `bounds` enclose their member components with at least 1 cell padding
- [ ] Each component's `position.col + size.w` does not exceed `layout.grid.cols`
- [ ] Each component's `position.row + size.h` does not exceed `layout.grid.rows`
- [ ] No two components occupy overlapping grid cells
- [ ] Steps with a `packet` also have the packet's `connection` in `active_connections`
- [ ] Steps with `stream` / `streams` reference only existing connection IDs
- [ ] Data flows left-to-right (increasing col) in the general case
- [ ] `packet.data` contains realistic representative values, not placeholders
- [ ] `logo` components also have a `color` matching the brand's hex colour
- [ ] `icon` values are camelCase Font Awesome solid icon names (no `fa` prefix)
- [ ] `logo` values are camelCase Font Awesome brands icon names (no `fa` prefix)
- [ ] Packets with a meaningful outcome have `arrivalStyle` set
- [ ] Every id is unique across the whole flow, including inside `detail` scenes
- [ ] Each step's references all live in that step's own scene
- [ ] Steps for one scene are grouped, with an outer step either side
- [ ] Repeated operations use one step with `packet.count`, not one step each
- [ ] Every `waterfall.weight`/`start` in the flow measures the same thing, with the unit in `label`
- [ ] `footer` notes carry their own units and are limited to one or two per step
- [ ] `streams` appear only on long-lived open connections (streamed media, WebSockets, telemetry feeds) — never to show data merely moving
- [ ] No unrelated component lies within 2 cells of a pipe midpoint on a crossing connection

---

## 15. Feature status

| Feature | Status |
|---------|--------|
| Component meshes (all 6 types) | ✅ Rendered |
| Component `shape` override (5 extruded prisms) | ✅ Rendered |
| `packet.count` repeat bursts + `×N` pipe marker | ✅ Rendered |
| Step `footer` notes (bold / italic / code) | ✅ Rendered |
| Step `waterfall` bars, offset on a shared axis in the sidebar | ✅ Rendered |
| Component `logo` (Font Awesome brands, camelCase) | ✅ Rendered |
| Component `icon` (Font Awesome solid, camelCase) | ✅ Rendered |
| Component `color` override | ✅ Rendered |
| Connection pipes | ✅ Rendered |
| Connection `label` overlay at midpoint | ✅ Rendered |
| Zone fills + 3D ground-plane labels | ✅ Rendered |
| Zone `parentId` nesting | ✅ Rendered |
| Zone `outline: "dashed"` border | ✅ Rendered |
| Step highlight / dim transitions | ✅ Rendered |
| Component penetration opacity (30% when packet enters) | ✅ Rendered |
| Packet animation + hover tooltip | ✅ Rendered |
| Packet `arrivalStyle` colour flash | ✅ Rendered |
| Packet `direction: reverse` (return path on same pipe) | ✅ Rendered |
| Multiple simultaneous packets (`packets[]`) | ✅ Rendered |
| Chevron streams (`stream` / `streams[]`) | ✅ Rendered |
| Annotation cards with leader lines | ✅ Rendered (`callout`, `transform`) |
| Annotation `style` badge + icon (`info`, `success`, `warning`, `error`) | ✅ Rendered |
| Camera pan + zoom per step (`step.camera`) | 🔲 Schema accepted, not applied — removed in #32 |
| Scroll-wheel zoom | ✅ Interactive |
| Component hover tooltip | ✅ Interactive |
| Packet hover payload | ✅ Interactive |
| Step sidebar with jump-to navigation | ✅ Interactive |
| Nested scenes (`component.detail` + `step.scene`), any depth | ✅ Rendered |
| Scene breadcrumb + indented steps for nested scenes | ✅ Rendered |
| Copy JSON of edits made *inside* a nested scene | 🔲 Not yet — sub-scene edits are not exported |
| Visualization switcher + `?flow=<id>` URL | ✅ Interactive |
| Edit mode: drag components, resize/move zones, edit labels and waypoints | ✅ Interactive (dev server) |
| Copy JSON export of an edited layout | ✅ Interactive (dev server) |
| Delete a visualization from the list | ✅ Interactive (dev server) |
| `step.name` sidebar label | ✅ Rendered (falls back to `title`) |
| Popout panels | 🔲 Schema accepted, not yet rendered |
| Elevation (`position.elevation`) | 🔲 Schema accepted, not yet rendered |
