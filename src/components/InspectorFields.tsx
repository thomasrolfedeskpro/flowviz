import { useState } from 'react'
import { TYPE_COLOR } from '@/scene/ComponentMesh'
import { COMPONENT_SHAPES } from '@/scene/componentShapes'
import { SOLID_ICON_NAMES } from '@/scene/IconMesh'
import { IconCombobox } from '@/components/IconCombobox'
import type {
  Component,
  ComponentShape,
  ComponentType,
  Connection,
  FlowDefinition,
  Zone,
} from '@/types/schema'
import type { ComponentPatch, ConnectionPatch, ZonePatch } from '@/state/flowActions'
import { DEFAULT_TIMING } from '@/engine/timing'
import type { Timing } from '@/engine/timing'
import { sceneOf } from '@/utils/scenes'
import styles from '@/styles/EditModal.module.css'

/**
 * The forms behind the inspector modals: everything about a component, zone,
 * connection or the flow itself that the scene can't be dragged into saying.
 *
 * All of them hold a draft and commit on Done, so a half-typed label never
 * reaches the definition. The component form additionally previews its visual
 * fields straight into the scene — the 3-D view is the only honest colour
 * swatch — and the caller discards that preview if you cancel.
 */

const COMPONENT_TYPES: ComponentType[] =
  ['client', 'service', 'database', 'queue', 'function', 'external']

const SHAPE_GLYPH: Record<ComponentShape, string> = {
  cuboid:   'M2 3h12v10H2z',
  cylinder: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2z',
  hexagon:  'M8 1.5 14 5v6l-6 3.5L2 11V5z',
  octagon:  'M5.5 1.5h5L14 5v6l-3.5 3.5h-5L2 11V5z',
  triangle: 'M8 2l6 11H2z',
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

// ── Component ────────────────────────────────────────────────────────────────

export function ComponentFields({
  component,
  onPreview,
  onApply,
  onDelete,
  onCancel,
}: {
  component: Component
  /** Straight to the scene, not the definition — undone if you cancel. */
  onPreview: (patch: ComponentPatch) => void
  onApply: (patch: ComponentPatch) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ComponentPatch>({
    label:     component.label,
    type:      component.type,
    size:      component.size ?? { w: 1, h: 1 },
    shape:     component.shape ?? 'cuboid',
    icon:      component.icon ?? '',
    logo:      component.logo ?? '',
    color:     component.color ?? '',
    elevation: component.position.elevation ?? 0,
    meta:      component.meta ?? {},
  })

  /** Visual fields go to the scene as well as the draft. */
  const preview = (patch: ComponentPatch) => {
    setDraft((d) => ({ ...d, ...patch }))
    onPreview(patch)
  }
  const set = (patch: ComponentPatch) => setDraft((d) => ({ ...d, ...patch }))
  const meta = (patch: NonNullable<Component['meta']>) =>
    setDraft((d) => ({ ...d, meta: { ...d.meta, ...patch } }))

  const swatch = draft.color || hex(TYPE_COLOR[draft.type ?? component.type])
  const size = draft.size ?? { w: 1, h: 1 }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onApply(draft) }}>
      <div className={styles.body}>
        <IdRow id={component.id} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-label">Label</label>
          <input
            id="insp-label"
            className={styles.input}
            value={draft.label ?? ''}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-type">Type</label>
          <select
            id="insp-type"
            className={styles.input}
            value={draft.type}
            onChange={(e) => set({ type: e.target.value as ComponentType })}
          >
            {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <p className={styles.hint}>Sets the default colour and icon when neither is overridden.</p>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Size</span>
          <div className={styles.inline}>
            <input
              className={`${styles.input} ${styles.number}`}
              type="number" min={1} max={12} value={size.w}
              aria-label="Width in cells"
              onChange={(e) => preview({ size: { w: Math.max(1, Number(e.target.value)), h: size.h } })}
            />
            <span className={styles.times}>×</span>
            <input
              className={`${styles.input} ${styles.number}`}
              type="number" min={1} max={12} value={size.h}
              aria-label="Depth in cells"
              onChange={(e) => preview({ size: { w: size.w, h: Math.max(1, Number(e.target.value)) } })}
            />
            <span className={styles.suffix}>cells</span>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Shape</span>
          <div className={styles.segmented} role="group" aria-label="Shape">
            {COMPONENT_SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                title={s}
                aria-label={s}
                aria-pressed={s === draft.shape}
                className={`${styles.segment}${s === draft.shape ? ` ${styles.segmentOn}` : ''}`}
                onClick={() => preview({ shape: s })}
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
              className={styles.color} type="color" value={swatch}
              aria-label="Component colour"
              onChange={(e) => preview({ color: e.target.value })}
            />
            <code className={styles.swatchValue}>{draft.color || 'type default'}</code>
            <button type="button" className={styles.buttonSm} onClick={() => preview({ color: '' })}>
              Reset
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-icon">Icon</label>
          {/* A combobox, not a 2000-row select: type to filter, or open the list. */}
          <IconCombobox
            id="insp-icon"
            value={draft.icon ?? ''}
            names={SOLID_ICON_NAMES}
            placeholder="type default"
            onChange={(icon) => preview({ icon })}
          />
          <p className={styles.hint}>
            {draft.logo
              ? `Brand logo “${draft.logo}” is drawn instead of this icon.`
              : 'Font Awesome free-solid name — leave blank for the type default.'}
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-logo">Logo</label>
          <input
            id="insp-logo"
            className={styles.input}
            value={draft.logo ?? ''}
            placeholder="none"
            onChange={(e) => set({ logo: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-elev">Elevation</label>
          <div className={styles.inline}>
            <input
              id="insp-elev"
              className={`${styles.input} ${styles.number}`}
              type="number" min={0} step={1}
              value={draft.elevation ?? 0}
              onChange={(e) => set({ elevation: Math.max(0, Number(e.target.value)) })}
            />
            <span className={styles.suffix}>cells off the floor</span>
          </div>
        </div>

        <MetaFields
          description={draft.meta?.description ?? ''}
          notes={draft.meta?.notes ?? ''}
          onChange={meta}
          extra={
            <div className={styles.inline}>
              <input
                className={styles.input}
                placeholder="src/path/to/file.ts"
                aria-label="Source file"
                value={draft.meta?.file ?? ''}
                onChange={(e) => meta({ file: e.target.value })}
              />
              <input
                className={`${styles.input} ${styles.number}`}
                type="number" min={1}
                placeholder="line"
                aria-label="Line number"
                value={draft.meta?.line ?? ''}
                onChange={(e) => meta({ line: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
          }
        />
      </div>

      <Footer onCancel={onCancel} onDelete={onDelete} />
    </form>
  )
}

// ── Zone ─────────────────────────────────────────────────────────────────────

export function ZoneFields({
  zone,
  def,
  scene,
  onApply,
  onDelete,
  onCancel,
}: {
  zone: Zone
  def: FlowDefinition
  scene: string | null
  onApply: (patch: ZonePatch) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ZonePatch>({
    label:    zone.label,
    color:    zone.color,
    outline:  zone.outline ?? 'solid',
    parentId: zone.parentId ?? '',
    bounds:   zone.bounds,
    meta:     zone.meta ?? {},
  })
  const set = (patch: ZonePatch) => setDraft((d) => ({ ...d, ...patch }))
  const bounds = draft.bounds ?? zone.bounds

  // A zone can't be its own parent, and the schema only accepts a parent from
  // the same scene.
  const parents = (sceneOf(def, scene)?.zones ?? []).filter((z) => z.id !== zone.id)

  return (
    <form onSubmit={(e) => { e.preventDefault(); onApply(draft) }}>
      <div className={styles.body}>
        <IdRow id={zone.id} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-zone-label">Label</label>
          <input
            id="insp-zone-label"
            className={styles.input}
            value={draft.label ?? ''}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Colour</span>
          <div className={styles.inline}>
            <input
              className={styles.color} type="color" value={draft.color ?? '#3b82f6'}
              aria-label="Zone colour"
              onChange={(e) => set({ color: e.target.value })}
            />
            <code className={styles.swatchValue}>{draft.color}</code>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-outline">Border</label>
          <select
            id="insp-outline"
            className={styles.input}
            value={draft.outline}
            onChange={(e) => set({ outline: e.target.value as 'solid' | 'dashed' })}
          >
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-parent">Inside zone</label>
          <select
            id="insp-parent"
            className={styles.input}
            value={draft.parentId}
            onChange={(e) => set({ parentId: e.target.value })}
          >
            <option value="">Nothing — top level</option>
            {parents.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
          <p className={styles.hint}>A nested zone floats above its parent and grows to contain it.</p>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Bounds</span>
          <div className={styles.inline}>
            {(['col', 'row', 'width', 'height'] as const).map((k) => (
              <input
                key={k}
                className={`${styles.input} ${styles.number}`}
                type="number"
                min={k === 'width' || k === 'height' ? 1 : 0}
                aria-label={k}
                title={k}
                value={bounds[k]}
                onChange={(e) => set({
                  bounds: { ...bounds, [k]: Math.max(k === 'width' || k === 'height' ? 1 : 0, Number(e.target.value)) },
                })}
              />
            ))}
          </div>
          <p className={styles.hint}>col, row, width, height — in grid cells.</p>
        </div>

        <MetaFields
          description={draft.meta?.description ?? ''}
          notes={draft.meta?.notes ?? ''}
          onChange={(patch) => setDraft((d) => ({ ...d, meta: { ...d.meta, ...patch } }))}
        />
      </div>

      <Footer onCancel={onCancel} onDelete={onDelete} />
    </form>
  )
}

// ── Connection ───────────────────────────────────────────────────────────────

export function ConnectionFields({
  connection,
  def,
  scene,
  onApply,
  onDelete,
  onCancel,
}: {
  connection: Connection
  def: FlowDefinition
  scene: string | null
  onApply: (patch: ConnectionPatch, clearRoute: boolean) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ConnectionPatch>({
    label: connection.label ?? '',
    from:  connection.from,
    to:    connection.to,
    color: connection.color ?? '',
  })
  const [clearRoute, setClearRoute] = useState(false)
  const set = (patch: ConnectionPatch) => setDraft((d) => ({ ...d, ...patch }))

  // Connections cannot cross scenes, so both ends come from this one.
  const components = sceneOf(def, scene)?.components ?? []
  const waypoints = connection.route === 'auto' ? 0 : connection.route.length

  return (
    <form onSubmit={(e) => { e.preventDefault(); onApply(draft, clearRoute) }}>
      <div className={styles.body}>
        <IdRow id={connection.id} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-conn-label">Label</label>
          <input
            id="insp-conn-label"
            className={styles.input}
            value={draft.label ?? ''}
            placeholder="none"
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Colour</span>
          <div className={styles.inline}>
            <input
              className={styles.color}
              type="color"
              aria-label="Pipe colour"
              value={draft.color || '#7f8c9b'}
              onChange={(e) => set({ color: e.target.value })}
            />
            <code className={styles.swatchValue}>{draft.color || 'theme default'}</code>
            <button type="button" className={styles.buttonSm} onClick={() => set({ color: '' })}>
              Reset
            </button>
          </div>
          <p className={styles.hint}>
            The pipe stays glass — the same idle, active and in-flight opacities, in this hue.
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-from">From</label>
          <select
            id="insp-from"
            className={styles.input}
            value={draft.from}
            onChange={(e) => set({ from: e.target.value })}
          >
            {components.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-to">To</label>
          <select
            id="insp-to"
            className={styles.input}
            value={draft.to}
            onChange={(e) => set({ to: e.target.value })}
          >
            {components.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Route</span>
          {waypoints === 0 ? (
            <p className={styles.hint}>Automatic — a curve between the two components.</p>
          ) : (
            <label className={styles.inline}>
              <input
                type="checkbox"
                checked={clearRoute}
                onChange={(e) => setClearRoute(e.target.checked)}
              />
              <span className={styles.hint}>
                {waypoints} waypoint{waypoints === 1 ? '' : 's'} — tick to drop them and route
                automatically.
              </span>
            </label>
          )}
        </div>
      </div>

      <Footer onCancel={onCancel} onDelete={onDelete} />
    </form>
  )
}

// ── Flow ─────────────────────────────────────────────────────────────────────

export function FlowFields({
  def,
  onApply,
  onCancel,
}: {
  def: FlowDefinition
  onApply: (
    meta: {
      title: string
      description?: string
      waterfallLabel?: string
      timing?: Partial<Timing>
    },
    grid: { cols: number; rows: number },
  ) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(def.meta.title)
  const [description, setDescription] = useState(def.meta.description ?? '')
  const [waterfallLabel, setWaterfallLabel] = useState(def.meta.waterfallLabel ?? '')
  const [grid, setGrid] = useState(def.layout.grid)
  const [timing, setTiming] = useState<Partial<Timing>>(def.meta.timing ?? {})

  /** Blank means "use the default", so it's stored as absent, not as zero. */
  const setDuration = (key: keyof Timing, value: string) =>
    setTiming((t) => {
      const next = { ...t }
      if (value === '') delete next[key]
      else next[key] = Math.max(1, Number(value))
      return next
    })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onApply(
          {
            title:          title.trim() || 'Untitled',
            description:    description.trim() || undefined,
            waterfallLabel: waterfallLabel.trim() || undefined,
            timing:         Object.keys(timing).length ? timing : undefined,
          },
          grid,
        )
      }}
    >
      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-title">Title</label>
          <input
            id="insp-title"
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-desc">Description</label>
          <textarea
            id="insp-desc"
            className={styles.input}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Grid</span>
          <div className={styles.inline}>
            <input
              className={`${styles.input} ${styles.number}`}
              type="number" min={1} aria-label="Columns"
              value={grid.cols}
              onChange={(e) => setGrid({ ...grid, cols: Math.max(1, Number(e.target.value)) })}
            />
            <span className={styles.times}>×</span>
            <input
              className={`${styles.input} ${styles.number}`}
              type="number" min={1} aria-label="Rows"
              value={grid.rows}
              onChange={(e) => setGrid({ ...grid, rows: Math.max(1, Number(e.target.value)) })}
            />
            <span className={styles.suffix}>cells</span>
          </div>
          <p className={styles.hint}>
            Shrinking below what the layout uses can strand components off-grid.
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="insp-waterfall">Waterfall</label>
          <input
            id="insp-waterfall"
            className={styles.input}
            value={waterfallLabel}
            placeholder="Waterfall"
            onChange={(e) => setWaterfallLabel(e.target.value)}
          />
          <p className={styles.hint}>
            What the bars measure — “Latency”, “Cost”, “Distance”. Names the column
            and its toggle; the bars themselves are unitless.
          </p>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Timing</span>
          <div className={styles.timingGrid}>
            {([
              ['step',       'Step holds for'],
              ['packet',     'Packet crosses in'],
              ['transition', 'Highlights fade in'],
              ['stream',     'Chevrons loop every'],
            ] as const).map(([key, label]) => (
              <label key={key} className={styles.timingRow}>
                <span className={styles.timingLabel}>{label}</span>
                {/* step="any": with a step of 100 the browser rejects 600 as
                    "not a valid value" and silently refuses to submit — the form
                    just stops working, with nothing said. */}
                <input
                  className={`${styles.input} ${styles.number}`}
                  type="number" min={1} step="any"
                  placeholder={String(DEFAULT_TIMING[key])}
                  value={timing[key] ?? ''}
                  onChange={(e) => setDuration(key, e.target.value)}
                />
                <span className={styles.suffix}>ms</span>
              </label>
            ))}
          </div>
          <p className={styles.hint}>
            The flow's own pace. Blank uses the default. The viewer's speed control
            scales all of it and is never saved.
          </p>
        </div>
      </div>

      <Footer onCancel={onCancel} />
    </form>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** Ids are generated and never editable — but you still need to see them, since
 *  they're what the steps and connections refer to. */
function IdRow({ id }: { id: string }) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>Id</span>
      <code className={styles.swatchValue}>{id}</code>
    </div>
  )
}

function MetaFields({
  description,
  notes,
  onChange,
  extra,
}: {
  description: string
  notes: string
  onChange: (patch: { description?: string; notes?: string; file?: string; line?: number }) => void
  extra?: React.ReactNode
}) {
  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="insp-meta-desc">Description</label>
        <textarea
          id="insp-meta-desc"
          className={styles.input}
          rows={2}
          value={description}
          placeholder="Shown on hover"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      {extra && (
        <div className={styles.field}>
          <span className={styles.label}>Source</span>
          {extra}
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="insp-meta-notes">Notes</label>
        <textarea
          id="insp-meta-notes"
          className={styles.input}
          rows={2}
          value={notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </>
  )
}

function Footer({ onCancel, onDelete }: { onCancel: () => void; onDelete?: () => void }) {
  return (
    <footer className={styles.footer}>
      {/* Left of the divide, away from Apply: deleting is not the usual exit. */}
      {onDelete && (
        <button type="button" className={`${styles.button} ${styles.dangerGhost}`} onClick={onDelete}>
          Delete
        </button>
      )}
      <span className={styles.footerSpacer} />
      <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
      <button type="submit" className={`${styles.button} ${styles.primary}`}>Apply</button>
    </footer>
  )
}
