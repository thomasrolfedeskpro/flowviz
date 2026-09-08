/**
 * WebM recording of a play-through.
 *
 * The difference from the GIF path is the thing worth having: GIF encodes one
 * still per step, so a packet is only ever caught where it landed. This records
 * the live canvas through `MediaRecorder`, so packets actually travel, pipes
 * illuminate, and the camera moves — what the flow looks like, rather than a
 * slideshow of its resting states.
 *
 * Only the WebGL canvas is captured. Annotations, pipe and zone labels and the
 * HUD are DOM overlays sitting above it and do not appear in the recording.
 */

import { walkPlaythrough } from '@/utils/exportDriver'
import type { PlaythroughEngine } from '@/utils/exportDriver'

const FPS = 30

/** Preference order: vp9 is markedly smaller at the same quality. */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

/** The best WebM codec this browser will record, or null if it records none. */
export function pickVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

/** Long enough for the first and last steps to be seen rather than clipped. */
const LEAD_MS  = 400
const TAIL_MS  = 700

export async function exportAnimationWebm(
  canvas:     HTMLCanvasElement,
  engine:     PlaythroughEngine,
  msPerStep:  number,
  onProgress: (step: number, total: number) => void = () => {},
): Promise<Blob> {
  const mimeType = pickVideoMimeType()
  if (!mimeType) throw new Error('This browser cannot record WebM video.')

  const stream   = canvas.captureStream(FPS)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

  // Resolves on stop, or rejects if the recorder itself fails — without this the
  // returned blob could be assembled from a half-written stream.
  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop  = () => resolve()
    recorder.onerror = () => reject(new Error('Recording failed.'))
  })

  // A timeslice keeps chunks arriving during the walk instead of one large
  // blob at the end, which is easier on memory for a long flow.
  recorder.start(1000)

  try {
    await new Promise<void>((r) => setTimeout(r, LEAD_MS))
    await walkPlaythrough(engine, { msPerStep, onProgress })
    await new Promise<void>((r) => setTimeout(r, TAIL_MS))
  } finally {
    if (recorder.state !== 'inactive') recorder.stop()
    for (const track of stream.getTracks()) track.stop()
  }

  await finished
  return new Blob(chunks, { type: mimeType })
}
