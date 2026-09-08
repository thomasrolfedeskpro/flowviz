import { useCallback, useEffect, useState } from 'react'

/**
 * Present mode: fullscreen, no chrome, keyboard-driven.
 *
 * Kept in a hook because three things have to stay in step — the flag the app
 * renders from, the browser's fullscreen state, and `?present=1` in the URL so
 * a link can open straight into it. Any one of them drifting leaves the app
 * showing a bare diagram with no visible way back.
 *
 * Fullscreen is best-effort throughout. A browser can refuse the request
 * outright (no user gesture, an embedded frame, a policy), and present mode is
 * still worth having without it: the chrome is hidden either way. So nothing
 * here treats a refusal as failure.
 */

const PARAM = 'present'

function presentFromUrl(): boolean {
  const v = new URLSearchParams(window.location.search).get(PARAM)
  return v === '1' || v === 'true'
}

/** Adds or drops the flag, leaving every other parameter — `flow`, `step` —
 *  alone, and without pushing a history entry. */
function syncUrl(on: boolean): void {
  const url = new URL(window.location.href)
  if (on) url.searchParams.set(PARAM, '1')
  else    url.searchParams.delete(PARAM)
  window.history.replaceState({}, '', `${url.pathname}${url.search}`)
}

export interface PresentMode {
  presenting: boolean
  exit:   () => void
  toggle: () => void
}

export function usePresentMode(): PresentMode {
  const [presenting, setPresenting] = useState(presentFromUrl)

  useEffect(() => {
    if (presenting) {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {
          /* refused — present mode still applies, just windowed */
        })
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => { /* already gone */ })
    }
    syncUrl(presenting)
  }, [presenting])

  // Leaving fullscreen by any other route — the browser's own Esc, a window
  // control, the OS — has to leave present mode with it. Otherwise the chrome
  // stays hidden in a windowed tab and the only way back is a keystroke nobody
  // can see.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setPresenting(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  return {
    presenting,
    exit:   useCallback(() => setPresenting(false), []),
    toggle: useCallback(() => setPresenting((v) => !v), []),
  }
}
