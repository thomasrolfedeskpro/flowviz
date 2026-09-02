# FlowViz

An animated isometric 3D data-flow diagram tool. Describe a system architecture in a JSON file and step through an animated explanation of how data moves through it — complete with glowing glass tubes, flowing packets, nested sub-scenes, and annotation cards.

**FlowViz is designed to be driven by LLMs.** The authoring guide (`flow-authoring-guide.md`) is written as a structured reference that a language model can read once and immediately use to produce a valid, well-laid-out diagram JSON. Give an LLM the guide and a description of your system — AWS stack, microservices, event-driven pipeline, hexagonal architecture, etc. — and it will generate a ready-to-render flow in one pass.

## What it does

- Renders components (services, databases, clients, queues, serverless functions) as 3D meshes on an infinite isometric grid, in one of five extruded shapes with a Font Awesome icon or brand logo on top
- Connects them with glass tube pipes that illuminate when active
- Animates data packets travelling through the pipes, with optional arrival styles (success / error / warning) and repeat bursts for work that happens N times over
- Steps through a narrative sequence: each step can highlight components, activate connections, fire packets, show annotation callouts, and pin emphasised footer notes under its description
- Supports zone groupings (with optional nesting and dashed outlines) to visually bound logical boundaries like cloud regions or bounded contexts
- Chevron stream animation for genuine continuous data flows (Kafka, video, WebSockets)
- **Nested scenes:** a component can contain a scene of its own, to any depth. Steps inside it are rendered in that scene, with the camera diving in and pulling back out
- **Waterfall column:** give steps a measured bar and the sidebar slides out a waterfall showing where the time, rows, retries or cost went — the unit is yours, the renderer assumes nothing
- **Edit mode:** drag components, resize and move zones, edit routing waypoints, change a component's size / shape / colour / icon, rename zone and pipe labels — then **Save to file** writes it straight back to the flow's JSON (or Copy JSON if you'd rather paste it somewhere)
- Light and dark themes

## Authoring flows with an LLM

Flows are plain JSON files under `public/flows/`, in one of two directories:

| Directory | What goes there |
|---|---|
| `public/flows/examples/` | Committed to the repo. The flows that ship as reference material — read-only in the UI, they cannot be deleted. |
| `public/flows/custom/` | **Git-ignored.** Your own and your product's flows — they stay on your machine. |

New flows belong in `custom/` unless you specifically mean to add a shipped
example. Drop the `.json` file in, restart the dev server (the flow list is read
at startup) and it appears in the **Visualizations** tab of the sidebar.

Load one directly with `?flow=<file-name-without-json>` — the id is just the
filename, so `?flow=oauth` works wherever the file sits.

**[`flow-authoring-guide.md`](./flow-authoring-guide.md)** is the single reference an LLM needs. It covers the full JSON schema, layout rules, zone gap requirements, packet/stream usage, annotation types, nested scenes, waterfall bars, and the aggregation rules for turning a large trace into a readable number of steps — with enough examples that a model can produce a correct diagram without iteration. Attach it to a prompt like:

> "Read flow-authoring-guide.md, then create a FlowViz JSON for [your system description]."

**Example flows:**

These ship in `public/flows/examples/`:

Between them they exercise every feature the renderer has. Start with the coffee
shop; it is deliberately the simplest thing the tool can draw.

| File | Size | What it shows |
|------|------|---------------|
| `coffee-shop-order.json` | 6 / 6 | The ten-second read: components, icons, one packet per step |
| `water-cycle.json` | 7 / 8 | Streams vs packets, a reverse flow, a closed loop, `elevation` |
| `blood-circulation.json` | 8 / 11 | Not software at all — the double circuit, laid out as a body |
| `farm-to-shelf.json` | 8 / 6 | The smallest nested-scene example, three levels deep |
| `slow-checkout.json` | 10 / 15 | A trace: the waterfall, an N+1 burst, a coloured slow pipe |
| `card-payment.json` | 11 / 12 | A decline then a retry — error arrivals, brand logos, ms waterfall |
| `hexagonal-architecture.json` | 14 / 9 | Three bounded contexts with a shared EventBridge event bus |
| `airport-departure.json` | 20 / 18 | Two sub-scenes; passenger and suitcase reconverging |
| `uk-power.json` | 33 / 34 | Pipe colour carrying meaning: a voltage ramp, then real cable colours |
| `parcel-network.json` | 40 / 45 | The big one: four scenes three levels deep, 42 waterfall bars |
| `monopoly.json` | 58 / 38 | The London board, exactly — 40 spaces, a game played out, two sub-scenes |

*Size is components / steps, counting every nested scene.*

Flows in `public/flows/custom/` are git-ignored, for personal and
product-specific diagrams that should not be committed.

## Screenshots

### Overview — isometric grid with zones and glass tube pipes
<img width="1936" height="1255" alt="image" src="https://github.com/user-attachments/assets/e24c30c9-24e9-4ac7-9849-063b53eb8a34" />

### Stream indicators
<img width="1638" height="830" alt="image" src="https://github.com/user-attachments/assets/fd6b8034-4cb4-49f0-a29b-3beadf2f5406" />


## Development

```bash
pnpm install
pnpm run dev      # http://localhost:5175
pnpm test         # vitest
pnpm run build    # tsc -b && vite build
pnpm run lint
```

The port is pinned to **5175** in `vite.config.ts`. A flow loads automatically;
append `?flow=<name>` (any filename under `public/flows/`, without its extension)
to load a specific one.

Editing, saving and deleting flows all need the dev server — they write to
`public/flows/` through it, so none of them work in a static build. Saves are
validated against the flow schema before anything is written, so a save can't
leave a file the app won't load. Bundled examples can be saved (a bad save is one
`git checkout` away) but not deleted.

**Never stop the dev server with `pkill -f vite`** — that matches every vite process on the machine, including other repos' dev servers and `vitest`. Kill by port instead:

```bash
lsof -ti tcp:5175 | xargs kill
```
