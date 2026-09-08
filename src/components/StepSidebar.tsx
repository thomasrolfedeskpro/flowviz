import { Fragment, useEffect, useRef, useState } from 'react'
import type { Step } from '@/types/schema'
import { waterfallLanes } from '@/utils/waterfall'
import type { SceneInfo } from '@/utils/scenes'
import type { LintFinding } from '@/engine/geometryLint'
import styles from '@/styles/StepSidebar.module.css'

export interface FlowSummary {
  id: string
  title: string
  description: string
  /** subdirectory it came from — "examples" flows are read-only */
  group?: string
}

interface Props {
  steps: Step[]
  currentIndex: number
  /** What the waterfall measures, from `meta.waterfallLabel`. Bars are unitless,
   *  so this is the only thing that says whether they are ms, miles or pounds. */
  waterfallLabel?: string
  editMode: boolean
  flowId: string
  flows: FlowSummary[]
  /** Nested scenes by owning component id — used to indent their steps. */
  scenes?: Map<string, SceneInfo>
  onGoTo: (index: number) => void
  onEditModeToggle: () => void
  onSelectFlow: (id: string) => void
  /** Omitted when deleting isn't possible (no dev server to remove the file). */
  onDeleteFlow?: (flow: FlowSummary) => void
  onCopyJson?: () => void
  /** Writes the edited flow back to its file. Omitted when there's no dev server. */
  onSave?: () => void
  saveState?: { status: 'idle' | 'saving' | 'saved' | 'error'; message: string }
  // Step editing — all edit-mode only, and all omitted outside the dev server.
  onEditStep?: (index: number) => void
  onDuplicateStep?: (index: number) => void
  onDeleteStep?: (index: number) => void
  onAddStep?: (index: number) => void
  onReorderStep?: (from: number, to: number) => void
  /** Opens the flow's own settings — title, description, grid, timing. */
  onEditFlow?: () => void
  /** Opens the whole flow as raw JSON. */
  onEditJson?: () => void
  /** What a press on the canvas currently means. */
  mode?: 'select' | 'place-component' | 'place-zone' | 'connect'
  onModeChange?: (mode: 'select' | 'place-component' | 'place-zone' | 'connect') => void
  /** Re-lay the scene on screen. One action, so one undo. */
  onTidyLayout?: () => void
  /** Unsaved edits exist. */
  dirty?: boolean
  /** Validation messages for the whole flow, as "path: what's wrong". */
  problems?: string[]
  /** Layout findings. Advisory: they never stop a save, because a bad layout
   *  still loads and every drag passes through one on its way somewhere. */
  layoutWarnings?: LintFinding[]
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
}

export function StepSidebar({
  steps,
  currentIndex,
  waterfallLabel,
  editMode,
  flowId,
  flows,
  scenes,
  onGoTo,
  onEditModeToggle,
  onSelectFlow,
  onDeleteFlow,
  onCopyJson,
  onSave,
  saveState,
  onEditStep,
  onDuplicateStep,
  onDeleteStep,
  onAddStep,
  onReorderStep,
  onEditFlow,
  onEditJson,
  mode = 'select',
  onModeChange,
  onTidyLayout,
  dirty = false,
  problems = [],
  layoutWarnings = [],
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
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
  // Reorder drag: which row is moving, and where it would land.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [showWarnings, setShowWarnings] = useState(false)

  const currentTitle = flows.find((f) => f.id === flowId)?.title ?? ''

  // Waterfall bars are opt-in per flow: no data, no toggle.
  const lanes = waterfallLanes(steps)
  const hasWaterfall = lanes.span > 0
  const waterfallName = waterfallLabel?.trim() || 'Waterfall'
  const open = showWaterfall && hasWaterfall && tab === 'steps'

  // Keep the active step visible when it changes programmatically
  useEffect(() => {
    if (tab === 'steps') activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentIndex, tab])

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
          {/* Which flow you're looking at — the tabs above only say "Steps". */}
          {currentTitle && (
            <h2 className={styles.flowHeading} title={currentTitle}>
              {currentTitle}
            </h2>
          )}

          <div className={styles.header}>
            {hasWaterfall && (
              <button
                className={`${styles.iconBtn}${showWaterfall ? ` ${styles.iconBtnActive}` : ''}`}
                onClick={() => setShowWaterfall((v) => !v)}
                aria-pressed={showWaterfall}
                title={`${showWaterfall ? 'Hide' : 'Show'} ${waterfallName}`}
                aria-label={`${showWaterfall ? 'Hide' : 'Show'} ${waterfallName}`}
              >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path d="M1 2.5h9v2.2H1zM3 6.4h11v2.2H3zM2 10.3h6v2.2H2z" fill="currentColor" />
                </svg>
              </button>
            )}
            {editMode && onEditFlow && (
              <button
                className={styles.iconBtn}
                onClick={onEditFlow}
                title="Visualization settings"
                aria-label="Visualization settings"
              >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path
                    d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zm6 2.4a6 6 0 0 1-.1 1l1.3 1-1.3 2.3-1.6-.5a6 6 0 0 1-1.7 1l-.2 1.7H7.6l-.2-1.7a6 6 0 0 1-1.7-1l-1.6.5L2.8 10l1.3-1a6 6 0 0 1 0-2l-1.3-1 1.3-2.3 1.6.5a6 6 0 0 1 1.7-1L7.6 1.6h2.8l.2 1.7a6 6 0 0 1 1.7 1l1.6-.5L15.2 6l-1.3 1c.1.3.1.7.1 1z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            )}
            {editMode && onEditJson && (
              <button
                className={styles.iconBtn}
                onClick={onEditJson}
                title="Edit the whole flow as JSON"
                aria-label="Edit the whole flow as JSON"
              >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path
                    d="M6.2 1.8 4.6 3.4a3 3 0 0 0-.9 2.1v1.2L2 8l1.7 1.3v1.2a3 3 0 0 0 .9 2.1l1.6 1.6M9.8 1.8l1.6 1.6a3 3 0 0 1 .9 2.1v1.2L14 8l-1.7 1.3v1.2a3 3 0 0 1-.9 2.1l-1.6 1.6"
                    fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            <button
              className={`${styles.editBtn}${editMode ? ` ${styles.editBtnActive}` : ''}`}
              onClick={onEditModeToggle}
            >
              {editMode ? 'Done' : 'Edit layout'}
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
                  (editMode ? ` ${styles.stepItemEditable}` : '') +
                  (open ? ` ${styles.itemFixed}` : '') +
                  (i === currentIndex ? ` ${styles.active}` : '') +
                  (open && hovered === i ? ` ${styles.hovered}` : '') +
                  (dropIndex === i ? ` ${styles.dropBefore}` : '')
                }
                onClick={() => onGoTo(i)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                title={open ? (step.name ?? step.title) : undefined}
                // Reorder is drag-and-drop on the row itself; the row is only
                // draggable in edit mode, so a normal click-to-jump is unaffected.
                draggable={editMode && !!onReorderStep}
                onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => {
                  if (dragIndex === null) return
                  e.preventDefault()
                  // Snap to the nearer edge, so a row can be dropped below the last one.
                  const box = e.currentTarget.getBoundingClientRect()
                  const after = e.clientY > box.top + box.height / 2
                  setDropIndex(after ? i + 1 : i)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIndex !== null && dropIndex !== null) {
                    // Removing the dragged row first shifts everything after it.
                    const to = dropIndex > dragIndex ? dropIndex - 1 : dropIndex
                    onReorderStep?.(dragIndex, to)
                  }
                  setDragIndex(null)
                  setDropIndex(null)
                }}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null) }}
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

                {editMode && (
                  <span className={styles.stepActions}>
                    {onEditStep && (
                      <button
                        className={styles.stepActionBtn}
                        title={`Edit step ${i}`}
                        aria-label={`Edit step ${i}`}
                        onClick={(e) => { e.stopPropagation(); onEditStep(i) }}
                      >
                        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                          <path d="M11.5 1.7 14.3 4.5 5.8 13H3v-2.8zM10.4 2.8l2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        </svg>
                      </button>
                    )}
                    {onDuplicateStep && (
                      <button
                        className={styles.stepActionBtn}
                        title={`Duplicate step ${i}`}
                        aria-label={`Duplicate step ${i}`}
                        onClick={(e) => { e.stopPropagation(); onDuplicateStep(i) }}
                      >
                        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                          <rect x="2.5" y="2.5" width="8" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                          <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        </svg>
                      </button>
                    )}
                    {/* The last step stays: a flow with none of them can't render. */}
                    {onDeleteStep && steps.length > 1 && (
                      <button
                        className={`${styles.stepActionBtn} ${styles.stepActionDanger}`}
                        title={`Delete step ${i}`}
                        aria-label={`Delete step ${i}`}
                        onClick={(e) => { e.stopPropagation(); onDeleteStep(i) }}
                      >
                        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                          <path d="M6 2h4v1h3v1.5H3V3h3zM4.5 5.5h7l-.6 8.5H5.1z" fill="currentColor" />
                        </svg>
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}

            {editMode && onAddStep && (
              <button className={styles.addStepBtn} onClick={() => onAddStep(steps.length)}>
                + Add step
              </button>
            )}
          </div>

          {editMode && onModeChange && (
            <div className={styles.toolbar} role="group" aria-label="Add to the scene">
              {([
                ['place-component', 'Component', 'Click the grid to place a component'],
                ['place-zone',      'Zone',      'Click the grid to place a zone'],
                ['connect',         'Connect',   'Click two components to join them'],
              ] as const).map(([m, label, title]) => (
                <button
                  key={m}
                  className={`${styles.toolBtn}${mode === m ? ` ${styles.toolBtnOn}` : ''}`}
                  aria-pressed={mode === m}
                  title={`${title} — Esc to cancel`}
                  onClick={() => onModeChange(mode === m ? 'select' : m)}
                >
                  {m === 'connect' ? '⤳' : '＋'} {label}
                </button>
              ))}
            </div>
          )}

          {editMode && onTidyLayout && (
            <div className={styles.toolbar}>
              <button
                className={styles.toolBtn}
                onClick={onTidyLayout}
                title="Re-lay this scene left to right, keeping zones around their members. One undo puts it back."
              >
                ⇥ Tidy layout
              </button>
            </div>
          )}

          {editMode && (
            <div className={styles.editFooter}>
              {/* Problems first: the reason Save is disabled should be the thing
                  you read before you reach for it. */}
              {problems.length > 0 && (
                <div className={styles.problems}>
                  <button
                    className={styles.problemsHead}
                    onClick={() => setShowProblems((v) => !v)}
                    aria-expanded={showProblems}
                  >
                    <span className={styles.problemsCount}>{problems.length}</span>
                    {problems.length === 1 ? 'problem' : 'problems'}
                    <span className={styles.chevron}>{showProblems ? '▾' : '▸'}</span>
                  </button>
                  {showProblems && (
                    <ul className={styles.problemList}>
                      {problems.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {/* Layout findings sit below the problems and above the history,
                  deliberately not next to Save: they are things to look at, not
                  things to fix before you can write the file. */}
              {layoutWarnings.length > 0 && (
                <div className={styles.warnings}>
                  <button
                    className={styles.warningsHead}
                    onClick={() => setShowWarnings((v) => !v)}
                    aria-expanded={showWarnings}
                  >
                    <span className={styles.warningsCount}>{layoutWarnings.length}</span>
                    layout {layoutWarnings.length === 1 ? 'note' : 'notes'}
                    <span className={styles.chevron}>{showWarnings ? '▾' : '▸'}</span>
                  </button>
                  {showWarnings && (
                    <ul className={styles.warningList}>
                      {layoutWarnings.map((w, i) => (
                        <li key={i} className={w.severity === 'error' ? styles.warnSevere : undefined}>
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {(onUndo || onRedo) && (
                <div className={styles.historyRow}>
                  <button
                    className={styles.historyBtn}
                    onClick={onUndo}
                    disabled={!canUndo}
                    title="Undo (⌘Z)"
                  >
                    ↩ Undo
                  </button>
                  <button
                    className={styles.historyBtn}
                    onClick={onRedo}
                    disabled={!canRedo}
                    title="Redo (⇧⌘Z)"
                  >
                    ↪ Redo
                  </button>
                </div>
              )}

              <div className={styles.editActions}>
                {onSave && (
                  <button
                    className={styles.saveBtn}
                    onClick={onSave}
                    // A flow that won't validate can't be written: the server
                    // would refuse it anyway, with less to go on.
                    disabled={saveState?.status === 'saving' || problems.length > 0}
                    title={
                      problems.length
                        ? 'Fix the problems above before saving'
                        : 'Write these edits back to the flow file'
                    }
                  >
                    {saveState?.status === 'saving'
                      ? 'Saving…'
                      : dirty ? 'Save to file •' : 'Save to file'}
                  </button>
                )}
                <button
                  className={styles.copyJsonBtn}
                  onClick={onCopyJson}
                  title="Copy current layout as flow JSON to clipboard"
                >
                  Copy JSON
                </button>
              </div>
              {saveState && saveState.status !== 'idle' && saveState.status !== 'saving' && (
                <p
                  className={`${styles.saveNote} ${
                    saveState.status === 'error' ? styles.saveError : styles.saveOk
                  }`}
                >
                  {saveState.message}
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className={styles.list}>
          {flows.map((f, i) => (
            <Fragment key={f.id}>
              {/* Bundled examples sit above the rule, personal flows below it.
                  Only drawn at the boundary, so a list of one kind has none. */}
              {i > 0 && f.group !== 'examples' && flows[i - 1].group === 'examples' && (
                <hr className={styles.groupRule} aria-hidden="true" />
              )}
            <div
              className={`${styles.item} ${styles.flowItem}${f.id === flowId ? ` ${styles.active}` : ''}`}
              onClick={() => onSelectFlow(f.id)}
              title={f.description}
            >
              <span className={styles.flowTitle}>{f.title}</span>
              {f.description && <span className={styles.flowDesc}>{f.description}</span>}
              {/* Bundled examples are committed and shared, so they aren't
                  offered for deletion; and the last flow standing stays put,
                  because there'd be nothing to fall back to. */}
              {onDeleteFlow && flows.length > 1 && f.group !== 'examples' && (
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
            </Fragment>
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
          <span className={styles.waterfallTitle} title={waterfallName}>{waterfallName}</span>
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
