import { useRef } from 'react'
import ReactDOM from 'react-dom'
import type { InternalGraph } from '@/types/internal'
import type { OverlayBridge } from '@/scene/OverlayBridge'
import { useWorldToScreen } from '@/hooks/useWorldToScreen'
import { PinIcon, RelationsIcon } from '@/components/ControlIcons'
import { Tooltip } from '@/components/Tooltip'
import styles from '@/styles/HoverTooltip.module.css'

interface HoverTooltipProps {
  componentId: string | null
  graph:       InternalGraph
  bridge:      OverlayBridge
  /** Kept open by its own pin, rather than following the pointer. */
  pinned?:     boolean
  /**
   * Name only, no body. Set while the view is zoomed far enough out that a
   * full card would cover the diagram it is describing — see `cardDensity`.
   * Pinned cards compact too: several of them at once is the worse case, not
   * the exception.
   */
  compact?:    boolean
  onTogglePin?: () => void
  /**
   * Light every connection this component makes, across the whole flow.
   *
   * Offered whether the card is pinned or merely hovered: the point of it is
   * seeing the shape without leaving a card sitting over the diagram.
   */
  relations?: {
    /** Only to tell a component with no connections from one with some. */
    count:    number
    on:       boolean
    onToggle: () => void
  }
  /** So a card the pointer has moved onto is not pulled from under it. */
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

/**
 * One component's card.
 *
 * Normally it follows the pointer, one at a time. Pinned, several stay up at
 * once: a flow is read a step at a time, and remembering what four components
 * were for while the packets move between them is the thing this saves.
 *
 * Its two controls are icons with tooltips rather than labelled buttons. The
 * card appears under the pointer while you are reading the diagram, and a pair
 * of sentences arriving there is more in the way than the card itself.
 */
export function HoverTooltip({
  componentId,
  graph,
  bridge,
  pinned = false,
  compact = false,
  onTogglePin,
  relations,
  onPointerEnter,
  onPointerLeave,
}: HoverTooltipProps) {
  const divRef    = useRef<HTMLDivElement | null>(null)
  const component = componentId ? (graph.components.get(componentId) ?? null) : null

  useWorldToScreen(
    bridge,
    () => component?.topCenter ?? null,
    (x, y) => {
      if (divRef.current) {
        // `--card-gap` is defined in the stylesheet, which also spans it with the
        // bridge that makes it hoverable. Read from there so the two cannot drift.
        divRef.current.style.transform =
          `translate(calc(${x}px - 50%), calc(${y}px - 100% - var(--card-gap)))`
      }
    },
    [componentId, graph],
  )

  if (!component) return null

  const { meta } = component
  // Nothing in the body to hide is not the same as hiding it: a card that was
  // only ever a name must not gain a gap under it at one zoom and lose it at
  // another.
  const hasBody = Boolean(meta?.description || meta?.file || meta?.notes)
  const bodyShown = hasBody && !compact
  const overlayRoot = document.getElementById('overlay-root')
  if (!overlayRoot) return null


  return ReactDOM.createPortal(
    <div
      ref={divRef}
      className={[
        styles.tooltip,
        pinned && styles.pinned,
        !bodyShown && styles.headOnly,
      ].filter(Boolean).join(' ')}
      style={{ transform: 'translate(-9999px, -9999px)' }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className={styles.head}>
        <strong>{component.label}</strong>
        <span className={styles.actions}>
          {relations && (
            <Tooltip label={relations.on ? 'Hide connections' : 'Show connections'}>
              <button
                type="button"
                className={relations.on ? `${styles.action} ${styles.actionOn}` : styles.action}
                aria-pressed={relations.on}
                aria-label={relations.on ? 'Hide connections' : 'Show connections'}
                // Nothing to light: offering the toggle would be a button that
                // provably does nothing.
                disabled={relations.count === 0}
                onClick={relations.onToggle}
              >
                <RelationsIcon />
              </button>
            </Tooltip>
          )}
          {onTogglePin && (
            <Tooltip label={pinned ? 'Let this card go' : 'Keep this card open'}>
              <button
                type="button"
                className={pinned ? `${styles.action} ${styles.actionOn}` : styles.action}
                aria-pressed={pinned}
                aria-label={pinned ? 'Unpin this card' : 'Pin this card'}
                onClick={onTogglePin}
              >
                <PinIcon />
              </button>
            </Tooltip>
          )}
        </span>
      </div>
      {/* The scrolling and the wrapping live here, not on the card, so the
          header's tooltips are not clipped by them. */}
      {bodyShown && (
        <div className={styles.body}>
          {meta?.description && <p>{meta.description}</p>}
          {meta?.file && (
            <code>{meta.file}{meta.line ? `:${meta.line}` : ''}</code>
          )}
          {meta?.notes && <p className={styles.notes}>{meta.notes}</p>}
        </div>
      )}
    </div>,
    overlayRoot
  )
}
