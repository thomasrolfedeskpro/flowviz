/**
 * A still of whatever is on screen right now.
 *
 * The one export that needs no playthrough: no stepping, no waiting, no
 * encoder. It is also the one people reach for most, because a PNG is what
 * pastes into a ticket or a doc.
 *
 * Two of them, in fact, and both draw the page over the WebGL frame — the
 * diagram's labels and annotations are HTML, so a capture of the canvas alone
 * would be missing half of what the author wrote. They differ only in what is
 * left out: the full-view still is the screen as it stands, and the
 * without-panels still drops the step list and the description box.
 */

import { rasterizeViewport } from '@/utils/domRaster'

export interface FullViewTarget {
  captureFrame(): string
  /** Where the 3D view sits on screen, so the page layer lands over it. */
  canvas: HTMLCanvasElement
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the captured frame'))
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG'))), 'image/png')
  })
}

/**
 * The whole screen: the WebGL frame with the page drawn over it.
 *
 * The two layers meet at the canvas's own rectangle rather than at the
 * viewport's, so the page lands exactly where it sits on screen even if the
 * canvas does not fill the window. Everything is measured in device pixels, so
 * the export comes out at the resolution the diagram was rendered at.
 */
export async function captureFullViewPng(
  target: FullViewTarget,
  /** Elements to leave out — the panels, when the diagram is what matters. */
  omit: Iterable<Element> = [],
): Promise<Blob> {
  const frame = await loadImage(target.captureFrame())
  const rect  = target.canvas.getBoundingClientRect()
  const scale = frame.width / rect.width

  const out = document.createElement('canvas')
  out.width  = Math.round(window.innerWidth  * scale)
  out.height = Math.round(window.innerHeight * scale)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('No 2D context for the export canvas')

  // The page layer clears the backgrounds that would cover the diagram, which
  // leaves any margin around the canvas transparent unless it is painted here.
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || '#000'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(frame, rect.left * scale, rect.top * scale, rect.width * scale, rect.height * scale)
  ctx.drawImage(
    await rasterizeViewport(target.canvas, out.width, out.height, omit),
    0, 0, out.width, out.height,
  )

  return canvasToBlob(out)
}
