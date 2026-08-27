import { useEffect, useState } from 'react'
import { useStepEngine } from '@/hooks/useStepEngine'
import { DEFAULT_PLAY_INTERVAL_MS } from '@/engine/stepEngine'
import type { StepEngine } from '@/engine/stepEngine'
import styles from '@/styles/StepControls.module.css'

const SPEED_OPTIONS = [
  { label: '0.5×', multiplier: 0.5 },
  { label: '1×', multiplier: 1 },
  { label: '1.5×', multiplier: 1.5 },
  { label: '2×', multiplier: 2 },
  { label: '4×', multiplier: 4 },
]

export function StepControls({ engine }: { engine: StepEngine }) {
  const state = useStepEngine(engine)
  const [speed, setSpeed] = useState(1)

  // Keep the engine's playback interval in sync with the chosen speed.
  useEffect(() => {
    engine.setPlayInterval(DEFAULT_PLAY_INTERVAL_MS / speed)
  }, [engine, speed])

  if (!state) return null

  return (
    <div className={styles.controls}>
      <button onClick={() => engine.prev()} disabled={state.currentIndex === 0}>
        ← Back
      </button>
      <button onClick={() => engine.toggle()}>
        {state.isPlaying ? 'Pause' : 'Play'}
      </button>
      <button onClick={() => engine.next()} disabled={state.currentIndex === state.totalSteps - 1}>
        Forward →
      </button>
      <span className={styles.counter}>
        {state.currentIndex + 1} / {state.totalSteps}
      </span>
      <select
        className={styles.speedSelect}
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
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
