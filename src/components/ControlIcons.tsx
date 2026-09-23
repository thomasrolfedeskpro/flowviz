/**
 * The control panel's icon set.
 *
 * Inline SVG on a 16×16 box, stroked or filled in `currentColor`, so an icon
 * takes the colour of the button holding it and needs no per-theme variant.
 * Kept apart from the panel itself because a wall of path data buried in the
 * layout makes the layout unreadable.
 */

const box = { viewBox: '0 0 16 16', width: 18, height: 18, 'aria-hidden': true } as const

export function StepBackIcon() {
  return (
    <svg {...box}>
      <path d="M13 3.4v9.2L6.2 8z" fill="currentColor" />
      <rect x="3" y="3.4" width="1.7" height="9.2" rx="0.6" fill="currentColor" />
    </svg>
  )
}

export function StepForwardIcon() {
  return (
    <svg {...box}>
      <path d="M3 3.4v9.2L9.8 8z" fill="currentColor" />
      <rect x="11.3" y="3.4" width="1.7" height="9.2" rx="0.6" fill="currentColor" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg {...box}>
      <path d="M4.8 3.1 12.6 8l-7.8 4.9z" fill="currentColor" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg {...box}>
      <rect x="4.3" y="3.3" width="2.6" height="9.4" rx="0.8" fill="currentColor" />
      <rect x="9.1" y="3.3" width="2.6" height="9.4" rx="0.8" fill="currentColor" />
    </svg>
  )
}

/** Camera follow: a reticle, because what it does is keep the view on a target. */
export function FollowIcon() {
  return (
    <svg {...box}>
      <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
      />
    </svg>
  )
}

/** Pipes: a length of tube with two joints, seen side on. */
/** A chip pinned above a box — the pinned component label, in miniature. */
export function LabelIcon() {
  return (
    <svg {...box}>
      <rect
        x="3.2" y="1.8" width="9.6" height="4" rx="1.2"
        fill="none" stroke="currentColor" strokeWidth="1.3"
      />
      <rect
        x="4.6" y="8.6" width="6.8" height="5.6" rx="1"
        fill="currentColor" opacity="0.5"
      />
    </svg>
  )
}

export function PipesIcon() {
  return (
    <svg {...box}>
      <rect
        x="1.8" y="5.6" width="12.4" height="4.8" rx="2.4"
        fill="none" stroke="currentColor" strokeWidth="1.3"
      />
      <path d="M5.4 5.6v4.8M10.6 5.6v4.8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

/** Isometric: a cube, drawn at the angle the scene is actually drawn at. */
export function IsometricIcon() {
  return (
    <svg {...box}>
      <path
        d="M8 1.8 14 5.2v5.6L8 14.2 2 10.8V5.2z"
        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
      <path
        d="M2 5.2 8 8.6l6-3.4M8 8.6v5.6"
        fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
    </svg>
  )
}

/** Plan: the same ground, square on. */
export function PlanIcon() {
  return (
    <svg {...box}>
      <rect
        x="2.2" y="2.2" width="11.6" height="11.6" rx="1.2"
        fill="none" stroke="currentColor" strokeWidth="1.3"
      />
      <path d="M8 2.2v11.6M2.2 8h11.6" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

/** Zoom: a lens, with the sign for which way it goes. Drawn as one pair so the
 *  two buttons differ by a single stroke and nothing else. */
export function ZoomInIcon() {
  return (
    <svg {...box}>
      <circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 4.9v4.2M4.9 7h4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function ZoomOutIcon() {
  return (
    <svg {...box}>
      <circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.9 7h4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function SunIcon() {
  return (
    <svg {...box}>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <path
        d="M8 1.3v1.8M8 12.9v1.8M1.3 8h1.8M12.9 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"
      />
    </svg>
  )
}

export function MoonIcon() {
  return (
    <svg {...box}>
      <path
        d="M13.4 9.9A5.9 5.9 0 0 1 6.1 2.6a5.9 5.9 0 1 0 7.3 7.3z"
        fill="currentColor"
      />
    </svg>
  )
}

export function EnterFullScreenIcon() {
  return (
    <svg {...box}>
      <path
        d="M2.6 6V2.6H6M10 2.6h3.4V6M13.4 10v3.4H10M6 13.4H2.6V10"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

export function ExitFullScreenIcon() {
  return (
    <svg {...box}>
      <path
        d="M6 2.6V6H2.6M13.4 6H10V2.6M10 13.4V10h3.4M2.6 10H6v3.4"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

export function ExportIcon() {
  return (
    <svg {...box}>
      <path
        d="M8 2.2v7.4M5.2 6.9 8 9.8l2.8-2.9"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M2.8 11.4v1.4a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.4"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  )
}
