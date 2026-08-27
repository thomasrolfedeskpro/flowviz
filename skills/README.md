# FlowViz Claude skill

`flowviz/` is a Claude Code skill for authoring and editing FlowViz flows **from
any repo**. It exists because the schema, the renderer and the authoring guide
all live here, while you are usually working in the product repo whose behaviour
you want to draw.

What it does when it triggers:

1. Finds your FlowViz checkout (`$FLOWVIZ_DIR`, a cached path, or a search for
   `flow-authoring-guide.md`) and caches the answer.
2. Checks the checkout is usable — package manager, dependencies, dev server,
   and which schema features that version actually has.
3. Interviews you about intent and depth (sketch / walkthrough / forensic)
   before writing anything.
4. Reads **your checkout's** guide and schema, so it never emits fields your
   version can't parse.
5. Writes the flow to `public/flows/custom/<slug>.json` — the git-ignored
   directory, so product-specific diagrams stay on your machine — and validates
   it against your own zod schema plus a real graph build.

It leaves the file uncommitted and hands back the URL.

## Install

```bash
# from anywhere
unzip -o /path/to/dataviz/skills/dist/flowviz.skill -d ~/.claude/skills
```

That's it — restart Claude Code and ask for something like "make a flowviz of
the webhook path in this repo".

Optional, and worth doing if you have more than one checkout:

```bash
echo 'export FLOWVIZ_DIR=/path/to/your/flowviz' >> ~/.zshrc
```

## Updating it

Edit `skills/flowviz/`, then repackage:

```bash
python3 -m scripts.package_skill /path/to/dataviz/skills/flowviz   # from the skill-creator dir
```

Move the resulting `flowviz.skill` into `skills/dist/` and commit it, so
everyone installs the same version.

## When it should not trigger

It is deliberately scoped to FlowViz flow diagrams. Charts, plots, dashboards,
KPI tiles and statistical graphics belong to Claude's built-in `dataviz` skill —
the description says so explicitly to keep the two from fighting over the same
request.
