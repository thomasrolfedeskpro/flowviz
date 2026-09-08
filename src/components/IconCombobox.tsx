import { useEffect, useId, useMemo, useRef, useState } from 'react'
import styles from '@/styles/EditModal.module.css'

/**
 * A name picker over the whole Font Awesome solid set.
 *
 * This is not a `<datalist>` on purpose. Chrome filters datalist options by the
 * input's current value, so once a full icon name is in the box the only
 * suggestion equals what's typed and the popup never opens again — and it caps
 * the popup at 513 rows regardless, which cut the list off at "deaf". Both are
 * unreachable from CSS or markup, so the list is ours.
 */
export function IconCombobox({
  id,
  value,
  names,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  names: string[]
  placeholder?: string
  onChange: (name: string) => void
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  /**
   * The typed filter, or null when the box just holds a chosen name. Null is
   * what makes reopening show the whole list instead of the one exact match.
   */
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => {
    const q = query?.trim().toLowerCase()
    if (!q) return names
    // Prefix matches first: typing "data" should reach "database" before "metadata".
    const starts: string[] = []
    const contains: string[] = []
    for (const n of names) {
      const i = n.toLowerCase().indexOf(q)
      if (i === 0) starts.push(n)
      else if (i > 0) contains.push(n)
    }
    return [...starts, ...contains]
  }, [names, query])

  /** Open on the chosen name, so the list starts where the value is. */
  const openList = () => {
    setQuery(null)
    setActive(Math.max(0, names.indexOf(value)))
    setOpen(true)
  }

  const choose = (name: string) => {
    onChange(name)
    setQuery(null)
    setOpen(false)
  }

  // Keep the highlighted row in view for both keyboard walking and reopening.
  useEffect(() => {
    if (!open) return
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  // Clicking anywhere else in the modal closes the list.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { openList(); return }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(matches.length - 1, Math.max(0, i + step)))
      return
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (matches[active]) choose(matches[active])
      return
    }
    if (e.key === 'Escape' && open) {
      // The modal is a <dialog>: let Escape through and it closes the whole form.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className={styles.combo} ref={wrapRef}>
      <input
        id={id}
        className={styles.input}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={query ?? value}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
          onChange(e.target.value)
        }}
        onMouseDown={() => { if (!open) openList() }}
        onFocus={() => { if (!open) openList() }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className={styles.comboList} id={listId} role="listbox" ref={listRef}>
          {matches.length === 0 && <li className={styles.comboEmpty}>No icon matches that</li>}
          {matches.map((name, i) => (
            <li
              key={name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={name === value}
              className={[
                styles.comboOption,
                i === active ? styles.comboActive : '',
                name === value ? styles.comboChosen : '',
              ].filter(Boolean).join(' ')}
              // pointerdown would fire before the input's blur handling; mousedown
              // keeps the choice ahead of the outside-click close.
              onMouseDown={(e) => { e.preventDefault(); choose(name) }}
              onMouseEnter={() => setActive(i)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
