import { useState } from 'react'
import type {
  Annotation,
  AnnotationStyle,
  ArrivalStyle,
  FlowDefinition,
  FooterNote,
  NoteStyle,
  Packet,
  PacketShape,
  Step,
  StreamDef,
  WaterfallBar,
} from '@/types/schema'
import type { StepPatch } from '@/state/flowActions'
import { sceneChoices, sceneIndex } from '@/utils/scenes'
import styles from '@/styles/StepEditor.module.css'

const PACKET_SHAPES: PacketShape[]   = ['sphere', 'document', 'token', 'blob', 'envelope']
const ARRIVAL_STYLES: ArrivalStyle[] = ['success', 'warning', 'error']
const NOTE_STYLES: NoteStyle[]       = ['info', 'success', 'warning', 'error']
const ANNOTATION_STYLES: AnnotationStyle[] = ['info', 'success', 'warning', 'error']

interface Props {
  def:   FlowDefinition
  index: number
  onApply: (patch: StepPatch) => void
  onClose: () => void
}

/**
 * The whole of a step, in one form.
 *
 * Edits are held as a draft and applied on submit rather than per keystroke:
 * committing each character would re-apply the step to the scene and restart
 * its animation while you were still typing.
 *
 * `packet`/`packets` and `stream`/`streams` are read in both forms and always
 * written back as arrays, so the two spellings stop multiplying.
 */
export function StepEditor({ def, index, onApply, onClose }: Props) {
  const step = def.steps[index]
  const [draft, setDraft] = useState<Step>(() => structuredClone(step))

  const scenes  = sceneIndex(def)
  const choices = sceneChoices(def, draft.scene)

  const set = <K extends keyof Step>(key: K, value: Step[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const packets = draft.packets ?? (draft.packet ? [draft.packet] : [])
  const streams = draft.streams ?? (draft.stream ? [draft.stream] : [])

  /** Blank optional fields are removed, not written as empty strings. */
  const submit = () => {
    const text = (v?: string) => (v && v.trim() ? v.trim() : undefined)
    onApply({
      title:              text(draft.title) ?? 'Untitled step',
      name:               text(draft.name),
      description:        text(draft.description),
      scene:              draft.scene || undefined,
      highlight:          draft.highlight,
      active_connections: draft.active_connections,
      camera:             draft.camera?.focus || draft.camera?.zoom ? draft.camera : undefined,
      annotations:        draft.annotations?.length ? draft.annotations : undefined,
      footer:             draft.footer?.length ? draft.footer : undefined,
      waterfall:          draft.waterfall,
      // Collapse the singular spellings into the plural ones.
      packet:             undefined,
      packets:            packets.length ? packets : undefined,
      stream:             undefined,
      streams:            streams.length ? streams : undefined,
    })
    onClose()
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <form
      className={styles.form}
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <div className={styles.body}>
        <Section title="Text">
          <Row label="Name">
            <input
              className={styles.input}
              value={draft.name ?? ''}
              placeholder={draft.title}
              onChange={(e) => set('name', e.target.value)}
            />
            <p className={styles.hint}>Shown in the step list. Falls back to the title.</p>
          </Row>
          <Row label="Title">
            <input
              className={styles.input}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Row>
          <Row label="Description">
            <textarea
              className={styles.textarea}
              rows={4}
              value={draft.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </Row>
        </Section>

        <Section title="Scene">
          <Row label="Plays in">
            <select
              className={styles.input}
              value={draft.scene ?? ''}
              onChange={(e) => {
                // Everything a step references has to live in its own scene, so
                // switching scene clears the references rather than saving a
                // flow that won't load.
                const scene = e.target.value || undefined
                setDraft((d) => ({
                  ...d,
                  scene,
                  highlight: [],
                  active_connections: [],
                  annotations: undefined,
                  packets: undefined,
                  packet: undefined,
                  streams: undefined,
                  stream: undefined,
                  camera: undefined,
                }))
              }}
            >
              <option value="">Top level</option>
              {[...scenes.values()].map((s) => (
                <option key={s.id} value={s.id}>{s.path.join(' › ')}</option>
              ))}
            </select>
            {draft.scene !== step.scene && (
              <p className={styles.warn}>
                Changing scene clears this step's highlights, packets and annotations —
                they can only point at things in their own scene.
              </p>
            )}
          </Row>
        </Section>

        <Section title="Highlight">
          <CheckList
            items={choices.components}
            selected={draft.highlight}
            onToggle={(id) => set('highlight', toggle(draft.highlight, id))}
            empty="This scene has no components."
          />
        </Section>

        <Section title="Active connections">
          <CheckList
            items={choices.connections}
            selected={draft.active_connections}
            onToggle={(id) => set('active_connections', toggle(draft.active_connections, id))}
            empty="This scene has no connections."
          />
        </Section>

        <Section
          title="Packets"
          onAdd={choices.connections.length ? () => {
            const next: Packet = { connection: choices.connections[0].id, shape: 'sphere' }
            setDraft((d) => ({ ...d, packet: undefined, packets: [...packets, next] }))
          } : undefined}
        >
          {packets.map((p, i) => (
            <div key={i} className={styles.itemRow}>
              <select
                className={styles.input}
                value={p.connection}
                onChange={(e) => setDraft((d) => ({
                  ...d, packet: undefined,
                  packets: packets.map((x, j) => (j === i ? { ...x, connection: e.target.value } : x)),
                }))}
              >
                {choices.connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select
                className={styles.narrow}
                value={p.shape}
                onChange={(e) => setDraft((d) => ({
                  ...d, packet: undefined,
                  packets: packets.map((x, j) => (j === i ? { ...x, shape: e.target.value as PacketShape } : x)),
                }))}
              >
                {PACKET_SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                className={styles.narrow}
                value={p.direction ?? 'forward'}
                onChange={(e) => setDraft((d) => ({
                  ...d, packet: undefined,
                  packets: packets.map((x, j) => (j === i ? { ...x, direction: e.target.value as 'forward' | 'reverse' } : x)),
                }))}
              >
                <option value="forward">forward</option>
                <option value="reverse">reverse</option>
              </select>
              <input
                className={styles.number}
                type="number"
                min={1}
                placeholder="×1"
                title="How many packets this step sends"
                value={p.count ?? ''}
                onChange={(e) => setDraft((d) => ({
                  ...d, packet: undefined,
                  packets: packets.map((x, j) => (j === i
                    ? { ...x, count: e.target.value ? Number(e.target.value) : undefined }
                    : x)),
                }))}
              />
              <select
                className={styles.narrow}
                value={p.arrivalStyle ?? ''}
                title="Arrival flash"
                onChange={(e) => setDraft((d) => ({
                  ...d, packet: undefined,
                  packets: packets.map((x, j) => (j === i
                    ? { ...x, arrivalStyle: (e.target.value || undefined) as ArrivalStyle | undefined }
                    : x)),
                }))}
              >
                <option value="">arrival…</option>
                {ARRIVAL_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <RemoveBtn onClick={() => setDraft((d) => ({
                ...d, packet: undefined, packets: packets.filter((_, j) => j !== i),
              }))} />
            </div>
          ))}
        </Section>

        <Section
          title="Streams"
          onAdd={choices.connections.length ? () => {
            const next: StreamDef = { connection: choices.connections[0].id }
            setDraft((d) => ({ ...d, stream: undefined, streams: [...streams, next] }))
          } : undefined}
        >
          <p className={styles.hint}>
            For connections that stay open — video, WebSockets. Packets are for data moving.
          </p>
          {streams.map((s, i) => (
            <div key={i} className={styles.itemRow}>
              <select
                className={styles.input}
                value={s.connection}
                onChange={(e) => setDraft((d) => ({
                  ...d, stream: undefined,
                  streams: streams.map((x, j) => (j === i ? { ...x, connection: e.target.value } : x)),
                }))}
              >
                {choices.connections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <input
                className={styles.color}
                type="color"
                value={s.color ?? '#4488ff'}
                aria-label="Stream colour"
                onChange={(e) => setDraft((d) => ({
                  ...d, stream: undefined,
                  streams: streams.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)),
                }))}
              />
              <RemoveBtn onClick={() => setDraft((d) => ({
                ...d, stream: undefined, streams: streams.filter((_, j) => j !== i),
              }))} />
            </div>
          ))}
        </Section>

        <Section
          title="Footer notes"
          onAdd={() => {
            const next: FooterNote = { text: '' }
            set('footer', [...(draft.footer ?? []), next])
          }}
        >
          {(draft.footer ?? []).map((note, i) => (
            <div key={i} className={styles.itemRow}>
              <input
                className={styles.input}
                value={note.text}
                placeholder="**Slow step** — 3,180 ms"
                onChange={(e) => set('footer', (draft.footer ?? []).map((x, j) =>
                  (j === i ? { ...x, text: e.target.value } : x)))}
              />
              <select
                className={styles.narrow}
                value={note.style ?? 'info'}
                onChange={(e) => set('footer', (draft.footer ?? []).map((x, j) =>
                  (j === i ? { ...x, style: e.target.value as NoteStyle } : x)))}
              >
                {NOTE_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <RemoveBtn onClick={() => set('footer', (draft.footer ?? []).filter((_, j) => j !== i))} />
            </div>
          ))}
        </Section>

        <Section
          title="Annotations"
          onAdd={choices.components.length ? () => {
            const next: Annotation = { type: 'callout', target: choices.components[0].id, text: '' }
            set('annotations', [...(draft.annotations ?? []), next])
          } : undefined}
        >
          {(draft.annotations ?? []).map((a, i) => (
            <div key={i} className={styles.itemRow}>
              <select
                className={styles.narrow}
                value={a.target}
                onChange={(e) => set('annotations', (draft.annotations ?? []).map((x, j) =>
                  (j === i ? { ...x, target: e.target.value } : x)))}
              >
                {choices.components.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <input
                className={styles.input}
                value={a.text}
                placeholder="What happens here"
                onChange={(e) => set('annotations', (draft.annotations ?? []).map((x, j) =>
                  (j === i ? { ...x, text: e.target.value } : x)))}
              />
              <select
                className={styles.narrow}
                value={a.style ?? 'info'}
                onChange={(e) => set('annotations', (draft.annotations ?? []).map((x, j) =>
                  (j === i ? { ...x, style: e.target.value as AnnotationStyle } : x)))}
              >
                {ANNOTATION_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <RemoveBtn onClick={() => set('annotations', (draft.annotations ?? []).filter((_, j) => j !== i))} />
            </div>
          ))}
        </Section>

        <Section
          title="Waterfall bar"
          onAdd={draft.waterfall ? undefined : () => set('waterfall', { weight: 1 })}
        >
          {draft.waterfall ? (
            <WaterfallFields
              bar={draft.waterfall}
              onChange={(bar) => set('waterfall', bar)}
              onClear={() => set('waterfall', undefined)}
            />
          ) : (
            <p className={styles.hint}>
              No bar. Weights are unitless — milliseconds, rows scanned, retries, whatever the
              flow compares.
            </p>
          )}
        </Section>

        <Section title="Camera">
          <div className={styles.itemRow}>
            <select
              className={styles.input}
              value={draft.camera?.focus ?? ''}
              onChange={(e) => set('camera', { ...draft.camera, focus: e.target.value || null })}
            >
              <option value="">Don't move the camera</option>
              {choices.components.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input
              className={styles.number}
              type="number"
              step="any"
              min="0.1"
              placeholder="zoom"
              title="Magnification of the scene's overview framing"
              // Zoom without something to zoom in on has nothing to do.
              disabled={!draft.camera?.focus}
              value={draft.camera?.zoom ?? ''}
              onChange={(e) => set('camera', {
                ...draft.camera,
                zoom: e.target.value ? Number(e.target.value) : undefined,
              })}
            />
          </div>
          <p className={styles.hint}>
            {draft.camera?.focus
              ? 'The view moves to this component. Zoom magnifies the scene’s overview framing — 1.5 is half again as close.'
              : 'The view stays wherever the last step, or the viewer, left it. Pick a component to move it.'}
          </p>
        </Section>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
        <button type="submit" className={`${styles.button} ${styles.primary}`}>Apply</button>
      </footer>
    </form>
  )
}

function WaterfallFields({
  bar,
  onChange,
  onClear,
}: {
  bar: WaterfallBar
  onChange: (bar: WaterfallBar) => void
  onClear: () => void
}) {
  return (
    <div className={styles.itemRow}>
      <input
        className={styles.number}
        type="number"
        min={0}
        title="Length of the bar"
        value={bar.weight}
        onChange={(e) => onChange({ ...bar, weight: Number(e.target.value) })}
      />
      <input
        className={styles.number}
        type="number"
        min={0}
        placeholder="start"
        title="Where the bar begins. Leave blank to follow the previous one."
        value={bar.start ?? ''}
        onChange={(e) => onChange({ ...bar, start: e.target.value ? Number(e.target.value) : undefined })}
      />
      <input
        className={styles.input}
        placeholder="label, shown on hover"
        value={bar.label ?? ''}
        onChange={(e) => onChange({ ...bar, label: e.target.value || undefined })}
      />
      <input
        className={styles.color}
        type="color"
        aria-label="Bar colour"
        value={bar.color ?? '#4488ff'}
        onChange={(e) => onChange({ ...bar, color: e.target.value })}
      />
      <RemoveBtn onClick={onClear} />
    </div>
  )
}

function Section({
  title,
  onAdd,
  children,
}: {
  title: string
  onAdd?: () => void
  children: React.ReactNode
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {onAdd && (
          <button type="button" className={styles.addBtn} onClick={onAdd}>+ Add</button>
        )}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      {children}
    </label>
  )
}

function CheckList({
  items,
  selected,
  onToggle,
  empty,
}: {
  items: Array<{ id: string; label: string }>
  selected: string[]
  onToggle: (id: string) => void
  empty: string
}) {
  const [filter, setFilter] = useState('')
  if (!items.length) return <p className={styles.hint}>{empty}</p>

  const term    = filter.trim().toLowerCase()
  const visible = term
    ? items.filter((i) => `${i.label} ${i.id}`.toLowerCase().includes(term))
    : items

  return (
    <>
      {items.length > 8 && (
        <input
          className={styles.input}
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className={styles.checkList}>
        {visible.map((item) => (
          <label key={item.id} className={styles.check}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={() => onToggle(item.id)}
            />
            <span className={styles.checkLabel}>{item.label}</span>
            <span className={styles.checkId}>{item.id}</span>
          </label>
        ))}
      </div>
    </>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.removeBtn} onClick={onClick} aria-label="Remove">
      ✕
    </button>
  )
}
