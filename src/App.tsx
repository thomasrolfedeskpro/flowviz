import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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
import { parseFlowSchema } from '@/engine/flowSchema'
import { lintGeometry } from '@/engine/geometryLint'
import { applyActions } from '@/state/flowActions'
import { nextId } from '@/state/flowActions'
import { planDelete } from '@/state/cascade'
import type { DeletePlan } from '@/state/cascade'
import type { SceneMode } from '@/scene/FlowScene'
import type {
  ComponentPatch,
  ConnectionPatch,
  FlowAction,
  SceneId,
  ZonePatch,
} from '@/state/flowActions'
import { StepEngine } from '@/engine/stepEngine'
import { resolveTiming } from '@/engine/timing'
import type { Timing } from '@/engine/timing'
import { useStepEngine } from '@/hooks/useStepEngine'
import { useHover } from '@/hooks/useHover'
import { usePresentMode } from '@/hooks/usePresentMode'
import type { ViewMode } from '@/scene/viewMode'
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
/** Width of the fixed step sidebar, matching `.sidebar` in the stylesheet. It
 *  covers the canvas rather than sitting next to it. */
const SIDEBAR_WIDTH = 250

/** How many gestures you can walk back. Definitions are tens of kilobytes, so
 *  the depth costs little. */
const UNDO_DEPTH = 50

/** Stable empty list: `?? []` would hand the step-sync effect a new array on
 *  every render and re-run it forever. */
const NO_STEPS: Step[] = []

// The simplest example, on purpose: it is what a first-time visitor lands on.
const PREFERRED_DEFAULT = 'coffee-shop-order'
const DEFAULT_FLOW =
  allFlows.find((f) => f.id === PREFERRED_DEFAULT)?.id ?? allFlows[0]?.id ?? PREFERRED_DEFAULT

async function loadFlow(id: string): Promise<FlowDefinition> {
  // A flow added while the dev server was running is not in the manifest yet;
  // guessing the old flat path lets a deep link still work until a restart.
  const path = allFlows.find((f) => f.id === id)?.path ?? `${id}.json`
  const res = await fetch(`/flows/${path}`)
  if (!res.ok) throw new Error(`Failed to load flow "${id}": ${res.status}`)

  // The dev server answers an unknown path with index.html and a 200, so a
  // wrong id would otherwise surface as a JSON syntax error.
  if (!res.headers.get('content-type')?.includes('json')) {
    throw new Error(
      `No flow named "${id}". Check the file exists under public/flows/examples/ ` +
      `or public/flows/custom/ — and if you just added it, restart the dev server.`,
    )
  }
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

/** `?step=` is 1-based in the URL, because it is a thing people read and type.
 *  Returns a zero-based index, or null when the parameter is absent or junk. */
function stepIndexFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('step')
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n - 1 : null
}

/** `?view=plan` opens straight into the flat view. Anything else is isometric,
 *  which is the default the tool is built around. */
function viewModeFromUrl(): ViewMode {
  return new URLSearchParams(window.location.search).get('view') === 'plan' ? 'plan' : 'isometric'
}

/** How long the camera takes to swing between the two views. */
const VIEW_CHANGE_MS = 600

/** How long the playback bar waits before fading out while presenting. */
const PRESENT_IDLE_MS = 3500

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
  // Playback speed lives here: the step engine needs it for its interval and the
  // scene needs it to scale animations, or a fast walkthrough clips every packet.
  const [speed, setSpeed] = useState(1)
  /** Whether steps that name a component may pull the camera to it. */
  const [cameraFollow, setCameraFollow] = useState(true)
  /** Isometric, or straight down. Isometric is the point of the tool; plan view
   *  is for when a dense diagram needs to be read rather than admired. */
  const [viewMode, setViewMode] = useState<ViewMode>(viewModeFromUrl)
  const [saveState, setSaveState] = useState<
    { status: 'idle' | 'saving' | 'saved' | 'error'; message: string }
  >({ status: 'idle', message: '' })
  const [arrivedTargets, setArrivedTargets] = useState<Set<string>>(new Set())
  const [pipeLabelData, setPipeLabelData] = useState<
    Array<{ id: string; label: string; midpoint: Vector3 }>
  >([])
  /** Connection whose label pad is hovered in edit mode — the highlight has to
   *  be drawn on the HTML chip, which covers the pad in the scene. */
  const [hoveredPipeLabel, setHoveredPipeLabel] = useState<string | null>(null)
  /**
   * Undo history as whole definitions rather than inverse actions.
   *
   * A flow is tens of kilobytes, so snapshots are cheap, and they cannot drift
   * out of step with the document the way a log of inverses can. One entry per
   * committed gesture, and saving doesn't clear it — undoing past a save is
   * allowed, it just leaves the file behind until you save again.
   */
  const [history, setHistory] = useState<{ past: FlowDefinition[]; future: FlowDefinition[] }>(
    { past: [], future: [] },
  )
  /** The definition as it is on disk, for the dirty marker. */
  const [savedDef, setSavedDef] = useState<FlowDefinition | null>(null)
  /** Mirrors the scene's pointer mode, so the toolbar can show what's armed. */
  const [mode, setModeState] = useState<SceneMode>({ kind: 'select' })
  /** Fullscreen, chrome-free playback. */
  const { presenting, exit: exitPresent, toggle: togglePresent } = usePresentMode()
  /** Pointer has been still for a while — the playback bar gets out of the way. */
  const [presentIdle, setPresentIdle] = useState(false)
  /** A delete waiting on the prompt that says what else it would change. */
  const [deletePlan, setDeletePlan] = useState<
    { kind: 'component' | 'zone' | 'connection'; id: string; scene: SceneId; plan: DeletePlan } | null
  >(null)

  // Only treat the loaded flow as current once its id matches the requested one.
  const current = loaded?.id === flowId ? loaded : null
  const graph   = current?.graph ?? null
  const flowDef = current?.def ?? null
  const engine  = current?.engine ?? null
  const steps: Step[] = current?.def.steps ?? NO_STEPS

  const stepState = useStepEngine(engine)
  /** The flow's own pace, with the viewer's speed applied on top. */
  const timing = useMemo(() => resolveTiming(flowDef), [flowDef])

  // Dirty is reference equality against the definition as it is on disk: every
  // edit produces a new object, and an undo back to the saved one restores it.
  const dirty = flowDef !== null && savedDef !== null && flowDef !== savedDef
  // Validated on every commit rather than only at save, so a broken reference
  // surfaces where it was made instead of ten edits later.
  const problems = useMemo(() => {
    if (!flowDef) return []
    const result = parseFlowSchema(flowDef)
    return result.success ? [] : result.errors
  }, [flowDef])

  /**
   * Layout findings, kept apart from `problems` because they mean something
   * different. A schema error makes the file unloadable, so it blocks Save; a
   * geometry finding just means the diagram reads worse than intended, and
   * blocking on those would disable Save halfway through every drag.
   */
  const layoutWarnings = useMemo(
    () => (flowDef && editMode ? lintGeometry(flowDef, graph ?? undefined) : []),
    [flowDef, graph, editMode],
  )

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
  // The manifest's titles were read from disk at startup; the flow on screen is
  // whatever the definition now says it is, so it overrides its own entry.
  const flowsForList = useMemo(
    () => (flowDef
      ? flowList.map((f) => (f.id === flowId ? { ...f, title: flowDef.meta.title } : f))
      : flowList),
    [flowList, flowId, flowDef],
  )

  const { hoveredId, setHoveredId } = useHover()
  // The step subscription is set up once per flow; a ref keeps it reading the
  // current speed without resubscribing on every change.
  const speedRef = useRef(speed)
  /** Same reason as speedRef: the step subscription is set up once per flow. */
  const timingRef = useRef(timing)
  const sceneRef = useRef<FlowScene | null>(null)
  const engineRef = useRef<StepEngine | null>(null)
  /** Mirrors `loaded` for callbacks that must not re-subscribe on every edit. */
  const loadedRef = useRef<LoadedFlow | null>(null)
  /** Same, for the flow-switch guard: `handleSelectFlow` is memoised on flowId. */
  const dirtyRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    loadFlow(flowId)
      .then((def) => {
        if (cancelled) return
        const eng = new StepEngine(def.steps)
        // A shared link can name the step it was about. Clamped rather than
        // rejected: a flow that lost steps since the link was made should still
        // open, at the nearest step that exists.
        const wanted = stepIndexFromUrl()
        if (wanted !== null && def.steps.length > 0) {
          eng.goTo(Math.min(wanted, def.steps.length - 1))
        }
        engineRef.current = eng
        setError(null)
        loadedRef.current = { id: flowId, graph: buildGraph(def), def, engine: eng }
        setLoaded(loadedRef.current)
        setSavedDef(def)
        setHistory({ past: [], future: [] })
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
      // Switching flow throws the in-memory definition away.
      if (dirtyRef.current && !window.confirm('Discard unsaved edits to this visualization?')) return
      // A new flow starts at its own step one, so `step` goes; `present` stays,
      // because switching flow is not a reason to drop out of a presentation.
      const url = new URL(window.location.href)
      url.searchParams.set('flow', id)
      url.searchParams.delete('step')
      window.history.pushState({}, '', `${url.pathname}${url.search}`)
      setFlowId(id)
    },
    [flowId],
  )

  // The step in the URL, so a walkthrough is linkable at the point it was about
  // and survives a reload. replaceState, not push: stepping through a 40-step
  // flow must not bury the page you arrived from under 40 history entries.
  const urlStep = stepState?.currentIndex
  useEffect(() => {
    if (urlStep === undefined) return
    const url = new URL(window.location.href)
    if (urlStep > 0) url.searchParams.set('step', String(urlStep + 1))
    else             url.searchParams.delete('step')
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }, [urlStep])

  // Wire step engine to scene on each step change. The scene only re-applies when
  // the step index actually changes — play/pause notifications must not restart
  // the animation of the step that is already running.
  useEffect(() => {
    if (!engine) return
    // Dedupe on the step itself, not its index: play/pause notifications repeat
    // the same object and must not restart the animation, but editing a step
    // produces a new one and should show immediately.
    let applied: Step | null = null
    return engine.subscribe((state) => {
      if (state.step === applied) return
      applied = state.step
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
      sceneRef.current?.applyStep(state.step, null, timingRef.current.transition / speedRef.current)
    })
  }, [engine])

  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  // Idle pointer fades the playback bar out, so a still frame is just the
  // diagram. Any movement or keypress brings it back.
  //
  // The flag is never reset on the way out: it is only ever read while
  // presenting, so a stale `true` cannot show anything, and clearing it would
  // mean setting state from an effect for no visible gain.
  useEffect(() => {
    if (!presenting) return
    let timer: ReturnType<typeof setTimeout>
    const arm  = () => { timer = setTimeout(() => setPresentIdle(true), PRESENT_IDLE_MS) }
    const bump = () => { setPresentIdle(false); clearTimeout(timer); arm() }
    arm()
    window.addEventListener('pointermove', bump)
    window.addEventListener('keydown', bump)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [presenting])

  // Recompose for the width that is actually visible. Without this the diagram
  // stays shifted left in present mode, composed around a sidebar that has gone,
  // and a presentation is exactly where that empty margin shows most.
  useEffect(() => {
    sceneRef.current?.setViewportInset(presenting ? 0 : SIDEBAR_WIDTH)
  }, [presenting])

  useEffect(() => {
    sceneRef.current?.setCameraFollow(cameraFollow)
  }, [cameraFollow])

  // Animated, because cutting between the two projections is disorienting —
  // everything on screen moves at once and nothing tells you it was the camera.
  useEffect(() => {
    sceneRef.current?.setViewMode(viewMode, VIEW_CHANGE_MS)
    const url = new URL(window.location.href)
    if (viewMode === 'plan') url.searchParams.set('view', 'plan')
    else                     url.searchParams.delete('view')
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }, [viewMode])

  useEffect(() => {
    speedRef.current = speed
    sceneRef.current?.setPlaybackSpeed(speed)
  }, [speed])

  // The flow's pace, and the viewer's multiplier on top of it. Editing timing
  // takes effect on the next step rather than mid-flight, which is what you'd
  // expect from changing how fast something plays.
  useEffect(() => {
    timingRef.current = timing
    sceneRef.current?.setTiming(timing)
    engineRef.current?.setPlayInterval(timing.step / speed)
  }, [timing, speed])

  // Editing steps rewrites the array the engine was constructed with.
  useEffect(() => {
    if (engine && steps.length) engine.setSteps(steps)
  }, [engine, steps])

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
    // Nothing moves while you edit: an animation re-applying under an open
    // editor fights whatever you are typing into it.
    if (next) engineRef.current?.pause()
    if (!next) setEditTarget(null)
    setSaveState({ status: 'idle', message: '' })
    sceneRef.current?.setEditMode(next)
  }, [editMode])

  /**
   * Editing and presenting are mutually exclusive: present mode hides the whole
   * editing apparatus, and a dashed edit border around a presentation is noise.
   * Handled where present mode is entered rather than by an effect watching
   * both flags — there is no way to start editing while presenting, since the
   * only toggle lives in the sidebar that present mode unmounts.
   *
   * Leaving edit mode keeps the edits. Only Discard throws them away.
   */
  const leaveEditMode = useCallback(() => {
    if (!editMode) return
    setEditMode(false)
    setEditTarget(null)
    sceneRef.current?.setEditMode(false)
  }, [editMode])

  /** The F key: into present mode from anywhere, and back out again. */
  const handleTogglePresent = useCallback(() => {
    if (!presenting) leaveEditMode()
    togglePresent()
  }, [presenting, leaveEditMode, togglePresent])

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

  /**
   * The one way an edit reaches the flow definition.
   *
   * The scene has already applied the change to its own graph and meshes by the
   * time this fires — this is what makes it persistent. Definition first means
   * saving writes exactly what was loaded plus what was edited, so a flow
   * nobody touched is rewritten byte for byte.
   */
  /**
   * Rebuild the scene from a definition.
   *
   * Drags mutate the graph themselves and don't come through here. Everything
   * else — undo, and any inspector field the meshes can't be talked into
   * changing — is easier and safer to rebuild than to patch in place.
   *
   * A definition that won't build is kept anyway: the problems list is what
   * explains it, and throwing the edit away would lose work with no way back.
   */
  const renderDef = useCallback((def: FlowDefinition) => {
    const prev = loadedRef.current
    if (!prev) return
    let graph
    try {
      graph = buildGraph(def)
    } catch {
      return
    }
    loadedRef.current = { ...loadedRef.current!, graph }
    setLoaded(loadedRef.current)

    // Rebuild before the engine notifies, or the step would be applied to layers
    // that are about to be disposed.
    sceneRef.current?.reloadGraph(graph, engineRef.current?.getState().step ?? null)
    engineRef.current?.setSteps(def.steps)
    setPipeLabelData(sceneRef.current?.getConnectionLabelData() ?? [])
  }, [])

  const dispatch = useCallback((actions: FlowAction[], rebuild = false) => {
    const prev = loadedRef.current
    if (!prev) return
    const def = applyActions(prev.def, actions)
    // A gesture that resolved to nothing — a zone reporting an unchanged grid —
    // must not land an undo entry that appears to do nothing when used.
    if (def === prev.def) return

    loadedRef.current = { ...prev, def }
    setLoaded(loadedRef.current)
    setHistory((h) => ({ past: [...h.past, prev.def].slice(-UNDO_DEPTH), future: [] }))
    if (rebuild) renderDef(def)
  }, [renderDef])


  /** Re-lay whichever scene is on screen. Deliberately a button, never
   *  automatic: several flows here are hand-placed on purpose. */
  const handleTidyLayout = useCallback(() => {
    // Rebuild, unlike most edits: a drag has already moved its mesh by the time
    // it commits, but this moves everything at once with nothing on screen
    // having changed, so the scene has to be rebuilt from the new definition.
    dispatch([{ type: 'layout/tidy', scene: sceneRef.current?.activeSceneId ?? null }], true)
  }, [dispatch])
  /**
   * Show a definition that didn't come from a gesture — an undo or a redo.
   *
   * The graph and its meshes were mutated in place by whatever is being undone,
   * so they're rebuilt from the definition rather than reverse-engineered.
   */
  const showDef = useCallback((def: FlowDefinition) => {
    const prev = loadedRef.current
    if (!prev) return
    loadedRef.current = { ...prev, def }
    renderDef(def)
  }, [renderDef])

  const undo = useCallback(() => {
    const prev = loadedRef.current
    if (!prev || !history.past.length) return
    const target = history.past[history.past.length - 1]
    setHistory({
      past:   history.past.slice(0, -1),
      future: [prev.def, ...history.future].slice(0, UNDO_DEPTH),
    })
    showDef(target)
  }, [history, showDef])

  const redo = useCallback(() => {
    const prev = loadedRef.current
    if (!prev || !history.future.length) return
    const [target, ...rest] = history.future
    setHistory({ past: [...history.past, prev.def].slice(-UNDO_DEPTH), future: rest })
    showDef(target)
  }, [history, showDef])

  /**
   * Push everything the viewer has chosen into a freshly built scene.
   *
   * Switching visualization discards the FlowScene and builds another, so any
   * setting missing from this list silently reverts to its default while the
   * control still shows what you picked — which is exactly how camera-follow
   * came back on after a flow switch.
   */
  const initScene = useCallback((s: FlowScene) => {
    s.setTheme(theme)
    s.setPlaybackSpeed(speed)
    s.setEditMode(editMode)
    s.setCameraFollow(cameraFollow)
    s.setTiming(timingRef.current)
    // The sidebar is fixed over the canvas, not beside it, so tell the scene how
    // much of its width is hidden and it will compose into what is visible.
    // Presenting takes the sidebar away, so the whole canvas is visible again.
    s.setViewportInset(presenting ? 0 : SIDEBAR_WIDTH)
    // No animation here: the scene has only just been built, so there is no
    // previous view for it to have come from.
    s.setViewMode(viewMode, 0)
  }, [theme, speed, editMode, cameraFollow, presenting, viewMode])

  const setMode = useCallback((next: SceneMode) => {
    sceneRef.current?.setMode(next)
  }, [])

  // Dev-only handle for driving edits from the console or an e2e check, the way
  // __flowScene exposes the scene. The JSON hatch will want the same entry point.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __flowEdit?: unknown }).__flowEdit = { dispatch, showDef, undo, redo }
  }, [dispatch, showDef, undo, redo])

  // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z. Ignored while typing, or an undo in a text
  // field would rewind the whole flow instead of the sentence.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Disarming beats closing nothing: the modal handles its own Esc.
        setMode({ kind: 'select' })
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, setMode])

  /**
   * Step navigation from the keyboard, bound whether or not you are presenting.
   * This is a stepper: the arrows are the first thing anyone reaches for, and
   * having them work only in fullscreen would leave them undiscovered.
   *
   * What it deliberately does not touch: any key aimed at a text field, a
   * shortcut with a modifier, and anything at all while an edit modal is open —
   * the modal owns the keyboard until it closes.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const el = document.activeElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) return

      if (editTarget) return

      const eng = engineRef.current
      switch (e.key) {
        case 'ArrowRight':
          eng?.next()
          break
        case 'ArrowLeft':
          eng?.prev()
          break
        case 'Home':
          eng?.goTo(0)
          break
        case 'End': {
          const total = eng?.getState().totalSteps ?? 0
          if (total > 0) eng?.goTo(total - 1)
          break
        }
        case ' ':
          // Space is how a focused button is pressed — leave it to the button.
          if (el instanceof HTMLButtonElement) return
          // Playback stays off while editing, matching the disabled Play control.
          if (editMode) return
          eng?.toggle()
          break
        case 'f':
        case 'F':
          handleTogglePresent()
          break
        case 'Escape':
          // Only meaningful here while presenting; otherwise the edit-mode
          // handler above wants it for disarming a tool.
          if (!presenting) return
          exitPresent()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editMode, editTarget, presenting, handleTogglePresent, exitPresent])

  // Unsaved edits live only in this tab.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const handleEditStep = useCallback((index: number) => {
    setEditTarget({ kind: 'step', index })
  }, [])

  /** A duplicate lands right after its original and is selected, because the
   *  reason to duplicate a step is almost always to edit the copy. */
  const handleDuplicateStep = useCallback((index: number) => {
    const step = engineRef.current?.getSteps()[index]
    if (!step) return
    const copy = structuredClone(step) as Partial<Step>
    delete copy.id   // the reducer assigns a fresh one
    dispatch([{ type: 'step/insert', index: index + 1, step: copy as Omit<Step, 'id'> }])
    engineRef.current?.goTo(index + 1)
  }, [dispatch])

  const handleDeleteStep = useCallback((index: number) => {
    dispatch([{ type: 'step/remove', index }])
  }, [dispatch])

  /** A new step inherits the scene you're currently in, so adding one while
   *  inside a sub-scene doesn't silently jump the walkthrough back out. */
  const handleAddStep = useCallback((index: number) => {
    const scene = sceneRef.current?.activeSceneId ?? undefined
    dispatch([{
      type: 'step/insert',
      index,
      step: { title: 'New step', highlight: [], active_connections: [], ...(scene ? { scene } : {}) },
    }])
    engineRef.current?.goTo(index)
    setEditTarget({ kind: 'step', index })
  }, [dispatch])

  const handleReorderStep = useCallback((from: number, to: number) => {
    dispatch([{ type: 'step/reorder', from, to }])
    engineRef.current?.goTo(to)
  }, [dispatch])

  // Inspector edits go through the definition and rebuild the scene from it.
  // Only drags are worth patching in place; everything here can change the mesh
  // itself, its colour, even which two things a pipe joins.
  const handlePatchComponent = useCallback((id: string, scene: SceneId, patch: ComponentPatch) => {
    dispatch([{ type: 'component/patch', scene, id, patch }], true)
  }, [dispatch])

  const handlePatchZone = useCallback((id: string, scene: SceneId, patch: ZonePatch) => {
    dispatch([{ type: 'zone/patch', scene, id, patch }], true)
  }, [dispatch])

  const handlePatchConnection = useCallback(
    (id: string, scene: SceneId, patch: ConnectionPatch, clearRoute: boolean) => {
      const actions: FlowAction[] = [{ type: 'connection/patch', scene, id, patch }]
      if (clearRoute) actions.push({ type: 'connection/setRoute', scene, id, route: 'auto' })
      dispatch(actions, true)
    },
    [dispatch],
  )

  const handlePatchFlow = useCallback(
    (
      meta: {
        title: string
        description?: string
        waterfallLabel?: string
        timing?: Partial<Timing>
      },
      grid: { cols: number; rows: number },
    ) => {
      dispatch([
        { type: 'meta/patch', patch: meta },
        { type: 'layout/setGrid', scene: null, grid },
      ], true)
    },
    [dispatch],
  )

  // ── Placing, connecting, deleting ────────────────────────────────────────

  /** Drop a new component or zone on the cell that was clicked, then open its
   *  editor: the only reason to place one is to say what it is. */
  const handlePlace = useCallback((what: 'component' | 'zone', cell: { col: number; row: number }) => {
    const prev = loadedRef.current
    if (!prev) return
    const scene = sceneRef.current?.activeSceneId ?? null

    if (what === 'component') {
      const id = nextId(prev.def, 'comp')
      dispatch([{
        type: 'component/add', scene, id,
        component: { label: 'New component', type: 'service', position: cell },
      }], true)
      setEditTarget({ kind: 'component', id, scene })
    } else {
      const id = nextId(prev.def, 'zone')
      dispatch([{
        type: 'zone/add', scene, id,
        zone: {
          label: 'New zone',
          color: '#3b82f6',
          bounds: { col: cell.col, row: cell.row, width: 4, height: 3 },
        },
      }], true)
      setEditTarget({ kind: 'zone', id, scene })
    }
  }, [dispatch])

  const handleConnect = useCallback((from: string, to: string) => {
    const prev = loadedRef.current
    if (!prev) return
    const scene = sceneRef.current?.activeSceneId ?? null
    const id = nextId(prev.def, 'conn')
    dispatch([{ type: 'connection/add', scene, id, connection: { from, to, route: 'auto' } }], true)
    setEditTarget({ kind: 'pipe', id, scene })
  }, [dispatch])

  /** Work out what a delete would take with it, and show that before doing it. */
  const handleAskDelete = useCallback(
    (kind: 'component' | 'zone' | 'connection', id: string, scene: SceneId) => {
      const prev = loadedRef.current
      if (!prev) return
      setDeletePlan({ kind, id, scene, plan: planDelete(prev.def, scene, kind, id) })
    },
    [],
  )

  const confirmDeleteObject = useCallback(() => {
    if (!deletePlan || deletePlan.plan.blocked) return
    dispatch(deletePlan.plan.actions, true)
    setDeletePlan(null)
    setEditTarget(null)
  }, [deletePlan, dispatch])

  /** Scene-only, for the live colour/shape/size preview. Discarded on cancel. */
  const handlePreviewComponent = useCallback((id: string, patch: ComponentPatch) => {
    sceneRef.current?.previewComponent(id, patch)
  }, [])

  /**
   * Apply raw JSON, from the per-object hatch or the whole-flow one.
   *
   * Validated as a whole flow before it lands: the point of the hatch is to
   * reach fields the forms don't cover, not to write a file the app can't load.
   * Returns the reasons it was refused, so the editor stays open with them.
   */
  const handleApplyJson = useCallback((target: EditTarget, parsed: unknown): string[] | null => {
    const prev = loadedRef.current
    if (!prev) return ['No flow is loaded.']

    let candidate: FlowDefinition
    let actions: FlowAction[]

    if (target.kind === 'json') {
      candidate = parsed as FlowDefinition
      actions = []
    } else {
      if (target.kind === 'flow' || target.kind === 'delete-flow') return ['Nothing to edit here.']
      const scene = target.kind === 'step' ? null : target.scene
      const obj = parsed as { id?: string }
      if (target.kind !== 'step' && obj?.id !== target.id) {
        return [`Ids can't be changed here — this one has to stay "${target.id}".`]
      }
      actions =
        target.kind === 'component' ? [{ type: 'component/replace', scene, id: target.id, component: parsed as never }]
        : target.kind === 'zone'    ? [{ type: 'zone/replace',      scene, id: target.id, zone: parsed as never }]
        : target.kind === 'pipe'    ? [{ type: 'connection/replace', scene, id: target.id, connection: parsed as never }]
        : [{ type: 'step/replace', index: target.index, step: parsed as never }]
      candidate = applyActions(prev.def, actions)
    }

    const result = parseFlowSchema(candidate)
    if (!result.success) return result.errors

    if (target.kind === 'json') {
      // A pasted flow can differ everywhere, so it goes through the same path
      // as an undo: one history entry, then rebuild from scratch.
      setHistory((h) => ({ past: [...h.past, prev.def].slice(-UNDO_DEPTH), future: [] }))
      loadedRef.current = { ...prev, def: candidate }
      renderDef(candidate)
    } else {
      dispatch(actions, true)
    }
    setEditTarget(null)
    return null
  }, [dispatch, renderDef])

  /** Rebuild from the definition, throwing away anything a form previewed. */
  const handleDiscard = useCallback(() => {
    if (loadedRef.current) renderDef(loadedRef.current.def)
  }, [renderDef])

  // Writes the edited flow back to its file through the dev server. The server
  // validates before writing, so a save can never leave an unloadable file.
  const handleSave = useCallback(async () => {
    if (!flowDef) return
    setSaveState({ status: 'saving', message: 'Saving…' })
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flowDef, null, 2),
      })
      const body = (await res.json().catch(() => ({}))) as { saved?: string; error?: string; errors?: string[] }
      if (!res.ok) {
        throw new Error(body.errors?.join('; ') ?? body.error ?? `Save failed (${res.status})`)
      }
      setSaveState({ status: 'saved', message: `Saved to ${body.saved ?? flowId}` })
      setSavedDef(flowDef)
    } catch (err) {
      setSaveState({ status: 'error', message: String(err) })
    }
  }, [flowDef, flowId])

  const handleCopyJson = useCallback(() => {
    if (!flowDef) return
    navigator.clipboard.writeText(JSON.stringify(flowDef, null, 2)).catch(() => {
      /* clipboard access denied — silently ignore */
    })
  }, [flowDef])

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
          initScene(s)
          s.setHoverCallback(setHoveredId)
          // Objects are edited in whichever scene is on screen, so the target
          // records it: the same id has to be found again in the definition.
          s.setComponentSelectCallback((id) =>
            setEditTarget({ kind: 'component', id, scene: s.activeSceneId }))
          s.setZoneLabelEditCallback((zoneId) =>
            setEditTarget({ kind: 'zone', id: zoneId, scene: s.activeSceneId }))
          s.setPipeLabelEditCallback((connId) =>
            setEditTarget({ kind: 'pipe', id: connId, scene: s.activeSceneId }))
          s.setPipeLabelHoverCallback(setHoveredPipeLabel)
          s.setEditCommitCallback(dispatch)
          s.setPlaceCallback(handlePlace)
          s.setConnectCallback(handleConnect)
          s.setModeCallback(setModeState)
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

      {steps.length > 0 && stepState && !presenting && (
        <StepSidebar
          steps={steps}
          currentIndex={stepState.currentIndex}
          waterfallLabel={flowDef?.meta.waterfallLabel}
          editMode={editMode}
          flowId={flowId}
          flows={flowsForList}
          scenes={scenes}
          onSelectFlow={handleSelectFlow}
          onDeleteFlow={import.meta.env.DEV ? handleDeleteFlow : undefined}
          onGoTo={handleGoTo}
          onEditModeToggle={handleEditModeToggle}
          onCopyJson={handleCopyJson}
          onSave={handleSave}
          saveState={saveState}
          dirty={dirty}
          problems={problems}
          layoutWarnings={layoutWarnings}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={undo}
          onRedo={redo}
          // Step editing writes to the file, so it needs the dev server too.
          onEditStep={import.meta.env.DEV ? handleEditStep : undefined}
          onDuplicateStep={import.meta.env.DEV ? handleDuplicateStep : undefined}
          onDeleteStep={import.meta.env.DEV ? handleDeleteStep : undefined}
          onAddStep={import.meta.env.DEV ? handleAddStep : undefined}
          onReorderStep={import.meta.env.DEV ? handleReorderStep : undefined}
          onEditFlow={import.meta.env.DEV ? () => setEditTarget({ kind: 'flow' }) : undefined}
          onEditJson={import.meta.env.DEV ? () => setEditTarget({ kind: 'json' }) : undefined}
          mode={
            mode.kind === 'place' ? (mode.what === 'zone' ? 'place-zone' : 'place-component')
            : mode.kind === 'connect' ? 'connect'
            : 'select'
          }
          onTidyLayout={import.meta.env.DEV ? handleTidyLayout : undefined}
          onModeChange={import.meta.env.DEV ? (m) => setMode(
            m === 'place-component' ? { kind: 'place', what: 'component' }
            : m === 'place-zone'    ? { kind: 'place', what: 'zone' }
            : m === 'connect'       ? { kind: 'connect' }
            : { kind: 'select' },
          ) : undefined}
        />
      )}

      {/* Persistent pipe protocol labels */}
      {bridge && pipeLabelData.length > 0 && (
        <PipeLabels
          pipes={pipeLabelData}
          bridge={bridge}
          counts={packetCounts}
          hoveredId={hoveredPipeLabel}
        />
      )}

      {/* Delete confirmation is reachable outside edit mode; the rest is edit-only. */}
      {editTarget && (editMode || editTarget.kind === 'delete-flow') && (
        <EditModal
          key={
            editTarget.kind === 'step' ? `step:${editTarget.index}`
            : editTarget.kind === 'flow' || editTarget.kind === 'json' ? editTarget.kind
            : `${editTarget.kind}:${editTarget.id}`
          }
          target={editTarget}
          def={flowDef}
          onConfirmDelete={confirmDeleteFlow}
          error={deleteError}
          onPatchStep={(index, patch) => dispatch([{ type: 'step/patch', index, patch }])}
          onPatchComponent={handlePatchComponent}
          onPatchZone={handlePatchZone}
          onPatchConnection={handlePatchConnection}
          onPatchFlow={handlePatchFlow}
          onPreviewComponent={handlePreviewComponent}
          onDiscard={handleDiscard}
          onApplyJson={handleApplyJson}
          onAskDelete={handleAskDelete}
          deletePlan={deletePlan?.plan ?? null}
          onConfirmDeleteObject={confirmDeleteObject}
          onCancelDeleteObject={() => setDeletePlan(null)}
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
          {/* While presenting, the bar fades out once the pointer settles: a
              held frame should be the diagram and nothing else. It stops taking
              clicks when hidden, so it can't swallow a drag on the canvas. */}
          <div
            className={
              presenting
                ? `${styles.autoHide}${presentIdle ? ` ${styles.autoHidden}` : ''}`
                : undefined
            }
          >
            <StepControls
              engine={engine}
              speed={speed}
              onSpeedChange={setSpeed}
              cameraFollow={cameraFollow}
              onCameraFollowChange={setCameraFollow}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              theme={theme}
              onThemeToggle={handleThemeToggle}
              presenting={presenting}
              onTogglePresent={handleTogglePresent}
              editMode={editMode}
            >
              {/* Recordings hold each step for as long as playback does at the
                  current speed, so an export matches what the viewer watched. */}
              <ExportButton
                scene={scene}
                engine={engine}
                flowId={flowId}
                msPerStep={timing.step / speed}
              />
            </StepControls>
          </div>
        </>
      )}

      {/* Present mode has no visible exit, so it says how to leave. It fades
          itself out in CSS rather than being timed out from React. */}
      {presenting && (
        <div className={styles.presentHint} role="status">
          <kbd>←</kbd> <kbd>→</kbd> step · <kbd>space</kbd> play · <kbd>Esc</kbd> exit
        </div>
      )}

    </div>
  )
}

export default App
