/**
 * Grouping for the visualization list.
 *
 * Every flow sits in one of two top-level folders, decided by the directory
 * holding it: bundled examples in one, your own flows in the other. `meta.group`
 * nests it further below that, as a dot-separated path — "deskpro.infra.aws"
 * puts it three levels down inside Custom. The separator is a dot because it is
 * the one character that reads as a path without suggesting the flow is stored
 * at that path: every flow file stays flat in public/flows.
 */

/** The two folders the list always opens on. */
export const EXAMPLES_FOLDER = 'Examples'
export const CUSTOM_FOLDER = 'Custom'

export interface GroupedFlow {
  title: string
  /** Dot-separated path below the top-level folder, from `meta.group`. Empty
   *  means the flow sits directly in that folder. */
  group?: string
  /** The directory the file came from: "examples" or "custom". */
  source?: string
}

/** Which of the two top-level folders a flow belongs to. Anything that isn't a
 *  bundled example is yours, including a flow left at the root of public/flows. */
export function rootFolder(source: string | undefined): string {
  return source === 'examples' ? EXAMPLES_FOLDER : CUSTOM_FOLDER
}

/** The folders a flow sits in, outermost first: its top-level folder, then
 *  whatever `meta.group` nests below it. */
export function folderPath(flow: GroupedFlow): string[] {
  return [rootFolder(flow.source), ...groupSegments(flow.group)]
}

/** Splits a group path into its segments, dropping empties so ".a..b." is still
 *  two levels. Slashes are accepted as separators too, for a group pasted from
 *  a directory path. */
export function groupSegments(group: string | undefined): string[] {
  return (group ?? '')
    .split(/[./]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The canonical spelling of a group path, for storing and comparing. */
export function normaliseGroup(group: string | undefined): string {
  return groupSegments(group).join('.')
}

/** Every group path in use, each ancestor included, sorted. Feeds the combobox
 *  that offers existing groups when you set one. */
export function knownGroups(flows: GroupedFlow[]): string[] {
  const paths = new Set<string>()
  for (const flow of flows) {
    const segments = groupSegments(flow.group)
    for (let i = 1; i <= segments.length; i++) paths.add(segments.slice(0, i).join('.'))
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

/**
 * List order, shared by the dev-server manifest and by the app when it adds an
 * imported flow. Examples first, then by folder, then alphabetical by title.
 */
export function compareFlows(a: GroupedFlow, b: GroupedFlow): number {
  const rank = (f: GroupedFlow) => (f.source === 'examples' ? 0 : 1)
  return (
    rank(a) - rank(b) ||
    folderPath(a).join('.').localeCompare(folderPath(b).join('.')) ||
    a.title.localeCompare(b.title)
  )
}

export type FlowTreeNode<T> =
  | { kind: 'flow'; flow: T }
  | { kind: 'group'; name: string; path: string; count: number; children: FlowTreeNode<T>[] }

/**
 * Turns a flat list into the tree the sidebar draws.
 *
 * Folder order follows the order folders first appear, so the caller's sort is
 * the only thing deciding it — sort with `compareFlows` first. Within a folder,
 * nested folders come before the flows that sit directly in it.
 */
export function buildFlowTree<T extends GroupedFlow>(flows: T[]): FlowTreeNode<T>[] {
  interface Pending {
    node: Extract<FlowTreeNode<T>, { kind: 'group' }>
    subgroups: Map<string, Pending>
    flows: FlowTreeNode<T>[]
  }

  const rootGroups = new Map<string, Pending>()
  const looseFlows: FlowTreeNode<T>[] = []
  const all: Pending[] = []

  for (const flow of flows) {
    const segments = folderPath(flow)
    if (segments.length === 0) {
      looseFlows.push({ kind: 'flow', flow })
      continue
    }

    let level = rootGroups
    let parent: Pending | undefined
    let path = ''
    for (const name of segments) {
      path = path ? `${path}.${name}` : name
      let pending = level.get(name)
      if (!pending) {
        pending = {
          node: { kind: 'group', name, path, count: 0, children: [] },
          subgroups: new Map(),
          flows: [],
        }
        level.set(name, pending)
        all.push(pending)
      }
      pending.node.count++
      parent = pending
      level = pending.subgroups
    }
    parent!.flows.push({ kind: 'flow', flow })
  }

  for (const pending of all) {
    pending.node.children = [
      ...[...pending.subgroups.values()].map((p) => p.node),
      ...pending.flows,
    ]
  }

  return [...[...rootGroups.values()].map((p) => p.node), ...looseFlows]
}

/** Every group path in a tree, for expanding the lot. */
export function allGroupPaths<T>(nodes: FlowTreeNode<T>[]): string[] {
  const out: string[] = []
  const walk = (list: FlowTreeNode<T>[]) => {
    for (const node of list) {
      if (node.kind !== 'group') continue
      out.push(node.path)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}
