/**
 * How much a component card says, decided by how far the view is zoomed out.
 *
 * A card is sized in CSS pixels and the diagram is not: the zoom range runs
 * from 40% to 400% of the scene's overview framing, so pulling all the way back
 * leaves a fixed 260px card sitting over a diagram drawn at 40% of the size it
 * was fitted to. The card wins, and the thing it is covering is the thing you
 * pulled back to see.
 *
 * Scaling the card down with the zoom would keep the proportions and lose the
 * words — 0.8rem at 40% is not text any more. So the card keeps its type size
 * and drops its body instead. Zoomed out you are sweeping the diagram asking
 * which one is this, and the name answers that; the description is what you
 * zoom in for.
 */

/**
 * Zoom level below which cards carry their name only.
 *
 * The wheel moves in notches of 1.12, so from the opening framing this lands on
 * the fourth notch out — far enough back that the change follows a deliberate
 * pull-back rather than a nudge. Each notch is an 11% jump, so nothing sits
 * close enough to the threshold to flicker across it.
 */
export const COMPACT_ZOOM_THRESHOLD = 0.7

/** Whether a card at this zoom shows its name alone. `zoomLevel` is the same
 *  unit the playbar reads out: 1 is the scene's own overview framing. */
export function isCompactAtZoom(zoomLevel: number): boolean {
  return zoomLevel < COMPACT_ZOOM_THRESHOLD
}
