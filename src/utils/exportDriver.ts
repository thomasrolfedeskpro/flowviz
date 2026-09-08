/**
 * Walking a flow from step 0 to the end, in real time, so something can record
 * it.
 *
 * Every export format needs the same walk and differs only in what it does with
 * the frames: the GIF encoder wants one still per step, the video recorder wants
 * the canvas streamed while the walk happens and no per-step callback at all.
 * Keeping the walk here means the two can't drift on how long a step holds or
 * where a capture lands within it.
 *
 * The walk restores the step you were on when it finishes. An export is a thing
 * you do *while* reading a flow, not a thing that should move your place in it.
 */

export interface PlaythroughEngine {
  goTo(index: number): void
  pause(): void
  getState(): { totalSteps: number; currentIndex: number }
}

export interface PlaythroughOptions {
  /** How long each step holds. Real time — the recorder is watching. */
  msPerStep: number
  onProgress?: (step: number, total: number) => void
  /**
   * Run once per step, after it has held for `msPerStep` and everything has
   * settled. Frame-per-step encoders capture here; a continuous recorder
   * leaves it unset.
   */
  onSettled?: (index: number) => void | Promise<void>
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Let `n` frames render. Used after changing how the scene is composed, so a
 *  capture reads the new framing rather than the last one drawn. */
export function nextFrames(n = 2): Promise<void> {
  return new Promise((resolve) => {
    let left = n
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
    requestAnimationFrame(tick)
  })
}

export async function walkPlaythrough(
  engine: PlaythroughEngine,
  { msPerStep, onProgress, onSettled }: PlaythroughOptions,
): Promise<void> {
  const { totalSteps, currentIndex: startedOn } = engine.getState()

  // Autoplay would fight the walk for the step index.
  engine.pause()

  try {
    for (let i = 0; i < totalSteps; i++) {
      engine.goTo(i)
      onProgress?.(i + 1, totalSteps)
      await wait(msPerStep)
      await onSettled?.(i)
    }
  } finally {
    engine.goTo(startedOn)
  }
}
