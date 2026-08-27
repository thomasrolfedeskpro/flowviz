import type { FlowDefinition } from '@/types/schema'
import type { InternalGraph } from '@/types/internal'
import { CELL_SIZE, COMPONENT_GAP } from '@/engine/layoutEngine'

export function graphToFlowDefinition(
  graph: InternalGraph,
  original: FlowDefinition,
): FlowDefinition {
  const components = original.components.map(orig => {
    const ic = graph.components.get(orig.id)
    if (!ic) return orig
    const w   = ic.meshSize.x / (CELL_SIZE * COMPONENT_GAP)
    const h   = ic.meshSize.z / (CELL_SIZE * COMPONENT_GAP)
    const col = Math.round(ic.center.x / CELL_SIZE - w / 2)
    const row = Math.round(ic.center.z / CELL_SIZE - h / 2)
    const next = {
      ...orig,
      position: { ...orig.position, col, row },
      size: { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) },
      icon:  ic.icon,
      color: ic.color,
      shape: ic.shape,
    }
    // Cleared overrides drop out of the JSON rather than serialising as undefined.
    if (!next.icon)  delete next.icon
    if (!next.color) delete next.color
    if (!next.shape || next.shape === 'cuboid') delete next.shape   // cuboid is the default
    return next
  })

  const connections = original.connections.map(orig => {
    const conn = graph.connections.get(orig.id)
    if (!conn) return orig
    // route carries edited waypoints, and becomes 'auto' once they are all deleted
    const next = { ...orig, route: conn.route }
    if (conn.label) next.label = conn.label
    return next
  })

  const zones = original.zones.map(orig => {
    const iz = graph.zones.find(z => z.id === orig.id)
    if (!iz) return orig
    const col = Math.round(iz.min.x / CELL_SIZE)
    const row = Math.round(iz.min.z / CELL_SIZE)
    return {
      ...orig,
      label: iz.label,
      bounds: {
        col,
        row,
        width:  Math.max(1, Math.round(iz.max.x / CELL_SIZE) - col),
        height: Math.max(1, Math.round(iz.max.z / CELL_SIZE) - row),
      },
    }
  })

  // gridBounds grows when a zone is stretched past the grid edge — keep the
  // exported grid big enough that the layout survives a reload.
  const layout = {
    ...original.layout,
    grid: {
      ...original.layout.grid,
      cols: Math.max(original.layout.grid.cols, Math.round(graph.gridBounds.maxX / CELL_SIZE)),
      rows: Math.max(original.layout.grid.rows, Math.round(graph.gridBounds.maxZ / CELL_SIZE)),
    },
  }

  return { ...original, layout, components, connections, zones }
}
