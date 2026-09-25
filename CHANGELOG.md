# Changelog

Notable changes to FlowViz, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); entries are dated
rather than versioned, because the app is deployed rather than released.

## 2026-09-25

### Added

- **A separate toggle for pipe labels.** The playback bar now has one control
  for the tubes and another for the chips naming them, both on by default. A
  diagram can be too busy with protocol names on it and still need the routes
  drawn, which one combined toggle could not express.
- The waterfall column goes with the step list when it is put away. It emerges
  from behind the panel and is positioned against its edge, so on its own it
  was left standing against the window attached to nothing. Fetching the panel
  back returns the column to however it was left.
- **A progress line on the playing step.** A line creeps across the step's row
  in the sidebar for as long as that step holds. A step whose only change is an
  annotation animates nothing in the scene, and neither does the first step of
  a play-through — without this there was no sign the flow was running.

- **Components and zones can be dragged anywhere on the grid.** Past the far
  edge grows `layout.grid` to cover them; past the origin re-bases the scene so
  the lowest occupied cell is zero again, taking every component, zone and
  waypoint with it. Previously a component sitting at row 1 could move up
  exactly one cell and stop, against an invisible wall made half of the
  declared grid and half of the origin.
- **Routing waypoints can be added from the diagram.** Double-click a pipe in
  edit mode to put one where you clicked, and double-click a waypoint to take
  it away. They could be dragged and right-clicked away before, but there was
  no way to make one — routes had to be written by hand.
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

### Fixed

- The camera frames the declared grid *union* what is actually in the scene,
  rather than the declared grid alone, so a component dragged past the edge is
  still framed. Every flow that exists today has its contents inside its grid,
  so none of them reframe.
- The dashed boundary round a nested scene follows what is inside it again. It
  is derived from the scene's contents, but was built once and never re-fitted,
  so dragging a component left a box that no longer contained its own scene.

### Changed

- Step rows are numbered from one rather than zero, matching the step counter
  in the playback bar and the 1-based `?step=` deep link.
- The active step row no longer carries a blue edge marker; its number already
  goes solid blue, and the row was saying the same thing twice.
- The `uk-power` example names every component with a pinned label and moves the
  camera on every step.
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
