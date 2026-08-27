---
name: flowviz
description: >-
  Create or edit a FlowViz visualization — the animated isometric 3D flow
  diagrams that FlowViz renders from JSON files in its own repo
  (public/flows/custom/ and public/flows/examples/). Use this whenever someone wants to see how a request,
  message, job, trace or piece of data moves through a system as a stepped
  walkthrough: "make a flowviz of this request path", "diagram how a ticket
  write works", "turn this OTel trace into a flow", "visualise what happens when
  a webhook arrives", "add a step to the oauth flow", "edit the factory
  visualization". It finds the FlowViz checkout from whatever directory you are
  working in (usually a different repo entirely), reads that checkout's own
  authoring guide and schema so it matches the version on disk, works out the
  intent and depth with you, then writes and validates the flow JSON. This is
  NOT for charts, plots, dashboards, statistical graphics or KPI tiles — use the
  dataviz skill for those.
---

# FlowViz authoring

FlowViz renders a JSON file as an animated isometric diagram you step through.
This skill exists because authoring one has an awkward prerequisite: the
renderer, the schema and the authoring guide all live in the FlowViz repo, and
you are almost always working somewhere else — inside the product repo whose
behaviour you want to draw.

The commands below use `$SKILL` for this skill's own directory — the base
directory you were given when this skill loaded. Set it once so the rest
copy-pastes:

```bash
SKILL=<the base directory of this skill>
```

Your job is orchestration and interrogation, not schema knowledge:

1. Find the FlowViz checkout and confirm it works.
2. Read **that checkout's** authoring guide and schema — they are the contract.
3. Work out what the visualization is for and how deep it should go.
4. Gather the real material (read the code, the trace, the doc — don't invent).
5. Write the flow JSON, validate it, hand back a URL.

## Why you read the repo's own guide, every time

Different people run different states of FlowViz. Someone's checkout may predate
nested scenes, or `footer` notes, or the five-prism `shape` set. If you author
from memory you will emit fields their renderer silently ignores or their
validator rejects.

So: `flow-authoring-guide.md` in the checkout is authoritative, and
`src/types/schema.ts` is the final word on which fields exist. Read them before
writing anything. If you want to use a feature, grep the schema for it first:

```bash
grep -nE '\b(footer|waterfall|detail|scene|count|shape)\b' src/types/schema.ts
```

Absent from the schema means absent from that renderer. Author without it and
mention the option to the user rather than shipping JSON that won't load.

## Step 1 — Find the checkout

```bash
bash "$SKILL/scripts/flowviz-locate.sh"
```

It checks `$FLOWVIZ_DIR`, then a cached path, then searches the usual project
directories for a folder containing `flow-authoring-guide.md`. Outcomes:

- **One hit** — use it. Say which path you're using, so a dev with two checkouts
  can stop you.
- **Several hits** — list them and ask which one. Cache the answer.
- **None** — ask for the path. Then cache it:
  ```bash
  bash "$SKILL/scripts/flowviz-locate.sh" --set /path/to/flowviz
  ```

Everything after this runs with the FlowViz repo as the working directory. Keep
using absolute paths for anything in the user's original repo — you will be
reading source there while writing JSON here.

## Step 2 — Check the checkout is usable

```bash
bash "$SKILL/scripts/flowviz-preflight.sh" /path/to/flowviz
```

Reports the package manager (both lockfiles sometimes exist), whether
`node_modules` is present, whether the dev server is already up, git branch and
cleanliness, and which optional schema features that version supports.

If dependencies are missing, install them with the manager the lockfile implies
and say so — a dev who has not opened this repo in months should not have to
guess why validation failed. If the repo is on a branch with uncommitted work,
mention it once and carry on; you are only adding a file.

## Step 3 — Intake: what is this for, and how deep

This is the part that decides whether the visualization is any good, so do not
skip it even when the request sounds complete. "Make a flowviz of the checkout
flow" leaves the two most important questions open: what the viewer should
understand afterwards, and how much detail earns its place.

Read `references/intake.md` and run the intake. In short:

- Ask in **one batch** (use AskUserQuestion) — audience and purpose, where the
  flow starts and ends, and which depth tier.
- Offer the three tiers by name — **sketch**, **walkthrough**, **forensic** —
  with what each costs and buys. Recommend one from what they've told you.
- If the answer is "high level, but with detail in one place", that is what
  nested scenes are for, if the checkout supports them.

Skip the interview only when the user has already answered it, which happens
when they hand you a spec or say "same depth as the oauth one".

## Step 4 — Gather real material

A flow's worth comes from being true. Read the actual source:

- **A code path**: follow it. Use the file and line for `meta.file`/`meta.line`
  so a viewer can jump to it.
- **A trace**: work from the exported spans, not from a summary of them.
  Aggregate repeats per the guide rather than emitting one step per span.
- **A doc or diagram**: extract entities and hops, then say which parts you
  could not verify.

When something is genuinely unclear — does this queue retry? does that call
block? — ask rather than drawing a confident lie. A diagram is read as fact.

## Step 5 — Write it

Flows live in one of two directories and the choice matters, because only one is
committed:

| Directory | Committed | Use for |
|---|---|---|
| `public/flows/custom/` | no — git-ignored | **the default.** Anything about the user's own product |
| `public/flows/examples/` | yes | reference flows meant to ship, only when asked |

**Write to `public/flows/custom/<slug>.json`**, slug in kebab-case from the
title. A flow of someone's internal request path names their services, file paths
and sometimes their customers; that belongs on their machine, not in a shared
repo. Only use `examples/` if the user says they want it committed as an example.

If the checkout predates this split — no `examples/` or `custom/` directory —
write to `public/flows/` as before rather than inventing a structure their
manifest won't read.

Editing: change the existing file in place; do not rewrite it wholesale, because
someone tuned that layout by hand.

Follow the guide's layout rules — the spacing ones exist because packets sweep
wide arcs and clip neighbouring components. Then validate:

```bash
node "$SKILL/scripts/flowviz-validate.mjs" /path/to/flowviz public/flows/custom/<slug>.json
```

It validates against the repo's own zod schema and builds the graph, so it
catches everything the app would hit at load: unknown ids, cross-scene
references, bad enum values, duplicate ids. Fix and re-run until clean. Do not
hand over a flow you have not validated.

## Step 6 — Hand back

Leave the file uncommitted. The dev owns the commit; they may be on a fork or a
branch with its own conventions.

Tell them:

- The file you wrote or changed.
- The URL: `http://localhost:5175/?flow=<slug>` — the id is the filename without
  its directory or extension. (The port is pinned in `vite.config.ts`; check it
  rather than assuming.)
- That it landed in `custom/`, which is git-ignored, so they know it will not
  show up in `git status`.
- How to start the server if it isn't running: `pnpm run dev` (or npm), from the
  FlowViz repo.
- One line on what you could not verify, if anything.

**Never stop a dev server with `pkill -f vite`.** It matches every vite process
on the machine, including other repos' servers and `vitest`. If one needs
stopping: `lsof -ti tcp:5175 | xargs kill`.

New flow files appear in the Visualizations tab only after a dev-server restart,
because the flow list is read at startup. Say so if you added one while the
server was already running, or they'll think it failed.

## Editing an existing visualization

List what's there before guessing at names:

```bash
for f in public/flows/*.json public/flows/*/*.json; do
  [ -f "$f" ] || continue
  printf '%s\t%s\t%s\n' \
    "$(basename "$f" .json)" \
    "$(dirname "${f#public/flows/}")" \
    "$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['meta']['title'])" "$f")"
done
```

The id is the bare filename — `?flow=oauth` works whether the file sits in
`examples/`, `custom/` or the root.

Match the user's words against titles as well as filenames — people say "the
ticket one", not `deskpro-ticket-write-path`. Confirm the file before editing.

For layout complaints ("it's cramped", "that pipe crosses"), the fastest route
is often the app's own edit mode rather than hand-editing coordinates: the dev
opens the flow, presses **Edit layout**, drags things, presses **Copy JSON**, and
pastes it back. Offer that when the fix is aesthetic; do it in JSON when the fix
is structural.

## Reference files

- `references/intake.md` — the intake questions, the three depth tiers, and how
  to translate answers into step counts and component budgets.
- `references/repo-setup.md` — locating and repairing a checkout: stale
  dependencies, version skew, validation failures, and what to do when the
  repo isn't there at all.
