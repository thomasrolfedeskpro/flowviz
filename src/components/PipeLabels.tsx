import { useRef } from 'react'
import ReactDOM from 'react-dom'
import * as THREE from 'three'
import type { OverlayBridge } from '@/scene/OverlayBridge'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import styles from '@/styles/PipeLabels.module.css'

interface PipeLabelDatum {
  id:       string
  label:    string
  midpoint: THREE.Vector3
}

interface PipeLabelsProps {
  pipes:   PipeLabelDatum[]
  bridge:  OverlayBridge
  /** connection id → repeat count for the current step, when above one. */
  counts?: Record<string, number>
}

export function PipeLabels({ pipes, bridge, counts = {} }: PipeLabelsProps) {
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useAnimationFrame(() => {
    for (const pipe of pipes) {
      const el = itemRefs.current.get(pipe.id)
      if (!el) continue
      const pos = bridge.worldToScreen(pipe.midpoint)
      el.style.transform = `translate(calc(${pos.x}px - 50%), calc(${pos.y}px - 50%))`
    }
  }, [pipes, bridge])

  const overlayRoot = document.getElementById('overlay-root')
  if (!overlayRoot) return null

  return ReactDOM.createPortal(
    <>
      {pipes.map(pipe => (
        <div
          key={pipe.id}
          ref={el => {
            if (el) itemRefs.current.set(pipe.id, el)
            else itemRefs.current.delete(pipe.id)
          }}
          className={styles.badge}
          style={{ transform: 'translate(-9999px, -9999px)' }}
        >
          {pipe.label}
          {counts[pipe.id] > 1 && <span className={styles.count}>×{counts[pipe.id]}</span>}
        </div>
      ))}
    </>,
    overlayRoot
  )
}
