import type { Step } from '@/types/schema'
import { DEFAULT_TIMING } from '@/engine/timing'

type StepEngineListener = (state: StepState) => void

export interface StepState {
  currentIndex: number
  totalSteps: number
  isPlaying: boolean
  step: Step
}

/** Re-exported so callers that only want the step interval need one import. */
export const DEFAULT_PLAY_INTERVAL_MS = DEFAULT_TIMING.step

export class StepEngine {
  private steps:          Step[]
  private playIntervalMs: number
  private index:          number = 0
  private playing:        boolean = false
  private timer:          ReturnType<typeof setTimeout> | null = null
  private listeners:      Set<StepEngineListener> = new Set()

  constructor(steps: Step[], playIntervalMs: number = DEFAULT_PLAY_INTERVAL_MS) {
    this.steps          = steps
    this.playIntervalMs = playIntervalMs
  }

  subscribe(fn: StepEngineListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSteps(): Step[] {
    return this.steps
  }

  /**
   * Swap in an edited step list without losing your place.
   *
   * The index is clamped rather than reset: deleting the last step, or the one
   * you were on, should leave you somewhere sensible instead of back at the
   * start of the flow.
   */
  setSteps(steps: Step[]): void {
    if (steps.length === 0) return
    this.steps = steps
    this.index = Math.max(0, Math.min(this.index, steps.length - 1))
    this.notify()
  }

  getState(): StepState {
    return {
      currentIndex: this.index,
      totalSteps: this.steps.length,
      isPlaying: this.playing,
      step: this.steps[this.index],
    }
  }

  private notify(): void {
    const state = this.getState()
    for (const fn of this.listeners) fn(state)
  }

  next(): void {
    if (this.index < this.steps.length - 1) {
      this.index++
      this.notify()
    }
    if (this.playing) {
      if (this.index === this.steps.length - 1) {
        this.playing = false
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.notify()
      } else {
        this.scheduleNext()
      }
    }
  }

  prev(): void {
    this.index = Math.max(0, this.index - 1)
    this.notify()
  }

  goTo(index: number): void {
    this.index = Math.max(0, Math.min(this.steps.length - 1, index))
    this.notify()
  }

  play(): void {
    if (this.index === this.steps.length - 1) this.index = 0
    this.playing = true
    this.notify()
    this.scheduleNext()
  }

  pause(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.playing = false
    this.notify()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.next(), this.playIntervalMs)
  }

  setPlayInterval(ms: number): void {
    this.playIntervalMs = ms
    // Apply the new speed immediately rather than waiting for the
    // in-flight timer (scheduled at the old speed) to fire.
    if (this.playing) this.scheduleNext()
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
