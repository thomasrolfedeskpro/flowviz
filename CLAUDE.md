# FlowViz — Project Instructions for Claude Code

## What this project is

A web app that renders animated isometric data flow diagrams from a JSON definition file.
Full product requirements: `flowviz-requirements.md`
Full technical design: `flowviz-design.md`

---

## Dev server

The dev server runs on **port 5175** (pinned in `vite.config.ts`).

**Never run `pkill -f vite`.** `pkill -f` matches the full command line of every
process on the machine, so it kills dev servers in unrelated repos — and it also
matches `vitest`, because the pattern is a substring. Other checkouts on this
machine run their own vite dev servers.

Reuse one running server across test runs; HMR picks up edits, so restarts are
almost never needed. When one genuinely has to be stopped, kill by port:

```bash
lsof -ti tcp:5175 | xargs kill
```

(`lsof` returns both the npm wrapper and the vite child, and zsh does not
word-split an unquoted `$PID`, so piping to `xargs` is what actually kills both.)

---

## Where flows live

- `public/flows/examples/` — committed. Reference flows that ship with the repo.
  The UI hides their delete button and the dev-server endpoint refuses them.
- `public/flows/custom/` — **git-ignored.** Personal and product-specific flows.

Edit mode writes back through the dev server: **Save to file** PUTs the edited
definition to `/api/flows/<id>`, which validates it against the flow schema
before overwriting. Examples can be saved but not deleted.

Write new flows to `custom/` unless asked for a shipped example: these diagrams
name internal services and file paths, and keeping them out of git is deliberate.
The flow id is the bare filename, so `?flow=my-flow` finds it in either
directory. The manifest in `vite.config.ts` scans one level deep only.

---

## Git and PR workflow

**Before pushing to any branch**, check whether its PR has already been merged into `main`:
- Run `git fetch origin main && git log --oneline origin/main -5` to see recent merges
- If the PR is merged, create a **new branch** off `main` (e.g. `git checkout -b fix/my-fix origin/main`), cherry-pick or re-apply the changes, push that branch, and open a new PR
- Never push new commits to a branch whose PR is already merged — those commits won't reach `main` via a future merge and will be lost

---

## Current status

**Phase 2 complete.** Full visualization layer implemented and build passes cleanly.

---

## Your task: implement Phase 1

Phase 1 produces a running skeleton with no visualization content.
Everything is defined in `flowviz-design.md` § 3 (pages/sections 3.1–3.13).

Work through the Phase 1 checklist in `flowviz-design.md` § 3.13:

- [x] Scaffold the project with `npm create vite@latest flowviz -- --template react-ts` inside this folder
- [x] Install dependencies: `three`, `@tweenjs/tween.js`, `@types/three`
- [x] Apply `vite.config.ts` from § 3.2
- [x] Apply `tsconfig.json` settings from § 3.3 (strict mode, `moduleResolution: bundler`, `@/` alias, `target: ES2022`)
- [x] Implement `src/types/schema.ts` — all TypeScript types from § 2 of the design doc
- [x] Implement `src/scene/SceneManager.ts` — Three.js renderer, orthographic camera, animation loop (§ 3.4)
- [x] Implement `src/scene/LightingSetup.ts` — ambient + key + fill lights (§ 3.5)
- [x] Implement `src/scene/OverlayBridge.ts` — world → screen coordinate projection (§ 3.12)
- [x] Implement `src/engine/stepEngine.ts` — pure TS step state machine (§ 3.7)
- [x] Implement `src/hooks/useStepEngine.ts` — React hook wrapping StepEngine (§ 3.8)
- [x] Implement `src/hooks/useAnimationFrame.ts` — rAF subscription hook (§ 4.14)
- [x] Implement `src/engine/parseFlow.ts` — JSON → validated FlowDefinition (§ 3.11)
- [x] Implement `src/engine/layoutEngine.ts` — grid coords → world coords stubs (§ 4.1, just the constants and functions — no scene objects yet)
- [x] Implement `src/components/CanvasContainer.tsx` — mounts SceneManager, ResizeObserver (§ 3.6)
- [x] Implement `src/components/StepControls.tsx` — back / play-pause / forward (§ 3.9)
- [x] Implement `src/components/StepHUD.tsx` — title, description, step counter (§ 3.10)
- [x] Implement `src/App.tsx` — loads flow JSON, wires engine, renders layout
- [x] Create `public/flows/example.json` — the sample flow from § 5 of the design doc
- [x] Add CSS: `src/styles/global.css`, `StepControls.module.css`, `StepHUD.module.css`
- [x] Verify: canvas renders dark background, no console errors
- [x] Verify: isometric camera angle correct (add a temporary BoxGeometry at the origin to check)
- [x] Verify: resize keeps the canvas filling its container
- [x] Verify: `example.json` loads and parses without error
- [x] Verify: StepEngine play/pause/prev/next all work
- [x] Verify: StepControls and StepHUD update correctly on step change
- [x] Verify: OverlayBridge — a debug `<div>` at the origin tracks a cube at `(0,0,0)` on resize

## Key design decisions already made

- **No backend.** Static site, served by Vite dev server in development.
- **No component library, no CSS framework.** Plain CSS modules only.
- **SceneManager is a plain TS class**, not a React component. React owns its lifecycle via `CanvasContainer`.
- **StepEngine is pure TS** (no React, no Three.js). React subscribes via `useStepEngine`.
- **`@/` alias** maps to `/src`. Use it for all internal imports.
- **TWEEN.update()** must be called every frame in the animation loop with no arguments.
- **Packet shapes and component types** are defined in § 2 and § 4 of the design doc — don't invent alternatives.

## File layout (from § 3.1)

```
flowviz/
  index.html
  vite.config.ts
  tsconfig.json
  package.json
  public/
    flows/
      example.json
  src/
    main.tsx
    App.tsx
    types/
      schema.ts
      internal.ts
    engine/
      parseFlow.ts
      layoutEngine.ts
      stepEngine.ts
    scene/
      SceneManager.ts
      LightingSetup.ts
      OverlayBridge.ts
      FlowScene.ts
      GridFloor.ts
      ZoneRenderer.ts
      ComponentMesh.ts
      ConnectionPipe.ts
      DataPacket.ts
      HoverSystem.ts
    components/
      CanvasContainer.tsx
      StepControls.tsx
      StepHUD.tsx
      AnnotationOverlay.tsx
      HoverTooltip.tsx
      PopoutPanel.tsx
    hooks/
      useStepEngine.ts
      useAnimationFrame.ts
      useHover.ts
    styles/
      global.css
      StepControls.module.css
      StepHUD.module.css
      AnnotationOverlay.module.css
      HoverTooltip.module.css
      PopoutPanel.module.css
```

## After Phase 2

Phase 2 (visualization) is complete. Phase 3 (Claude Skill Integration) is defined in `flowviz-design.md` § 5.
