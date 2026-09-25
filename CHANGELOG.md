# Changelog

Notable changes to FlowViz, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are dated
rather than versioned, because the app is deployed rather than released.

## 2026-09-25

### Added

- **Import a flow.** "Import a flow…" in the Visualizations tab takes a `.json`
  file or pasted text, validates it against the flow schema before sending, and
  writes it to `public/flows/custom/` under a name you choose — which becomes
  both the filename and the flow's title. The counterpart to the JSON download.
- **Pin a component's card.** Its card carries a thumbtack: press it and the
  card stays up until you press it again. Several can be pinned at once, and
  they survive stepping, so what four components are for stays on screen while
  the packets move between them.
- **Show a component's connections.** The card's other control threads a dashed
  line down every connection that component makes across the whole flow — navy
  on the light theme, white on the dark one — with the other components dimmed.
  It is the shape a step-at-a-time reading never shows. Drawn through the tube
  like the stream chevrons rather than applied to the glass, so a pipe the step
  is lighting and a pipe you asked to see stay two separate statements. Offered
  whether the card is pinned or merely hovered, so the shape can be read without
  leaving a card in the way.
- A hovered card now survives the pointer moving onto it, which is what makes
  its own controls reachable.
- **Hide the step list.** A double-chevron handle at the top of the sidebar,
  just outside its edge, slides the panel off the right of the window and back.
  The diagram recomposes for the width it actually has, so closing the list
  gives it the whole window rather than leaving it shifted left around a panel
  that is no longer there.

### Changed

- PNG exports render at several times screen resolution — up to 6000px on the
  longest edge, clamped to what the GPU will allocate — so label text is legible
  at full size rather than upscaled.
- Overlay labels are drawn smaller in a PNG export, so a fitted diagram is not
  a wall of overlapping chips. They come out at twice their on-screen size
  rather than four times — still legible at 6000px, half the footprint.
- The "without panels" PNG now frames the whole diagram rather than whatever the
  screen happens to be zoomed to, and leaves out the playback controls as well
  as the step list and the description box. A still is a picture of the flow,
  not of the window. The screen's own zoom and position are restored afterwards.

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

- Long text in a component's hover card no longer overflows it sideways. A file
  path wraps mid-word instead of pushing out a horizontal scrollbar that could
  not be reached — moving towards it moved the card.

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
