import { useStepEngine } from '@/hooks/useStepEngine'
import { inlineMarkdown } from '@/utils/inlineMarkdown'
import type { StepEngine } from '@/engine/stepEngine'
import styles from '@/styles/StepHUD.module.css'

export function StepHUD({
  engine,
  scenePath = [],
}: {
  engine: StepEngine
  /** Labels from the top level down to the scene on screen; empty at top level. */
  scenePath?: string[]
}) {
  const state = useStepEngine(engine)
  if (!state) return null

  const footer = state.step.footer ?? []

  return (
    <div className={styles.hud} data-export-panel key={state.currentIndex}>
      {scenePath.length > 0 && (
        <p className={styles.breadcrumb}>
          {scenePath.map((label, i) => (
            <span key={i}>
              {i > 0 && <span className={styles.crumbSep}>▸</span>}
              {label}
            </span>
          ))}
        </p>
      )}
      <h2 className={styles.title}>{state.step.title}</h2>
      {state.step.description && (
        <p className={styles.description}>{state.step.description}</p>
      )}

      {footer.length > 0 && (
        <div className={styles.footer}>
          {footer.map((note, i) => (
            <p
              key={i}
              className={`${styles.note} ${styles[note.style ?? 'info']}`}
            >
              {inlineMarkdown(note.text, styles.code)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
