# Getting a FlowViz checkout into a usable state

Read this when `flowviz-locate.sh` or `flowviz-preflight.sh` reports a problem,
or when validation fails for reasons that look environmental rather than a
mistake in the flow.

## The checkout isn't found

`flowviz-locate.sh` looks in order at:

1. `$FLOWVIZ_DIR`
2. the cached path in `~/.cache/flowviz/repo-path`
3. the usual project roots (`~/repos`, `~/src`, `~/code`, `~/projects`, `~/dev`,
   `~/work`, `~/git`, `~/Developer`, `~/Documents/repos`, `~/Documents`), looking
   for a directory containing `flow-authoring-guide.md`

The guide filename is the marker rather than the repo name, because people clone
it as `flowviz`, `dataviz`, `arch-diagrams` or whatever else.

If none of that finds it, ask. Two useful prompts: "where is your FlowViz
checkout?" and, if they don't have one, "clone it first — I can't author a flow
without its schema." Do not guess a path and do not scaffold a fake repo.

Cache whatever you learn so the next session skips all of this:

```bash
bash scripts/flowviz-locate.sh --set /path/to/checkout
```

Also worth suggesting once: `export FLOWVIZ_DIR=/path/to/checkout` in their
shell profile makes it deterministic across machines and tools.

## Several checkouts

Worktrees and side-by-side clones are normal. List every hit with its git branch
and let the user choose — do not pick the first. A dev with `flowviz` and
`flowviz-experiment` will not thank you for silently writing into the wrong one.

## Dependencies aren't installed

`node_modules` missing means validation cannot run — it uses the repo's own
vitest and zod.

Pick the manager from the lockfile: `pnpm-lock.yaml` → `pnpm install`,
`package-lock.json` → `npm install`, `yarn.lock` → `yarn`. If both pnpm and npm
lockfiles exist, prefer pnpm and say so. Run the install from the FlowViz repo
and report that you did — an unexpected two-minute pause is worse than a
sentence explaining it.

## Version skew

This is the failure this skill exists to prevent. Older checkouts lack features
you might reach for:

| Field | What it does | Absent means |
|---|---|---|
| `component.detail`, `step.scene` | nested scenes | one flow, one grid |
| `step.footer` | emphasised notes under the description | put the fact in `description` |
| `step.waterfall` | measured bar per step | numbers go in footers or labels |
| `packet.count` | repeat bursts, `×N` marker | one packet, say the count in text |
| `shape: cylinder` etc. | five extruded prisms | older sets had `server`, `cloud`, `stack` — check the enum |

Check before authoring, don't discover at validation:

```bash
grep -nE '\b(detail|scene|footer|waterfall|count)\b' src/types/schema.ts
grep -n 'ComponentShape' -A 8 src/types/schema.ts
```

When a feature is missing, author without it and tell the user what they'd get by
updating. That's more useful than a validation error they have to decode.

## Which directory to write to

Current checkouts split the flows directory:

- `public/flows/examples/` — committed, reference flows
- `public/flows/custom/` — **git-ignored**, everything else

Default to `custom/`. It exists so nobody accidentally commits a diagram of
their employer's internals to a shared repo, so writing there is the polite
default even when the user hasn't said.

Older checkouts have neither directory and read `public/flows/*.json` directly.
Check before writing:

```bash
ls -d public/flows/custom public/flows/examples 2>/dev/null || echo "flat layout"
```

If it is flat, write to `public/flows/` — the manifest in that version does not
recurse into subdirectories, so a flow in a new subfolder would simply never
appear.

## Saving from the browser

Current checkouts have a **Save to file** button in edit mode that PUTs the
edited definition to `/api/flows/<id>`; the dev server validates it and
overwrites the file. Older checkouts only have **Copy JSON**, where the dev
pastes the clipboard over the file themselves. Check before telling someone to
"just hit save":

```bash
grep -c 'Save to file' src/components/StepSidebar.tsx
```

## Validation failures

`flowviz-validate.mjs` runs the repo's zod schema and then builds the graph, so
its messages are the app's own. The common ones:

- **`References unknown component: x`** — a step or connection names something
  that isn't in that scene. In a nested flow, check you're in the right scene:
  ids are unique flow-wide, and a step can only reference its own scene.
- **`Duplicate id "x"`** — ids must be unique across every scene, not per scene.
- **`Invalid component shape: server`** — you used an older or newer enum value.
  Read the enum from the schema.
- **`Cannot read properties of undefined`** from the graph build — usually a
  connection whose `from`/`to` points at a component you renamed.

If the error mentions a file inside `node_modules` or the vitest runner rather
than the flow, that's an environment problem — check the install and the node
version (`.nvmrc` or `engines` in `package.json` if present).

## Nothing renders, but validation passed

Validation proves the JSON parses and the graph builds. It cannot see layout. If
the dev says it looks wrong:

- **Crowded labels or overlapping pipes** — spacing. The guide has minimum
  clearances; components need ~2 empty cells from any pipe that doesn't
  terminate at them.
- **Everything tiny** — the grid is much larger than the content. Shrink
  `layout.grid` to fit what you actually placed.
- **A component is a plain box with no icon** — the icon name isn't in the Font
  Awesome set. Names are camelCase without the `fa` prefix. Check before
  shipping:
  ```bash
  node -e "const s=require('@fortawesome/free-solid-svg-icons');const n=Object.keys(s).filter(k=>k.startsWith('fa')&&Array.isArray(s[k]?.icon)).map(k=>k[2].toLowerCase()+k.slice(3));console.log(process.argv.slice(1).map(w=>w+': '+(n.includes(w)?'ok':'MISSING')).join('\n'))" laptop database gears
  ```
- **A flow doesn't appear in the sidebar** — the flow list is read at dev-server
  startup, so restart it. If restarting doesn't help, check the file is in a
  directory the manifest scans: `public/flows/`, `public/flows/examples/` or
  `public/flows/custom/`, no deeper.

## Stopping the dev server

Never `pkill -f vite`: it matches every vite process on the machine, including
other repos' dev servers and `vitest`, because the pattern is a substring. Kill
by port instead — FlowViz pins 5175 in `vite.config.ts`:

```bash
lsof -ti tcp:5175 | xargs kill
```
