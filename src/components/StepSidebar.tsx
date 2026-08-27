import { useEffect, useRef, useState } from 'react'
import type { Step } from '@/types/schema'
import { waterfallLanes } from '@/utils/waterfall'
import type { SceneInfo } from '@/utils/scenes'
import type { Theme } from '@/scene/ThemeColors'
import styles from '@/styles/StepSidebar.module.css'

export interface FlowSummary {
  id: string
  title: string
  description: string
}

interface Props {
  steps: Step[]
  currentIndex: number
  theme: Theme
  editMode: boolean
  flowId: string
  flows: FlowSummary[]
  /** Nested scenes by owning component id — used to indent their steps. */
  scenes?: Map<string, SceneInfo>
  onGoTo: (index: number) => void
  onThemeToggle: () => void
  onEditModeToggle: () => void
  onSelectFlow: (id: string) => void
  /** Omitted when deleting isn't possible (no dev server to remove the file). */
  onDeleteFlow?: (flow: FlowSummary) => void
  onCopyJson?: () => void
}

export function StepSidebar({
  steps,
  currentIndex,
  theme,
  editMode,
  flowId,
  flows,
  scenes,
  onGoTo,
  onThemeToggle,
  onEditModeToggle,
  onSelectFlow,
  onDeleteFlow,
  onCopyJson,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null)
  const stepsListRef = useRef<HTMLDivElement | null>(null)
  const barsListRef = useRef<HTMLDivElement | null>(null)
  const syncing = useRef(false)
  const [tab, setTab] = useState<'steps' | 'flows'>('steps')
  const [showWaterfall, setShowWaterfall] = useState(false)
  const [listTop, setListTop] = useState(0)
  // Hovering either column highlights the pair, so the two read as one row.
  const [hovered, setHovered] = useState<number | null>(null)

  // Waterfall bars are opt-in per flow: no data, no toggle.
  const lanes = waterfallLanes(steps)
  const hasWaterfall = lanes.span > 0
  const open = showWaterfall && hasWaterfall && tab === 'steps'

  // Keep the active step visible when it changes programmatically
  useEffect(() => {
    if (tab === 'steps') activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentIndex, tab])

  // Publish the occupied width so fixed overlays (the playback bar) can avoid it.
  useEffect(() => {
    document.documentElement.dataset.sidebar = open ? 'wide' : 'normal'
  }, [open])

  // Line the bar column up with the step list rather than guessing at the
  // height of the tabs and header above it.
  useEffect(() => {
    const measure = () => {
      const top = stepsListRef.current?.getBoundingClientRect().top
      if (top !== undefined) setListTop(top)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, editMode, tab])

  /** Two scroll containers, one axis: mirror whichever the user is scrolling. */
  const mirrorScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return
    syncing.current = true
    to.scrollTop = from.scrollTop
    requestAnimationFrame(() => { syncing.current = false })
  }

  return (
    <>
    <nav className={styles.sidebar}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab}${tab === 'steps' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('steps')}
        >
          Steps
        </button>
        <button
          className={`${styles.tab}${tab === 'flows' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('flows')}
        >
          Visualizations
        </button>
      </div>

      {tab === 'steps' ? (
        <>
          <div className={styles.header}>
            {hasWaterfall && (
              <button
                className={`${styles.iconBtn}${showWaterfall ? ` ${styles.iconBtnActive}` : ''}`}
                onClick={() => setShowWaterfall((v) => !v)}
                aria-pressed={showWaterfall}
                title={showWaterfall ? 'Hide waterfall' : 'Show waterfall'}
                aria-label={showWaterfall ? 'Hide waterfall' : 'Show waterfall'}
              >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path d="M1 2.5h9v2.2H1zM3 6.4h11v2.2H3zM2 10.3h6v2.2H2z" fill="currentColor" />
                </svg>
              </button>
            )}
            <button
              className={`${styles.editBtn}${editMode ? ` ${styles.editBtnActive}` : ''}`}
              onClick={onEditModeToggle}
            >
              {editMode ? 'Done' : 'Edit layout'}
            </button>
            <button className={styles.themeBtn} onClick={onThemeToggle}>
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>

          <div
            className={styles.list}
            ref={stepsListRef}
            onScroll={() => mirrorScroll(stepsListRef.current, barsListRef.current)}
          >
            {steps.map((step, i) => (
              <div
                key={step.id}
                ref={i === currentIndex ? activeRef : null}
                className={
                  `${styles.item}` +
                  (open ? ` ${styles.itemFixed}` : '') +
                  (i === currentIndex ? ` ${styles.active}` : '') +
                  (open && hovered === i ? ` ${styles.hovered}` : '')
                }
                onClick={() => onGoTo(i)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                title={open ? (step.name ?? step.title) : undefined}
              >
                {/* one notch of indent per level of nesting */}
                <span
                  className={styles.stepNum}
                  style={{ marginLeft: `${(step.scene ? scenes?.get(step.scene)?.depth ?? 0 : 0) * 0.75}rem` }}
                >
                  {i}
                </span>
                <span className={`${styles.stepName}${open ? ` ${styles.stepNameTight}` : ''}`}>
                  {step.name ?? step.title}
                </span>

              </div>
            ))}
          </div>

          {editMode && (
            <div className={styles.editFooter}>
              <button
                className={styles.copyJsonBtn}
                onClick={onCopyJson}
                title="Copy current layout as flow JSON to clipboard"
              >
                Copy JSON
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={styles.list}>
          {flows.map((f) => (
            <div
              key={f.id}
              className={`${styles.item} ${styles.flowItem}${f.id === flowId ? ` ${styles.active}` : ''}`}
              onClick={() => onSelectFlow(f.id)}
              title={f.description}
            >
              <span className={styles.flowTitle}>{f.title}</span>
              {f.description && <span className={styles.flowDesc}>{f.description}</span>}
              {/* last one standing stays put — there'd be nothing to fall back to */}
              {onDeleteFlow && flows.length > 1 && (
                <button
                  className={styles.deleteBtn}
                  title={`Delete ${f.title}`}
                  aria-label={`Delete ${f.title}`}
                  onClick={(e) => { e.stopPropagation(); onDeleteFlow(f) }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d="M6 2h4v1h3v1.5H3V3h3zM4.5 5.5h7l-.6 8.5H5.1z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </nav>

    {/* A column of its own, pulled out from behind the sidebar. Rows are the
        same fixed height as the step rows and the two lists share a scroll
        position, so every bar stays level with the step it measures. */}
    {hasWaterfall && (
      <aside
        className={`${styles.waterfall}${open ? ` ${styles.waterfallOpen}` : ''}`}
        aria-hidden={!open}
      >
        {/* Spacer sized to the step list's offset, so row one lines up with step one. */}
        <div className={styles.waterfallHeader} style={{ height: listTop }}>
          <span className={styles.waterfallTitle}>Waterfall</span>
        </div>
        <div
          className={styles.waterfallList}
          ref={barsListRef}
          onScroll={() => mirrorScroll(barsListRef.current, stepsListRef.current)}
        >
          {steps.map((step, i) => (
            <div
              key={step.id}
              className={
                `${styles.barRow}` +
                (i === currentIndex ? ` ${styles.active}` : '') +
                (hovered === i ? ` ${styles.hovered}` : '')
              }
              onClick={() => onGoTo(i)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {lanes.byStep[i] && (
                <>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      style={{
                        // offset and width are shares of the whole span, so
                        // bars line up like any other waterfall
                        marginLeft: `${lanes.byStep[i]!.offsetPct}%`,
                        width: `${lanes.byStep[i]!.widthPct}%`,
                        background: step.waterfall?.color ?? 'var(--accent-blue)',
                      }}
                    />
                  </span>
                  {/* Absolutely positioned, revealed on hover: an inline label
                      would give every track a different width. */}
                  {step.waterfall?.label && (
                    <span className={styles.barValue}>{step.waterfall.label}</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </aside>
    )}
    </>
  )
}
