import { useState, useCallback, useEffect, useRef } from 'react'
import { exportAnimationGif } from '@/utils/gifExport'
import { exportAnimationWebm, pickVideoMimeType } from '@/utils/videoExport'
import { captureFullViewPng } from '@/utils/pngExport'
import { flowJsonBlob } from '@/utils/jsonExport'
import { nextFrames } from '@/utils/exportDriver'
import { ExportIcon } from '@/components/ControlIcons'
import { Tooltip } from '@/components/Tooltip'
import { downloadBlob, exportStem } from '@/utils/download'
import type { FlowScene } from '@/scene/FlowScene'
import type { StepEngine } from '@/engine/stepEngine'
import type { FlowDefinition } from '@/types/schema'
import styles from '@/styles/ExportButton.module.css'

interface ExportButtonProps {
  scene:  FlowScene | null
  engine: StepEngine | null
  /** Names the downloaded file after the flow it came from. */
  flowId: string
  /**
   * The definition as it stands in memory, so a JSON download carries unsaved
   * edit-mode changes rather than whatever is still on disk.
   */
  def: FlowDefinition | null
  /**
   * How long each step should hold while recording — the flow's own pace with
   * the viewer's speed applied, so a recording matches what is on screen
   * rather than some separate export tempo.
   */
  msPerStep: number
}

/** Decided once: whether this browser can record video at all. */
const videoMime = pickVideoMimeType()

/** The step list and the description box: what "without panels" leaves out.
 *  Marked in their own components, because CSS-module names are hashed. */
const PANEL_SELECTOR = '[data-export-panel]'

const OVERLAY_CAVEAT = 'Panels means the step list and the description box. Both PNGs keep the diagram\u2019s own labels and annotations; WebM and GIF cannot.'

export function ExportButton({ scene, engine, flowId, def, msPerStep }: ExportButtonProps) {
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
   *
   * A full-view capture is the exception on both counts. It is meant to look
   * like the screen, so it keeps the screen's framing, and it finishes fast
   * enough that a progress pill would only photograph itself — hence the
   * nameless variant, which shows nothing while it runs.
   */
  const run = useCallback(
    async (
      label: string | null,
      produce: () => Promise<Blob> | Blob,
      filename: string,
      asOnScreen = false,
    ) => {
      if (!scene || !engine || recording) return
      setOpen(false)
      setFailed(null)
      setProgress(label)
      engine.pause()
      const inset = scene.viewportInset
      try {
        if (!asOnScreen) scene.setViewportInset(0)
        await nextFrames()
        downloadBlob(await produce(), filename)
      } catch (err) {
        console.error(`${label ?? 'Export'} failed:`, err)
        setFailed(err instanceof Error ? err.message : 'Export failed')
      } finally {
        if (!asOnScreen) scene.setViewportInset(inset)
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
    // Not `asOnScreen`: with the step list gone from the capture there is no
    // sidebar for the diagram to dodge, so it composes for the whole frame.
    void run(
      null,
      () => captureFullViewPng(scene, document.querySelectorAll(PANEL_SELECTOR)),
      `${stem}-step-${n}.png`,
    )
  }, [run, scene, engine, stem])

  const handleFullPng = useCallback(() => {
    if (!scene || !engine) return
    const n = engine.getState().currentIndex + 1
    void run(null, () => captureFullViewPng(scene), `${stem}-step-${n}-full.png`, true)
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

  // No scene work and no failure mode worth a banner: the definition is already
  // in hand, so this skips the shared shell entirely.
  const handleJson = useCallback(() => {
    if (!def) return
    setOpen(false)
    downloadBlob(flowJsonBlob(def), `${stem}.json`)
  }, [def, stem])

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
          {/* One export in two forms, so they share a row: as separate entries
              they read as unrelated formats sitting next to WebM and GIF. */}
          <div className={styles.row}>
            <span className={styles.itemLabel}>PNG</span>
            <div className={styles.choices} role="group" aria-label="PNG export">
              <button
                role="menuitem"
                className={styles.choice}
                onClick={handlePng}
                title="The 3D diagram on its own"
              >
                Without panels
              </button>
              <button
                role="menuitem"
                className={styles.choice}
                onClick={handleFullPng}
                title="The screen as you see it"
              >
                With panels
              </button>
            </div>
          </div>
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
          <button
            role="menuitem"
            onClick={handleJson}
            disabled={!def}
            title="The flow definition, including unsaved edits"
          >
            <span className={styles.itemLabel}>JSON</span>
            <span className={styles.itemHint}>flow definition</span>
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
