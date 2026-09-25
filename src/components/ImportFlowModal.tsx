import { useEffect, useRef, useState } from 'react'
import { parseFlowSchema } from '@/engine/flowSchema'
import { exportStem } from '@/utils/download'
import type { FlowSummary } from '@/components/StepSidebar'
import type { FlowDefinition } from '@/types/schema'
import styles from '@/styles/EditModal.module.css'

/**
 * Taking in a flow someone else made.
 *
 * The other half of the JSON download: a flow arrives as a file or as pasted
 * text, and lands in `public/flows/custom/` under a name you choose. Validated
 * here before it is sent, so a malformed paste is rejected against the same
 * schema the renderer uses rather than by a server round trip.
 */

interface Props {
  /** Flow ids already taken, so a clash is caught before the request. */
  taken: Set<string>
  onImported: (flow: FlowSummary) => void
  onClose: () => void
}

/** What the schema found, as lines a person can act on. */
function problemsOf(text: string): { def?: FlowDefinition; errors: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { errors: [`Not valid JSON — ${err instanceof Error ? err.message : String(err)}`] }
  }
  const result = parseFlowSchema(parsed)
  return result.success ? { def: result.data, errors: [] } : { errors: result.errors }
}

export function ImportFlowModal({ taken, onImported, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  const [text, setText]   = useState('')
  const [name, setName]   = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy]   = useState(false)

  const slug   = exportStem(name)
  const clash  = slug.length > 0 && taken.has(slug)
  const { def, errors } = text.trim() ? problemsOf(text) : { def: undefined, errors: [] }
  const ready  = Boolean(def) && slug.length > 0 && !clash && !busy

  /** A file and a paste are the same thing once read; the file just fills the box. */
  const readFile = async (file: File) => {
    const body = await file.text()
    setText(body)
    setError(null)
    if (!name) {
      const title = problemsOf(body).def?.meta.title
      setName(title || file.name.replace(/\.json$/i, ''))
    }
  }

  const submit = async () => {
    if (!def || !ready) return
    setBusy(true)
    setError(null)
    // The name is the flow's title as well as its filename — a list showing one
    // thing and a file called another is a puzzle nobody needs.
    const body: FlowDefinition = { ...def, meta: { ...def.meta, title: name.trim() } }
    try {
      const res = await fetch(`/api/flows/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body, null, 2),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] }
        throw new Error(payload.errors?.join('\n') ?? payload.error ?? `Import failed (${res.status})`)
      }
      // Always custom/: an import is never a bundled example, so the list
      // shows it below the rule and offers it for deletion.
      onImported({
        id: slug,
        title: body.meta.title,
        description: body.meta.description ?? '',
        group: 'custom',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className={`${styles.dialog} ${styles.wide}`} onClose={onClose} onCancel={onClose}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Import a flow</h2>
          <p className={styles.subtitle}>lands in public/flows/custom/</p>
        </div>
        <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="import-name">Name</label>
          <input
            id="import-name"
            className={styles.input}
            value={name}
            placeholder="Ticket write path"
            onChange={(e) => setName(e.target.value)}
          />
          <p className={styles.hint}>
            {slug
              ? clash
                ? `A flow called "${slug}" already exists — pick another name.`
                : `Saved as custom/${slug}.json, and used as the flow's title.`
              : 'Names the file and titles the flow.'}
          </p>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Flow JSON</span>
          <div className={styles.inline}>
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Choose a flow file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </div>
          <textarea
            className={styles.code}
            aria-label="Flow JSON"
            placeholder="…or paste the JSON here"
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null) }}
          />
          {text.trim() && errors.length > 0 && (
            <>
              {errors.slice(0, 8).map((e) => <p key={e} className={styles.error}>{e}</p>)}
              {errors.length > 8 && (
                <p className={styles.hint}>…and {errors.length - 8} more.</p>
              )}
            </>
          )}
          {def && <p className={styles.hint}>
            Valid — {def.components.length} components, {def.steps.length} steps.
          </p>}
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          disabled={!ready}
          onClick={() => void submit()}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </footer>
    </dialog>
  )
}
