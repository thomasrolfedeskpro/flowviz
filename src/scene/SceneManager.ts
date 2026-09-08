import * as THREE from 'three'
import { tweenGroup } from '@/scene/tweenGroup'

const FRUSTUM = 12

/**
 * How far the camera can see in front of and behind itself.
 *
 * Symmetric, and it has to be: an orthographic camera clips at `near` just as a
 * perspective one does, but here the ground plane is steeply inclined to the
 * view axis, so the part of it nearest the viewer sits in *front* of the camera
 * plane. With a small positive near, zooming out far enough pushes the bottom
 * of the screen through it and the diagram is cut off along a horizontal line —
 * bare background below, scene above. Distance costs nothing here because
 * orthographic depth is linear, so the range is simply made large enough that
 * no zoom can reach either end.
 */
const CAMERA_DEPTH = 2000

export class SceneManager {
  renderer: THREE.WebGLRenderer
  scene:    THREE.Scene
  camera:   THREE.OrthographicCamera
  clock:    THREE.Clock

  private rafId: number | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x1a1a2e)

    const { width, height } = canvas.getBoundingClientRect()
    const w = width  || canvas.clientWidth  || 800
    const h = height || canvas.clientHeight || 600
    const aspect = w / h

    this.camera = new THREE.OrthographicCamera(
      -FRUSTUM * aspect,
       FRUSTUM * aspect,
       FRUSTUM,
      -FRUSTUM,
      -CAMERA_DEPTH,
       CAMERA_DEPTH,
    )

    const D = 50
    this.camera.position.set(D, D, D)
    this.camera.lookAt(0, 0, 0)
    this.camera.up.set(0, 1, 0)

    this.scene = new THREE.Scene()
    this.clock = new THREE.Clock()
    this.renderer.setSize(w, h, false)
  }

  dispose(): void {
    this.renderer.dispose()
  }

  resize(width: number, height: number): void {
    const aspect = width / height
    this.camera.left   = -FRUSTUM * aspect
    this.camera.right  =  FRUSTUM * aspect
    this.camera.top    =  FRUSTUM
    this.camera.bottom = -FRUSTUM
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  startLoop(): void {
    const tick = () => {
      this.rafId = requestAnimationFrame(tick)
      const delta = this.clock.getDelta()
      tweenGroup.update()
      this.onFrame(delta * 1000)
      this.renderer.render(this.scene, this.camera)
    }
    this.clock.start()
    tick()
  }

  stopLoop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  captureFrame(): string {
    return this.renderer.domElement.toDataURL('image/png')
  }

  /** The drawing surface, for exporters that stream it rather than sample it. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  protected onFrame(_deltaMs: number): void {}
}
