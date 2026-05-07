# Src Structure Refactor Plan

## Purpose

This plan identifies the bulkiest files under `src` that are good candidates for splitting into smaller, more maintainable modules. It is based on a local size scan of production code, tests, styles, and markup, followed by a quick review of the largest internal blocks.

The goal is not to split files just because they are large. The goal is to separate stable responsibilities, reduce edit conflicts, make tests easier to target, and keep orchestration files readable.

## Scan Snapshot

| Area | Count |
| --- | ---: |
| Relevant files under `src` | 195 |
| Production code files | 130 |
| Test files | 49 |
| CSS files | 13 |
| HTML files | 3 |

Largest production code files:

| File | Lines | Notes |
| --- | ---: | --- |
| `src/main/streamEngine.ts` | 2760 | Runtime state machine; split carefully. |
| `src/main/main.ts` | 1723 | Electron bootstrap plus IPC, file dialogs, persistence, media import, capture permissions. |
| `src/main/director.ts` | 1643 | Main app state model; split carefully by domain. |
| `src/renderer/control/stream/streamSurface.ts` | 1310 | Stream workspace orchestrator mixing render signatures, DOM sync, selection, layout, and persistence. |
| `src/shared/types.ts` | 1217 | Large shared type registry; candidate for domain type barrels. |
| `src/renderer/control/patch/mediaPool.ts` | 1173 | Media pool controller with rows, menus, drag/drop, import, filtering, and live capture UI. |
| `src/renderer/control/media/audioRuntime.ts` | 915 | Web Audio graph, transport envelopes, meters, previews, and utilities. |
| `src/renderer/control/patch/mixerPanel.ts` | 852 | Mixer rendering, meters, faders, output source controls, context menus. |
| `src/shared/streamSchedule.ts` | 797 | Pure-ish validation, trigger graph, duration, and schedule building logic. |
| `src/main/showConfig.ts` | 656 | Persistence, migration, media URL hydration, diagnostics helpers. |

Largest style files:

| File | Lines | Notes |
| --- | ---: | --- |
| `src/renderer/styles/control/stream.css` | 2236 | Stream header, scene list, flow, gantt, scene edit, output gantt, details. |
| `src/renderer/styles/control/patch-mixer-display.css` | 1551 | Mixer strips, meters, displays, output details, routing/source controls. |
| `src/renderer/styles/control/patch-media-pool.css` | 661 | Media pool layout and item states. |
| `src/renderer/styles/control/shell.css` | 433 | Shell and surface chrome. |
| `src/renderer/styles/control/patch-layout.css` | 393 | Patch workspace layout. |

## Refactor Principles

- Keep behavior unchanged in each step. Prefer move-only or extract-only commits before functional edits.
- Preserve public imports first, then simplify call sites after tests pass.
- Split by responsibility, not by arbitrary line count.
- Keep state owners obvious. For state machines, extract pure helpers before extracting mutable state.
- Add focused tests around extracted pure modules when coverage is cheap.
- Keep CSS import order explicit in `src/renderer/control.css`.
- For CSS splits, move rules in cascade-safe chunks and verify the rendered control UI after each chunk.

## Priority 1: Best Code Split Candidates

### `src/main/main.ts`

Why split:

- 1723 lines with many unrelated responsibilities.
- `registerIpcHandlers()` is about 684 lines by itself.
- This is a strong candidate because many sections are already top-level helper functions and IPC groups.

Recommended target shape:

| New module | Responsibility |
| --- | --- |
| `src/main/appWindows.ts` | `createControlWindow`, `createAudioWindow`, trusted webContents/origin helpers if needed by windows. |
| `src/main/ipc/registerIpcHandlers.ts` | Thin registration entry point that wires sub-registrars. |
| `src/main/ipc/showConfigHandlers.ts` | Open/create/save dialogs, unsaved prompts, explicit save, recent shows. |
| `src/main/ipc/mediaPoolHandlers.ts` | Visual/audio import, dropped files, missing media relink. |
| `src/main/ipc/displayHandlers.ts` | Display creation/update/close, monitor queries, display media grants. |
| `src/main/ipc/streamHandlers.ts` | Stream edit/transport state bridge. |
| `src/main/capturePermissions.ts` | Desktop capture permission handlers and pending grants. |
| `src/main/embeddedAudioExtraction.ts` | FFmpeg path, args, extraction, error summarization. |
| `src/main/controlUiStateStore.ts` | Per-project control UI snapshot persistence. |

Suggested sequence:

1. Extract `controlUiStateStore.ts`; it has clear inputs and low coupling.
2. Extract `capturePermissions.ts`; pass in only the state and callbacks it needs.
3. Extract `embeddedAudioExtraction.ts`; keep `Director` mutation in `main.ts` at first if needed.
4. Split `registerIpcHandlers()` into domain registration functions.
5. Once handlers are split, move window creation if it no longer depends on local globals.

Verification:

- `npm run typecheck`
- `npm test -- src/main`
- Manual smoke test: launch app, open/create/save a show, import media, open display, run stream transport.

### `src/renderer/control/patch/mediaPool.ts`

Why split:

- 1173 lines and 63 function-like blocks.
- One controller owns rendering, filtering, sorting, context menus, live capture modal, drag/drop, and import plumbing.
- Many extraction points are DOM factories or pure signature builders.

Recommended target shape:

| New module | Responsibility |
| --- | --- |
| `src/renderer/control/patch/mediaPool/types.ts` | Pool tab/sort/layout/controller option types. |
| `src/renderer/control/patch/mediaPool/visualRows.ts` | Visual list rows and grid cards. |
| `src/renderer/control/patch/mediaPool/audioRows.ts` | Audio source rows. |
| `src/renderer/control/patch/mediaPool/contextMenus.ts` | Visual/audio context menus and menu positioning. |
| `src/renderer/control/patch/mediaPool/liveCaptureModal.ts` | Live source menu, capture modal, webcam/desktop source buttons. |
| `src/renderer/control/patch/mediaPool/filtering.ts` | Query matching, sort comparators, visible visual/audio selection. |
| `src/renderer/control/patch/mediaPool/dragDrop.ts` | File drag detection, dropped paths, file URI parsing. |
| `src/renderer/control/patch/mediaPool/signatures.ts` | Render signature helpers. |

Suggested sequence:

1. Extract `filtering.ts` and `signatures.ts` because they are easiest to test.
2. Extract `dragDrop.ts` as a small utility module.
3. Extract DOM row/card factories while passing callbacks through options.
4. Extract context menus.
5. Extract live capture modal last, since it owns temporary media resources.

Verification:

- Existing media pool and import tests, if present.
- `npm run typecheck`
- Manual smoke test: list/grid toggle, search, visual/audio tabs, import files, drag/drop, context menus, live capture picker.

### `src/renderer/control/patch/mixerPanel.ts`

Why split:

- 852 lines and 43 function-like blocks.
- Clear feature boundaries: meters, faders, output strips, source controls, solo state, context menu.

Recommended target shape:

| New module | Responsibility |
| --- | --- |
| `src/renderer/control/patch/mixerPanel/types.ts` | Controller options and local view types. |
| `src/renderer/control/patch/mixerPanel/meterPainting.ts` | Meter UI painting, segment sync, lane/peak caches. |
| `src/renderer/control/patch/mixerPanel/meterBallisticsRuntime.ts` | Smoothing and animation loop state. |
| `src/renderer/control/patch/mixerPanel/mixerStrip.ts` | Strip DOM construction and selection handlers. |
| `src/renderer/control/patch/mixerPanel/audioFader.ts` | Fader element creation and sync. |
| `src/renderer/control/patch/mixerPanel/outputSourceControls.ts` | Output source rows, level/pan/mute/solo controls. |
| `src/renderer/control/patch/mixerPanel/contextMenu.ts` | Output context menu and dismiss listeners. |
| `src/renderer/control/patch/mixerPanel/signatures.ts` | Render and solo signatures. |

Suggested sequence:

1. Extract `signatures.ts`.
2. Extract context menu helpers.
3. Extract `audioFader.ts`.
4. Extract `meterPainting.ts` and keep cache ownership in the controller initially.
5. Extract strip and output source controls.

Verification:

- `npm run typecheck`
- Relevant mixer/presentation tests.
- Manual smoke test: add/remove outputs, select strip, move fader, pan, mute/solo, meter activity, output detail controls.

### `src/renderer/control/stream/streamSurface.ts`

Why split:

- 1310 lines, but it should remain the Stream surface orchestrator.
- Contains render signatures, runtime DOM sync, workspace layout, selection sync, project UI snapshot hydration, keyboard transport, bottom pane coordination, and child controller wiring.

Recommended target shape:

| New module | Responsibility |
| --- | --- |
| `src/renderer/control/stream/streamSurface/signatures.ts` | Structural stream render model, header/bottom render signatures. |
| `src/renderer/control/stream/streamSurface/runtimeChrome.ts` | List runtime class sync and runtime-only DOM refresh helpers. |
| `src/renderer/control/stream/streamSurface/selection.ts` | Selected scene/entity helpers and scene edit selection sync. |
| `src/renderer/control/stream/streamSurface/projectUiSnapshot.ts` | Export/import of stream project UI state. |
| `src/renderer/control/stream/streamSurface/workspaceTransportKeys.ts` | Keyboard transport handling for stream workspace. |
| `src/renderer/control/stream/streamSurface/shellMount.ts` | Shell creation, mount/unmount lifecycle helpers if dependencies are clean. |

Suggested sequence:

1. Extract pure signature/model helpers.
2. Extract runtime DOM sync helpers.
3. Extract project UI snapshot import/export.
4. Extract workspace transport key handler.
5. Keep controller state and child controller ownership in `streamSurface.ts`.

Verification:

- `npm run typecheck`
- `npm test -- src/renderer/control/stream`
- Manual smoke test: switch list/flow/gantt, select scenes, edit sub-cues, hydrate layout, run/pause/seek stream.

### `src/renderer/control/media/audioRuntime.ts`

Why split:

- 915 lines with Web Audio graph reconciliation, output transport, meters, preview playback, utility math, and sink routing.
- Good split candidate, but runtime object lifetimes should remain easy to follow.

Recommended target shape:

| New module | Responsibility |
| --- | --- |
| `src/renderer/control/media/audioRuntime/types.ts` | Runtime local types. |
| `src/renderer/control/media/audioRuntime/graphSignature.ts` | Audio graph signature helpers. |
| `src/renderer/control/media/audioRuntime/outputGraph.ts` | Output/source runtime create, reconcile, dispose. |
| `src/renderer/control/media/audioRuntime/transportEnvelope.ts` | Play/pause/fade envelope and director transport sync. |
| `src/renderer/control/media/audioRuntime/meters.ts` | Meter sampling and meter display conversion helpers. |
| `src/renderer/control/media/audioRuntime/preview.ts` | Audio source preview and test tone helpers. |
| `src/renderer/control/media/audioRuntime/routing.ts` | Sink routing and hidden output element setup. |

Suggested sequence:

1. Extract dB/meter conversion helpers if tests can lock behavior.
2. Extract graph signature helpers.
3. Extract preview/test-tone code.
4. Extract transport envelope.
5. Extract graph reconciliation last.

Verification:

- `npm run typecheck`
- `npm test -- src/renderer/control/media/audioRuntime.test.ts`
- Manual smoke test: audio preview, bus routing, output meters, mute/fade, output delay, device routing.

### `src/shared/streamSchedule.ts`

Why split:

- 797 lines with mostly pure shared logic.
- Good candidate for incremental extraction because tests already target this area.

Recommended target shape:

| New module | Responsibility |
| --- | --- |
| `src/shared/streamSchedule/labels.ts` | `scenePrimaryLabel`, sub-cue labels. |
| `src/shared/streamSchedule/structureValidation.ts` | Structure and trigger-reference validation. |
| `src/shared/streamSchedule/contentValidation.ts` | Media/output/content validation and authoring highlights. |
| `src/shared/streamSchedule/durations.ts` | Sub-cue and scene duration estimation. |
| `src/shared/streamSchedule/triggerGraph.ts` | Dependency edges and cycle detection. |
| `src/shared/streamSchedule/buildSchedule.ts` | Schedule construction. |
| `src/shared/streamSchedule.ts` | Compatibility barrel exporting the same API. |

Suggested sequence:

1. Create folder modules while leaving `src/shared/streamSchedule.ts` as the public barrel.
2. Extract labels and duration helpers first.
3. Extract trigger graph and structure validation.
4. Extract content validation.
5. Extract schedule builder last.

Verification:

- `npm test -- src/shared/streamSchedule.test.ts`
- `npm run typecheck`

## Priority 2: Large But Split Carefully

### `src/main/streamEngine.ts`

Why careful:

- 2760 lines, but most of the file is one runtime state machine.
- A mechanical split could scatter mutable playback state and make runtime bugs harder to diagnose.

Recommended extraction order:

| Candidate | Reason |
| --- | --- |
| Runtime projection keys and active sub-cue collection | Mostly helper logic around audio/visual cue projection. |
| Duration and loop helpers | Can likely move near shared loop/timing utilities. |
| Control sub-cue dispatch helpers | Has a clear responsibility, but touches Director actions. |
| Timeline instance helpers | Useful once thread behavior is stable enough to protect with tests. |
| Validation context helpers | Lower risk and already delegates to shared validators. |

Avoid early:

- Extracting the whole transport state machine.
- Moving fields that represent runtime identity, current timelines, consumed scenes, or manual overrides.
- Introducing several classes before the current mutation model is explicitly documented.

Verification:

- `npm test -- src/main/streamEngine.test.ts`
- Stream manual smoke tests around play, pause, resume, seek, run from here, manual tail, parallel timelines, and control sub-cues.

### `src/main/director.ts`

Why careful:

- 1643 lines and state-heavy.
- It owns the app-level source of truth for visuals, audio sources, outputs, displays, persistence projection, readiness, drift correction, and transport.

Recommended extraction order:

| Candidate | Reason |
| --- | --- |
| ID and creation helpers | Simple, low-risk utilities. |
| Persistence projection helpers | `createShowConfig` and restore helpers can be isolated behind clear inputs. |
| Readiness issue evaluation | Mostly derived state and easy to test. |
| Drift correction helpers | Distinct domain with constants and isolated behavior. |
| Audio source derivation helpers | Good candidate after embedded-audio behavior is covered by tests. |
| Output selection normalization | Distinct logic with testable invariants. |

Avoid early:

- Splitting the state store itself.
- Moving emitter behavior into multiple owners.
- Spreading cross-domain updates across files without a clear transaction boundary.

Verification:

- `npm test -- src/main/director.test.ts`
- `npm test -- src/main/showConfig.test.ts`
- Manual smoke test: import/remove media, split audio, add/remove outputs, restore show, display readiness.

### `src/shared/types.ts`

Why careful:

- 1217 lines and 150 exports, but it is a dependency hub.
- Splitting it will touch imports across the project and can create circular dependency surprises.

Recommended target domains:

| New module | Type area |
| --- | --- |
| `src/shared/types/media.ts` | Visual/audio/media import/update types. |
| `src/shared/types/output.ts` | Virtual output, source selection, meters. |
| `src/shared/types/display.ts` | Display windows, monitors, visual mingle. |
| `src/shared/types/stream.ts` | Scenes, sub-cues, runtime, stream commands. |
| `src/shared/types/showConfig.ts` | Persisted show schema versions and operation results. |
| `src/shared/types/ipc.ts` | IPC channel map and renderer bridge payloads. |
| `src/shared/types/appSettings.ts` | App control and project UI state. |
| `src/shared/types.ts` | Compatibility barrel. |

Suggested sequence:

1. Add domain files and re-export from `types.ts`.
2. Move types in small groups without changing consumer imports.
3. Only after stabilization, update high-traffic imports to import from domain files directly.

Verification:

- `npm run typecheck`
- Full test suite after each larger domain move.

## CSS Refactor Plan

### Current CSS Entry Point

`src/renderer/control.css` is the cascade entry point:

```css
@import "tailwindcss";
@import "./scrollbar.css";
@import "./styles/control/tokens.css";
@import "./styles/control/base.css";
@import "./styles/control/shell.css";
@import "./styles/control/shell-modal.css";
@import "./styles/control/patch-layout.css";
@import "./styles/control/patch-media-pool.css";
@import "./styles/control/patch-mixer-display.css";
@import "./styles/control/stream.css";
@import "./styles/control/config-layout.css";
@import "./styles/control/shared-components.css";
```

Keep this order stable while splitting. Prefer replacing one large import with a feature index file that preserves internal order.

### `src/renderer/styles/control/stream.css`

Why split:

- 2236 lines and about 311 selectors.
- Already grouped by selector families: stream header, middle layout, scene list, flow, gantt, scene edit/subcue, output gantt/detail.

Recommended target shape:

| New file | Rule area |
| --- | --- |
| `src/renderer/styles/control/stream/index.css` | Imports stream CSS chunks in cascade order. |
| `stream/surface.css` | `.stream-surface`, middle layout, panel shells, tabs. |
| `stream/header.css` | Header, transport, timecode, title/note editing. |
| `stream/scene-list.css` | Scene list, rows, status classes, drag/drop rows, subcue line summaries. |
| `stream/flow.css` | Flow canvas, cards, links, hover actions, viewport controls. |
| `stream/gantt.css` | Stream gantt lanes, bars, cursor, empty states. |
| `stream/scene-edit.css` | Scene edit, subcue rail, subcue forms, validation banners. |
| `stream/output-gantt.css` | Output bus gantt rows, bars, live/orphaned states. |
| `stream/detail-panes.css` | Mixer/display/detail panes used inside Stream bottom/details. |
| `stream/responsive.css` | Stream-specific media queries, if any are currently interleaved. |

Suggested sequence:

1. Create `stream/index.css` and point `control.css` at it instead of `stream.css`.
2. Move the top-level surface/header rules first.
3. Move scene list rules as one chunk.
4. Move flow and gantt chunks separately.
5. Move scene edit/subcue rules.
6. Move output gantt and detail pane rules.
7. Delete the old `stream.css` only after visual checks pass.

Verification:

- `npm run build:renderer`
- Manual visual pass at desktop and narrow widths for Stream list, Flow, Gantt, scene edit, output detail.

### `src/renderer/styles/control/patch-mixer-display.css`

Why split:

- 1551 lines and about 194 selectors.
- It mixes Patch mixer, meter lanes, display preview/detail, output detail, and routing controls.

Recommended target shape:

| New file | Rule area |
| --- | --- |
| `src/renderer/styles/control/patch-mixer-display/index.css` | Imports chunks in cascade order. |
| `patch-mixer-display/mixer-panel.css` | Panel layout, output panel, strip collection. |
| `patch-mixer-display/mixer-strip.css` | Mixer strips, labels, fader column, pan knob, mute/solo buttons. |
| `patch-mixer-display/meters.css` | Output meters, meter lanes, scales, peaks, segments. |
| `patch-mixer-display/display-preview.css` | Display list, preview thumbnails, display cards. |
| `patch-mixer-display/output-detail.css` | Output detail toolbar/body, routing row, detail strip. |
| `patch-mixer-display/output-sources.css` | Output source rows, source actions, level/pan controls. |
| `patch-mixer-display/responsive.css` | Responsive adjustments. |

Suggested sequence:

1. Create `patch-mixer-display/index.css` and point `control.css` at it.
2. Move mixer panel/strip base rules.
3. Move meters as a complete chunk.
4. Move display preview/detail rules.
5. Move output detail and output source controls.
6. Preserve comments that explain non-obvious sizing and clipping constraints.

Verification:

- `npm run build:renderer`
- Manual visual pass: Patch mixer, meter activity, output detail, display previews, Stream bottom mixer/detail panes.

### `src/renderer/styles/control/patch-media-pool.css`

Why split:

- 661 lines and about 89 selectors.
- Lower priority than the two files above, but it should be revisited after `mediaPool.ts` is split.

Recommended target shape:

| New file | Rule area |
| --- | --- |
| `src/renderer/styles/control/patch-media-pool/index.css` | Imports chunks in cascade order. |
| `patch-media-pool/layout.css` | Pool shell, tabs, toolbar, empty states. |
| `patch-media-pool/visual-list.css` | Visual rows and grid cards. |
| `patch-media-pool/audio-list.css` | Audio rows and source state. |
| `patch-media-pool/context-menu.css` | Context menus and transient popovers. |
| `patch-media-pool/live-capture.css` | Live capture modal/source picker. |
| `patch-media-pool/drag-drop.css` | Drag-over and drop affordances. |

Verification:

- `npm run build:renderer`
- Manual visual pass: Patch media pool and Stream media pool variants.

## Suggested Implementation Milestones

### Milestone 1: Low-Risk Shared Logic

- Split `src/shared/streamSchedule.ts` behind a compatibility barrel.
- Extract pure helpers from `mediaPool.ts`: filtering, signatures, drag/drop.
- Extract `mixerPanel.ts` signatures and context menu helpers.

Expected benefit:

- Smaller tests and fewer risky runtime changes.
- Establishes the module naming pattern for the rest of the refactor.

### Milestone 2: Renderer Controller Decomposition

- Finish `mediaPool.ts` extraction.
- Finish `mixerPanel.ts` extraction.
- Extract `streamSurface.ts` signature/runtime/snapshot helpers while keeping it as orchestrator.

Expected benefit:

- Renderer UI files become easier to edit independently.
- DOM factories and render signatures become easier to test and review.

### Milestone 3: Main Process Decomposition

- Split `main.ts` into window, IPC, capture, extraction, and control UI state modules.
- Keep `main.ts` as app bootstrap and dependency wiring.

Expected benefit:

- IPC changes become domain-local.
- Electron lifecycle code is easier to audit.

### Milestone 4: CSS Decomposition

- Split `stream.css`.
- Split `patch-mixer-display.css`.
- Optionally split `patch-media-pool.css`.

Expected benefit:

- Feature-specific styling becomes easier to review.
- Cascade order remains explicit through index files.

### Milestone 5: State Machine Helper Extraction

- Extract carefully chosen pure helpers from `streamEngine.ts`.
- Extract helper domains from `director.ts`.
- Split `shared/types.ts` behind a compatibility barrel if import churn is acceptable.

Expected benefit:

- The largest files shrink without obscuring mutable runtime ownership.

## Review Checklist For Each Refactor PR

- Does the old public import path still work, or are all call sites updated consistently?
- Did any extracted module introduce a circular import?
- Is the state owner still clear?
- Are tests covering at least one extracted pure module or critical behavior?
- Did CSS chunk order preserve the previous cascade?
- Was the UI checked where the moved CSS applies?
- Did the PR avoid behavior changes unless explicitly scoped?

## Do Not Do Yet

- Do not split `StreamEngine` into several cooperating classes before documenting runtime state ownership.
- Do not delete compatibility barrels during the first split pass.
- Do not update every import in the repo just to make paths "cleaner".
- Do not mix CSS file moves with visual redesign.
- Do not split tests mechanically unless they block maintainability.

