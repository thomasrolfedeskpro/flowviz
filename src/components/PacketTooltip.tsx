import { useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import type { FlowScene } from '@/scene/FlowScene'
import type { OverlayBridge } from '@/scene/OverlayBridge'
import type { PacketMeshUserData } from '@/scene/meshUserData'
import { useAnimationFrame } from '@/hooks/useAnimationFrame'
import { packetBody } from '@/utils/packetBody'
import type { PacketBody } from '@/utils/packetBody'
import styles from '@/styles/PacketTooltip.module.css'

interface PacketTooltipProps {
  scene:     FlowScene
  bridge:    OverlayBridge
  hoveredId: string
}

interface Head {
  label: string
  shape: string
}

/**
 * What a packet is carrying, while you hover it.
 *
 * The position is written straight to the node's transform every frame — the
 * packet is moving, and re-rendering React at frame rate to chase it would be
 * wasteful. The body is different: it changes only when the hovered packet
 * changes, so it goes through state and gets to be real markup rather than a
 * string poked into a `<pre>`.
 */
export function PacketTooltip({ scene, bridge, hoveredId }: PacketTooltipProps) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const [head, setHead] = useState<Head | null>(null)
  const [body, setBody] = useState<PacketBody>({ kind: 'empty' })
  /** What the last body was built from, so it is rebuilt only when it changes. */
  const shownFor = useRef<string | null>(null)

  useAnimationFrame(() => {
    const mesh = scene.getPacketMesh(hoveredId)
    if (!divRef.current || !mesh) return

    const ud = mesh.userData as PacketMeshUserData
    const signature = `${hoveredId}|${ud.packetLabel}|${ud.packetCount ?? ''}`
    if (shownFor.current !== signature) {
      shownFor.current = signature
      setHead({
        label: ud.packetLabel,
        shape: ud.packetCount ? `${ud.packetShape} · ×${ud.packetCount}` : ud.packetShape,
      })
      setBody(packetBody(ud.packetData, ud.packetFormat))
    }

    const pos = bridge.worldToScreen(mesh.position)
    divRef.current.style.transform = `translate(calc(${pos.x}px - 50%), calc(${pos.y}px - 100% - 16px))`
  }, [scene, bridge, hoveredId])

  const overlayRoot = document.getElementById('overlay-root')
  if (!overlayRoot) return null

  return ReactDOM.createPortal(
    <div
      ref={divRef}
      className={styles.tooltip}
      style={{ transform: 'translate(-9999px, -9999px)' }}
    >
      <strong>{head?.label}</strong>
      <span className={styles.shape}>{head?.shape}</span>
      <Body body={body} />
    </div>,
    overlayRoot
  )
}

function Body({ body }: { body: PacketBody }) {
  switch (body.kind) {
    case 'empty':
      return <p className={styles.none}>no payload</p>

    case 'prose':
      return <p className={styles.prose}>{body.text}</p>

    case 'raw':
      return <pre className={styles.payload}>{body.json}</pre>

    case 'facts':
      return (
        <dl className={styles.facts}>
          {body.facts.map((f, i) => (
            <div key={i} className={styles.fact}>
              <dt className={styles.factLabel}>{f.label}</dt>
              <dd className={f.nested ? styles.factNested : styles.factValue}>
                {f.value}
                {f.unit && <span className={styles.unit}>{f.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )
  }
}
