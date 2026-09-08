import type { ReactNode } from 'react'
import { useStepEngine } from '@/hooks/useStepEngine'
import type { StepEngine } from '@/engine/stepEngine'
import type { ViewMode } from '@/scene/viewMode'
import type { Theme } from '@/scene/ThemeColors'
import {
  StepBackIcon, StepForwardIcon, PlayIcon, PauseIcon, FollowIcon,
  IsometricIcon, PlanIcon, SunIcon, MoonIcon,
  EnterFullScreenIcon, ExitFullScreenIcon,
} from '@/components/ControlIcons'
import { Tooltip } from '@/components/Tooltip'
import styles from '@/styles/StepControls.module.css'

const SPEED_OPTIONS = [
  { label: '0.5×', multiplier: 0.5 },
  { label: '1×', multiplier: 1 },
  { label: '1.5×', multiplier: 1.5 },
  { label: '2×', multiplier: 2 },
  { label: '4×', multiplier: 4 },
]

/**
 * Everything you do to the view, in one panel in the bottom-left corner.
 *
 * Three rows, split by what each acts on: moving through the flow, how it is
 * drawn, and what leaves the app. Before this they were spread across a centred
 * playback bar, the sidebar header and a floating button in the far corner.
 *
 * Icons rather than words, because a row of five text buttons is wider than the
 * step card above it and reads as a toolbar from a different application. Every
 * one carries a tooltip and an `aria-label`: the icon is the shorthand, not the
 * only explanation.
 *
 * Each row is a set of groups rather than a run of buttons. Without the
 * grouping the view switch and the follow toggle sat shoulder to shoulder and
 * read as one four-button control.
 */
export function StepControls({
  engine,
  speed,
  onSpeedChange,
  cameraFollow,
  onCameraFollowChange,
  viewMode,
  onViewModeChange,
  theme,
  onThemeToggle,
  presenting,
  onTogglePresent,
  editMode = false,
  children,
}: {
  engine: StepEngine
  /** Owned by App, because the scene has to scale its animations by it too. */
  speed: number
  onSpeedChange: (speed: number) => void
  /** Whether steps are allowed to move the camera. */
  cameraFollow: boolean
  onCameraFollowChange: (follow: boolean) => void
  /** Isometric, or looking straight down. */
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  theme: Theme
  onThemeToggle: () => void
  /** Whether the app is in fullscreen, chrome-free playback. */
  presenting: boolean
  onTogglePresent: () => void
  /** Playback is off while editing: nothing should move under an open editor,
   *  and a step that re-applies mid-edit fights whatever you just typed. */
  editMode?: boolean
  /** The export control. Passed in rather than imported so this stays a panel
   *  and does not grow a second job. */
  children?: ReactNode
}) {
  const state = useStepEngine(engine)

  if (!state) return null

  const atStart = state.currentIndex === 0
  const atEnd   = state.currentIndex === state.totalSteps - 1

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <div className={styles.group}>
          <Tooltip label="Previous step  ←">
            <button
              className={styles.iconBtn}
              onClick={() => engine.prev()}
              disabled={atStart}
              aria-label="Previous step"
            >
              <StepBackIcon />
            </button>
          </Tooltip>
          <Tooltip
            label={editMode ? 'Paused while editing' : state.isPlaying ? 'Pause  space' : 'Play  space'}
          >
            <button
              className={`${styles.iconBtn} ${styles.play}`}
              onClick={() => engine.toggle()}
              disabled={editMode}
              aria-label={state.isPlaying ? 'Pause' : 'Play'}
            >
              {state.isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
          </Tooltip>
          <Tooltip label="Next step  →">
            <button
              className={styles.iconBtn}
              onClick={() => engine.next()}
              disabled={atEnd}
              aria-label="Next step"
            >
              <StepForwardIcon />
            </button>
          </Tooltip>
        </div>

        <span className={styles.counter}>
          <span className={styles.current}>{state.currentIndex + 1}</span>
          <span className={styles.total}>/ {state.totalSteps}</span>
        </span>
      </div>

      <div className={styles.divider} />

      <div className={styles.row}>
        {/* Two states, both shown: a single toggle button would leave you
            guessing which view you are actually looking at. */}
        <div className={styles.segmented} role="group" aria-label="Camera view">
          <Tooltip label="Isometric view">
            <button
              className={`${styles.segBtn}${viewMode === 'isometric' ? ` ${styles.segOn}` : ''}`}
              onClick={() => onViewModeChange('isometric')}
              aria-pressed={viewMode === 'isometric'}
              aria-label="Isometric view"
            >
              <IsometricIcon />
            </button>
          </Tooltip>
          <Tooltip label="Plan view — straight down">
            <button
              className={`${styles.segBtn}${viewMode === 'plan' ? ` ${styles.segOn}` : ''}`}
              onClick={() => onViewModeChange('plan')}
              aria-pressed={viewMode === 'plan'}
              aria-label="Plan view"
            >
              <PlanIcon />
            </button>
          </Tooltip>
        </div>

        <div className={styles.group}>
          {/* Steps that name a component pull the camera to it. Turning this
              off hands the view back, so you can look around while it plays. */}
          <Tooltip label={cameraFollow ? 'Steps move the camera' : 'Camera stays put'}>
            <button
              className={`${styles.iconBtn}${cameraFollow ? ` ${styles.on}` : ''}`}
              onClick={() => onCameraFollowChange(!cameraFollow)}
              aria-pressed={cameraFollow}
              aria-label="Camera follow"
            >
              <FollowIcon />
            </button>
          </Tooltip>
          <Tooltip label="Playback speed">
            <select
              className={styles.select}
              value={speed}
              onChange={(e) => onSpeedChange(Number(e.target.value))}
              aria-label="Playback speed"
            >
              {SPEED_OPTIONS.map((opt) => (
                <option key={opt.multiplier} value={opt.multiplier}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Tooltip>
        </div>

        <div className={styles.group}>
          <Tooltip label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            <button
              className={styles.iconBtn}
              onClick={onThemeToggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </Tooltip>
          <Tooltip label={presenting ? 'Leave full screen  Esc' : 'Full screen  F'}>
            <button
              className={styles.iconBtn}
              onClick={onTogglePresent}
              aria-pressed={presenting}
              aria-label={presenting ? 'Leave full screen' : 'Full screen'}
            >
              {presenting ? <ExitFullScreenIcon /> : <EnterFullScreenIcon />}
            </button>
          </Tooltip>
          {children}
        </div>
      </div>
    </div>
  )
}
