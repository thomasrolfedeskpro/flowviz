import type { ReactNode } from 'react'
import styles from '@/styles/Tooltip.module.css'

/**
 * A tooltip for an icon control.
 *
 * The browser's own `title` is slow to appear, unstyled, cannot be themed, and
 * on a dark panel arrives as a pale system rectangle that belongs to a
 * different application. An icon-only toolbar leans on its tooltips too heavily
 * for that.
 *
 * Hover and keyboard focus both show it, and it is `aria-hidden` because the
 * control it wraps already carries an `aria-label` — announcing both would read
 * the same thing twice.
 *
 * Establishes a containing block, so anything else that positions itself
 * against an ancestor (the export menu) must sit outside this, not within it.
 */
export function Tooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <span className={styles.tip}>
      {children}
      <span className={styles.bubble} role="presentation" aria-hidden="true">
        {label}
      </span>
    </span>
  )
}
