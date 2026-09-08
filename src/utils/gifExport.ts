/**
 * Animated GIF of a play-through: one still per step.
 *
 * A GIF frame is captured after its step has settled, so packets appear where
 * they arrived rather than mid-flight — a slideshow of resting states. That is
 * the format's limit, not a bug; `videoExport.ts` records the motion. GIF stays
 * because it pastes inline in places WebM still does not.
 *
 * Only the WebGL canvas is captured — DOM overlays are not in the frames.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { walkPlaythrough } from '@/utils/exportDriver'
import type { PlaythroughEngine } from '@/utils/exportDriver'

const MAX_GIF_WIDTH = 960

interface ExportTarget {
  captureFrame(): string
}

function scaleCanvas(
  source: HTMLCanvasElement,
  maxWidth: number,
): HTMLCanvasElement {
  const ratio = Math.min(1, maxWidth / source.width)
  const w = Math.round(source.width  * ratio)
  const h = Math.round(source.height * ratio)
  const out = document.createElement('canvas')
  out.width  = w
  out.height = h
  out.getContext('2d')!.drawImage(source, 0, 0, w, h)
  return out
}

async function dataURLToCanvas(dataURL: string): Promise<HTMLCanvasElement> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload  = () => resolve()
    img.onerror = reject
    img.src = dataURL
  })
  const c   = document.createElement('canvas')
  c.width   = img.naturalWidth
  c.height  = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c
}

export async function exportAnimationGif(
  scene:      ExportTarget,
  engine:     PlaythroughEngine,
  msPerStep:  number = 3000,
  onProgress: (step: number, total: number) => void = () => {},
): Promise<Blob> {
  const gif = GIFEncoder()

  await walkPlaythrough(engine, {
    msPerStep,
    onProgress,
    onSettled: async () => {
      const raw    = await dataURLToCanvas(scene.captureFrame())
      const scaled = scaleCanvas(raw, MAX_GIF_WIDTH)

      const ctx       = scaled.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height)

      const palette = quantize(imageData.data, 256)
      const indices = applyPalette(imageData.data, palette)
      gif.writeFrame(indices, scaled.width, scaled.height, { palette, delay: msPerStep })
    },
  })

  gif.finish()
  return new Blob([gif.bytes().buffer as ArrayBuffer], { type: 'image/gif' })
}
