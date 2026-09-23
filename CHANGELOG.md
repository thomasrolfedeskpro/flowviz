# Changelog

Notable changes to FlowViz, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are dated
rather than versioned, because the app is deployed rather than released.

## 2026-09-23

### Added

- **Pinned component labels.** A component can carry an always-visible name via
  `pinnedLabel`, anchored at any of nine points against its projected bounding
  box and striped with its own colour. Off until the playback bar's toggle is
  pressed. Editable from the component inspector.
- **Pipes toggle.** Hides the tubes and their labels; packets and chevrons keep
  running, so the route still reads.
- **Zoom controls.** `−` / `+` buttons and the `-` / `+` keys move one wheel
  notch. The readout between them says how far in you are and refits the scene
  when pressed.
- **PNG export with or without the panels.** Both keep the diagram's own labels
  and annotations; "without panels" drops the step list and the description box.
- **Download the flow definition as JSON**, from the export menu, including
  unsaved edits.

### Changed

- Playback bar split into three rows — transport, view, and what's drawn. It had
  grown into a bar wider than some diagrams.
- PNG export now composites the page over the WebGL frame. It previously
  captured the canvas alone, which silently dropped every label and annotation.

### Fixed

- A flow whose framing is decided by its width rather than its height opened
  about 20% tighter than its own overview. The sidebar's width arrives after the
  scene is built, and the corrected framing was computed but never applied to
  the view.

## Baseline — everything before 2026-09-23

No changelog was kept for the first 124 commits (2026-06-10 to 2026-09-09).
This is the feature set as it stood at that point, not a list of changes.

**Rendering.** Isometric 3D grid; six component types in five extruded prism
shapes, with Font Awesome icons or brand logos; glass tube pipes that illuminate
when active; animated packets with arrival styles and repeat bursts; chevron
streams for genuinely continuous flows; zone groupings with nesting and dashed
outlines; light and dark themes.

**Narrative.** Stepped walkthroughs that highlight components, activate
connections, fire packets, show annotation callouts and pin footer notes.
Per-step camera focus and fit. Nested scenes to any depth, entered and left by
the camera. A waterfall column measuring whatever the author chooses.

**Viewing.** Isometric and plan views, present mode, keyboard stepping, deep
links to a flow and a step, hover tooltips for components, zones and packet
payloads. PNG, WebM and GIF export.

**Authoring.** Zod-validated flow schema; edit mode covering every field of
every object, direct manipulation on the grid, add/delete with cascade
preview, undo/redo, raw-JSON escape hatch, and save back to the flow file.
Geometry lint and auto-layout, via the CLI and in the editor.

Commit history has the detail: `git log --reverse`.
