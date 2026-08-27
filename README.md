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
- **Edit mode:** drag components, resize and move zones, edit routing waypoints, change a component's size / shape / colour / icon, rename zone and pipe labels, then Copy JSON back into the flow file
- Light and dark themes

## Authoring flows with an LLM

Flows are plain JSON files under `public/flows/`, in one of two directories:

| Directory | What goes there |
|---|---|
| `public/flows/examples/` | Committed to the repo. The flows that ship as reference material. |
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

| File | Description |
|------|-------------|
| `hexagonal-architecture.json` | Three bounded contexts with a shared EventBridge event bus |
| `blood-circulation.json` | Not software at all — the double circuit, laid out as a body |
| `zz-nested.json` | Nested scenes: a factory with a mill inside it |
| `zz-demo.json` | Repeat bursts, footer notes and waterfall bars |

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

Editing and deleting flows needs the dev server — both write to `public/flows/`
through it, so neither is available in a static build.

**Never stop the dev server with `pkill -f vite`** — that matches every vite process on the machine, including other repos' dev servers and `vitest`. Kill by port instead:

```bash
lsof -ti tcp:5175 | xargs kill
```
