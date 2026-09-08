/**
 * A still of whatever is on screen right now.
 *
 * The one export that needs no playthrough: no stepping, no waiting, no
 * encoder. It is also the one people reach for most, because a PNG is what
 * pastes into a ticket or a doc.
 */

export interface StillTarget {
  captureFrame(): string
}

/** Data URL → Blob, so the download path is the same as the other formats'. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',')
  const mime  = /:(.*?);/.exec(header)?.[1] ?? 'image/png'
  const bytes = atob(encoded)
  const buf   = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

export function captureStillPng(target: StillTarget): Blob {
  return dataUrlToBlob(target.captureFrame())
}
