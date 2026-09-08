import { useState } from 'react'
import styles from '@/styles/EditModal.module.css'

/**
 * The escape hatch: edit the raw JSON of one object, or of the whole flow.
 *
 * Every form above this one is a convenience. This is what makes the editor
 * complete — a packet's `data` payload, and whatever the schema grows next,
 * are all reachable here without waiting for a widget.
 *
 * Nothing is applied until it parses *and* the resulting flow validates, so the
 * hatch can't be used to write a file the app then refuses to load.
 */
export function JsonEditor({
  value,
  onApply,
  onCancel,
  hint,
}: {
  value: unknown
  /** Returns null on success, or the reasons it was refused. */
  onApply: (parsed: unknown) => string[] | null
  onCancel: () => void
  hint?: string
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [errors, setErrors] = useState<string[]>([])

  const apply = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      // The browser's message names the offending position, which is the only
      // useful thing to say about a syntax error.
      setErrors([String(err)])
      return
    }
    setErrors(onApply(parsed) ?? [])
  }

  return (
    <>
      <div className={styles.body}>
        {hint && <p className={styles.hint}>{hint}</p>}
        <textarea
          className={styles.code}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="JSON"
        />
        {errors.length > 0 && (
          <ul className={styles.cascadeList}>
            {errors.map((e, i) => <li key={i} className={styles.error}>{e}</li>)}
          </ul>
        )}
      </div>
      <footer className={styles.footer}>
        <span className={styles.footerSpacer} />
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={apply}>
          Apply
        </button>
      </footer>
    </>
  )
}
