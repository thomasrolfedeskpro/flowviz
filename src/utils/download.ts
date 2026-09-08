/** Handing a finished export to the browser. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
  } finally {
    // Revoking in the same tick as the click is enough for a same-document
    // anchor, but a frame's grace costs nothing and Safari has been unhappy
    // about the tight version before now.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** A filename stem safe on every platform: lowercase, no separators. */
export function exportStem(flowId: string): string {
  const slug = flowId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'flowviz'
}
