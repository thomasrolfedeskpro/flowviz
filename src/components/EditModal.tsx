import { useEffect, useId, useRef, useState } from 'react'
import { TYPE_COLOR } from '@/scene/ComponentMesh'
import { COMPONENT_SHAPES } from '@/scene/componentShapes'
import { SOLID_ICON_NAMES } from '@/scene/IconMesh'
import { CELL_SIZE, COMPONENT_GAP } from '@/engine/layoutEngine'
import type { InternalComponent } from '@/types/internal'
import type { ComponentShape } from '@/types/schema'
import styles from '@/styles/EditModal.module.css'

export interface ComponentPatch {
  size?:  { w: number; h: number }
  icon?:  string
  color?: string
  shape?: ComponentShape
}

/** What the modal is currently editing. `null` closes it. */
export type EditTarget =
  | { kind: 'zone';        id: string; label: string }
  | { kind: 'pipe';        id: string; label: string }
  | { kind: 'component';   id: string }
  | { kind: 'delete-flow'; id: string; label: string }

interface Props {
  target: EditTarget
  component: InternalComponent | null
  onRenameLabel: (target: EditTarget, label: string) => void
  onPatchComponent: (id: string, patch: ComponentPatch) => void
  onConfirmDelete?: () => void
  /** Shown inside the modal when an action failed, so it stays open to say why. */
  error?: string | null
  onClose: () => void
}

const cells = (worldSize: number) => Math.max(1, Math.round(worldSize / (CELL_SIZE * COMPONENT_GAP)))
const hex   = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/** Footprint glyph for the shape picker — drawn, not named, so the choice reads at a glance. */
const SHAPE_GLYPH: Record<ComponentShape, string> = {
  cuboid:   'M2 3h12v10H2z',
  cylinder: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z',
  hexagon:  'M8 1.5 14 5v6l-6 3.5L2 11V5z',
  octagon:  'M5.5 1.5h5L14 5v6l-3.5 3.5h-5L2 11V5z',
  triangle: 'M8 2l6 11H2z',
}

export function EditModal({
  target,
  component,
  onRenameLabel,
  onPatchComponent,
  onConfirmDelete,
  error,
  onClose,
}: Props) {
  // Native <dialog> gives Esc-to-close, the backdrop and focus trapping for free.
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  const heading =
    target.kind === 'zone'          ? { title: 'Rename zone',        sub: target.label }
    : target.kind === 'pipe'        ? { title: 'Pipe label',         sub: target.label }
    : target.kind === 'delete-flow' ? { title: 'Delete visualization', sub: target.label }
    :                                 { title: component?.label ?? 'Component', sub: component?.type ?? '' }

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} onCancel={onClose}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{heading.title}</h2>
          {heading.sub && <p className={styles.subtitle}>{heading.sub}</p>}
        </div>
        <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
      </header>

      {target.kind === 'delete-flow'
        ? (
            <ConfirmDelete
              label={target.label}
              error={error}
              onConfirm={() => onConfirmDelete?.()}
              onCancel={onClose}
            />
          )
        : target.kind === 'component'
        ? component && (
            <ComponentFields
              component={component}
              onChange={patch => onPatchComponent(component.id, patch)}
              onDone={onClose}
            />
          )
        : (
            <LabelField
              value={target.label}
              onSave={label => { onRenameLabel(target, label); onClose() }}
              onCancel={onClose}
            />
          )}
    </dialog>
  )
}

function ConfirmDelete({
  label,
  error,
  onConfirm,
  onCancel,
}: {
  label: string
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className={styles.body}>
        <p className={styles.prose}>
          Delete <strong>{label}</strong>? Its flow file is removed from disk and this
          cannot be undone.
        </p>
        {error && <p className={styles.error}>{error}</p>}
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onConfirm} autoFocus>
          Delete
        </button>
      </footer>
    </>
  )
}

function LabelField({
  value,
  onSave,
  onCancel,
}: {
  value: string
  onSave: (label: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(value)

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(text) }}>
      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-label">Label</label>
          <input
            id="edit-label"
            className={styles.input}
            type="text"
            value={text}
            autoFocus
            onChange={e => setText(e.target.value)}
          />
        </div>
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
        <button type="submit" className={`${styles.button} ${styles.primary}`}>Save</button>
      </footer>
    </form>
  )
}

function ComponentFields({
  component,
  onChange,
  onDone,
}: {
  component: InternalComponent
  onChange: (patch: ComponentPatch) => void
  onDone: () => void
}) {
  const [w, setW]         = useState(() => cells(component.meshSize.x))
  const [h, setH]         = useState(() => cells(component.meshSize.z))
  const [icon, setIcon]   = useState(component.icon ?? '')
  const [color, setColor] = useState(component.color ?? hex(TYPE_COLOR[component.type]))
  const [shape, setShape] = useState<ComponentShape>(component.shape ?? 'cuboid')
  const iconListId = useId()

  const resize = (nextW: number, nextH: number) => {
    setW(nextW)
    setH(nextH)
    onChange({ size: { w: nextW, h: nextH } })
  }

  // Every field applies straight to the scene — the 3-D view is the preview.
  return (
    <>
      <div className={styles.body}>
        <div className={styles.field}>
          <span className={styles.label}>Size</span>
          <div className={styles.inline}>
            <input
              className={`${styles.input} ${styles.number}`}
              type="number" min={1} max={12} value={w}
              aria-label="Width in cells"
              onChange={e => resize(Math.max(1, Number(e.target.value)), h)}
            />
            <span className={styles.times}>×</span>
            <input
              className={`${styles.input} ${styles.number}`}
              type="number" min={1} max={12} value={h}
              aria-label="Depth in cells"
              onChange={e => resize(w, Math.max(1, Number(e.target.value)))}
            />
            <span className={styles.suffix}>cells</span>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Shape</span>
          <div className={styles.segmented} role="group" aria-label="Shape">
            {COMPONENT_SHAPES.map(s => (
              <button
                key={s}
                type="button"
                title={s}
                aria-label={s}
                aria-pressed={s === shape}
                className={`${styles.segment}${s === shape ? ` ${styles.segmentOn}` : ''}`}
                onClick={() => { setShape(s); onChange({ shape: s }) }}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d={SHAPE_GLYPH[s]} fill="currentColor" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Colour</span>
          <div className={styles.inline}>
            <input
              className={styles.color} type="color" value={color}
              aria-label="Component colour"
              onChange={e => { setColor(e.target.value); onChange({ color: e.target.value }) }}
            />
            <code className={styles.swatchValue}>{color}</code>
            <button
              type="button"
              className={styles.buttonSm}
              onClick={() => { setColor(hex(TYPE_COLOR[component.type])); onChange({ color: '' }) }}
            >
              Reset
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-icon">Icon</label>
          {/* A combobox, not a 2000-row select: type to filter, or open the list. */}
          <input
            id="edit-icon"
            className={styles.input}
            list={iconListId}
            value={icon}
            placeholder="type default"
            onChange={e => { setIcon(e.target.value); onChange({ icon: e.target.value }) }}
          />
          <datalist id={iconListId}>
            {SOLID_ICON_NAMES.map(name => <option key={name} value={name} />)}
          </datalist>
        </div>

        <p className={styles.hint}>
          {component.logo
            ? `Brand logo “${component.logo}” is drawn instead of this icon.`
            : 'Font Awesome free-solid name — leave blank for the type default.'}
        </p>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onDone}>Done</button>
      </footer>
    </>
  )
}
