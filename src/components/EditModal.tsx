import { useEffect, useRef, useState } from 'react'
import type { FlowDefinition } from '@/types/schema'
import type {
  ComponentPatch,
  ConnectionPatch,
  SceneId,
  StepPatch,
  ZonePatch,
} from '@/state/flowActions'
import { StepEditor } from '@/components/StepEditor'
import { JsonEditor } from '@/components/JsonEditor'
import {
  ComponentFields,
  ConnectionFields,
  FlowFields,
  ZoneFields,
} from '@/components/InspectorFields'
import type { DeletePlan } from '@/state/cascade'
import { sceneOf } from '@/utils/scenes'
import styles from '@/styles/EditModal.module.css'

/**
 * What the modal is currently editing. `null` closes it.
 *
 * Objects carry the scene they were opened from: only one scene's meshes are on
 * screen, but the same id has to be found in the definition to edit it.
 */
export type EditTarget =
  | { kind: 'component';   id: string; scene: SceneId }
  | { kind: 'zone';        id: string; scene: SceneId }
  | { kind: 'pipe';        id: string; scene: SceneId }
  | { kind: 'step';        index: number }
  | { kind: 'flow' }
  | { kind: 'json' }
  | { kind: 'delete-flow'; id: string; label: string }

interface Props {
  target: EditTarget
  /** The flow being edited. Every form reads its subject out of this. */
  def: FlowDefinition | null
  onPatchStep: (index: number, patch: StepPatch) => void
  onPatchComponent: (id: string, scene: SceneId, patch: ComponentPatch) => void
  onPatchZone: (id: string, scene: SceneId, patch: ZonePatch) => void
  onPatchConnection: (id: string, scene: SceneId, patch: ConnectionPatch, clearRoute: boolean) => void
  onPatchFlow: (
    meta: { title: string; description?: string; waterfallLabel?: string },
    grid: { cols: number; rows: number },
  ) => void
  /** Applies a component's visual fields to the scene only, for live preview. */
  onPreviewComponent: (id: string, patch: ComponentPatch) => void
  /** Called when a form is abandoned, so any preview can be thrown away. */
  onDiscard: () => void
  /** Applies raw JSON for the object being edited. Returns any reasons it was
   *  refused, so the editor can stay open and say so. */
  onApplyJson: (target: EditTarget, parsed: unknown) => string[] | null
  /** Work out what deleting this would take with it, and show the prompt. */
  onAskDelete: (kind: 'component' | 'zone' | 'connection', id: string, scene: SceneId) => void
  /** Set while that prompt is up. */
  deletePlan: DeletePlan | null
  onConfirmDeleteObject: () => void
  onCancelDeleteObject: () => void
  onConfirmDelete?: () => void
  /** Shown inside the modal when an action failed, so it stays open to say why. */
  error?: string | null
  onClose: () => void
}

export function EditModal({
  target,
  def,
  onPatchStep,
  onPatchComponent,
  onPatchZone,
  onPatchConnection,
  onPatchFlow,
  onPreviewComponent,
  onDiscard,
  onApplyJson,
  onAskDelete,
  deletePlan,
  onConfirmDeleteObject,
  onCancelDeleteObject,
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

  /** Closing without applying — Esc, the backdrop, the ✕ or Cancel — drops any
   *  preview the form pushed into the scene. */
  const cancel = () => { onDiscard(); onClose() }

  // Objects can be edited as fields or as raw JSON; the toggle only appears
  // where there is a form to toggle away from.
  const [asJson, setAsJson] = useState(false)
  const scene = 'scene' in target ? target.scene : null
  const contents = def ? sceneOf(def, scene) : null
  const component  = target.kind === 'component' ? contents?.components.find((c) => c.id === target.id) : null
  const zone       = target.kind === 'zone' ? contents?.zones?.find((z) => z.id === target.id) : null
  const connection = target.kind === 'pipe' ? contents?.connections.find((c) => c.id === target.id) : null

  const heading =
    target.kind === 'zone'          ? { title: 'Zone',        sub: zone?.label ?? target.id }
    : target.kind === 'pipe'        ? { title: 'Connection',  sub: connection?.label ?? target.id }
    : target.kind === 'flow'        ? { title: 'Visualization', sub: def?.meta.title ?? '' }
    : target.kind === 'json'        ? { title: 'Flow JSON',     sub: def?.meta.title ?? '' }
    : target.kind === 'delete-flow' ? { title: 'Delete visualization', sub: target.label }
    : target.kind === 'step'        ? {
        title: `Step ${target.index}`,
        sub:   def?.steps[target.index]?.name ?? def?.steps[target.index]?.title ?? '',
      }
    :                                 { title: component?.label ?? 'Component', sub: component?.type ?? '' }

  const subject =
    target.kind === 'component' ? component
    : target.kind === 'zone'    ? zone
    : target.kind === 'pipe'    ? connection
    : target.kind === 'step'    ? def?.steps[target.index]
    : null

  const canToggleJson = subject != null

  return (
    <dialog
      ref={ref}
      className={
        `${styles.dialog}` +
        (target.kind === 'step' || target.kind === 'json' || asJson ? ` ${styles.wide}` : '')
      }
      onClose={cancel}
      onCancel={cancel}
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{heading.title}</h2>
          {heading.sub && <p className={styles.subtitle}>{heading.sub}</p>}
        </div>
        <div className={styles.headerActions}>
          {canToggleJson && !deletePlan && (
            <button
              className={`${styles.tabBtn}${asJson ? ` ${styles.tabBtnOn}` : ''}`}
              onClick={() => setAsJson((v) => !v)}
              title="Edit this object's raw JSON"
            >
              {asJson ? 'Fields' : 'JSON'}
            </button>
          )}
          <button className={styles.close} onClick={cancel} aria-label="Close">✕</button>
        </div>
      </header>

      {deletePlan ? (
        <CascadeConfirm
          plan={deletePlan}
          what={heading.sub || heading.title}
          onConfirm={onConfirmDeleteObject}
          onCancel={onCancelDeleteObject}
        />
      ) : target.kind === 'json' ? (
        def && (
          <JsonEditor
            value={def}
            hint="The whole flow. Paste one in, or reach anything the forms don't cover."
            onApply={(parsed) => onApplyJson(target, parsed)}
            onCancel={onClose}
          />
        )
      ) : asJson && subject ? (
        <JsonEditor
          value={subject}
          hint="Applied only if the whole flow still validates. Ids can't be changed here."
          onApply={(parsed) => onApplyJson(target, parsed)}
          onCancel={cancel}
        />
      ) : target.kind === 'delete-flow' ? (
        <ConfirmDelete
          label={target.label}
          error={error}
          onConfirm={() => onConfirmDelete?.()}
          onCancel={onClose}
        />
      ) : target.kind === 'step' ? (
        def && (
          <StepEditor
            def={def}
            index={target.index}
            onApply={(patch) => onPatchStep(target.index, patch)}
            onClose={onClose}
          />
        )
      ) : target.kind === 'flow' ? (
        def && (
          <FlowFields
            def={def}
            onApply={(meta, grid) => { onPatchFlow(meta, grid); onClose() }}
            onCancel={cancel}
          />
        )
      ) : target.kind === 'component' ? (
        component && (
          <ComponentFields
            component={component}
            onPreview={(patch) => onPreviewComponent(target.id, patch)}
            onApply={(patch) => { onPatchComponent(target.id, target.scene, patch); onClose() }}
            onDelete={() => onAskDelete('component', target.id, target.scene)}
            onCancel={cancel}
          />
        )
      ) : target.kind === 'zone' ? (
        zone && def && (
          <ZoneFields
            zone={zone}
            def={def}
            scene={target.scene}
            onApply={(patch) => { onPatchZone(target.id, target.scene, patch); onClose() }}
            onDelete={() => onAskDelete('zone', target.id, target.scene)}
            onCancel={cancel}
          />
        )
      ) : (
        connection && def && (
          <ConnectionFields
            connection={connection}
            def={def}
            scene={target.scene}
            onApply={(patch, clearRoute) => {
              onPatchConnection(target.id, target.scene, patch, clearRoute)
              onClose()
            }}
            onDelete={() => onAskDelete('pipe' === target.kind ? 'connection' : 'connection', target.id, target.scene)}
            onCancel={cancel}
          />
        )
      )}
    </dialog>
  )
}

/**
 * The prompt before a structural delete.
 *
 * Deleting is per-delete-confirmed by design: the fallout is listed here, in
 * the flow's own words, rather than cascading silently or being refused because
 * something somewhere points at it.
 */
function CascadeConfirm({
  plan,
  what,
  onConfirm,
  onCancel,
}: {
  plan: DeletePlan
  what: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className={styles.body}>
        {plan.blocked ? (
          <p className={styles.prose}>{plan.blocked}</p>
        ) : (
          <>
            <p className={styles.prose}>
              Delete <strong>{what}</strong>?
            </p>
            {plan.referrers.length > 0 ? (
              <>
                <p className={styles.prose}>These change too:</p>
                <ul className={styles.cascadeList}>
                  {plan.referrers.map((r, i) => (
                    <li key={i}><strong>{r.where}</strong> — {r.what}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className={styles.hint}>Nothing else refers to it.</p>
            )}
          </>
        )}
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
        {!plan.blocked && (
          <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onConfirm} autoFocus>
            Delete
          </button>
        )}
      </footer>
    </>
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
