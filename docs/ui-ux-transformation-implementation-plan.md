# Xtream UI/UX Transformation Implementation Plan

Date: 2026-04-27

## 1. Purpose

This plan translates the current design specification in `docs/DESIGN.md` and the static reference in `docs/static-ui-prototype.html` into an implementation roadmap for the current Electron MVP. It reconciles the target operator-console UX with the functional requirements in `docs/electron-cross-platform-player-prd.md` and the longer-term cue roadmap in `docs/show-cue-system-long-term-roadmap.md`.

The key finding is that the underlying MVP has already moved well beyond the original fixed-slot baseline in the PRD: the current code includes pool-based state, visual and audio source records, virtual outputs, display previews, image support, a timeline scrubber, schema version 3 persistence, and diagnostics. The largest remaining gap is not product model migration; it is turning the stacked MVP control page into the dense, persistent, single-page pro interface described by the design spec while preserving the working runtime behavior.

## 2. Source Materials Reviewed

- `docs/DESIGN.md`: Morandi-Technical visual system, single-page shell, patch view, footer mixer/detail pane, resizable panes, icon-first transport, and future navigation surfaces.
- `docs/static-ui-prototype.html`: concrete static layout for the nav rail, top app bar, patch workspace, display cards, audio mixer strip, dynamic detail pane, and status footer.
- `docs/electron-cross-platform-player-prd.md`: functional MVP requirements for Visual Pool, Audio Pool, Virtual Outputs, display mapping, live previews, active timeline, mixed-duration media, persistence, readiness, diagnostics, and tests.
- `docs/show-cue-system-long-term-roadmap.md`: future Cue and Performance surfaces, cue list foundation, adapter strategy, and long-term operator/authoring separation.
- Current implementation in `src/main`, `src/renderer`, `src/shared`, and `src/preload`.
- Current web interface guidance: accessibility, focus states, content overflow handling, semantic controls, icon button labels, dark theming, and performance constraints for large lists.

## 3. Current MVP Inventory

### 3.1 Architecture Already In Place

The current app is an Electron/Vite TypeScript application with one control renderer and display-only renderer windows.

Implemented foundations:

- Main-process `Director` owns transport, rate, loop, readiness, drift correction, display state, visual pool, audio pool, virtual outputs, previews, and diagnostics-ready state.
- Shared pool-based types exist in `src/shared/types.ts`, including `VisualState`, `AudioSourceState`, `VirtualOutputState`, `DisplayWindowState`, `ActiveTimelineState`, and schema version 3 persisted config.
- Visual imports support multiple files and browser-safe images/videos through main-process file dialogs.
- Display layouts reference visual ids rather than fixed `A`/`B` slots.
- Display renderer supports images and muted videos.
- Control renderer hosts muted visual previews and display-card previews.
- Audio Pool and Virtual Outputs exist in the control renderer, including per-source gain, bus gain, sink selection, mute, fallback acceptance, test tone, Web Audio graph sync, and meters.
- Timeline scrubber exists and is driven by `activeTimeline`.
- Mixed-duration helpers exist for video freeze/loop and audio silence/loop behavior.
- Show persistence is schema version 3 and saves visuals, audio sources, outputs, displays, rate, and loop.
- Director State is already collapsed by default in the control HTML.
- Unit tests exist for shared timeline/layout helpers, director behavior, show config, and audio capabilities.

### 3.2 MVP UI Shape Today

The current control UI in `src/renderer/index.html` is a vertical stack:

- Hero/title block with timecode.
- Transport panel.
- Show config and diagnostics panel.
- Setup presets panel.
- Visual Pool panel.
- Audio Pool panel.
- Display Windows and Mapping panel.
- Collapsed Director State details.

The current styling in `src/renderer/styles.css` uses rounded cards, spacious panels, shadows, cyan accents, and page-like sections. This conflicts with the new design direction of a compact square-edged operator console.

### 3.3 Important Current Constraints

- The renderer is vanilla TypeScript and DOM construction, not React.
- `package.json` currently has no Tailwind or Lucide dependency despite `DESIGN.md` specifying mandatory utility-first CSS and Lucide icons.
- The static prototype uses Tailwind CDN and Material Symbols, while `DESIGN.md` explicitly asks for Lucide icons. Implementation should follow `DESIGN.md` and use the prototype as a layout reference, not as literal dependency guidance.
- Current control rendering is centralized in one large `src/renderer/control.ts`, which increases risk for a large visual refactor unless the work introduces componentized renderer modules.
- Current element ids preserve some old names such as `slotList` and `applyMode1Button`; these are not user-facing but should be renamed during the UI refactor to prevent future slot/mode leakage.

## 4. Design And Requirements Alignment

### 4.1 What The Design Gets Right For The Product

The design direction is well aligned with the product:

- High-density layout matches live operator needs better than the current stacked panels.
- Persistent top transport reduces travel time for play, pause, stop, rate, loop, seek, save/open, diagnostics, and readiness.
- Left navigation rail provides a home for future Cue, Performance, Config, and Logs surfaces without complicating the MVP Patch view.
- Middle split workspace maps cleanly to the existing Visual Pool and Display Windows concepts.
- Footer mixer and dynamic detail pane are the right structure for virtual outputs and contextual editing.
- Square geometry, restrained color, and data-focused typography reinforce a professional tool rather than a marketing UI.

### 4.2 Design / PRD / Current Implementation Matrix

| Area | Design target | PRD requirement | Current state | Implementation status |
| --- | --- | --- | --- | --- |
| Global shell | Top transport, nav rail, status footer | One control window owns all interaction | Stacked control page | Major UI refactor needed |
| Visual Pool | Tabbed Visuals/Audio pool with compact list and preview | Arbitrary visuals, videos/images, metadata, bulk import | Arbitrary visuals, images/videos, metadata reports, previews | Runtime mostly done; UI needs transformation |
| Audio Pool | Audio tab in pool, source list, preview/test | Multiple external/embedded sources | Multiple sources and preview action | Runtime mostly done; UI needs tabbed pool integration |
| Display Windows | Dense output cards with status, preview, drift, remove | Dynamic displays, single/split mappings, live previews | Dynamic displays and previews exist | UI needs prototype card treatment and controls relocation |
| Audio Mixer | Footer vertical faders, meters, S/M controls | Multiple virtual outputs, per-output fader/meter/mute/solo/test | Virtual outputs, faders, meter, mute, test tone exist | Needs mixer-strip UI and solo behavior |
| Dynamic Details | Contextual 70vw pane for selected visual/audio/display/output | Unified config based on selection | Config is spread across cards | Selection model and details pane needed |
| Timeline | Thin progress separator plus primary scrubber | Click/drag timeline with loop markers | Range scrubber exists, no marker visualization | Needs header integration and richer display |
| Rate | Drag/double-click precise global rate | Global rate control | Number input + button | Needs interaction redesign |
| Loop | Icon button opens loop config tooltip/popover | Existing loop controls remain | Inline loop inputs | Needs popover and marker integration |
| Save/Open/Diagnostics | Icon utility actions | Save/open/export diagnostics | Buttons exist | Needs icon buttons and status feedback |
| Live state | Live/dimmed state display | Readiness/issues visible | Status text + issues list | Needs compact readiness/live model |
| Resizable panes | Header fixed; workspace/footer split resizable | Layout resizability expected by design | No resizable panes | New splitter system needed |
| Tokens/style | Morandi-Technical, zero radius, no shadows | Utility-first CSS/Tailwind | Rounded/shadowed custom CSS | Design system implementation needed |
| Icons | Lucide icons | Lucide icons whenever needed | Text buttons only | Icon system needed |
| Accessibility | Icon controls with labels/focus | Professional operator UI | Basic semantic controls, limited focus styling | Must be included with refactor |

## 5. UX Gap Analysis

### 5.1 Shell And Navigation Gaps

The design expects a fixed application shell:

- Left rail: Patch, Cue, Performance, Config/Logs.
- Top bar: timecode, transport, rate, utilities, readiness/live state, progress line.
- Main patch workspace: media pool and display windows.
- Footer: audio mixer and dynamic details.
- Bottom status bar: engine version, global mute/blackout, meter reset.

The current app has no persistent shell or navigation model. All controls are visible in a vertical document, which is functional but inefficient for repeated show operation.

Implementation implication: introduce a `ControlShell` layout layer first, then progressively move existing behavior into shell regions.

### 5.2 Selection And Details Gaps

The static design assumes that selecting a visual, audio source, display, or virtual output opens a contextual detail pane. The current UI edits each entity inline inside its own card.

Missing model:

- `selectedEntity` renderer state.
- Selection affordances in Visual Pool, Audio Pool, Display Windows, and Mixer.
- A detail-pane renderer that switches by entity type.
- Wider detail-pane expansion when something is selected.
- Keyboard and focus behavior for selection changes.

Implementation implication: add selection as renderer-local UI state first; only persist labels/settings through existing IPC commands.

### 5.3 Media Pool Gaps

The current Visual Pool and Audio Pool are separate stacked panels. The target design makes them tabs in the left workspace pane, with a compact list above an isolated preview.

Missing UX:

- Visuals/Audio segmented tabs.
- Compact row/list density.
- Row status indicators and hover remove action.
- Drag-and-drop import into the pane.
- Persistent add-media button.
- Selected asset preview in the bottom half of the pane.
- Asset preview transport independent from global director playback.
- Search/filter/sort bar.

Implementation implication: separate "asset list item" from "asset preview player" and avoid reusing global playback media elements for isolated preview controls.

### 5.4 Display Workspace Gaps

Display state and previews exist, but the current display cards are page cards with full inline configuration. The design needs compact output tiles with status telemetry and details moving into the contextual pane.

Missing UX:

- Dense card header overlays.
- Ready/Standby/No Signal state treatments.
- Drift and frame-rate telemetry in the bottom-left area.
- Close/remove icon at the bottom-right.
- Layout toggle controls at workspace header level.
- Custom searchable visual selector in details for single/split layouts.

Implementation implication: display cards should become monitoring surfaces; editing and routing controls should migrate to details.

### 5.5 Mixer And Output Gaps

Virtual output runtime exists, but the presentation is currently card-based. The target design expects persistent vertical mixer strips and a separate detail editor.

Missing UX:

- Footer mixer strips with fixed-width channels.
- Vertical fader with dB scale.
- Digital VU meter beside fader.
- Solo toggle behavior, not only mute.
- Add-output phantom strip/button.
- Linked fader behavior between mixer strip and selected-output detail pane.
- Clear visual distinction between logical bus, selected audio sources, and physical sink.

Implementation implication: preserve `VirtualOutputState` and implement solo as transient renderer/session state. Solo must affect the live Web Audio graph, but it should not be saved to show files or included as persisted diagnostic state.

### 5.6 Header Transport Gaps

The current transport works but is not in the target location or interaction model.

Missing UX:

- Icon-based play/pause/stop/seek controls.
- Double-click timecode editing.
- Thin full-width progress line as shell separator.
- Rate control with drag-to-tweak and precise double-click input.
- Loop icon button with popover containing existing loop parameters.
- Compact utility icons for save/open/diagnostics/config.
- Readiness/live indicator tied to current state.

Implementation implication: move existing `sendTransport`, `parseTimecodeInput`, `formatTimecode`, and loop/rate logic behind new header controls with accessible icon buttons and keyboard support.

### 5.7 Layout Resizability Gaps

No current panes are resizable. The design expects:

- Main row vs footer height resize.
- Media Pool vs Display Windows width resize.
- Mixer vs Details width resize.
- Optional internal split between asset list and asset preview.

Implementation implication: implement a small reusable splitter helper in the renderer with CSS custom properties and pointer events. Persist layout sizes in local UI preferences later; initial MVP can keep them session-local.

### 5.8 Design System Gaps

The target system requires:

- Zero border radius.
- No shadows.
- High-density spacing.
- Morandi-Tech colors from `DESIGN.md`.
- Typography roles for timecode, data, body, and label caps.
- Icon buttons rather than text buttons for common actions.
- No visible instructional copy inside the app.

The current CSS conflicts with most of this.

Implementation implication: replace the current style layer rather than patching it incrementally. Keep display-window black output styling isolated from control-shell styling.

## 6. Recommended Frontend Architecture

The current vanilla TypeScript approach can support the refactor, but `src/renderer/control.ts` should be split into modules before the shell is deeply implemented.

Recommended module structure:

```text
src/renderer/
  control.ts                 # bootstrap, state subscription, shell wiring
  control/
    appState.ts              # renderer-local UI state: selected entity, active tab, split sizes
    dom.ts                   # small DOM helpers: button, icon, field, tooltip, select
    icons.ts                 # Lucide icon creation and labels
    shell.ts                 # global shell layout render/update
    transport.ts             # header timecode, transport, rate, loop, timeline
    mediaPool.ts             # Visuals/Audio tabbed list and isolated preview
    displayWorkspace.ts      # display monitoring grid/cards
    mixer.ts                 # virtual output strips, meters, S/M, add output
    detailsPane.ts           # contextual configuration by selected entity
    issues.ts                # readiness/issues/log summary rendering
    splitters.ts             # pointer-driven resizable panes
    audioRuntime.ts          # existing Web Audio graph code
    mediaSync.ts             # shared renderer media sync helper
  control.css                # control shell styles/tokens
  display.css                # public display styles if split from shared CSS
```

This split keeps the current runtime behavior intact while making the visual refactor safer. The first extraction should move audio graph and media sync code out of `control.ts` because it is complex and should not be churned heavily during layout work.

## 7. Design System Implementation

### 7.1 Styling Strategy

`DESIGN.md` asks for utility-first CSS with Tailwind, and Tailwind is mandatory for this refactor. The repo currently uses plain CSS, so Tailwind setup is part of the implementation work.

Required approach:

- Add Tailwind to the Vite renderer build.
- Encode the Morandi-Tech design tokens in Tailwind config.
- Use CSS custom properties only as the underlying token source where helpful; Tailwind remains the authoring layer for the control shell.
- Do not use the static prototype's Tailwind CDN in production.

### 7.2 Tokens

Create control-shell tokens from `DESIGN.md`:

- Surfaces: `--surface`, `--surface-low`, `--surface-muted`, `--surface-active`, `--bg-base`.
- Text: `--text-primary`, `--text-secondary`, `--on-surface`.
- Accents: `--accent-teal`, `--accent-ochre`, `--status-critical`.
- Borders: `--border-subtle`, `--outline-variant`.
- Spacing: `--unit`, `--compact`, `--gutter`, `--pane-padding`, `--header-height`, `--status-footer-height`.
- Type: `--font-timecode`, `--font-data`, `--font-body`, `--font-label`.

Global control-shell rules:

- `border-radius: 0` for all control UI.
- No box shadows.
- `font-variant-numeric: tabular-nums` for timecode, meters, dB, drift, frame-rate, and durations.
- Explicit `color-scheme: dark`.
- Visible `:focus-visible` treatments.
- Compact but stable button/icon dimensions.

### 7.3 Icon System

Use Lucide icons for:

- Transport: `SkipBack`, `Rewind`, `Play`, `Pause`, `Stop`, `FastForward`, `SkipForward`, `Repeat`.
- Utility: `Save`, `FolderOpen`, `Settings`, `Activity`, `FileJson`, `Bug`, `RefreshCcw`.
- Media: `Plus`, `Search`, `Trash2`, `X`, `Film`, `Image`, `Music`, `Volume2`, `VolumeX`.
- Displays: `Monitor`, `PanelLeft`, `Columns2`, `Maximize`, `RotateCcw`, `Power`.
- Mixer: `SlidersVertical`, `Volume`, `CircleGauge`.

Every icon-only button must have an `aria-label` and visible tooltip or title.

## 8. Target Control UX

### 8.1 Shell Layout

```text
+------+-------------------------------------------------------------+
| Nav  | Header: timecode, transport, rate, loop, utilities, status  |
| Rail +-------------------------------------------------------------+
|      | Patch Workspace: Media Pool | Display Windows               |
|      |-------------------------------------------------------------|
|      | Footer: Audio Mixer        | Dynamic Details                |
+------+-------------------------------------------------------------+
| Status Footer: version, global mute, blackout, meter reset          |
+--------------------------------------------------------------------+
```

The Patch view is the first implemented surface. Cue, Performance, Config, and Logs should render lightweight placeholder surfaces that do not imply unfinished production behavior.

### 8.2 Header Behavior

- Timecode shows `formatTimecode(getDirectorSeconds(state))`.
- Double-click timecode swaps to a compact input; Enter commits seek; Escape cancels.
- Progress line maps current director time to active timeline duration.
- Play is disabled when readiness has blocking errors.
- Rate displays `1.0x`; drag horizontally adjusts in small increments; double-click opens exact input.
- Loop icon opens a popover with enable, start, end, and apply/reset. Loop markers render on the progress line.
- Save/Open/Diagnostics become icon buttons with status feedback in the status/footer region.
- Live state should read from readiness plus playback state:
  - `LIVE`: playing and readiness ready.
  - `STANDBY`: paused/stopped and ready.
  - `BLOCKED`: readiness has errors.
  - `DEGRADED`: readiness has warnings or display/audio degraded state.

### 8.3 Left Navigation Rail

Initial rails:

- Patch: implemented, active by default.
- Cue: placeholder linked to roadmap.
- Performance: placeholder linked to roadmap.
- Config: basic diagnostics/settings surface or placeholder.
- Logs: diagnostics/issues surface if easy to expose.

Do not wire unfinished controls that can alter show state. Placeholder rail items should clearly communicate that the surface is planned and should not expose fake cue/performance controls.

### 8.4 Media Pool

Tabs:

- Visuals.
- Audio.

Shared list behavior:

- Search/filter/sort bar.
- Add button.
- Drag media into pane to import.
- Compact rows with status dot, id/index, label, type/duration, and hover remove icon.
- Selecting a row updates the isolated preview and dynamic details pane.

Visual-specific details:

- Video or image icon.
- Dimensions and duration where available.
- Embedded audio indicator and action to add embedded audio source.

Audio-specific details:

- Source type: external file or embedded visual.
- Duration and readiness.
- Preview/test action.

Preview behavior:

- Muted and isolated from global show playback.
- Own play/pause and local scrubber for selected asset.
- Does not affect director state.
- If no selection, render an empty monitoring surface rather than instructions-heavy copy.

### 8.5 Display Workspace

Workspace header:

- Title: Display Windows.
- Create single display.
- Create split display.
- Optional view density/layout control.

Display card:

- Header overlay: display id, label, status.
- Preview body: same content/layout as public display preview.
- Bottom telemetry: drift, frame rate when available, fullscreen, monitor.
- Bottom-right close/remove icon.
- Clicking card selects display and opens Details.

Display detail pane:

- Label.
- Layout segmented control: single/split.
- Visual selector:
  - single: searchable single-select from Visual Pool.
  - split: two searchable selects or ordered dual-select.
- Monitor selector.
- Fullscreen, reopen, close, remove.
- Drift/correction summary.

Frame-rate telemetry is requested by `DESIGN.md` but is not currently in state. Add `lastFrameRateFps?: number` to display telemetry only after display renderer can report it accurately. Until then, show `fps --` or omit the field rather than inventing data.

### 8.6 Audio Mixer

Mixer strip:

- Fixed-width channel per virtual output.
- Label at bottom.
- Numeric dB readout at top.
- Vertical fader.
- Digital VU meter.
- Solo and mute toggles.
- Status indicator for routing/fallback.
- Phantom add-output strip after the final output.

Mixer interactions:

- Drag fader updates `busLevelDb`.
- Mute updates `muted`.
- Solo stays transient and only affects the current live session's Web Audio graph.
- Solo clear resets transient solo state across outputs.
- Solo is not persisted to show files and is not included as persisted diagnostic state.

### 8.7 Dynamic Details Pane

The detail pane replaces most inline card editing.

Entity types:

- Visual: label, path, type, file size, duration, dimensions, opacity, brightness, contrast, individual playback rate.
- Audio source: label, path/source visual, file size, duration, individual playback rate, source level.
- Display: label, layout, visual mapping, monitor, fullscreen/reopen/close/remove.
- Virtual output: label, bus level, meter, physical sink, source multi-select, per-source faders, solo/mute, test tone, remove.
- None selected: compact status/issue summary and show config actions.

Important data-model gaps:

- Visual opacity/brightness/contrast/rate are not currently in `VisualState`.
- Audio source individual rate/level are not currently in `AudioSourceState`.
- File size is not currently captured.
- Display labels are not currently in `DisplayWindowState`.

Add these fields deliberately and with persistence/tests:

```ts
type VisualState = {
  label: string;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  playbackRate?: number;
  fileSizeBytes?: number;
};

type AudioSourceState = {
  label: string;
  playbackRate?: number;
  levelDb?: number;
  fileSizeBytes?: number;
};

type DisplayWindowState = {
  label?: string;
  lastFrameRateFps?: number;
};
```

Visual playback rate and audio-source playback rate are durable media-record properties. If the same visual or audio source is used in multiple displays/outputs, its media-record rate applies everywhere. The global playback rate remains multiplicative on top of the media-record rate as required by `DESIGN.md`.

Visual opacity, brightness, and contrast are global properties of the visual media record. If the same visual is used in multiple display windows or split layouts, the same appearance adjustments apply everywhere that visual is rendered.

File size should be refreshed whenever media metadata is revalidated, not only captured once at import time.

### 8.8 Status Footer

Footer actions:

- Engine/runtime version.
- Global audio mute.
- Global display blackout.
- Global blackout for both audio and displays if product confirms.
- Solo clear.
- Reset meters.

Current state lacks global mute/blackout. Add after the shell is in place:

```ts
type DirectorState = {
  globalAudioMuted?: boolean;
  globalDisplayBlackout?: boolean;
};
```

Global mute and blackout are live-session controls. They apply immediately to the current running session, but they are not saved into the show file. Display blackout should be applied in display renderer and previews. Audio mute should be applied in the control renderer Web Audio graph. Runtime diagnostics may report whether they are currently active as live state, but reopening a show should not restore them automatically.

Xtream should maintain a separate engine/runtime version, distinct from the package app version. The starting runtime version for this refactor line is `v0.0.4`, reflecting the nightly stage and the planned schema v4 upgrade. The footer should display the runtime version, and diagnostics should include both the package app version and runtime version.

## 9. Implementation Phases

### Phase 0: Safety Baseline And Refactor Prep

Goal: create a stable checkpoint before moving UI.

Tasks:

- Run `npm run typecheck` and `npm test`.
- Capture screenshots of the current control page and display preview behavior for regression reference.
- Create a short checklist of currently working flows: add visuals, create display, assign mapping, add audio source, create output, route sink, play/pause/seek, save/open, export diagnostics.
- Split `src/renderer/control.ts` into modules without changing behavior:
  - `audioRuntime.ts`.
  - `mediaSync.ts`.
  - `dom.ts`.
  - `issues.ts`.
- Rename internal renderer ids/classes away from `slot` where feasible.

Acceptance:

- Typecheck and tests pass.
- UI behavior is unchanged.
- No product-facing regression.

### Phase 1: Design Tokens And Shell Skeleton

Goal: replace the page layout with the persistent app shell while keeping existing controls reachable.

Tasks:

- Add control-shell token layer based on `DESIGN.md`.
- Add Tailwind to the renderer build and wire the design tokens into Tailwind config.
- Add Lucide icon dependency and icon helper, or a local inline-SVG wrapper generated from Lucide if dependency cost is a concern.
- Build shell regions:
  - nav rail.
  - header.
  - workspace.
  - footer mixer/details.
  - bottom status footer.
- Move current controls into approximate shell regions without changing IPC behavior.
- Add focus-visible styles and `aria-label` for icon buttons.

Acceptance:

- Control window opens to the new shell.
- Play/pause/stop/seek/rate/loop/save/open/diagnostics remain functional.
- No rounded card/shadow visual language remains in control shell.
- Display renderer output remains black/framed as appropriate and is not accidentally restyled as the control shell.

### Phase 2: Header Transport And Timeline

Goal: implement the design's persistent transport experience.

Tasks:

- Build icon transport cluster.
- Add editable timecode behavior.
- Move timeline scrubber into header/progress line.
- Add loop popover with existing loop fields and loop marker rendering.
- Add rate drag/double-click control.
- Add compact readiness/live state model.
- Move issue details into status/details/log surface.

Acceptance:

- Timecode can be double-clicked, edited, committed, and canceled.
- Progress line supports pointer seek.
- Loop state can be enabled/edited from popover.
- Rate can be adjusted precisely and quickly.
- Play disabled state reflects readiness.

### Phase 3: Patch Media Pool

Goal: turn Visual Pool and Audio Pool into the tabbed left pane.

Tasks:

- Add renderer-local active pool tab state.
- Build compact Visual rows.
- Build compact Audio rows.
- Add search/filter/sort UI.
- Add drag-and-drop import for visual files.
- Add persistent add buttons.
- Add isolated selected-asset preview with local transport.
- Select row updates dynamic detail pane.
- Preserve existing add/replace/clear/remove behavior.

Acceptance:

- User can import multiple visuals via button and drag/drop.
- Visuals and audio sources are selectable from tabs.
- Preview playback does not affect director transport.
- Existing metadata/readiness reporting still works.

### Phase 4: Display Workspace

Goal: convert display records into monitoring cards and move editing into Details.

Tasks:

- Build display workspace header actions.
- Restyle display previews as dense cards matching the prototype.
- Add status overlays and drift telemetry.
- Add placeholder or implemented frame-rate telemetry.
- Move layout/mapping/monitor/fullscreen/reopen/close/remove controls into Display details.
- Add searchable visual dropdown component.
- Add display selection behavior.

Acceptance:

- Display cards primarily monitor output state.
- Selecting a display exposes all configuration in Details.
- Single and split visual mappings still work.
- Closed/degraded/no-signal states are visibly distinct.

### Phase 5: Mixer Footer And Output Details

Goal: make virtual outputs feel like a mixer, not a form list.

Tasks:

- Build mixer strips from `VirtualOutputState`.
- Add vertical fader and VU meter.
- Add mute toggle and transient solo toggle.
- Add phantom create-output strip.
- Link selected output detail fader with mixer fader.
- Move physical sink, source selection, per-source faders, fallback acceptance, test tone, and remove action into Output details.
- Add/reset meter action in status footer.

Acceptance:

- Multiple virtual outputs can be mixed from footer strips.
- Meters remain responsive.
- Output detail controls update the same runtime graph.
- Mute and transient solo behavior is deterministic. Mute remains persisted where represented on the output; solo resets with the live session.

### Phase 6: Dynamic Details For Visuals And Audio Sources

Goal: unify entity configuration and add missing design-specified controls.

Tasks:

- Add visual detail controls:
  - label.
  - path/readiness/metadata.
  - opacity.
  - brightness.
  - contrast.
  - per-visual playback rate.
  - file size refreshed during metadata validation.
- Apply visual appearance controls in display renderer and previews.
- Add audio source detail controls:
  - label.
  - path/source visual.
  - duration/readiness/file size refreshed during metadata validation.
  - source-level fader.
  - per-source playback rate.
- Apply audio source rate/level in Web Audio runtime.
- Persist new durable media fields in schema version 4 or as an explicit schema version 3 extension only if backward compatibility is guaranteed. Do not persist transient solo, global audio mute, or global display blackout.

Acceptance:

- Selecting any media source opens a meaningful detail editor.
- Visual settings affect public displays and previews.
- Audio source-level gain participates correctly in the three-level audio model:
  - source/file level.
  - per-output source-send level.
  - virtual output bus level.

### Phase 7: Resizable Layout And UI Preferences

Goal: make the operator console adaptable without destabilizing playback.

Tasks:

- Add horizontal splitter between media pool and display workspace.
- Add vertical splitter between workspace and footer.
- Add horizontal splitter between mixer and details.
- Add internal splitter between asset list and asset preview.
- Store split sizes in renderer-local storage with versioned preference key.
- Add min/max sizes so panels cannot collapse into broken states.

Acceptance:

- Pane resizing is pointer-driven, keyboard-accessible where practical, and stable.
- Text and controls do not overlap at the app minimum size.
- Preferences restore on reload.

### Phase 8: Global Status, Config, Logs, And Future Rails

Goal: round out shell surfaces without overbuilding future roadmap features.

Tasks:

- Add footer engine/runtime version from a dedicated runtime version source, starting at `v0.0.4`.
- Add session-scoped global audio mute.
- Add session-scoped global display blackout.
- Add reset meters.
- Add a Config/Logs surface for readiness issues, diagnostics export, physical output refresh, and Director State.
- Add or update a runtime changelog so release-facing engine changes can be tracked separately from package metadata.
- Keep Cue and Performance as placeholders unless active implementation begins.

Acceptance:

- Operator can access diagnostics and raw Director State without crowding Patch.
- Global mute/blackout state is visible and reversible.
- Future rails do not create fake functionality.

### Phase 9: Hardening, Tests, And Packaged UX Validation

Goal: prove the new UI did not weaken show behavior.

Tasks:

- Unit tests:
- new persisted fields and migrations.
- runtime version source and changelog entry for `v0.0.4`.
- global mute/blackout state.
  - output mute behavior and transient solo graph behavior.
  - per-media rate and level calculations.
  - loop/rate interactions after UI commands.
- Renderer tests or smoke scripts:
  - app shell renders required regions.
  - icon buttons have accessible names.
  - media pool selection opens Details.
  - display selection opens Details.
  - mixer fader updates output state.
- Manual hardware checks:
  - Windows display placement/fullscreen.
  - macOS display placement/fullscreen.
  - audio sink enumeration and fallback.
  - multi-output audio test tones.
  - display drift reporting.
  - save/open and diagnostics export.

Acceptance:

- `npm run build` passes.
- Manual test doc is updated.
- Packaged app smoke test passes on target platforms before release.

## 10. Data Model And IPC Changes

### 10.1 Likely Type Additions

Add only when the corresponding UI/runtime behavior lands:

```ts
type SelectedEntity =
  | { type: 'visual'; id: VisualId }
  | { type: 'audio-source'; id: AudioSourceId }
  | { type: 'display'; id: DisplayWindowId }
  | { type: 'output'; id: VirtualOutputId };

type VisualUpdate = {
  label?: string;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  playbackRate?: number;
};

type AudioSourceUpdate = {
  label?: string;
  levelDb?: number;
  playbackRate?: number;
};

type DisplayUpdate = {
  label?: string;
  layout?: VisualLayoutProfile;
  fullscreen?: boolean;
  displayId?: string;
};

type VirtualOutputUpdate = {
  muted?: boolean;
  busLevelDb?: number;
  sources?: VirtualOutputSourceSelection[];
  sinkId?: string;
  sinkLabel?: string;
};
```

### 10.2 IPC Additions

Likely additions:

- `director:update-global-state` for global mute/blackout.
- `renderer:display-telemetry` for frame-rate reporting if implemented.
- `visual:drop-add` is not necessary; drag/drop can call existing `visual:add` only if main-process dialog is used. True file drag/drop needs a new IPC that accepts sanitized dropped file paths from the renderer.

For Electron security, dropped file paths should be validated in the main process before becoming media records.

### 10.3 Persistence Version

Current persistence supports schema version 3 only. Adding durable visual appearance fields, source gain/rate, display labels, and refreshed file-size metadata should trigger schema version 4.

Schema version 4 should include:

- all current v3 fields.
- visual appearance/rate/file size where applicable.
- audio source source-level gain/rate/file size where applicable.
- display label and telemetry preferences if persisted.
- no virtual output solo; solo is transient live-session state.
- no global mute/blackout; both are transient live-session state.
- optional UI preferences only if they are show-scoped; otherwise keep them in local storage.

Add migration:

- v3 -> v4: fill defaults.
- v1/v2 compatibility only if older configs are expected in real use. Current `showConfig.ts` rejects anything except v3, so this should be addressed before external release if old show files exist.

The schema v4 work should be coordinated with the runtime version move to `v0.0.4`, and the runtime changelog should call out the schema change.

### 10.4 Runtime Versioning

Maintain an engine/runtime version separately from `package.json`.

Recommended implementation:

- Add a small shared version module, for example `src/shared/version.ts`, exporting `XTREAM_RUNTIME_VERSION = 'v0.0.4'`.
- Display the runtime version in the status footer.
- Include both `appVersion` and `runtimeVersion` in diagnostics.
- Add a dedicated changelog, for example `docs/runtime-changelog.md`, beginning with `v0.0.4`.
- Use runtime changelog entries for schema, playback engine, routing, display, sync, and diagnostics changes.
- Keep `package.json` version for packaged app/distribution metadata.

## 11. Accessibility And Interaction Requirements

Non-negotiables for the refactor:

- All icon-only buttons need `aria-label`.
- All inputs/selects need real labels or accessible labels.
- Keyboard users must be able to operate transport, popovers, tabs, selects, and splitters.
- Focus states must be visible against dark backgrounds.
- Destructive actions such as remove visual/source/display/output need confirmation or undo when they can destroy configuration.
- Long labels and file paths must truncate or wrap without breaking layout.
- The app minimum window size must not produce overlapping UI.
- Status updates and readiness changes should use an `aria-live="polite"` region.
- Meters should not be the only indicator of audio state; include numeric dB where meaningful.
- Do not rely only on color for Ready/Blocked/Degraded states.

## 12. Performance Requirements

The refactor will add more live surfaces. Protect runtime performance with these constraints:

- Keep public display windows display-only.
- Keep preview videos muted.
- Reuse existing media sync helpers for previews and displays.
- Avoid rebuilding large DOM subtrees on every animation frame.
- Continue using render signatures or more granular update functions.
- Throttle meter DOM updates and IPC reports.
- Use `content-visibility: auto` or simple list virtualization if media lists exceed roughly 50 items.
- Do not use box shadows, blur-heavy effects, or decorative animations.
- Respect reduced-motion preferences for any panel expansion/popover animation.

## 13. Regression And Acceptance Checklist

Functional acceptance:

- App launches exactly one control window and no display windows by default.
- Visual import supports multiple videos/images.
- Visual Pool and Audio Pool are still backed by real director state.
- Display windows can be created, reopened, closed, removed, fullscreened, and assigned to monitors.
- Single and split layouts render correctly in public display and control preview.
- Image visuals remain static and do not create sync pressure.
- Video visuals follow transport, seek, rate, loop, and drift correction.
- Audio sources can be external or embedded visual audio.
- Virtual outputs can select multiple sources, set per-source level, set bus level, route to sink, mute/solo, show meter, and play test tone.
- Readiness blocks play when active displays/media/outputs are invalid.
- Save/open preserves show state through schema migration.
- Diagnostics include the new state.
- Diagnostics include both package app version and engine/runtime version.

UX acceptance:

- First screen is the usable Patch operator console.
- Header, nav rail, workspace, mixer/details, and status footer persist.
- Common actions are icon-first with accessible labels.
- Details pane changes based on selection.
- Pane resizing works within stable bounds.
- No rounded cards/shadows remain in the control shell.
- Text does not overlap or overflow in minimum supported window size.

Technical acceptance:

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- Manual test doc is updated.
- Runtime changelog includes the `v0.0.4` schema v4/runtime entry.
- Hardware smoke tests are recorded for Windows and macOS targets.

## 14. Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Large `control.ts` churn breaks audio/runtime behavior | High | Extract audio runtime/media sync before visual refactor |
| Static prototype encourages copying CDN/Tailwind/Material Symbols literally | Medium | Treat prototype as layout reference; follow `DESIGN.md` for Lucide and production build |
| Details pane adds fields not represented in state | High | Add type, IPC, persistence, and tests with each field |
| More live previews increase CPU/GPU load | Medium | Keep previews muted, modest size, throttle sync, add future preview quality setting if needed |
| Resizable panes can create unusable layouts | Medium | CSS min/max constraints and reset layout action |
| Solo semantics are transient but operationally important | Medium | Keep solo renderer/session-scoped, make active solo state prominent, and provide Solo Clear |
| Global blackout/mute could surprise operators | High | Make state prominent, reversible, session-scoped, and never restored silently from a show file |
| Schema v4 migration breaks existing configs | High | Add migration tests and keep v3 fixture coverage |
| Tailwind adoption adds build complexity | Low/Medium | Treat Tailwind setup as required Phase 1 work and keep token definitions centralized |

## 15. Recommended Build Order

The safest order is:

1. Stabilize and modularize renderer code.
2. Implement design tokens and shell skeleton.
3. Move transport into header.
4. Build tabbed Media Pool.
5. Build display workspace cards.
6. Build mixer strips.
7. Build dynamic Details pane.
8. Add new state fields for visual/audio/display/output details.
9. Add resizable panes.
10. Add global status/footer actions.
11. Harden tests, migrations, and manual test docs.

This order keeps the current working runtime visible throughout the refactor and avoids mixing layout work with deep playback model changes too early.

## 16. Product Decisions

Resolved decisions:

- Solo state is transient operator/session state. It affects the live Web Audio graph, resets with the session, and is not saved to show files.
- Global audio mute and global display blackout are live-session controls. They apply to the current session and are not restored from a show file.
- Visual opacity, brightness, and contrast apply globally to that visual everywhere it is used.
- Visual playback rate and audio-source playback rate are media-record properties, and global playback rate multiplies on top of them.
- File size is refreshed when media metadata is revalidated.
- Cue and Performance rail items should be placeholders until implementation begins.
- Tailwind is mandatory for the control UI refactor.
- Xtream maintains a separate engine/runtime version and changelog. The starting runtime version is `v0.0.4`.

## 17. Near-Term Next Step

Begin with Phase 0 and Phase 1 in a single branch:

- Extract `control.ts` runtime-heavy helpers.
- Add tokenized control-shell CSS.
- Create the shell layout with existing controls moved into their future regions.
- Keep all current IPC and director behavior unchanged.

That gives the project a visible transformation quickly while preserving the already-working pool, timeline, display, audio, persistence, and diagnostics foundations.
