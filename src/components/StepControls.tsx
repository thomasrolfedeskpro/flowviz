import { useStepEngine } from '@/hooks/useStepEngine'
import type { StepEngine } from '@/engine/stepEngine'
import type { ViewMode } from '@/scene/viewMode'
import styles from '@/styles/StepControls.module.css'

const SPEED_OPTIONS = [
  { label: '0.5×', multiplier: 0.5 },
  { label: '1×', multiplier: 1 },
  { label: '1.5×', multiplier: 1.5 },
  { label: '2×', multiplier: 2 },
  { label: '4×', multiplier: 4 },
]

export function StepControls({
  engine,
  speed,
  onSpeedChange,
  cameraFollow,
  onCameraFollowChange,
  viewMode,
  onViewModeChange,
  editMode = false,
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
  /** Playback is off while editing: nothing should move under an open editor,
   *  and a step that re-applies mid-edit fights whatever you just typed. */
  editMode?: boolean
}) {
  const state = useStepEngine(engine)

  if (!state) return null

  return (
    <div className={styles.controls}>
      <button onClick={() => engine.prev()} disabled={state.currentIndex === 0}>
        ← Back
      </button>
      <button
        onClick={() => engine.toggle()}
        disabled={editMode}
        title={editMode ? 'Playback is paused while editing' : undefined}
      >
        {state.isPlaying ? 'Pause' : 'Play'}
      </button>
      <button onClick={() => engine.next()} disabled={state.currentIndex === state.totalSteps - 1}>
        Forward →
      </button>
      <span className={styles.counter}>
        {state.currentIndex + 1} / {state.totalSteps}
      </span>
      {/* Steps that name a component pull the camera to it. Turning this off
          hands the view back, so you can look around while it plays. */}
      <label className={styles.follow} title="Let steps move the camera">
        <input
          type="checkbox"
          checked={cameraFollow}
          onChange={(e) => onCameraFollowChange(e.target.checked)}
        />
        Follow
      </label>
      {/* Named rather than a toggle button: a button showing the other view is
          ambiguous about which one you are looking at. */}
      <select
        className={styles.speedSelect}
        value={viewMode}
        onChange={(e) => onViewModeChange(e.target.value as ViewMode)}
        aria-label="Camera view"
        title="Camera view"
      >
        <option value="isometric">Isometric</option>
        <option value="plan">Plan</option>
      </select>
      <select
        className={styles.speedSelect}
        value={speed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
        aria-label="Playback speed"
        title="Playback speed"
      >
        {SPEED_OPTIONS.map((opt) => (
          <option key={opt.multiplier} value={opt.multiplier}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
