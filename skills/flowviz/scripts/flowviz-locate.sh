#!/usr/bin/env bash
# Locate a FlowViz checkout from anywhere on the machine.
#
# Order: $FLOWVIZ_DIR, cached path, then a bounded search of the usual project
# roots for a directory containing flow-authoring-guide.md. The guide is the
# marker rather than the repo name, because people clone it under all sorts of
# names.
#
#   flowviz-locate.sh              # print the checkout path, or candidates
#   flowviz-locate.sh --set PATH   # cache PATH for next time
#   flowviz-locate.sh --clear      # forget the cached path

set -uo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/flowviz"
CACHE_FILE="$CACHE_DIR/repo-path"
MARKER="flow-authoring-guide.md"

is_checkout() {
  [ -n "${1:-}" ] && [ -f "$1/$MARKER" ] && [ -d "$1/public/flows" ]
}

describe() {
  local dir="$1" branch=""
  branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "not a git repo")
  local flows
  flows=$(find "$dir/public/flows" -maxdepth 2 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  printf '%s\t(branch: %s, %s flows)\n' "$dir" "$branch" "$flows"
}

case "${1:-}" in
  --set)
    target="${2:?--set needs a path}"
    target="$(cd "$target" 2>/dev/null && pwd)" || { echo "No such directory: ${2}" >&2; exit 1; }
    if ! is_checkout "$target"; then
      echo "Not a FlowViz checkout (no $MARKER + public/flows): $target" >&2
      exit 1
    fi
    mkdir -p "$CACHE_DIR"
    printf '%s\n' "$target" > "$CACHE_FILE"
    echo "cached: $target"
    exit 0
    ;;
  --clear)
    rm -f "$CACHE_FILE"
    echo "cache cleared"
    exit 0
    ;;
esac

# 1. explicit environment variable wins, so a dev can pin it per shell
if [ -n "${FLOWVIZ_DIR:-}" ]; then
  if is_checkout "$FLOWVIZ_DIR"; then
    echo "source: FLOWVIZ_DIR"
    describe "$FLOWVIZ_DIR"
    exit 0
  fi
  echo "warning: FLOWVIZ_DIR is set but is not a FlowViz checkout: $FLOWVIZ_DIR" >&2
fi

# 2. cached from a previous session
if [ -f "$CACHE_FILE" ]; then
  cached="$(cat "$CACHE_FILE")"
  if is_checkout "$cached"; then
    echo "source: cache"
    describe "$cached"
    exit 0
  fi
  echo "warning: cached path no longer valid, re-searching: $cached" >&2
fi

# 3. search the usual roots. Depth-limited and pruned so this stays quick on a
#    home directory full of node_modules.
ROOTS=(
  "$HOME/repos" "$HOME/src" "$HOME/code" "$HOME/projects" "$HOME/dev"
  "$HOME/work" "$HOME/git" "$HOME/Developer" "$HOME/Documents/repos"
  "$HOME/Documents" "$HOME"
)

found=()
for root in "${ROOTS[@]}"; do
  [ -d "$root" ] || continue
  depth=4
  [ "$root" = "$HOME" ] && depth=3   # shallower at the top, it is the widest
  while IFS= read -r hit; do
    dir="$(dirname "$hit")"
    is_checkout "$dir" || continue
    case " ${found[*]:-} " in *" $dir "*) continue ;; esac
    found+=("$dir")
  done < <(find "$root" -maxdepth "$depth" \
              \( -name node_modules -o -name .git -o -name Library \
                 -o -name Applications -o -name .Trash \) -prune -o \
              -type f -name "$MARKER" -print 2>/dev/null)
  [ "${#found[@]}" -gt 0 ] && break
done

case "${#found[@]}" in
  0)
    echo "source: none"
    echo "No FlowViz checkout found. Ask the user for the path, then:" >&2
    echo "  bash \"\$SKILL/scripts/flowviz-locate.sh\" --set /path/to/flowviz" >&2
    exit 2
    ;;
  1)
    echo "source: search"
    describe "${found[0]}"
    mkdir -p "$CACHE_DIR"
    printf '%s\n' "${found[0]}" > "$CACHE_FILE"
    exit 0
    ;;
  *)
    echo "source: search (multiple candidates — ask which one, then --set it)"
    for dir in "${found[@]}"; do describe "$dir"; done
    exit 3
    ;;
esac
