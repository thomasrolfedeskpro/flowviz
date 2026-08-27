#!/usr/bin/env bash
# Report whether a FlowViz checkout is ready to author against, and what its
# schema supports. Read-only: it installs nothing and starts nothing, so the
# caller can decide and explain.
#
#   flowviz-preflight.sh /path/to/flowviz

set -uo pipefail
REPO="${1:?usage: flowviz-preflight.sh /path/to/flowviz}"
cd "$REPO" || { echo "cannot cd to $REPO" >&2; exit 1; }

echo "repo: $(pwd)"

# ── git state ────────────────────────────────────────────────────────────────
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "branch: $(git rev-parse --abbrev-ref HEAD)"
  dirty=$(git status --porcelain | wc -l | tr -d ' ')
  echo "uncommitted files: $dirty"
else
  echo "branch: (not a git repo)"
fi

# ── package manager ──────────────────────────────────────────────────────────
pm="npm"
[ -f package-lock.json ] && pm="npm"
[ -f yarn.lock ] && pm="yarn"
[ -f pnpm-lock.yaml ] && pm="pnpm"      # last wins: prefer pnpm when several exist
locks=$(ls -1 pnpm-lock.yaml package-lock.json yarn.lock 2>/dev/null | tr '\n' ' ')
echo "package manager: $pm   (lockfiles: ${locks:-none})"

if [ -d node_modules ]; then
  echo "dependencies: installed"
else
  echo "dependencies: MISSING — run '$pm install' in $REPO before validating"
fi

# ── dev server ───────────────────────────────────────────────────────────────
port=$(grep -oE 'port:[[:space:]]*[0-9]+' vite.config.ts 2>/dev/null | grep -oE '[0-9]+' | head -1)
if [ -z "$port" ]; then
  echo "dev server: port not pinned in vite.config.ts — read it from the server output"
elif lsof -ti "tcp:$port" >/dev/null 2>&1; then
  echo "dev server: running on $port"
else
  echo "dev server: not running (start with '$pm run dev', it serves on $port)"
fi

# ── what this version of the schema supports ─────────────────────────────────
schema="src/types/schema.ts"
if [ -f "$schema" ]; then
  echo "schema features:"
  for feat in detail scene footer waterfall count; do
    if grep -qE "^[[:space:]]*${feat}\??:" "$schema"; then
      echo "  $feat: yes"
    else
      echo "  $feat: NO — do not author this field"
    fi
  done
  shapes=$(sed -n '/ComponentShape/,/^$/p' "$schema" | grep -oE "'[a-z]+'" | tr -d "'" | tr '\n' ' ')
  echo "  component shapes: ${shapes:-unknown}"
else
  echo "schema features: cannot read $schema — is this really a FlowViz checkout?"
fi

# ── flows on disk ────────────────────────────────────────────────────────────
root=$(ls -1 public/flows/*.json 2>/dev/null | wc -l | tr -d ' ')
examples=$(ls -1 public/flows/examples/*.json 2>/dev/null | wc -l | tr -d ' ')
custom=$(ls -1 public/flows/custom/*.json 2>/dev/null | wc -l | tr -d ' ')
echo "existing flows: $examples in examples/, $custom in custom/, $root loose in public/flows"
if [ -d public/flows/custom ]; then
  echo "write new flows to: public/flows/custom/ (git-ignored)"
else
  echo "write new flows to: public/flows/ (this checkout predates the examples/custom split)"
fi
