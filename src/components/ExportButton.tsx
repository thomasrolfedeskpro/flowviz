import { useState, useCallback, useEffect, useRef } from 'react'
import { exportAnimationGif } from '@/utils/gifExport'
import { exportAnimationWebm, pickVideoMimeType } from '@/utils/videoExport'
import { captureStillPng } from '@/utils/pngExport'
import { nextFrames } from '@/utils/exportDriver'
import { ExportIcon } from '@/components/ControlIcons'
import { Tooltip } from '@/components/Tooltip'
import { downloadBlob, exportStem } from '@/utils/download'
import type { FlowScene } from '@/scene/FlowScene'
import type { StepEngine } from '@/engine/stepEngine'
import styles from '@/styles/ExportButton.module.css'

interface ExportButtonProps {
  scene:  FlowScene | null
  engine: StepEngine | null
  /** Names the downloaded file after the flow it came from. */
  flowId: string
  /**
   * How long each step should hold while recording — the flow's own pace with
   * the viewer's speed applied, so a recording matches what is on screen
   * rather than some separate export tempo.
   */
  msPerStep: number
}

/** Decided once: whether this browser can record video at all. */
const videoMime = pickVideoMimeType()

const OVERLAY_CAVEAT = 'Captures the 3D diagram only — annotations, labels and the HUD are not included.'

export function ExportButton({ scene, engine, flowId, msPerStep }: ExportButtonProps) {
  const [progress, setProgress] = useState<string | null>(null)
  const [open, setOpen]         = useState(false)
  const [failed, setFailed]     = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const recording = progress !== null

  // Click-away and Esc, so the menu behaves like a menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  /**
   * Shared shell: closes the menu, reports progress, always clears state.
   *
   * It also composes for the whole canvas while the export runs. On screen the
   * diagram is deliberately pushed left so the sidebar doesn't cover it, but an
   * export captures the canvas edge to edge — including the strip the sidebar
   * was hiding — so that same shift reads as the diagram hugging the left with
   * dead space beside it. Dropping the inset centres what actually gets
   * captured, and it goes back afterwards however the export ends.
   */
  const run = useCallback(
    async (label: string, produce: () => Promise<Blob> | Blob, filename: string) => {
      if (!scene || !engine || recording) return
      setOpen(false)
      setFailed(null)
      setProgress(label)
      engine.pause()
      const inset = scene.viewportInset
      try {
        scene.setViewportInset(0)
        await nextFrames()
        downloadBlob(await produce(), filename)
      } catch (err) {
        console.error(`${label} failed:`, err)
        setFailed(err instanceof Error ? err.message : 'Export failed')
      } finally {
        scene.setViewportInset(inset)
        setProgress(null)
      }
    },
    [scene, engine, recording],
  )

  const stem = exportStem(flowId)

  const handlePng = useCallback(() => {
    if (!scene || !engine) return
    // Named by the step it shows, because the reason to grab a still is almost
    // always to point at one particular moment.
    const n = engine.getState().currentIndex + 1
    void run('Capturing…', () => captureStillPng(scene), `${stem}-step-${n}.png`)
  }, [run, scene, engine, stem])

  const handleGif = useCallback(() => {
    if (!scene || !engine) return
    void run(
      'Recording…',
      () => exportAnimationGif(scene, engine, msPerStep, (s, t) => setProgress(`Frame ${s} / ${t}`)),
      `${stem}.gif`,
    )
  }, [run, scene, engine, stem, msPerStep])

  const handleWebm = useCallback(() => {
    if (!scene || !engine) return
    void run(
      'Recording…',
      () => exportAnimationWebm(scene.canvas, engine, msPerStep, (s, t) => setProgress(`Step ${s} / ${t}`)),
      `${stem}.webm`,
    )
  }, [run, scene, engine, stem, msPerStep])

  const ready = Boolean(scene && engine)

  return (
    <div className={styles.root} ref={rootRef}>
      {failed && !recording && (
        <div className={styles.error} role="alert">{failed}</div>
      )}

      {/* The button is an icon now, so progress needs somewhere else to live —
          a long capture with no visible sign of life reads as a hang. */}
      {recording && (
        <div className={styles.progress} role="status">
          <span className={styles.dot} />
          {progress}
        </div>
      )}

      {open && !recording && (
        <div className={styles.menu} role="menu">
          <button role="menuitem" onClick={handlePng}>
            <span className={styles.itemLabel}>PNG</span>
            <span className={styles.itemHint}>this step</span>
          </button>
          <button
            role="menuitem"
            onClick={handleWebm}
            disabled={!videoMime}
            title={videoMime ? 'Records the animation as it plays' : 'This browser cannot record WebM'}
          >
            <span className={styles.itemLabel}>WebM</span>
            <span className={styles.itemHint}>animated play-through</span>
          </button>
          <button role="menuitem" onClick={handleGif} title="One frame per step">
            <span className={styles.itemLabel}>GIF</span>
            <span className={styles.itemHint}>one frame per step</span>
          </button>
          <p className={styles.caveat}>{OVERLAY_CAVEAT}</p>
        </div>
      )}

      {/* The tooltip wraps only the button: it establishes a containing block,
          and the menu above has to position against the panel, not against this. */}
      <Tooltip label={recording ? 'Recording…' : 'Export image or video'}>
        <button
          className={`${styles.btn} ${recording ? styles.recording : ''}`}
          onClick={() => { setFailed(null); setOpen((v) => !v) }}
          disabled={recording || !ready}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Export"
        >
          {recording ? <span className={styles.dot} /> : <ExportIcon />}
        </button>
      </Tooltip>
    </div>
  )
}
