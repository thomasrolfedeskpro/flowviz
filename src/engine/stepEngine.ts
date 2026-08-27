import type { Step } from '@/types/schema'

type StepEngineListener = (state: StepState) => void

export interface StepState {
  currentIndex: number
  totalSteps: number
  isPlaying: boolean
  step: Step
}

export const DEFAULT_PLAY_INTERVAL_MS = 3000

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
