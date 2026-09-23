import { useRef } from 'react'
import * as THREE from 'three'
import ReactDOM from 'react-dom'
import type { OverlayBridge } from '@/scene/OverlayBridge'
import type { LabelAnchor } from '@/types/schema'
import { anchorTransform, screenBox } from '@/utils/labelAnchor'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import styles from '@/styles/ComponentLabels.module.css'

export interface ComponentLabelDatum {
  id:     string
  text:   string
  anchor: LabelAnchor
  /** The component's own colour, so the chip reads as belonging to it. */
  color:  string
  /** Footprint centre at ground level. Held by reference — a drag moves it. */
  center: THREE.Vector3
  /** Mesh extents. Held by reference — a resize changes it. */
  size:   THREE.Vector3
}

interface ComponentLabelsProps {
  labels: ComponentLabelDatum[]
  bridge: OverlayBridge
}

/** Clear air between the chip and the component it names. */
const GAP_PX = 8

/** The eight corners of a component's box, reused each frame. */
const CORNER = Array.from({ length: 8 }, () => new THREE.Vector3())

/**
 * Always-visible component names.
 *
 * Hovering tells you what a component is, which is no use in a screenshot — so
 * a flow can pin the name on instead. The chip tracks its component's projected
 * bounding box, so it holds the same relationship through a zoom, a pan, a drag
 * and a switch to plan view.
 */
export function ComponentLabels({ labels, bridge }: ComponentLabelsProps) {
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useAnimationFrame(() => {
    for (const label of labels) {
      const el = itemRefs.current.get(label.id)
      if (!el) continue

      const { center, size } = label
      const hx = size.x / 2
      const hz = size.z / 2
      // The mesh stands on the ground at `center.y` and rises its full height.
      let i = 0
      for (const x of [center.x - hx, center.x + hx]) {
        for (const y of [center.y, center.y + size.y]) {
          for (const z of [center.z - hz, center.z + hz]) {
            CORNER[i++].set(x, y, z)
          }
        }
      }

      const box = screenBox(CORNER.map(c => bridge.worldToScreen(c)))
      el.style.transform = anchorTransform(box, label.anchor, GAP_PX)
    }
  }, [labels, bridge])

  const overlayRoot = document.getElementById('overlay-root')
  if (!overlayRoot) return null

  return ReactDOM.createPortal(
    <>
      {labels.map(label => (
        <div
          key={label.id}
          ref={el => {
            if (el) itemRefs.current.set(label.id, el)
            else itemRefs.current.delete(label.id)
          }}
          className={styles.badge}
          style={{ borderLeftColor: label.color, transform: 'translate(-9999px, -9999px)' }}
        >
          {label.text}
        </div>
      ))}
    </>,
    overlayRoot
  )
}
