import { useState, useEffect, useRef, useCallback } from 'react'
import { CanvasContainer } from '@/components/CanvasContainer'
import { StepControls } from '@/components/StepControls'
import { StepHUD } from '@/components/StepHUD'
import { AnnotationOverlay } from '@/components/AnnotationOverlay'
import { HoverTooltip } from '@/components/HoverTooltip'
import { ZoneTooltip } from '@/components/ZoneTooltip'
import { PipeLabels } from '@/components/PipeLabels'
import { PacketTooltip } from '@/components/PacketTooltip'
import { StepSidebar } from '@/components/StepSidebar'
import type { FlowSummary } from '@/components/StepSidebar'
import { EditModal } from '@/components/EditModal'
import type { EditTarget } from '@/components/EditModal'
import { ExportButton } from '@/components/ExportButton'
import { buildGraph } from '@/engine/parseFlow'
import { graphToFlowDefinition } from '@/utils/flowSerializer'
import { StepEngine } from '@/engine/stepEngine'
import { useStepEngine } from '@/hooks/useStepEngine'
import { useHover } from '@/hooks/useHover'
import type { FlowScene } from '@/scene/FlowScene'
import type { OverlayBridge } from '@/scene/OverlayBridge'
import type { Theme } from '@/scene/ThemeColors'
import type { Step } from '@/types/schema'
import type { InternalGraph } from '@/types/internal'
import type { FlowDefinition } from '@/types/schema'
import type { Vector3 } from 'three'
import { flows as allFlows } from 'virtual:flows'
import { sceneIndex, findSceneGraph } from '@/utils/scenes'
import styles from '@/styles/App.module.css'
import '@/styles/global.css'

// Flows live in subdirectories (`examples/` ships, `custom/` is git-ignored), so
// the manifest maps an id to its path. Falling back to the first flow keeps a
// fresh clone working even though the previous default now lives in custom/.
const PREFERRED_DEFAULT = 'zz-nested'
const DEFAULT_FLOW =
  allFlows.find((f) => f.id === PREFERRED_DEFAULT)?.id ?? allFlows[0]?.id ?? PREFERRED_DEFAULT

async function loadFlow(id: string): Promise<FlowDefinition> {
  // A flow added while the dev server was running is not in the manifest yet;
  // guessing the old flat path lets a deep link still work until a restart.
  const path = allFlows.find((f) => f.id === id)?.path ?? `${id}.json`
  const res = await fetch(`/flows/${path}`)
  if (!res.ok) throw new Error(`Failed to load flow "${id}": ${res.status}`)
  return res.json() as Promise<FlowDefinition>
}

/** One flow's parsed state, tagged with the id it came from so a switch that is
 *  still in flight never renders the previous flow's graph. */
interface LoadedFlow {
  id: string
  graph: InternalGraph
  def: FlowDefinition
  engine: StepEngine
}

function flowIdFromUrl(): string {
  return new URLSearchParams(window.location.search).get('flow') ?? DEFAULT_FLOW
}

function App() {
  const [flowId, setFlowId] = useState<string>(flowIdFromUrl)
  const [loaded, setLoaded] = useState<LoadedFlow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bridge, setBridge] = useState<OverlayBridge | null>(null)
  const [scene, setScene] = useState<FlowScene | null>(null)
  const [theme, setTheme] = useState<Theme>('light')
  const [editMode, setEditMode] = useState(false)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [flowList, setFlowList] = useState<FlowSummary[]>(allFlows)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Scene transitions dip the view to the background colour and back.
  const [sceneFade, setSceneFade] = useState({ opacity: 0, ms: 0 })
  const [arrivedTargets, setArrivedTargets] = useState<Set<string>>(new Set())
  const [pipeLabelData, setPipeLabelData] = useState<
    Array<{ id: string; label: string; midpoint: Vector3 }>
  >([])

  // Only treat the loaded flow as current once its id matches the requested one.
  const current = loaded?.id === flowId ? loaded : null
  const graph   = current?.graph ?? null
  const flowDef = current?.def ?? null
  const engine  = current?.engine ?? null
  const steps: Step[] = current?.def.steps ?? []

  const stepState = useStepEngine(engine)

  // Overlays (annotations, tooltips, pipe labels) must read the scene on screen,
  // not the top-level one — a sub-scene's components live in its own graph.
  const activeSceneId = stepState?.step.scene ?? null
  const activeGraph   = graph ? findSceneGraph(graph, activeSceneId) : null
  const scenes        = flowDef ? sceneIndex(flowDef) : new Map()
  const scenePath     = activeSceneId ? scenes.get(activeSceneId)?.path ?? [] : []

  // Repeat counts for the step on screen, so pipes can show a ×N marker.
  const packetCounts: Record<string, number> = {}
  for (const def of [
    ...(stepState?.step.packet ? [stepState.step.packet] : []),
    ...(stepState?.step.packets ?? []),
  ]) {
    if (def.count && def.count > 1) {
      packetCounts[def.connection] = Math.max(packetCounts[def.connection] ?? 0, def.count)
    }
  }
  const { hoveredId, setHoveredId } = useHover()
  const sceneRef = useRef<FlowScene | null>(null)
  const engineRef = useRef<StepEngine | null>(null)

  useEffect(() => {
    let cancelled = false

    loadFlow(flowId)
      .then((def) => {
        if (cancelled) return
        const eng = new StepEngine(def.steps)
        engineRef.current = eng
        setError(null)
        setLoaded({ id: flowId, graph: buildGraph(def), def, engine: eng })
      })
      .catch((err) => !cancelled && setError(String(err)))

    return () => {
      cancelled = true
      engineRef.current?.destroy()
      sceneRef.current = null
    }
  }, [flowId])

  // Browser back/forward switches visualization
  useEffect(() => {
    const onPop = () => setFlowId(flowIdFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const handleSelectFlow = useCallback(
    (id: string) => {
      if (id === flowId) return
      window.history.pushState({}, '', `?flow=${id}`)
      setFlowId(id)
    },
    [flowId],
  )

  // Wire step engine to scene on each step change. The scene only re-applies when
  // the step index actually changes — play/pause notifications must not restart
  // the animation of the step that is already running.
  useEffect(() => {
    if (!engine) return
    let appliedIndex = -1
    return engine.subscribe((state) => {
      if (state.currentIndex === appliedIndex) return
      appliedIndex = state.currentIndex
      const packetDefs = [
        ...(state.step.packet ? [state.step.packet] : []),
        ...(state.step.packets ?? []),
      ]
      // If no packets this step, show annotations immediately
      if (packetDefs.length === 0) {
        setArrivedTargets(
          new Set(state.step.annotations?.map((a) => a.target) ?? []),
        )
      } else {
        setArrivedTargets(new Set())
      }
      sceneRef.current?.applyStep(state.step, null, 800)
    })
  }, [engine])

  // Keep the HTML data-theme attribute in sync with React state
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const handleThemeToggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    sceneRef.current?.setTheme(next)
  }, [theme])

  const handleEditModeToggle = useCallback(() => {
    const next = !editMode
    setEditMode(next)
    if (!next) setEditTarget(null)
    sceneRef.current?.setEditMode(next)
  }, [editMode])

  const handleDeleteFlow = useCallback((flow: FlowSummary) => {
    setDeleteError(null)
    setEditTarget({ kind: 'delete-flow', id: flow.id, label: flow.title })
  }, [])

  const confirmDeleteFlow = useCallback(async () => {
    if (editTarget?.kind !== 'delete-flow') return
    const id = editTarget.id
    try {
      const res = await fetch(`/api/flows/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Delete failed (${res.status})`)
      }
    } catch (err) {
      setDeleteError(String(err))
      return
    }

    const remaining = flowList.filter((f) => f.id !== id)
    setFlowList(remaining)
    setEditTarget(null)

    // Deleting the flow on screen leaves nothing to render — fall back to another.
    if (id === flowId && remaining.length > 0) {
      const next = remaining[0].id
      window.history.replaceState({}, '', `?flow=${next}`)
      setFlowId(next)
    }
  }, [editTarget, flowList, flowId])

  const handleRenameLabel = useCallback((target: EditTarget, label: string) => {
    const trimmed = label.trim()
    if (!trimmed) return
    if (target.kind === 'zone') {
      sceneRef.current?.renameZone(target.id, trimmed)
    } else if (target.kind === 'pipe') {
      sceneRef.current?.renameConnection(target.id, trimmed)
      setPipeLabelData((prev) => prev.map((p) => (p.id === target.id ? { ...p, label: trimmed } : p)))
    }
  }, [])

  const handleCopyJson = useCallback(() => {
    if (!graph || !flowDef) return
    const updated = graphToFlowDefinition(graph, flowDef)
    navigator.clipboard.writeText(JSON.stringify(updated, null, 2)).catch(() => {
      /* clipboard access denied — silently ignore */
    })
  }, [graph, flowDef])

  const handleGoTo = useCallback((index: number) => {
    engineRef.current?.goTo(index)
  }, [])

  if (error) {
    return (
      <div
        style={{ color: '#ff6b6b', padding: '2rem', fontFamily: 'monospace' }}
      >
        Error: {error}
      </div>
    )
  }

  if (!graph) {
    return (
      <div
        style={{ color: '#e0e0e0', padding: '2rem', fontFamily: 'monospace' }}
      >
        Loading…
      </div>
    )
  }

  return (
    <div className={`${styles.app}${editMode ? ` ${styles.editing}` : ''}`}>
      <CanvasContainer
        key={flowId}
        graph={graph}
        onSceneReady={(s, b) => {
          sceneRef.current = s
          // dev-only handle for poking at the scene from the console / e2e checks
          if (import.meta.env.DEV) (window as unknown as { __flowScene?: FlowScene }).__flowScene = s
          setScene(s)
          setBridge(b)
          setArrivedTargets(new Set())
          s.setTheme(theme)
          s.setEditMode(editMode)
          s.setHoverCallback(setHoveredId)
          s.setComponentSelectCallback((id) => setEditTarget({ kind: 'component', id }))
          s.setZoneLabelEditCallback((zoneId, current) =>
            setEditTarget({ kind: 'zone', id: zoneId, label: current }),
          )
          s.setPipeLabelEditCallback((connId, current) =>
            setEditTarget({ kind: 'pipe', id: connId, label: current }),
          )
          // Fires at the moment the layers swap, mid-transition — reading the
          // labels off the step's scene id would race the swap and show the
          // scene we just left.
          s.setSceneChangeCallback(() => setPipeLabelData(s.getConnectionLabelData()))
          s.setTransitionCallback((phase, ms) =>
            setSceneFade({ opacity: phase === 'out' ? 1 : 0, ms }),
          )
          s.setPacketArrivalCallback((targetId) => {
            setArrivedTargets((prev) => new Set([...prev, targetId]))
          })
          setPipeLabelData(s.getConnectionLabelData())
          const eng = engineRef.current
          if (eng) {
            s.applyStep(eng.getState().step, null, 0)
          }
        }}
      />

      {/* Covers the diagram only — the panels stay legible through a transition. */}
      <div
        className={styles.sceneFade}
        style={{ opacity: sceneFade.opacity, transitionDuration: `${sceneFade.ms}ms` }}
      />

      {steps.length > 0 && stepState && (
        <StepSidebar
          steps={steps}
          currentIndex={stepState.currentIndex}
          theme={theme}
          editMode={editMode}
          flowId={flowId}
          flows={flowList}
          scenes={scenes}
          onSelectFlow={handleSelectFlow}
          onDeleteFlow={import.meta.env.DEV ? handleDeleteFlow : undefined}
          onGoTo={handleGoTo}
          onThemeToggle={handleThemeToggle}
          onEditModeToggle={handleEditModeToggle}
          onCopyJson={handleCopyJson}
        />
      )}

      {/* Persistent pipe protocol labels */}
      {bridge && pipeLabelData.length > 0 && (
        <PipeLabels
          pipes={pipeLabelData}
          bridge={bridge}
          counts={packetCounts}
        />
      )}

      {/* Delete confirmation is reachable outside edit mode; the rest is edit-only. */}
      {editTarget && (editMode || editTarget.kind === 'delete-flow') && (
        <EditModal
          key={`${editTarget.kind}:${editTarget.id}`}
          target={editTarget}
          onConfirmDelete={confirmDeleteFlow}
          error={deleteError}
          component={
            editTarget.kind === 'component'
              ? (activeGraph ?? graph).components.get(editTarget.id) ?? null
              : null
          }
          onRenameLabel={handleRenameLabel}
          // updateComponent mutates the InternalComponent in place and rebuilds
          // the mesh, so there is nothing for React to re-render here.
          onPatchComponent={(id, patch) => sceneRef.current?.updateComponent(id, patch)}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Per-step annotations — deferred until the packet arrives at the target */}
      {bridge &&
        (() => {
          const visible =
            stepState?.step.annotations?.filter((a) =>
              arrivedTargets.has(a.target),
            ) ?? []
          return visible.length > 0 ? (
            <AnnotationOverlay
              annotations={visible}
              graph={activeGraph ?? graph}
              bridge={bridge}
            />
          ) : null
        })()}

      {hoveredId?.startsWith('__packet__') && sceneRef.current && bridge && (
        <PacketTooltip
          scene={sceneRef.current}
          bridge={bridge}
          hoveredId={hoveredId}
        />
      )}
      {hoveredId &&
        !hoveredId.startsWith('__packet__') &&
        !hoveredId.startsWith('__zone__') &&
        bridge && (
          <HoverTooltip hoveredId={hoveredId} graph={activeGraph ?? graph} bridge={bridge} />
        )}
      {hoveredId?.startsWith('__zone__') && sceneRef.current && bridge && (
        <ZoneTooltip
          zoneId={hoveredId.slice('__zone__'.length)}
          graph={activeGraph ?? graph}
          scene={sceneRef.current}
          bridge={bridge}
        />
      )}

      {engine && stepState && (
        <>
          <StepHUD engine={engine} scenePath={scenePath} />
          <StepControls engine={engine} />
        </>
      )}

      <ExportButton scene={scene} engine={engine} />
    </div>
  )
}

export default App
