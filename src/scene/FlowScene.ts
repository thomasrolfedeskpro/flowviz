import * as THREE from 'three'
import { SceneManager } from '@/scene/SceneManager'
import { OverlayBridge } from '@/scene/OverlayBridge'
import { GridFloor } from '@/scene/GridFloor'
import { applyZoneCorner, clampZoneDelta, snapZoneToGrid, componentsInZone, snapDelta } from '@/scene/ZoneRenderer'
import type { ZoneCorner, ZoneRenderer } from '@/scene/ZoneRenderer'
import { SceneLayer } from '@/scene/SceneLayer'
import { HoverSystem } from '@/scene/HoverSystem'
import { setHoverOutline, setHoverOutlineScale, setHoverOutlineTheme } from '@/scene/hoverOutline'
import { setupLighting, updateLighting } from '@/scene/LightingSetup'
import type { SceneLights } from '@/scene/LightingSetup'
import { THEME_COLORS } from '@/scene/ThemeColors'
import type { Theme } from '@/scene/ThemeColors'
import type { InternalGraph } from '@/types/internal'
import type { Step } from '@/types/schema'
import { CELL_SIZE, COMPONENT_GAP, gridToWorld, worldToGrid } from '@/engine/layoutEngine'
import { PIPE_HEIGHT, removeWaypoint } from '@/engine/parseFlow'
import type { ComponentPatch, FlowAction } from '@/state/flowActions'
import { componentGridPosition, gridFromBounds, zoneGridBounds } from '@/state/gridUnits'
import { DEFAULT_TIMING } from '@/engine/timing'
import type { Timing } from '@/engine/timing'
import { Tween, Easing } from '@tweenjs/tween.js'
import { tweenGroup } from '@/scene/tweenGroup'

const CAMERA_HEIGHT        = 50
const WHEEL_ZOOM_IN        = 0.89
const WHEEL_ZOOM_OUT       = 1.12
const FRUSTUM_MIN_RATIO    = 0.25
const FRUSTUM_MAX_RATIO    = 2.5
const DRAG_THRESHOLD_PX    = 4    // movement before a press becomes a drag
const DRAG_LIFT            = 0.6  // world-units a component rises while being dragged
// Scene transitions: fade out, swap under cover, fade back in.
const SCENE_FADE_RATIO     = 0.55  // of the step duration, per direction
const SCENE_FADE_MIN_MS    = 320
const SCENE_FADE_HOLD_MS   = 140   // fully covered, so the cut is never glimpsed
const SCENE_ZOOM_IN        = 0.72  // frustum multiplier while diving into a scene
const SCENE_ZOOM_OUT       = 1.45  // …and while backing out of one
const SCENE_SETTLE_WIDE    = 1.15  // arrive wide, close in — reads as descending
const SCENE_SETTLE_TIGHT   = 0.55  // arrive tight, open out — reads as ascending
const SCENE_EXIT_PAD_MS      = 500   // reading time after the last packet lands
const SCENE_EXIT_MAX_WAIT_MS = 1600  // never stall the walkthrough longer than this
// Waypoint handles float above the pipe: sitting at pipe height buried half the
// handle inside the tube, which made them hard to see and to grab.
const WAYPOINT_HANDLE_Y    = PIPE_HEIGHT + 0.6

/** What a press on the canvas means. `connect` remembers the first end picked. */
export type SceneMode =
  | { kind: 'select' }
  | { kind: 'place'; what: 'component' | 'zone' }
  | { kind: 'connect'; from?: string }

export class FlowScene extends SceneManager {
  /** Every scene in the flow, keyed by owning component id (null = top level). */
  private layers:         Map<string | null, SceneLayer> = new Map()
  /** The one the camera is looking at and the pointer acts on. */
  private layer:          SceneLayer
  private rootLayer:      SceneLayer
  private grid:           GridFloor
  private lights:         SceneLights
  private currentTheme:    Theme = 'light'
  private hoverSystem:     HoverSystem
  private overviewTarget:  THREE.Vector3
  private overviewFrustum: number

  // Per-scene state lives on the active layer; these keep the pointer, edit and
  // step code reading the same way it did when a FlowScene held exactly one graph.
  private get graph()          { return this.layer.graph }
  private get components()     { return this.layer.components }
  private get pipes()          { return this.layer.pipes }
  private get zones()          { return this.layer.zones }
  private get zoneById()       { return this.layer.zoneById }
  private get waypointHandles(){ return this.layer.waypointHandles }
  private get labelHandles()   { return this.layer.labelHandles }
  get zoneLabelPositions()     { return this.layer.zoneLabelPositions }
  private isPanning:       boolean = false
  private panLast:         THREE.Vector2 = new THREE.Vector2()
  private packetArrivalCallback: ((targetId: string) => void) | null = null
  // ── Edit-mode drag state ──
  private editMode:        boolean = false
  private dragId:          string | null = null
  private dragGroup:       THREE.Group | null = null
  private dragPointerId:   number | null = null
  private dragOffset:      THREE.Vector2 = new THREE.Vector2()  // (groupX-groundX, groupZ-groundZ) at grab
  private dragStartClient: THREE.Vector2 = new THREE.Vector2()  // pointer-down position, for threshold
  private dragOriginY:     number = 0
  private dragMoved:       boolean = false
  private dragRay:         THREE.Raycaster = new THREE.Raycaster()
  private dragGhost:       THREE.Mesh | null = null
  private dragW:           number = 0
  private dragH:           number = 0
  // ── Zone corner-resize state ──
  private resizeZone:      ZoneRenderer | null = null
  private resizeCorner:    ZoneCorner | null = null
  // ── Whole-zone move state (grip handle) ──
  private moveGrabbed:     boolean = false
  private moveStart:       THREE.Vector3 = new THREE.Vector3()
  private moveZoneSnapshot: Array<{ zr: ZoneRenderer; min: THREE.Vector3; max: THREE.Vector3 }> = []
  private moveCompSnapshot: Array<{ id: string; center: THREE.Vector3 }> = []
  // ── Waypoint handle state ──
  // ── Edit-mode hover feedback ──
  private hoverHandle:     THREE.Mesh | null = null
  private hoverComponent:  string | null = null
  private sceneChangeCallback: ((sceneId: string | null) => void) | null = null
  private transitionCallback: ((phase: 'out' | 'in', ms: number) => void) | null = null
  private transitionTimer: ReturnType<typeof setTimeout> | null = null
  private cameraTween: Tween<{ x: number; z: number; f: number }> | null = null
  private playbackSpeed: number = 1
  /** Steps may move the camera. Off means the view is yours. */
  private cameraFollow: boolean = true
  private timing: Timing = DEFAULT_TIMING
  /**
   * Pixels of the canvas hidden behind fixed chrome on the right — the step
   * sidebar sits over the diagram rather than beside it, so the canvas is wider
   * than the part you can see. Without accounting for it every flow composes
   * half the sidebar's width right of centre, and a wide one runs underneath.
   */
  private viewportInset = 0
  private pipeLabelEditCallback: ((connectionId: string, current: string) => void) | null = null
  private commitCallback: ((actions: FlowAction[]) => void) | null = null
  private pipeLabelHoverCallback: ((connectionId: string | null) => void) | null = null
  private hoverPipeLabel:  string | null = null
  // ── Placing / connecting ──
  private mode:            SceneMode = { kind: 'select' }
  private placeGhost:      THREE.Mesh | null = null
  private placeCallback:   ((what: 'component' | 'zone', cell: { col: number; row: number }) => void) | null = null
  private connectCallback: ((from: string, to: string) => void) | null = null
  private modeCallback:    ((mode: SceneMode) => void) | null = null
  private dragWaypoint:    { connId: string; index: number; mesh: THREE.Mesh } | null = null
  private zoneLabelEditCallback: ((zoneId: string, current: string) => void) | null = null
  private componentSelectCallback: ((componentId: string) => void) | null = null
  cameraTarget:   THREE.Vector3
  currentFrustum: number
  overlayBridge:  OverlayBridge

  constructor(canvas: HTMLCanvasElement, graph: InternalGraph) {
    super(canvas)

    this.lights = setupLighting(this.scene, this.currentTheme)

    // Build scene objects — pass theme so grid uses correct colors from first frame
    this.grid = new GridFloor(this.scene, this.currentTheme)

    // Overlay bridge + hover system exist before the layers, which register with them
    this.overlayBridge = new OverlayBridge(this.camera, this.renderer)
    this.hoverSystem = new HoverSystem(canvas, this.camera, () => {})

    // One layer per scene: the flow itself plus every nested component.detail.
    // Only the root is visible until a step names another scene.
    this.rootLayer = new SceneLayer(
      this.scene,
      graph,
      null,
      this.currentTheme,
      this.renderer.capabilities.getMaxAnisotropy(),
      {
        addHoverTarget:    mesh => this.hoverSystem.addTarget(mesh),
        removeHoverTarget: mesh => this.hoverSystem.removeTarget(mesh),
        onPacketArrival:   id   => this.packetArrivalCallback?.(id),
      },
    )
    this.layer = this.rootLayer
    for (const l of this.rootLayer.flatten()) this.layers.set(l.id, l)
    for (const mesh of this.layer.hoverTargets()) this.hoverSystem.addTarget(mesh)

    this.overviewTarget  = this.layer.overviewTarget.clone()
    this.overviewFrustum = this.overviewFrustumOf(this.layer)
    this.cameraTarget    = this.overviewTarget.clone()
    this.currentFrustum  = this.overviewFrustum
    const frustumNeeded  = this.overviewFrustum

    // Position camera at overview
    const t = this.overviewTarget
    this.camera.position.set(t.x + CAMERA_HEIGHT, CAMERA_HEIGHT, t.z + CAMERA_HEIGHT)
    this.camera.lookAt(t)
    const aspect = canvas.clientWidth / canvas.clientHeight || 1
    this.camera.left   = -frustumNeeded * aspect
    this.camera.right  =  frustumNeeded * aspect
    this.camera.top    =  frustumNeeded
    this.camera.bottom = -frustumNeeded
    this.camera.updateProjectionMatrix()

    // Apply initial theme to renderer before the first frame is drawn
    this.renderer.setClearColor(THEME_COLORS[this.currentTheme].clearColor)

    canvas.addEventListener('wheel',        this.onWheel,       { passive: false })
    canvas.addEventListener('pointerdown',  this.onPointerDown)
    canvas.addEventListener('pointermove',  this.onPointerMove)
    canvas.addEventListener('pointerup',    this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerUp)
    canvas.addEventListener('contextmenu',  this.onContextMenu)
    canvas.style.cursor = 'grab'
    this.startLoop()
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    // Whatever the step wanted, you are holding the controls now.
    this.cameraTween?.stop()
    const factor = e.deltaY > 0 ? WHEEL_ZOOM_OUT : WHEEL_ZOOM_IN
    const next = Math.min(
      Math.max(this.currentFrustum * factor, this.overviewFrustum * FRUSTUM_MIN_RATIO),
      this.overviewFrustum * FRUSTUM_MAX_RATIO
    )
    this.currentFrustum = next
    const aspect = this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight || 1
    this.camera.left   = -next * aspect
    this.camera.right  =  next * aspect
    this.camera.top    =  next
    this.camera.bottom = -next
    this.camera.updateProjectionMatrix()
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return

    // Placing and connecting take the whole canvas: while either is armed, a
    // press means "here" or "this one", never a drag or a pan.
    if (this.editMode && this.mode.kind === 'place') {
      // Read what is being placed before disarming — `setMode` overwrites it.
      const what = this.mode.what
      const cell = this.pointerToCell(e.clientX, e.clientY)
      this.setMode({ kind: 'select' })
      this.placeCallback?.(what, cell)
      return
    }
    if (this.editMode && this.mode.kind === 'connect') {
      const id = this.pickComponent(e.clientX, e.clientY)
      if (!id) return
      if (!this.mode.from) {
        this.setMode({ kind: 'connect', from: id })
        this.components.get(id)?.setEditHover(true)
        return
      }
      const from = this.mode.from
      this.components.get(from)?.setEditHover(false)
      this.setMode({ kind: 'select' })
      // A pipe from something to itself renders as nothing useful.
      if (id !== from) this.connectCallback?.(from, id)
      return
    }

    // Edit mode: waypoints, then zone handles, then components; empty space pans.
    if (this.editMode) {
      this.clearEditHover()
      const wp = this.pickWaypointHandle(e.clientX, e.clientY)
      if (wp) {
        this.dragWaypoint = {
          connId: wp.userData.connId as string,
          index:  wp.userData.waypointIndex as number,
          mesh:   wp as THREE.Mesh,
        }
        this.dragPointerId = e.pointerId
        this.renderer.domElement.setPointerCapture(e.pointerId)
        this.renderer.domElement.style.cursor = 'grabbing'
        return
      }

      const labelHandle = this.pickLabelHandle(e.clientX, e.clientY)
      if (labelHandle) {
        const connId = labelHandle.userData.connId as string
        const conn = this.graph.connections.get(connId)
        this.pipeLabelEditCallback?.(connId, conn?.label ?? '')
        return
      }

      const handle = this.pickZoneHandle(e.clientX, e.clientY)
      if (handle) {
        const zr = this.zoneById.get(handle.userData.zoneId as string) ?? null
        this.dragPointerId = e.pointerId
        this.renderer.domElement.setPointerCapture(e.pointerId)
        if (handle.userData.zoneMove) {
          if (zr) this.beginZoneMove(zr, e.clientX, e.clientY)
          this.renderer.domElement.style.cursor = 'move'
        } else {
          this.resizeZone   = zr
          this.resizeCorner = handle.userData.zoneCorner as ZoneCorner
          this.renderer.domElement.style.cursor = 'nwse-resize'
        }
        return
      }

      const labelZoneId = this.pickZoneLabel(e.clientX, e.clientY)
      if (labelZoneId) {
        const zr = this.zoneById.get(labelZoneId)
        if (zr) this.zoneLabelEditCallback?.(labelZoneId, zr.zone.label)
        return
      }

      const id = this.pickComponent(e.clientX, e.clientY)
      if (id) {
        const cm = this.components.get(id)!
        const icForDrag = this.graph.components.get(id)!
        this.dragW         = icForDrag.meshSize.x / (CELL_SIZE * COMPONENT_GAP)
        this.dragH         = icForDrag.meshSize.z / (CELL_SIZE * COMPONENT_GAP)
        this.dragId        = id
        this.dragGroup     = cm.group
        this.dragPointerId = e.pointerId
        cm.cancelEditHover()
        this.dragOriginY   = cm.baseY
        this.dragMoved     = false
        this.dragStartClient.set(e.clientX, e.clientY)
        const ground = this.pointerToGround(e.clientX, e.clientY)
        this.dragOffset.set(cm.group.position.x - ground.x, cm.group.position.z - ground.z)
        this.renderer.domElement.setPointerCapture(e.pointerId)
        this.renderer.domElement.style.cursor = 'grabbing'
        return
      }
    }

    this.isPanning = true
    this.panLast.set(e.clientX, e.clientY)
    this.renderer.domElement.style.cursor = 'grabbing'
  }

  private onPointerMove = (e: PointerEvent): void => {
    // Waypoint drag
    if (this.dragWaypoint) {
      const ground = this.pointerToGround(e.clientX, e.clientY)
      this.setWaypoint(this.dragWaypoint, ground.x / CELL_SIZE, ground.z / CELL_SIZE)
      return
    }

    // Whole-zone move
    if (this.moveGrabbed) {
      const ground = this.pointerToGround(e.clientX, e.clientY)
      this.applyZoneMove(ground.x - this.moveStart.x, ground.z - this.moveStart.z)
      return
    }

    // Zone corner resize
    if (this.resizeZone && this.resizeCorner) {
      const ground = this.pointerToGround(e.clientX, e.clientY)
      // Stop at the grid origin while dragging, not on release. `snapZoneToGrid`
      // clamps the committed bounds to zero either way, so without this the zone
      // follows the pointer into negative space and then springs back the moment
      // you let go — which reads as the whole resize being rejected. Zones that
      // start at col 0 or row 0 could never be resized outward at all.
      const x = Math.max(0, ground.x)
      const z = Math.max(0, ground.z)
      // Dragging a corner past its opposite edge flips which corner is held.
      this.resizeCorner = applyZoneCorner(this.resizeZone.zone, this.resizeCorner, x, z)
      this.resizeZone.rebuild()
      return
    }

    // Edit-mode drag takes priority over panning
    if (this.dragId && this.dragGroup) {
      if (!this.dragMoved) {
        const dist = Math.hypot(e.clientX - this.dragStartClient.x, e.clientY - this.dragStartClient.y)
        if (dist < DRAG_THRESHOLD_PX) return  // sub-threshold: treat as a click, don't move yet
        this.dragMoved = true
        this.dragGroup.position.y = this.dragOriginY + DRAG_LIFT  // lift on first real movement
      }
      const ground = this.pointerToGround(e.clientX, e.clientY)
      this.dragGroup.position.x = ground.x + this.dragOffset.x
      this.dragGroup.position.z = ground.z + this.dragOffset.y

      // Sync InternalComponent center with live mesh position for pipe rebuild
      const id = this.dragId!
      const ic = this.graph.components.get(id)!
      const gx = this.dragGroup.position.x
      const gz = this.dragGroup.position.z
      ic.center.set(gx, 0, gz)
      ic.topCenter.set(gx, ic.meshSize.y, gz)

      // Live-rebuild all pipes connected to the dragged component
      for (const [connId, conn] of this.graph.connections) {
        if (conn.from.id === id || conn.to.id === id) this.pipes.get(connId)?.update()
      }

      // Show/update ghost box at the snapped target position
      if (!this.dragGhost) {
        const geo = new THREE.BoxGeometry(ic.meshSize.x, 0.05, ic.meshSize.z)
        const mat = new THREE.MeshBasicMaterial({ color: 0x4488ff, wireframe: true, transparent: true, opacity: 0.8 })
        this.dragGhost = new THREE.Mesh(geo, mat)
        this.scene.add(this.dragGhost)
      }
      const { cx: snapX, cz: snapZ } = this.computeSnap(gx, gz, this.dragW, this.dragH)
      this.dragGhost.position.set(snapX, 0.05, snapZ)
      return
    }

    if (this.editMode && this.mode.kind === 'place') {
      this.updateGhost(this.pointerToCell(e.clientX, e.clientY))
      return
    }
    if (this.editMode && this.mode.kind === 'connect') {
      // Only components can be joined, so only they light up while connecting.
      const id = this.pickComponent(e.clientX, e.clientY)
      this.setEditHover(null, id ?? this.mode.from ?? null, id ? 'crosshair' : 'default')
      return
    }

    // Nothing is being dragged: show what a press would grab. Doing this on the
    // same pick order as onPointerDown is what makes the highlight honest —
    // whatever lights up is what you would actually get.
    if (this.editMode && !this.isPanning) {
      this.updateEditHover(e.clientX, e.clientY)
      return
    }

    if (!this.isPanning) return
    this.cameraTween?.stop()
    const dx = e.clientX - this.panLast.x
    const dy = e.clientY - this.panLast.y
    this.panLast.set(e.clientX, e.clientY)
    if (dx === 0 && dy === 0) return

    const el     = this.renderer.domElement
    const scaleX = (this.camera.right - this.camera.left) / el.clientWidth
    const scaleY = (this.camera.top   - this.camera.bottom) / el.clientHeight

    // Camera right/up in world space, projected onto XZ so panning stays on the ground plane
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const up    = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    right.y = 0
    up.y    = 0

    // `right` is already horizontal and unit-length, so a pixel of horizontal drag
    // maps 1:1. `up` loses length when flattened onto XZ (the camera looks down at
    // ~35°), so dividing by that squared length restores the same rate — without it
    // vertical panning drifts behind the cursor at ~1/3 speed.
    const offset = new THREE.Vector3()
    offset.addScaledVector(right, -dx * scaleX)
    offset.addScaledVector(up,     dy * scaleY / up.lengthSq())

    this.cameraTarget.add(offset)
    this.camera.position.add(offset)
    this.camera.lookAt(this.cameraTarget)
    this.camera.updateProjectionMatrix()
  }

  private onPointerUp = (): void => {
    if (this.dragWaypoint) {
      const conn = this.graph.connections.get(this.dragWaypoint.connId)
      if (conn && conn.route !== 'auto') {
        const wp = conn.route[this.dragWaypoint.index]
        // Commit on whole cells, same as a component drop.
        this.setWaypoint(this.dragWaypoint, Math.round(wp.col), Math.round(wp.row))
        this.commit([this.routeAction(this.dragWaypoint.connId)])
      }
      this.dragWaypoint = null
      if (this.dragPointerId !== null) {
        try { this.renderer.domElement.releasePointerCapture(this.dragPointerId) } catch { /* already released */ }
        this.dragPointerId = null
      }
      this.renderer.domElement.style.cursor = this.editMode ? 'move' : 'grab'
      return
    }
    if (this.moveGrabbed) {
      this.endZoneMove()
      return
    }
    if (this.resizeZone) {
      snapZoneToGrid(this.resizeZone.zone)
      this.resizeZone.rebuild()
      this.growGridToZones()
      this.commit([
        {
          type:   'zone/setBounds',
          scene:  this.activeSceneId,
          id:     this.resizeZone.zone.id,
          bounds: zoneGridBounds(this.resizeZone.zone),
        },
        this.gridAction(),
      ])
      this.resizeZone   = null
      this.resizeCorner = null
      if (this.dragPointerId !== null) {
        try { this.renderer.domElement.releasePointerCapture(this.dragPointerId) } catch { /* already released */ }
        this.dragPointerId = null
      }
      this.renderer.domElement.style.cursor = this.editMode ? 'move' : 'grab'
      return
    }
    if (this.dragId) {
      this.endDrag()
      return
    }
    this.isPanning = false
    this.clearEditHover()
  }

  /** Highlight (and set the cursor for) whichever edit target is under the pointer. */
  private updateEditHover(clientX: number, clientY: number): void {
    const wp = this.pickWaypointHandle(clientX, clientY)
    if (wp) return this.setEditHover(wp as THREE.Mesh, null, 'grab')

    const zoneHandle = this.pickZoneHandle(clientX, clientY)
    if (zoneHandle) {
      const cursor = zoneHandle.userData.zoneMove ? 'move' : 'nwse-resize'
      return this.setEditHover(zoneHandle as THREE.Mesh, null, cursor)
    }

    const labelPad = this.pickLabelHandle(clientX, clientY)
    if (labelPad) return this.setEditHover(labelPad as THREE.Mesh, null, 'text')

    const zoneLabelId = this.pickZoneLabel(clientX, clientY)
    if (zoneLabelId) {
      const chip = this.zoneById.get(zoneLabelId)?.labelMesh ?? null
      return this.setEditHover(chip, null, 'text')
    }

    const componentId = this.pickComponent(clientX, clientY)
    if (componentId) return this.setEditHover(null, componentId, 'grab')

    this.setEditHover(null, null, 'move')
  }

  private setEditHover(
    handle: THREE.Mesh | null,
    componentId: string | null,
    cursor: string,
  ): void {
    if (handle !== this.hoverHandle) {
      // Same treatment as components: an outline, not a size or colour change,
      // so a handle always shows its true position and hit area.
      if (this.hoverHandle) setHoverOutline(this.hoverHandle, false)
      if (handle) {
        setHoverOutline(handle, true)
        setHoverOutlineScale(handle, this.worldUnitsPerPixel())
      }
      this.hoverHandle = handle

      // A label pad is the one handle whose highlight lives in the DOM, on the
      // chip above it — derived from the handle rather than passed in, so every
      // caller of setEditHover gets it right for free.
      const u = handle?.userData as { connId?: string; waypointIndex?: number } | undefined
      const pipeLabel = u?.connId !== undefined && u.waypointIndex === undefined ? u.connId : null
      if (pipeLabel !== this.hoverPipeLabel) {
        this.hoverPipeLabel = pipeLabel
        this.pipeLabelHoverCallback?.(pipeLabel)
      }
    }

    if (componentId !== this.hoverComponent) {
      if (this.hoverComponent && this.hoverComponent !== this.dragId) {
        this.components.get(this.hoverComponent)?.setEditHover(false)
      }
      if (componentId) {
        const cm = this.components.get(componentId)
        cm?.setEditHover(true)
        cm?.updateEditHoverScale(this.worldUnitsPerPixel())
      }
      this.hoverComponent = componentId
    }

    this.renderer.domElement.style.cursor = cursor
  }

  /** Drop any hover styling — on leaving edit mode, or when a drag takes over. */
  private clearEditHover(): void {
    this.setEditHover(null, null, this.editMode ? 'move' : 'grab')
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    if (!this.editMode) return
    const hit = this.pickWaypointHandle(e.clientX, e.clientY)
    if (hit) this.deleteWaypoint(hit.userData.connId as string, hit.userData.waypointIndex as number)
  }

  // ── Waypoints ─────────────────────────────────────────────────────────────

  private pickLabelHandle(clientX: number, clientY: number): THREE.Object3D | null {
    const meshes = this.labelHandles.filter(h => h.visible)
    if (!meshes.length) return null
    this.dragRay.setFromCamera(this.clientToNdc(clientX, clientY), this.camera)
    const hits = this.dragRay.intersectObjects(meshes as THREE.Object3D[], false)
    return hits.length ? hits[0].object : null
  }

  private pickWaypointHandle(clientX: number, clientY: number): THREE.Object3D | null {
    const meshes = this.waypointHandles.filter(h => h.visible)
    if (!meshes.length) return null
    this.dragRay.setFromCamera(this.clientToNdc(clientX, clientY), this.camera)
    const hits = this.dragRay.intersectObjects(meshes as THREE.Object3D[], false)
    return hits.length ? hits[0].object : null
  }

  private setWaypoint(
    drag: { connId: string; index: number; mesh: THREE.Mesh },
    col:  number,
    row:  number,
  ): void {
    const conn = this.graph.connections.get(drag.connId)
    if (!conn || conn.route === 'auto') return
    conn.route[drag.index] = { col, row }
    drag.mesh.position.copy(gridToWorld(col, row).setY(WAYPOINT_HANDLE_Y))
    this.pipes.get(drag.connId)?.update()
  }

  private deleteWaypoint(connId: string, index: number): void {
    const conn = this.graph.connections.get(connId)
    if (!conn) return
    conn.route = removeWaypoint(conn.route, index)
    this.pipes.get(connId)?.update()
    this.layer.buildWaypointHandles()   // indices shift, so rebuild rather than patch
    this.commit([this.routeAction(connId)])
  }

  private routeAction(connId: string): FlowAction {
    return {
      type:  'connection/setRoute',
      scene: this.activeSceneId,
      id:    connId,
      // The reducer copies it — this array keeps being mutated as you drag.
      route: this.graph.connections.get(connId)?.route ?? 'auto',
    }
  }

  // ── Edit-mode drag helpers ────────────────────────────────────────────────

  setEditMode(enabled: boolean): void {
    this.editMode = enabled
    if (!enabled) this.setMode({ kind: 'select' })
    // Leaving edit mode mid-drag commits the in-progress move rather than orphaning state.
    if (!enabled && this.dragId) this.endDrag()
    this.layer.setEditMode(enabled)
    this.renderer.domElement.style.cursor = enabled ? 'move' : 'grab'
  }

  /**
   * Called with the edits a finished gesture made, in flow-definition terms.
   *
   * The scene mutates its own graph while you drag so rendering stays at frame
   * rate; this fires once at the end, and is how an edit reaches the file. One
   * gesture can touch several objects — moving a zone carries its components —
   * hence a batch.
   */
  setEditCommitCallback(fn: (actions: FlowAction[]) => void): void {
    this.commitCallback = fn
  }

  private commit(actions: FlowAction[]): void {
    if (actions.length) this.commitCallback?.(actions)
  }

  /** Where a component ended up, as the file records it. */
  private componentPositionAction(id: string): FlowAction | null {
    const ic = this.graph.components.get(id)
    if (!ic) return null
    return {
      type:     'component/setPosition',
      scene:    this.activeSceneId,
      id,
      position: componentGridPosition(ic),
    }
  }

  /** Emitted after a zone edit: the grid grows to cover zones dragged past its
   *  edge, and that growth has to reach the file or the layout won't reload. */
  private gridAction(): FlowAction {
    return {
      type:  'layout/setGrid',
      scene: this.activeSceneId,
      grid:  gridFromBounds(this.graph.gridBounds),
    }
  }

  /** Called when a component is clicked (not dragged) in edit mode. */
  setComponentSelectCallback(fn: (componentId: string) => void): void {
    this.componentSelectCallback = fn
  }

  /** Apply an edit-mode config change to one component and rebuild its mesh. */
  /**
   * Apply a component patch to the meshes and nothing else.
   *
   * Deliberately does not commit: this is the inspector's live preview, and a
   * commit per keystroke would fill the undo stack with half-chosen colours and
   * leave the definition holding an edit the user then cancelled. The form
   * commits once, on Apply.
   */
  previewComponent(id: string, patch: ComponentPatch): void {
    this.layer.rebuildComponent(id, patch)
  }

  /** Rename a connection; PipeLabels renders the text, this keeps the model in sync. */
  renameConnection(connectionId: string, label: string): void {
    const conn = this.graph.connections.get(connectionId)
    if (!conn) return
    conn.label = label
    this.commit([{ type: 'connection/setLabel', scene: this.activeSceneId, id: connectionId, label }])
  }

  /** Called when a pipe's label chip is clicked in edit mode. */
  setPipeLabelEditCallback(fn: (connectionId: string, current: string) => void): void {
    this.pipeLabelEditCallback = fn
  }

  /**
   * Called with the connection whose label pad is hovered, or null.
   *
   * The pad's own ring is invisible in practice: the label the user sees is an
   * HTML chip on the overlay, painted over the canvas and wider than the pad
   * beneath it. So the highlight has to be applied to the chip, in CSS.
   */
  setPipeLabelHoverCallback(fn: (connectionId: string | null) => void): void {
    this.pipeLabelHoverCallback = fn
  }

  /** Called when a zone label is clicked in edit mode; the app supplies the rename UI. */
  setZoneLabelEditCallback(fn: (zoneId: string, current: string) => void): void {
    this.zoneLabelEditCallback = fn
  }

  renameZone(zoneId: string, label: string): void {
    const zr = this.zoneById.get(zoneId)
    if (!zr) return
    zr.setLabel(label)
    this.commit([{ type: 'zone/setLabel', scene: this.activeSceneId, id: zoneId, label }])
  }

  /** Raycast the visible zone corner handles; returns the topmost hit or null. */
  private pickZoneHandle(clientX: number, clientY: number): THREE.Object3D | null {
    const meshes: THREE.Object3D[] = []
    for (const z of this.zones) for (const h of z.handles) if (h.visible) meshes.push(h)
    if (!meshes.length) return null
    this.dragRay.setFromCamera(this.clientToNdc(clientX, clientY), this.camera)
    const hits = this.dragRay.intersectObjects(meshes, false)
    return hits.length ? hits[0].object : null
  }

  /** Raycast the zone label chips; returns the topmost zone id or null. */
  private pickZoneLabel(clientX: number, clientY: number): string | null {
    this.dragRay.setFromCamera(this.clientToNdc(clientX, clientY), this.camera)
    const hits = this.dragRay.intersectObjects(this.zones.map(z => z.labelMesh), false)
    return hits.length ? (hits[0].object.userData.zoneId as string) : null
  }

  private clientToNdc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width)  * 2 - 1,
      -((clientY - rect.top)  / rect.height) * 2 + 1,
    )
  }

  /** Raycast the component hit meshes; returns the topmost component id or null. */
  private pickComponent(clientX: number, clientY: number): string | null {
    this.dragRay.setFromCamera(this.clientToNdc(clientX, clientY), this.camera)
    const meshes: THREE.Object3D[] = []
    for (const cm of this.components.values()) meshes.push(cm.hitMesh)
    const hits = this.dragRay.intersectObjects(meshes, false)
    return hits.length ? (hits[0].object.userData.componentId as string) : null
  }

  /** Project a screen pointer onto the y=0 ground plane. Camera always looks
   *  down at an angle, so ray.direction.y is non-zero and the solve is stable. */
  private pointerToGround(clientX: number, clientY: number): THREE.Vector3 {
    this.dragRay.setFromCamera(this.clientToNdc(clientX, clientY), this.camera)
    const ray = this.dragRay.ray
    const t   = -ray.origin.y / ray.direction.y
    return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t))
  }

  // ── Whole-zone move ───────────────────────────────────────────────────────

  /** Snapshot the zone (plus any nested child zones) and every component sitting
   *  inside it, so the drag can be applied as a single delta off the originals. */
  private beginZoneMove(zr: ZoneRenderer, clientX: number, clientY: number): void {
    this.moveGrabbed = true
    this.moveStart.copy(this.pointerToGround(clientX, clientY))

    const moved = [zr, ...this.descendantZones(zr.zone.id)]
    this.moveZoneSnapshot = moved.map(z => ({
      zr:  z,
      min: z.zone.min.clone(),
      max: z.zone.max.clone(),
    }))
    this.moveCompSnapshot = componentsInZone(this.graph, zr.zone).map(id => ({
      id,
      center: this.graph.components.get(id)!.center.clone(),
    }))
  }

  private descendantZones(parentId: string): ZoneRenderer[] {
    const out = this.zones.filter(z => z.zone.parentId === parentId)
    return out.flatMap(z => [z, ...this.descendantZones(z.zone.id)])
  }

  private applyZoneMove(dx: number, dz: number): void {
    // Stop at the origin, for the same reason a resize does — but here it also
    // protects the contents: the grip carries the zone's components with it, and
    // a component dragged to a negative cell can't be dragged back, because a
    // component drag clamps itself to the grid.
    let minX = Infinity
    let minZ = Infinity
    for (const snap of this.moveZoneSnapshot) {
      minX = Math.min(minX, snap.min.x)
      minZ = Math.min(minZ, snap.min.z)
    }
    ;({ dx, dz } = clampZoneDelta(minX, minZ, dx, dz))

    for (const snap of this.moveZoneSnapshot) {
      snap.zr.zone.min.set(snap.min.x + dx, snap.min.y, snap.min.z + dz)
      snap.zr.zone.max.set(snap.max.x + dx, snap.max.y, snap.max.z + dz)
      snap.zr.rebuild()
    }
    for (const snap of this.moveCompSnapshot) {
      const ic = this.graph.components.get(snap.id)!
      const cm = this.components.get(snap.id)!
      ic.center.set(snap.center.x + dx, 0, snap.center.z + dz)
      ic.topCenter.set(ic.center.x, ic.meshSize.y, ic.center.z)
      cm.topCenter.copy(ic.topCenter)
      cm.group.position.x = ic.center.x
      cm.group.position.z = ic.center.z
    }
    // Cheap enough to rebuild every pipe — a moved zone can touch most of them.
    for (const pipe of this.pipes.values()) pipe.update()
  }

  private endZoneMove(): void {
    const first = this.moveZoneSnapshot[0]
    if (first) {
      // Commit on whole cells so zone and components stay grid-aligned.
      this.applyZoneMove(
        snapDelta(first.zr.zone.min.x - first.min.x),
        snapDelta(first.zr.zone.min.z - first.min.z),
      )
      this.growGridToZones()

      // The grip moves the zone, every zone nested inside it, and every
      // component standing on it — all of that has to reach the file, or a
      // reload puts the components back where the zone used to be.
      const actions: FlowAction[] = this.moveZoneSnapshot.map((snap) => ({
        type:   'zone/setBounds',
        scene:  this.activeSceneId,
        id:     snap.zr.zone.id,
        bounds: zoneGridBounds(snap.zr.zone),
      }))
      for (const snap of this.moveCompSnapshot) {
        const moved = this.componentPositionAction(snap.id)
        if (moved) actions.push(moved)
      }
      actions.push(this.gridAction())
      this.commit(actions)
    }
    this.moveGrabbed      = false
    this.moveZoneSnapshot = []
    this.moveCompSnapshot = []
    if (this.dragPointerId !== null) {
      try { this.renderer.domElement.releasePointerCapture(this.dragPointerId) } catch { /* already released */ }
      this.dragPointerId = null
    }
    this.renderer.domElement.style.cursor = this.editMode ? 'move' : 'grab'
  }

  /** A component drop is clamped to gridBounds, so a zone stretched past the
   *  grid edge would be unreachable. Grow the bounds (and the floor) to cover
   *  every zone. Grow only — shrinking could strand components off-grid. */
  private growGridToZones(): void {
    const b = this.graph.gridBounds
    let { maxX, maxZ } = b
    for (const z of this.zones) {
      maxX = Math.max(maxX, z.zone.max.x)
      maxZ = Math.max(maxZ, z.zone.max.z)
    }
    b.maxX = maxX
    b.maxZ = maxZ
  }

  /** Compute the snapped grid position from a raw center (world coords). */
  private computeSnap(centerX: number, centerZ: number, w: number, h: number): { col: number; row: number; cx: number; cz: number } {
    const cols = this.graph.gridBounds.maxX / CELL_SIZE
    const rows = this.graph.gridBounds.maxZ / CELL_SIZE
    const raw  = worldToGrid(centerX - (w / 2) * CELL_SIZE, centerZ - (h / 2) * CELL_SIZE)
    const col  = Math.min(Math.max(raw.col, 0), Math.max(0, Math.round(cols - w)))
    const row  = Math.min(Math.max(raw.row, 0), Math.max(0, Math.round(rows - h)))
    return { col, row, cx: (col + w / 2) * CELL_SIZE, cz: (row + h / 2) * CELL_SIZE }
  }

  private endDrag(): void {
    const id    = this.dragId
    const group = this.dragGroup
    if (id && group && this.dragMoved) {
      const cm = this.components.get(id)!
      const ic = this.graph.components.get(id)!

      // Snap to nearest grid cell
      const { cx, cz } = this.computeSnap(group.position.x, group.position.z, this.dragW, this.dragH)

      // Commit snapped position to model and mesh
      ic.center.set(cx, 0, cz)
      ic.topCenter.set(cx, ic.meshSize.y, cz)
      cm.topCenter.set(cx, ic.meshSize.y, cz)
      group.position.set(cx, this.dragOriginY, cz)

      // Final pipe rebuild at snapped position
      for (const [connId, conn] of this.graph.connections) {
        if (conn.from.id === id || conn.to.id === id) this.pipes.get(connId)?.update()
      }

      const moved = this.componentPositionAction(id)
      if (moved) this.commit([moved])

      // Brief scale-bounce to signal the snap commit
      new Tween({ t: 0 }, tweenGroup)
        .to({ t: 1 }, 300)
        .onUpdate(({ t }) => { group.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.1) })
        .onComplete(() => { group.scale.setScalar(1.0) })
        .start()
    } else if (group) {
      group.position.y = this.dragOriginY
      // Pressed without moving — that's a click: open the component's editor.
      if (id) this.componentSelectCallback?.(id)
    }
    this.clearDrag()
  }

  private clearDrag(): void {
    if (this.dragPointerId !== null) {
      try { this.renderer.domElement.releasePointerCapture(this.dragPointerId) } catch { /* already released */ }
    }
    if (this.dragGhost) {
      this.scene.remove(this.dragGhost)
      this.dragGhost.geometry.dispose()
      ;(this.dragGhost.material as THREE.Material).dispose()
      this.dragGhost = null
    }
    this.dragId        = null
    this.dragGroup     = null
    this.dragPointerId = null
    this.dragMoved     = false
    this.renderer.domElement.style.cursor = this.editMode ? 'move' : 'grab'
  }

  setHoverCallback(fn: (id: string | null) => void): void {
    this.hoverSystem.setOnHoverChange(fn)
  }

  setPacketArrivalCallback(fn: (targetId: string) => void): void {
    this.packetArrivalCallback = fn
  }

  /** Playback speed from the controls. Scales every animation, not just the step
   *  interval — otherwise a 4x walkthrough clips every packet mid-flight. */
  /** The flow's own pace. Fans out to every layer, including ones not on screen,
   *  so a scene entered later doesn't start at the previous flow's tempo. */
  setTiming(timing: Timing): void {
    this.timing = timing
    for (const l of this.layers.values()) l.setTiming(timing)
  }

  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = Math.max(0.1, speed)
    for (const l of this.layers.values()) l.setSpeed(this.playbackSpeed)
  }

  setTheme(theme: Theme): void {
    this.currentTheme = theme
    setHoverOutlineTheme(theme)
    this.renderer.setClearColor(THEME_COLORS[theme].clearColor)
    updateLighting(this.lights, theme)
    this.grid.setTheme(theme)
    for (const l of this.layers.values()) l.setTheme(theme)
  }

  applyStep(step: Step, _prevStep: Step | null, durationMs: number): void {
    const target = this.layers.get(step.scene ?? null) ?? this.rootLayer
    if (target === this.layer) {
      target.applyStep(step, durationMs)
      this.applyStepCamera(step, durationMs)
      return
    }
    // Hold the step back until the layers have swapped, or its packets would be
    // halfway down their pipes by the time the new scene is revealed.
    this.enterLayer(target, durationMs, () => {
      target.applyStep(step, durationMs)
      this.applyStepCamera(step, durationMs)
    })
  }

  /**
   * Move the camera for a step that asks for it.
   *
   * Only steps naming a component move the view. This behaviour was removed
   * once before for being disruptive, and the reason is visible in the flows:
   * as many steps carry `"focus": null` as name something, and treating that as
   * "snap back to the overview" meant the camera lurched on almost every step
   * and fought any panning you did. Here, `null` and a missing camera both mean
   * "leave it alone" — the view stays where the last step, or you, put it.
   */
  private applyStepCamera(step: Step, durationMs: number): void {
    if (!this.cameraFollow) return

    // `fit` is how a step asks for the whole scene back. Without it there is no
    // way to undo an earlier focus, since both a missing camera and an explicit
    // `focus: null` deliberately leave the view where it is.
    if (step.camera?.fit) {
      this.tweenCamera(
        this.layer.overviewTarget.clone(),
        this.overviewFrustumOf(this.layer),
        durationMs,
      )
      return
    }

    const focus = step.camera?.focus
    if (!focus) return

    const component = this.graph.components.get(focus)
    if (!component) return

    // zoom is a magnification of the scene's own overview framing, so the same
    // value means the same thing in a big flow and a small one.
    const zoom = step.camera?.zoom
    const frustum = zoom ? this.overviewFrustumOf(this.layer) / zoom : this.currentFrustum
    this.tweenCamera(component.center.clone(), frustum, durationMs)
  }

  /**
   * Whether steps are allowed to move the camera.
   *
   * Turning it off leaves you free to pan and zoom around a flow while it plays
   * without every step snatching the view back.
   */
  setCameraFollow(enabled: boolean): void {
    this.cameraFollow = enabled
    if (!enabled) this.cameraTween?.stop()
  }

  // ── Placing and connecting ────────────────────────────────────────────────

  /**
   * What a press on the canvas means.
   *
   * Everything the pointer does used to be inferred from what was under it.
   * Adding "drop a new thing here" and "join these two" needs the opposite:
   * the target says nothing, the armed mode does.
   */
  setMode(mode: SceneMode): void {
    if (this.mode.kind === 'connect' && this.mode.from) {
      this.components.get(this.mode.from)?.setEditHover(false)
    }
    this.mode = mode
    this.clearEditHover()
    this.updateGhost()
    this.renderer.domElement.style.cursor =
      mode.kind === 'place'   ? 'copy'
      : mode.kind === 'connect' ? 'crosshair'
      : this.editMode ? 'move' : 'grab'
    this.modeCallback?.(mode)
  }

  get currentMode(): SceneMode {
    return this.mode
  }

  /** Called when a placement lands, with the grid cell that was clicked. */
  setPlaceCallback(fn: (what: 'component' | 'zone', cell: { col: number; row: number }) => void): void {
    this.placeCallback = fn
  }

  /** Called with the two ends of a new connection. */
  setConnectCallback(fn: (from: string, to: string) => void): void {
    this.connectCallback = fn
  }

  /** Called whenever the mode changes, including when the scene cancels it. */
  setModeCallback(fn: (mode: SceneMode) => void): void {
    this.modeCallback = fn
  }

  private pointerToCell(clientX: number, clientY: number): { col: number; row: number } {
    const ground = this.pointerToGround(clientX, clientY)
    return {
      col: Math.max(0, Math.floor(ground.x / CELL_SIZE)),
      row: Math.max(0, Math.floor(ground.z / CELL_SIZE)),
    }
  }

  /** A hollow box on the cell under the pointer, so a placement is aimed rather
   *  than guessed at. */
  private updateGhost(cell?: { col: number; row: number }): void {
    const placing = this.mode.kind === 'place'
    if (!placing) {
      if (this.placeGhost) {
        this.scene.remove(this.placeGhost)
        this.placeGhost.geometry.dispose()
        ;(this.placeGhost.material as THREE.Material).dispose()
        this.placeGhost = null
      }
      return
    }
    if (!this.placeGhost) {
      const geo = new THREE.BoxGeometry(CELL_SIZE * 0.9, 0.05, CELL_SIZE * 0.9)
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4488ff, wireframe: true, transparent: true, opacity: 0.9, depthTest: false,
      })
      this.placeGhost = new THREE.Mesh(geo, mat)
      this.placeGhost.renderOrder = 30
      this.scene.add(this.placeGhost)
    }
    if (cell) {
      this.placeGhost.position.set(
        (cell.col + 0.5) * CELL_SIZE,
        0.05,
        (cell.row + 0.5) * CELL_SIZE,
      )
    }
  }

  /**
   * The frustum that frames a layer in the canvas as it is right now.
   *
   * Half-height is what an orthographic camera takes, and the viewport's aspect
   * decides whether the grid's projected width or its height is the binding
   * constraint — so this can't be precomputed on the layer.
   */
  private overviewFrustumOf(layer: SceneLayer): number {
    const aspect = this.visibleAspect()
    return Math.max(layer.overviewHalfHeight, layer.overviewHalfWidth / aspect)
  }

  /** Aspect of the part of the canvas the user can actually see. */
  private visibleAspect(): number {
    const el = this.renderer.domElement
    const visible = Math.max(1, el.clientWidth - this.viewportInset)
    return visible / el.clientHeight || 1
  }

  /** How much chrome covers the right of the canvas. */
  setViewportInset(px: number): void {
    if (px === this.viewportInset) return
    this.viewportInset = px
    this.overviewFrustum = this.overviewFrustumOf(this.layer)
    this.applyCamera()
  }

  /** Which scene is on screen: null for the top level, else a component id. */
  get activeSceneId(): string | null {
    return this.layer.id
  }

  /**
   * Throw away every layer and rebuild from a fresh graph.
   *
   * Undo works on the flow definition, but the meshes were mutated directly by
   * whatever gesture is being undone — so rebuilding from the definition is the
   * only honest way to show the result. Camera, current scene and edit mode are
   * kept: an undo that also threw away where you were looking would be an edit
   * of its own.
   *
   * No fade, because nothing is meant to look like it moved.
   */
  reloadGraph(graph: InternalGraph, step: Step | null): void {
    const sceneId = this.activeSceneId
    const wasEditing = this.editMode

    // Anything holding a mesh has to let go before the meshes are disposed.
    this.clearEditHover()
    this.clearDrag()
    this.dragWaypoint = null
    this.resizeZone = null
    this.resizeCorner = null
    this.moveGrabbed = false
    this.moveZoneSnapshot = []
    this.moveCompSnapshot = []
    for (const mesh of this.layer.hoverTargets()) this.hoverSystem.removeTarget(mesh)

    this.rootLayer.dispose()
    this.layers.clear()

    this.rootLayer = new SceneLayer(
      this.scene,
      graph,
      null,
      this.currentTheme,
      this.renderer.capabilities.getMaxAnisotropy(),
      {
        addHoverTarget:    (mesh) => this.hoverSystem.addTarget(mesh),
        removeHoverTarget: (mesh) => this.hoverSystem.removeTarget(mesh),
        onPacketArrival:   (id)   => this.packetArrivalCallback?.(id),
      },
    )
    for (const l of this.rootLayer.flatten()) this.layers.set(l.id, l)

    // Back to the scene you were in, if it still exists after the edit.
    this.layer = this.layers.get(sceneId) ?? this.rootLayer
    for (const l of this.layers.values()) l.setVisible(l === this.layer)
    for (const mesh of this.layer.hoverTargets()) this.hoverSystem.addTarget(mesh)

    this.overviewTarget  = this.layer.overviewTarget.clone()
    this.overviewFrustum = this.overviewFrustumOf(this.layer)
    this.layer.setEditMode(wasEditing)
    this.layer.setSpeed(this.playbackSpeed)
    this.layer.setTiming(this.timing)

    // Straight to the layer: applyStep would try to transition into a scene we
    // are already standing in.
    if (step) this.layer.applyStep(step, 0)
    this.sceneChangeCallback?.(this.layer.id)
  }

  setSceneChangeCallback(fn: (sceneId: string | null) => void): void {
    this.sceneChangeCallback = fn
  }

  /** Drives the app's fade overlay: 'out' dims the view, 'in' brings it back. */
  setTransitionCallback(fn: (phase: 'out' | 'in', ms: number) => void): void {
    this.transitionCallback = fn
  }

  /**
   * Move to another scene. The view fades to the background colour, the layers
   * swap while it is covered, then it fades back on the new scene — a cut under
   * cover reads far calmer than watching one scene replace another. The camera
   * drifts inward through the fade and settles outward after it, so there is a
   * sense of travel without a visible jump.
   */
  private enterLayer(next: SceneLayer, durationMs: number, onSwapped: () => void): void {
    const prev = this.layer
    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer)
      this.transitionTimer = null
    }

    const swap = () => {
      prev.clearStepState()
      for (const mesh of prev.hoverTargets()) this.hoverSystem.removeTarget(mesh)
      prev.setEditMode(false)
      prev.setVisible(false)

      next.setVisible(true)
      for (const mesh of next.hoverTargets()) this.hoverSystem.addTarget(mesh)
      next.setEditMode(this.editMode)

      this.layer = next
      this.overviewTarget.copy(next.overviewTarget)
      this.overviewFrustum = this.overviewFrustumOf(next)
      this.sceneChangeCallback?.(next.id)
    }

    if (durationMs <= 0) {
      swap()
      this.cameraTarget.copy(next.overviewTarget)
      this.currentFrustum = this.overviewFrustumOf(next)
      this.applyCamera()
      onSwapped()
      return
    }

    // Which way we are travelling decides the shape of the move, so going out of
    // a scene looks like the reverse of going into it rather than the same dive.
    const ascending = next.depth < prev.depth
    const descending = next.depth > prev.depth

    // The component that owns the deeper of the two scenes: on the way down it
    // is what we dive into, on the way up it is what we pull back out of.
    const anchorId = ascending ? prev.id : next.id
    const anchorNow  = anchorId ? prev.graph.components.get(anchorId)?.center : undefined
    const anchorNext = anchorId ? next.graph.components.get(anchorId)?.center : undefined

    let outTarget  = this.cameraTarget.clone()
    let outFrustum = this.currentFrustum * 0.9
    let inTarget   = next.overviewTarget.clone()
    let inFrustum  = this.overviewFrustumOf(next) * 1.1

    if (descending) {
      // Push in towards the component being entered, then open up inside it.
      if (anchorNow) outTarget = anchorNow.clone()
      outFrustum = this.currentFrustum * SCENE_ZOOM_IN
      inFrustum  = this.overviewFrustumOf(next) * SCENE_SETTLE_WIDE
    } else if (ascending) {
      // Pull back out of the scene, then reappear tight on the component we were
      // inside and widen to the parent's framing — the descent, played backwards.
      outFrustum = this.currentFrustum * SCENE_ZOOM_OUT
      if (anchorNext) inTarget = anchorNext.clone()
      inFrustum  = this.overviewFrustumOf(next) * SCENE_SETTLE_TIGHT
    }

    const fade = Math.max(SCENE_FADE_MIN_MS / this.playbackSpeed, durationMs * SCENE_FADE_RATIO)

    const begin = () => {
      this.transitionCallback?.('out', fade)
      this.tweenCamera(outTarget, outFrustum, fade + SCENE_FADE_HOLD_MS)
      this.transitionTimer = setTimeout(afterFade, fade + SCENE_FADE_HOLD_MS)
    }

    const afterFade = () => {
      this.transitionTimer = null
      swap()

      // Enter on the far side of the move and settle to the new framing as the
      // curtain lifts: wide-then-in on the way down, tight-then-out on the way up.
      this.cameraTarget.copy(inTarget)
      this.currentFrustum = inFrustum
      this.applyCamera()

      onSwapped()
      this.transitionCallback?.('in', fade)
      this.tweenCamera(next.overviewTarget.clone(), this.overviewFrustumOf(next), fade * 1.4)
    }

    // Let the scene we are leaving finish what it was saying. Fading over a
    // packet still in flight — or an annotation that only just appeared — throws
    // the information away. Wait for the last packet to land plus a beat to read
    // it, capped so a long burst cannot stall the walkthrough.
    const inFlight = prev.remainingAnimationMs(performance.now())
    const lead = inFlight > 0
      ? Math.min(
          SCENE_EXIT_MAX_WAIT_MS / this.playbackSpeed,
          inFlight + SCENE_EXIT_PAD_MS / this.playbackSpeed,
        )
      : 0

    if (lead > 0) this.transitionTimer = setTimeout(begin, lead)
    else begin()
  }

  private tweenCamera(target: THREE.Vector3, frustum: number, ms: number, onDone?: () => void): void {
    this.cameraTween?.stop()
    const from = { x: this.cameraTarget.x, z: this.cameraTarget.z, f: this.currentFrustum }
    this.cameraTween = new Tween(from, tweenGroup)
      .to({ x: target.x, z: target.z, f: frustum }, ms)
      .easing(Easing.Quadratic.InOut)
      .onUpdate(({ x, z, f }) => {
        this.cameraTarget.set(x, 0, z)
        this.currentFrustum = f
        this.applyCamera()
      })
      .onComplete(() => { this.cameraTween = null; onDone?.() })
      .start()
  }

  /** Push cameraTarget / currentFrustum into the actual camera. */
  private applyCamera(): void {
    const el     = this.renderer.domElement
    const aspect = el.clientWidth / el.clientHeight || 1
    this.camera.left   = -this.currentFrustum * aspect
    this.camera.right  =  this.currentFrustum * aspect
    this.camera.top    =  this.currentFrustum
    this.camera.bottom = -this.currentFrustum

    // Look at a point offset to the right in screen space, which slides the
    // diagram left into the visible half. cameraTarget itself is left alone so
    // panning and framing keep meaning "what the viewer is looking at".
    const look = this.cameraTarget.clone().add(this.screenRightShift())
    this.camera.position.set(look.x + CAMERA_HEIGHT, CAMERA_HEIGHT, look.z + CAMERA_HEIGHT)
    this.camera.lookAt(look)
    this.camera.updateProjectionMatrix()
  }

  /**
   * How far to slide the diagram left, as a world vector along screen-right.
   *
   * Only half of what centring in the visible width would suggest. There is
   * chrome on both sides: the sidebar covers the full height on the right, so
   * it counts in full when deciding how much *fits* — but the prose panel
   * covers the top-left corner, and shifting all the way over tucks a wide
   * diagram underneath it. Half clears the sidebar without reaching the panel.
   */
  private screenRightShift(): THREE.Vector3 {
    if (!this.viewportInset) return new THREE.Vector3()
    const perPixel = (this.currentFrustum * 2) / (this.renderer.domElement.clientHeight || 1)
    // Screen-right on the ground plane is (x - z) / sqrt2 for this camera.
    return new THREE.Vector3(1, 0, -1).normalize().multiplyScalar((this.viewportInset / 4) * perPixel)
  }

  override resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false)
    // Delegate rather than repeat the projection maths: this used to be a second
    // copy of it, which silently dropped the viewport-inset composition.
    this.applyCamera()
  }

  getConnectionLabelData(): Array<{ id: string; label: string; midpoint: THREE.Vector3 }> {
    const result: Array<{ id: string; label: string; midpoint: THREE.Vector3 }> = []
    for (const [id, pipe] of this.pipes) {
      const label = this.graph.connections.get(id)?.label
      if (label) result.push({ id, label, midpoint: pipe.midpoint })
    }
    return result
  }

  getPacketMesh(id: string): THREE.Mesh | null {
    return this.layer.activePackets.find(p => p.mesh.userData.componentId === id)?.mesh ?? null
  }

  /** World units covered by one screen pixel at the current zoom. */
  private worldUnitsPerPixel(): number {
    const h = this.renderer.domElement.clientHeight || 1
    return (this.currentFrustum * 2) / h
  }

  protected onFrame(_deltaMs: number): void {
    if (!this.isPanning) this.hoverSystem.update()
    // Re-fit the hovered ring: zooming changes what a pixel is worth.
    if (this.hoverHandle || this.hoverComponent) {
      const upp = this.worldUnitsPerPixel()
      if (this.hoverHandle) setHoverOutlineScale(this.hoverHandle, upp)
      if (this.hoverComponent) this.components.get(this.hoverComponent)?.updateEditHoverScale(upp)
    }
    this.layer.update(performance.now())
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('wheel',        this.onWheel)
    this.renderer.domElement.removeEventListener('pointerdown',  this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointermove',  this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerup',    this.onPointerUp)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerUp)
    this.renderer.domElement.removeEventListener('contextmenu',  this.onContextMenu)
    if (this.transitionTimer !== null) clearTimeout(this.transitionTimer)
    this.stopLoop()
    this.hoverSystem.dispose()
    this.updateGhost()   // drops the placement ghost if one is up
    this.grid.dispose(this.scene)
    this.rootLayer.dispose()
    this.layers.clear()
    super.dispose()
  }
}
