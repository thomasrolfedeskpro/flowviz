import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StepEngine } from '@/engine/stepEngine'
import type { Step } from '@/types/schema'

function makeStep(id: number, name?: string): Step {
  return { id, title: `Step ${id}`, name, highlight: [], active_connections: [] }
}

const THREE_STEPS = [makeStep(0), makeStep(1), makeStep(2)]

describe('StepEngine', () => {
  let engine: StepEngine

  beforeEach(() => {
    vi.useFakeTimers()
    engine = new StepEngine([...THREE_STEPS], 1000)
  })

  afterEach(() => {
    engine.destroy()
    vi.useRealTimers()
  })

  // ── initial state ──────────────────────────────────────────────────

  it('starts at index 0', () => {
    const s = engine.getState()
    expect(s.currentIndex).toBe(0)
    expect(s.totalSteps).toBe(3)
    expect(s.isPlaying).toBe(false)
    expect(s.step).toEqual(THREE_STEPS[0])
  })

  // ── getSteps() ─────────────────────────────────────────────────────

  it('getSteps() returns the full step array', () => {
    expect(engine.getSteps()).toEqual(THREE_STEPS)
  })

  // ── next() ─────────────────────────────────────────────────────────

  it('next() advances by one', () => {
    engine.next()
    expect(engine.getState().currentIndex).toBe(1)
  })

  it('next() does not advance past the last step', () => {
    engine.goTo(2)
    engine.next()
    expect(engine.getState().currentIndex).toBe(2)
  })

  // ── prev() ─────────────────────────────────────────────────────────

  it('prev() retreats by one', () => {
    engine.goTo(2)
    engine.prev()
    expect(engine.getState().currentIndex).toBe(1)
  })

  it('prev() does not go below index 0', () => {
    engine.prev()
    expect(engine.getState().currentIndex).toBe(0)
  })

  // ── goTo() ─────────────────────────────────────────────────────────

  it('goTo() jumps to the requested index', () => {
    engine.goTo(2)
    expect(engine.getState().currentIndex).toBe(2)
    expect(engine.getState().step).toEqual(THREE_STEPS[2])
  })

  it('goTo() clamps negative index to 0', () => {
    engine.goTo(-99)
    expect(engine.getState().currentIndex).toBe(0)
  })

  it('goTo() clamps out-of-range index to last step', () => {
    engine.goTo(999)
    expect(engine.getState().currentIndex).toBe(2)
  })

  // ── subscribe() ────────────────────────────────────────────────────

  it('subscribe() fires listener on every state change', () => {
    const listener = vi.fn()
    engine.subscribe(listener)
    engine.next()
    engine.next()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('subscribe() passes the new state to the listener', () => {
    const listener = vi.fn()
    engine.subscribe(listener)
    engine.next()
    expect(listener.mock.calls[0][0].currentIndex).toBe(1)
  })

  it('subscribe() returns an unsubscribe function that stops notifications', () => {
    const listener = vi.fn()
    const unsub = engine.subscribe(listener)
    unsub()
    engine.next()
    expect(listener).not.toHaveBeenCalled()
  })

  it('multiple subscribers all receive notifications', () => {
    const a = vi.fn()
    const b = vi.fn()
    engine.subscribe(a)
    engine.subscribe(b)
    engine.next()
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  // ── play() / pause() ───────────────────────────────────────────────

  it('play() sets isPlaying to true', () => {
    engine.play()
    expect(engine.getState().isPlaying).toBe(true)
  })

  it('pause() sets isPlaying to false', () => {
    engine.play()
    engine.pause()
    expect(engine.getState().isPlaying).toBe(false)
  })

  it('play() at the last step resets to step 0 first', () => {
    engine.goTo(2)
    engine.play()
    expect(engine.getState().currentIndex).toBe(0)
  })

  it('play() advances steps automatically after the interval', () => {
    engine.play()
    expect(engine.getState().currentIndex).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(engine.getState().currentIndex).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(engine.getState().currentIndex).toBe(2)
  })

  it('play() stops automatically at the last step', () => {
    engine.play()
    vi.advanceTimersByTime(3000)
    expect(engine.getState().currentIndex).toBe(2)
    expect(engine.getState().isPlaying).toBe(false)
  })

  // ── toggle() ───────────────────────────────────────────────────────

  it('toggle() starts playback when paused', () => {
    engine.toggle()
    expect(engine.getState().isPlaying).toBe(true)
  })

  it('toggle() pauses when playing', () => {
    engine.play()
    engine.toggle()
    expect(engine.getState().isPlaying).toBe(false)
  })

  // ── setPlayInterval() ──────────────────────────────────────────────

  it('setPlayInterval() changes the auto-advance timing', () => {
    engine.setPlayInterval(500)
    engine.play()
    vi.advanceTimersByTime(500)
    expect(engine.getState().currentIndex).toBe(1)
  })

  // ── name field ─────────────────────────────────────────────────────

  it('step.name is preserved when set', () => {
    const eng = new StepEngine([makeStep(0, 'Overview'), makeStep(1, 'Send data')])
    expect(eng.getSteps()[0].name).toBe('Overview')
    expect(eng.getSteps()[1].name).toBe('Send data')
    eng.destroy()
  })

  it('step.name is undefined when not set', () => {
    expect(engine.getSteps()[0].name).toBeUndefined()
  })
})

describe('setSteps', () => {
  const steps = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i, title: `Step ${i}`, highlight: [], active_connections: [],
    }))

  it('keeps your place when the list is edited', () => {
    const engine = new StepEngine(steps(5))
    engine.goTo(3)
    engine.setSteps(steps(5))
    expect(engine.getState().currentIndex).toBe(3)
  })

  it('clamps rather than resetting when steps are deleted', () => {
    const engine = new StepEngine(steps(5))
    engine.goTo(4)
    engine.setSteps(steps(2))
    expect(engine.getState().currentIndex).toBe(1)
    expect(engine.getState().totalSteps).toBe(2)
  })

  it('tells subscribers, so the scene re-applies the edited step', () => {
    const engine = new StepEngine(steps(3))
    let seen = 0
    engine.subscribe(() => { seen++ })
    engine.setSteps(steps(3))
    expect(seen).toBe(1)
  })

  it('ignores an empty list — there would be no step to show', () => {
    const engine = new StepEngine(steps(3))
    engine.setSteps([])
    expect(engine.getState().totalSteps).toBe(3)
  })
})
