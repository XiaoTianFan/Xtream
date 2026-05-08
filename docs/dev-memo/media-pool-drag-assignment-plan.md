# Media Pool Drag Assignment Plan

## Purpose

Improve the shared media pool so pool items can be dragged out of the pool and assigned directly in Patch and Stream workspaces.

The feature should support:

- Drag audio pool items from the media pool onto Patch output bus channel strips.
- Drag visual pool items from either the visual list row or grid card onto Patch display preview zones.
- Drag audio pool items onto Stream scene rows in List mode or scene cards in Flow mode to create audio sub-cues.
- Drag visual pool items onto Stream scene rows in List mode or scene cards in Flow mode to create visual sub-cues.

This memo is based on the current renderer, IPC, and Stream engine architecture. It is a planning document only; it does not implement the feature.

## Current Architecture

### Shared State And IPC

The renderer talks to app state through the `window.xtream` preload API. The relevant mutators already exist:

- `window.xtream.outputs.addSource(outputId, audioSourceId)` maps an audio source to a Patch virtual output.
- `window.xtream.displays.update(displayId, { layout })` changes a Patch display window visual layout.
- `window.xtream.stream.edit({ type: 'update-scene', sceneId, update })` is the current way to add/remove/reorder Stream sub-cues.

Main-process IPC handlers autosave show changes after these mutations. No new main-process IPC is required for the first implementation.

The relevant persisted data structures live in `src/shared/types.ts`:

- `AudioSourceState` and `VisualState` are media pool entries.
- `VirtualOutputState.sources` stores Patch output source selections.
- `DisplayWindowState.layout` stores single or split display visual assignment.
- `PersistedSceneConfig.subCues` and `subCueOrder` store Stream audio/visual/control sub-cues.

### Media Pool

The media pool is implemented once in Patch modules and reused by Stream:

- Controller: `src/renderer/control/patch/mediaPool.ts`
- Rows/cards: `src/renderer/control/patch/mediaPool/rows.ts`
- File-drop import helpers: `src/renderer/control/patch/mediaPool/dragDrop.ts`
- Stream mounting: `src/renderer/control/stream/shell.ts`

Today, drag/drop in `mediaPool.ts` only handles external file drops onto the pool panel via `DataTransfer.types.includes('Files')`. Pool items themselves are not draggable. Visual list rows, visual grid cards, and audio rows are ordinary clickable/context-menu elements.

### Patch Audio Target

Patch output strips are rendered by:

- `src/renderer/control/patch/mixerPanel.ts`
- `src/renderer/control/patch/mixerPanel/mixerStrip.ts`
- `src/renderer/control/patch/mixerPanel/outputSourceControls.ts`

`mixerStrip.ts` creates both normal strips and detail strips with `data-output-strip`. The existing add-source selector in `outputSourceControls.ts` filters out sources already routed to that output, then calls `window.xtream.outputs.addSource`.

Drag assignment should reuse that behavior: dropping an already-routed source should not create duplicate source rows.

### Patch Visual Target

Patch displays are rendered by:

- `src/renderer/control/patch/displayWorkspace.ts`
- `src/renderer/control/patch/displayPreview.ts`

`createDisplayPreview()` currently renders panes only for visual ids returned by `getPreviewVisualIds(layout)`. This means empty single displays and empty split zones may have no pane element to drop onto. The feature needs explicit display-zone hit areas even when the zone has no assigned visual.

Display assignment is a layout update:

- Single display: `{ type: 'single', visualId }`
- Split display left: `{ type: 'split', visualIds: [visualId, existingRight] }`
- Split display right: `{ type: 'split', visualIds: [existingLeft, visualId] }`

Because Patch display previews can be rendered from a Stream-derived presentation state, the drop handler should fetch the latest raw director state before building the persisted layout update. The visible preview can still use presentation state for rendering.

### Stream Scene Targets

Stream mounts the same media pool next to a workspace pane:

- Stream controller: `src/renderer/control/stream/streamSurface.ts`
- Workspace routing: `src/renderer/control/stream/workspacePane.ts`
- List mode: `src/renderer/control/stream/listMode.ts`
- Flow mode: `src/renderer/control/stream/flowMode.ts`
- Flow card component: `src/renderer/control/stream/flowCards.ts`

List mode already uses HTML5 drag/drop for scene reordering. It stores the dragged scene id in `text/plain` and uses `listDragSceneId` in context to distinguish active scene reorder drags.

Flow mode does not use HTML5 drag/drop for card movement. It uses pointer events through `FlowReteCanvas` and `createFlowSceneCard()`. HTML5 media drops can be added to flow cards without interfering with the existing pointer-based move/resize behavior, as long as the media drop handlers live on the card wrapper/card and do not start pointer drags.

Stream sub-cues are currently added in the scene edit rail:

- `src/renderer/control/stream/sceneEdit/subCueRail.ts`
- `src/renderer/control/stream/sceneEdit/subCueDefaults.ts`
- `src/renderer/control/stream/sceneEdit/subCueIds.ts`

There is no `create-subcue` IPC command. The rail creates a new sub-cue id, builds a default cue, then patches the whole scene with updated `subCues` and `subCueOrder`.

## Design

### 1. Add A Pool Media Drag Payload

Extend or split `src/renderer/control/patch/mediaPool/dragDrop.ts` with media-pool payload helpers.

Recommended payload:

```ts
export const XTREAM_MEDIA_POOL_ITEM_MIME = 'application/x-xtream-media-pool-item';

export type MediaPoolDragPayload =
  | { type: 'visual'; id: VisualId }
  | { type: 'audio-source'; id: AudioSourceId };
```

Add helpers:

- `writeMediaPoolDragPayload(dataTransfer, payload)`
- `readMediaPoolDragPayload(dataTransfer)`
- `isMediaPoolDragEvent(event)`

Use the custom MIME type as the authoritative signal. Avoid relying on `text/plain`, because Stream list scene reordering already uses `text/plain` for scene ids. A plain text fallback can be set for accessibility/debugging, but target handlers must only accept the custom MIME payload.

Keep file import helpers separate from media-item helpers:

- File drops into the pool continue to use `Files`.
- Media-item drags out of the pool use `application/x-xtream-media-pool-item`.

### 2. Make Pool Items Draggable

Update `createVisualRow`, `createVisualGridCard`, and `createAudioSourceRow` in `rows.ts`:

- Set `draggable = true`.
- On `dragstart`, write the custom payload.
- Use `effectAllowed = 'copy'`.
- Add a drag-source class for styling.
- Ignore drag starts from remove/context action controls.
- On `dragend`, remove drag-source styling.

Both visual representations must be draggable:

- `.asset-row` for visual list layout.
- `.visual-pool-card` for visual grid layout.

Audio source rows already share `.asset-row`, but should emit `type: 'audio-source'`.

### 3. Patch: Drop Audio Onto Output Bus Strips

Add audio-drop support in the mixer layer.

Recommended implementation:

- Add optional drop callbacks to `MixerStripDeps` in `mixerStrip.ts`.
- Install `dragenter`, `dragover`, `dragleave`, and `drop` on both normal and detail strips.
- Accept only payloads where `payload.type === 'audio-source'`.
- On drop, call a mixer controller helper that:
  - Fetches or uses current director state.
  - Validates the output and audio source still exist.
  - Checks whether `output.sources` already contains the source.
  - Calls `window.xtream.outputs.addSource(outputId, audioSourceId)` only when not already assigned.
  - Fetches `window.xtream.director.getState()` afterward and calls `renderState`.
  - Refreshes detail panes and meters as needed.

`MixerPanelControllerOptions` should gain `setShowStatus` so duplicate/invalid drops can produce concise feedback:

- `"Audio source already routed to Main Output."`
- `"Drop an audio source onto an output bus."`

This keeps drag assignment aligned with the existing Add Source selector, which prevents duplicates.

### 4. Patch: Drop Visuals Onto Display Preview Zones

Refactor display preview rendering so every visual zone has a drop target.

Recommended changes:

- Add a helper in `displayPreview.ts`, for example `getDisplayPreviewZoneEntries(layout)`, returning:
  - Single: one entry with `zoneId: 'single'`, assigned `visualId`.
  - Split: two entries with `zoneId: 'L'` and `zoneId: 'R'`, assigned visual ids when present.
- Render one `.display-preview-pane` per zone, even when no visual is assigned.
- Set `data-display-zone` on each pane.
- Keep `data-visual-id` only when a visual is assigned.
- Preserve current preview behavior for image, video, live capture, blackout, and progress edge.

Then update `displayWorkspace.ts`:

- Attach media-pool visual drag handlers to preview panes and the card as a fallback.
- Accept only payloads where `payload.type === 'visual'`.
- Resolve the intended zone from:
  - The closest `[data-display-zone]`, or
  - The pane under the event coordinates, or
  - A sensible default: `single` for single layout, first empty split zone otherwise left.
- Fetch latest raw director state before writing the layout.
- Preserve the other split zone when replacing one side.
- Call `window.xtream.displays.update(displayId, { layout })`.
- Render the next director state.

This is the main architectural change needed for Patch visuals. Without always-rendered zones, users could not drop onto an empty display or an empty split side.

### 5. Stream: Add A Shared Scene Media-Drop Authoring Helper

Create a Stream helper, for example:

`src/renderer/control/stream/sceneEdit/addMediaSubCueFromPool.ts`

Responsibilities:

- Accept `scene`, `sceneId`, `stream`, `directorState`, and a `MediaPoolDragPayload`.
- Create a new sub-cue id with `createNewSubCueId()`.
- For audio:
  - Build `buildDefaultAudioSubCue(id, directorState)`.
  - Override `audioSourceId` with the dropped source id.
  - Keep default output routing behavior, currently first available output.
- For visual:
  - Build `buildDefaultVisualSubCue(id, directorState)`.
  - Override `visualId` with the dropped visual id.
  - Keep default display target behavior, currently all displays with left zone for split displays.
- Patch the scene via `window.xtream.stream.edit({ type: 'update-scene', sceneId, update })`.
- Return the new `subCueId` and next `StreamEnginePublicState`.

Do not duplicate this logic inside both `listMode.ts` and `flowMode.ts`.

For visual drops, decide explicitly whether to mirror the rail's `maybeAppendEmbeddedAfter()` behavior. The recommended first implementation is visual-only for drag drops, because the requested behavior is "create a new visual sub-cue." The existing Add Sub-Cue menu can keep its embedded-audio convenience behavior.

### 6. Stream: Route Drops Through StreamSurface Context

List and Flow mode components should remain mostly presentational. Add a context callback in `StreamWorkspacePaneContext`, for example:

```ts
addMediaPoolItemToScene: (sceneId: SceneId, payload: MediaPoolDragPayload) => Promise<void>;
```

Implement it in `streamSurface.ts`, where the controller has access to:

- `currentState`
- `streamState`
- `sceneEditSceneId`
- `sceneEditSelection`
- `bottomTab`
- `detailPane`
- `options.setShowStatus`
- `renderCurrent()`

Suggested behavior after a successful drop:

- Set edit focus to the target scene.
- Set `bottomTab = 'scene'`.
- Clear `detailPane`.
- Select the newly created sub-cue in `sceneEditSelection`.
- Request/render current state.
- Optionally expand the target row in List mode so the new cue is visible.

Guardrails:

- Reject missing media ids with status feedback.
- Reject unknown scenes.
- Reject drops when the target scene is currently running or preloading, matching the scene edit pane's current locked-edit behavior.
- Allow drops onto disabled scenes, because disabled scenes are still authorable.

### 7. Stream List Mode Drop Handling

Update `listMode.ts` scene row wrappers:

- In `dragover`, first check `readMediaPoolDragPayload(event.dataTransfer)`.
- If media payload exists:
  - Validate media type is audio or visual.
  - Prevent default.
  - Set `dropEffect = 'copy'`.
  - Add a drop-over class to the row wrapper.
  - Do not call scene reorder indicator logic.
- Otherwise, keep the existing scene reorder behavior.

In `drop`:

- If media payload exists, call `ctx.addMediaPoolItemToScene(scene.id, payload)` and return.
- Otherwise, keep the existing scene reorder drop path.

The list end-drop target should continue to handle only scene reordering, not media assignment.

### 8. Stream Flow Mode Drop Handling

Update `FlowCardHandlers` in `flowCards.ts` to include media drop hooks or a direct scene assignment callback.

Recommended:

- `canAcceptMediaDrop(event, sceneId)`
- `dropMedia(event, sceneId)`

In `createFlowSceneCard()`:

- Attach `dragenter`, `dragover`, `dragleave`, and `drop` to the card or wrapper.
- Accept only the custom media-pool MIME payload.
- Use `dropEffect = 'copy'`.
- Add a visual drop-over class to the card.
- Keep pointer-based card drag/resize untouched.

In `flowMode.ts`, pass handlers that call the new Stream context callback.

### 9. Styling And Feedback

Add small, consistent visual states:

- Pool items: `.media-pool-drag-source`
- Patch output strips: `.mixer-strip.media-drop-target` and `.mixer-strip.media-drop-over`
- Display panes: `.display-preview-pane.media-drop-target` and `.display-preview-pane.media-drop-over`
- Stream list rows: `.stream-scene-row-wrap.media-drop-over`
- Flow cards: `.stream-flow-card.media-drop-over`

Keep the feedback restrained: border/accent glow is enough. Do not introduce large overlays that obscure preview content.

Status feedback should be concise and action-oriented:

- Valid Patch audio: `"Added Kick Loop to Main Output."`
- Duplicate Patch audio: `"Kick Loop is already routed to Main Output."`
- Valid Patch visual: `"Assigned Logo Loop to Display 1 left zone."`
- Valid Stream audio: `"Added audio sub-cue from Kick Loop to Intro."`
- Valid Stream visual: `"Added visual sub-cue from Logo Loop to Intro."`
- Invalid media kind: `"Drop an audio source here."` or `"Drop a visual source here."`

### 10. Accessibility And Interaction Details

HTML5 drag/drop is pointer-first, but keep keyboard workflows intact:

- Existing click, Enter, and Space selection behavior on pool rows/cards should stay unchanged.
- Existing Add Source selector and Add Sub-Cue menu remain the keyboard-accessible alternatives.
- Drag handles should not steal remove-button clicks.
- Scene reorder drag should remain separate from media assignment drag by custom MIME type.
- File drops into the media pool should continue to import files exactly as today.

## Test Plan

Add focused tests rather than broad end-to-end coverage.

### Unit Tests

Add or extend tests for `mediaPool/dragDrop.ts`:

- Writes and reads visual payloads.
- Writes and reads audio-source payloads.
- Ignores malformed JSON.
- Ignores external `Files` drops for media assignment helpers.

### Renderer DOM Tests

Recommended DOM tests:

- Media pool rows/cards set `draggable` and emit the custom payload.
- `createDisplayPreview()` renders a single drop pane even when no visual is assigned.
- `createDisplayPreview()` renders both split panes even when one or both sides are empty.
- Mixer strip drop calls `outputs.addSource` for audio payloads and ignores visual payloads.
- Stream List row drop calls `addMediaPoolItemToScene` for media payloads and keeps scene reorder behavior for scene drags.
- Flow card drop calls the media assignment handler without invoking pointer drag.
- Stream helper creates an audio sub-cue with the dropped `audioSourceId`.
- Stream helper creates a visual sub-cue with the dropped `visualId`.

### Manual Smoke Tests

Patch:

- Drag audio source onto an output strip with no sources.
- Drag the same audio source onto the same output again and confirm no duplicate row.
- Drag visual list row onto a single display preview.
- Switch visual pool to grid and drag a visual card onto a split display left and right zone.
- Drop wrong media kinds onto Patch targets and confirm they are ignored with useful status.

Stream:

- In List mode, drag audio onto a scene row and confirm a selected audio sub-cue appears.
- In List mode, drag visual onto a scene row and confirm a selected visual sub-cue appears.
- Reorder scenes after media drag is implemented to confirm scene reordering still works.
- In Flow mode, drag audio and visual onto scene cards.
- Drag and resize Flow cards after media drag is implemented to confirm pointer interactions still work.

## Implementation Milestones

### Milestone 1: Establish The Drag Payload Contract

Goal: create one reliable way for targets to recognize media-pool drags without interfering with file import drops or Stream scene reorder drags.

Files:

- `src/renderer/control/patch/mediaPool/dragDrop.ts`
- `src/renderer/control/patch/mediaPool/dragDrop.test.ts` or a new adjacent test file

Tasks:

- Add `XTREAM_MEDIA_POOL_ITEM_MIME`.
- Add `MediaPoolDragPayload` with `visual` and `audio-source` variants.
- Add `writeMediaPoolDragPayload(dataTransfer, payload)`.
- Add `readMediaPoolDragPayload(dataTransfer)`.
- Add `isMediaPoolDragEvent(event)` or equivalent guard.
- Keep existing file-drop helpers unchanged.
- Ensure all media assignment targets use only the custom MIME type, not `text/plain`.

Acceptance:

- Unit tests prove valid audio and visual payloads round-trip.
- Malformed JSON, missing MIME data, and external `Files` drops return `undefined` for media-pool payload reads.
- Existing file URI/path parsing tests still pass.

Dependencies:

- None. This should land first because every later target relies on this contract.

### Milestone 2: Make Pool Items Draggable

Goal: let every requested pool representation start a media-pool drag.

Files:

- `src/renderer/control/patch/mediaPool/rows.ts`
- `src/renderer/styles/control/patch-media-pool/visual-list.css`
- Possibly `src/renderer/styles/control/patch-media-pool/list-region.css`

Tasks:

- Set `draggable = true` on audio source rows.
- Set `draggable = true` on visual list rows.
- Set `draggable = true` on visual grid cards.
- On `dragstart`, write `{ type: 'audio-source', id }` or `{ type: 'visual', id }`.
- Set `effectAllowed = 'copy'`.
- Add/remove `.media-pool-drag-source` during drag.
- Do not begin a drag from row/card action buttons such as remove.
- Preserve click, keyboard selection, context menu, and remove behavior.

Acceptance:

- Audio source row drag emits an audio-source payload.
- Visual list row drag emits a visual payload.
- Visual grid card drag emits a visual payload.
- Remove buttons still click without starting a drag.
- File drop import onto the media pool still works.

Dependencies:

- Milestone 1.

### Milestone 3: Render Stable Display Drop Zones

Goal: ensure every display layout has visible DOM zones that can receive a visual drop, including empty display assignments.

Files:

- `src/renderer/control/patch/displayPreview.ts`
- `src/renderer/control/patch/displayPreview.test.ts`
- `src/renderer/styles/control/patch-mixer-display/display-preview.css`

Tasks:

- Add a display-zone projection helper, for example `getDisplayPreviewZoneEntries(layout)`.
- Render one `.display-preview-pane` for single layouts even when `visualId` is missing.
- Render two `.display-preview-pane` elements for split layouts even when either side is empty.
- Add `data-display-zone="single" | "L" | "R"` to panes.
- Keep `data-visual-id` only when a visual is assigned.
- Preserve existing image, video, live capture, canvas preview, blackout, and progress-edge behavior.
- Add empty-zone labels that match existing preview-empty styling.

Acceptance:

- Tests cover empty single, assigned single, empty split, one-sided split, and fully assigned split.
- `syncPreviewElements()` still finds preview videos by `data-preview-video`.
- Existing display preview tests still pass.

Dependencies:

- None strictly, but this should be done before Patch visual drop assignment.

### Milestone 4: Add Patch Audio Drop Assignment

Goal: dropping an audio source onto an output strip adds that source to the Patch output.

Files:

- `src/renderer/control/patch/mixerPanel.ts`
- `src/renderer/control/patch/mixerPanel/mixerStrip.ts`
- `src/renderer/control/patch/patchSurface.ts`
- `src/renderer/control/stream/streamSurface.ts` if the shared mixer controller needs `setShowStatus` in Stream too
- `src/renderer/styles/control/patch-mixer-display/mixer-strip.css`

Tasks:

- Extend `MixerPanelControllerOptions` with `setShowStatus`.
- Add an `assignAudioSourceToOutput(outputId, audioSourceId)` helper inside the mixer controller.
- Validate the output and audio source against the latest state.
- Skip duplicate routing if the output already contains the source.
- Call `window.xtream.outputs.addSource(outputId, audioSourceId)` for valid new assignments.
- Fetch `window.xtream.director.getState()` and call `renderState(nextState)`.
- Refresh details and meters after assignment.
- Install strip drag/drop listeners in both `createMixerStrip()` and `createOutputDetailMixerStrip()`.
- Ignore visual payloads and external file drops.

Acceptance:

- Dropping audio onto a normal output strip creates one output source row.
- Dropping audio onto a detail output strip creates one output source row.
- Dropping the same audio source again does not duplicate it.
- Dropping a visual onto an output strip does not mutate state.
- Existing fader, pan, mute, solo, click selection, and context menu behavior remains intact.

Dependencies:

- Milestone 1.
- Milestone 2 for real user drag sources, though target tests can use synthetic payloads.

### Milestone 5: Add Patch Visual Drop Assignment

Goal: dropping a visual onto a display preview pane updates the display's persisted visual layout.

Files:

- `src/renderer/control/patch/displayWorkspace.ts`
- `src/renderer/control/patch/displayPreview.ts`
- `src/renderer/control/patch/patchSurface.ts`
- `src/renderer/control/stream/streamSurface.ts` if shared display controller status feedback is added there too
- `src/renderer/styles/control/patch-mixer-display/display-preview.css`

Tasks:

- Extend `DisplayWorkspaceControllerOptions` with `setShowStatus` if status feedback is desired here.
- Add an `assignVisualToDisplayZone(displayId, zoneId, visualId)` helper.
- Fetch latest raw director state before building the new layout.
- For single layout, set `{ type: 'single', visualId }`.
- For split layout, replace only the dropped zone and preserve the other side.
- Add drop listeners to preview panes, with card-level fallback only if needed.
- Accept only visual payloads.
- Ignore audio payloads and external file drops.
- Call `window.xtream.displays.update(displayId, { layout })`.
- Render the next director state.

Acceptance:

- Dropping onto an empty single display assigns the visual.
- Dropping onto an assigned single display replaces the visual.
- Dropping onto split left changes only left.
- Dropping onto split right changes only right.
- Dropping audio onto a display preview does not mutate state.
- Stream-derived presentation previews do not cause transient Stream projection layout to be persisted.

Dependencies:

- Milestone 1.
- Milestone 2.
- Milestone 3.

### Milestone 6: Extract Stream Media-To-Sub-Cue Authoring Helper

Goal: centralize Stream sub-cue creation so List and Flow drops use the same behavior.

Files:

- New `src/renderer/control/stream/sceneEdit/addMediaSubCueFromPool.ts`
- `src/renderer/control/stream/sceneEdit/subCueDefaults.ts`
- `src/renderer/control/stream/sceneEdit/subCueIds.ts`
- New or existing Stream scene edit helper tests

Tasks:

- Add a helper that accepts stream, scene id, director state, and media-pool payload.
- Validate that the target scene exists.
- Validate that the audio source or visual exists in director state.
- Create a new sub-cue id with `createNewSubCueId()`.
- For audio, build default audio sub-cue and override `audioSourceId`.
- For visual, build default visual sub-cue and override `visualId`.
- Patch the scene with updated `subCues` and `subCueOrder`.
- Return the next `StreamEnginePublicState` and created `subCueId`.
- Do not append embedded audio automatically in the first implementation unless product direction changes.

Acceptance:

- Audio payload creates one audio sub-cue using the dropped source.
- Visual payload creates one visual sub-cue using the dropped source.
- New sub-cue is appended at the end of the scene.
- Invalid scene/media ids reject without partial mutation.
- Existing Add Sub-Cue menu behavior remains unchanged.

Dependencies:

- Milestone 1.

### Milestone 7: Add StreamSurface Scene Drop Orchestration

Goal: give workspace modes a single callback that handles validation, authoring, selection, and rerendering.

Files:

- `src/renderer/control/stream/streamSurface.ts`
- `src/renderer/control/stream/workspacePane.ts`
- `src/renderer/control/stream/listMode.ts`
- `src/renderer/control/stream/flowMode.ts`
- `src/renderer/control/stream/streamTypes.ts` if shared types need to move there

Tasks:

- Add `addMediaPoolItemToScene(sceneId, payload)` to `StreamWorkspacePaneContext`.
- Implement it in `streamSurface.ts` using the helper from Milestone 6.
- Reject drops when the target scene is running/preloading.
- Allow drops onto disabled scenes.
- On success:
  - Set edit focus to the target scene.
  - Set bottom tab to `scene`.
  - Clear detail pane.
  - Select the new sub-cue in `sceneEditSelection`.
  - Optionally expand the target scene in List mode.
  - Reset bottom/workspace render signatures as needed.
  - Render current state.
- Add useful status feedback for success and rejection paths.

Acceptance:

- Synthetic calls to `addMediaPoolItemToScene` create sub-cues and focus the created cue.
- Running-scene drops are rejected.
- Disabled-scene drops are allowed.
- Detail overlays close after a successful scene media drop.

Dependencies:

- Milestone 6.

### Milestone 8: Wire Stream List Mode Drops

Goal: dropping media onto a List scene row creates the matching sub-cue without breaking scene reordering.

Files:

- `src/renderer/control/stream/listMode.ts`
- `src/renderer/styles/control/stream/scene-list.css`
- New or existing list mode DOM tests

Tasks:

- In row wrapper `dragover`, check for media-pool payload before scene reorder logic.
- If media payload exists, prevent default, set `dropEffect = 'copy'`, and show `.media-drop-over`.
- In row wrapper `drop`, route media payloads to `ctx.addMediaPoolItemToScene(scene.id, payload)`.
- Keep scene reorder logic unchanged when no media payload exists.
- Ensure the list end-drop target only accepts scene reorder drags.
- Clear hover state on `dragleave`, `drop`, and `dragend`-adjacent paths.

Acceptance:

- Audio drop on a scene row calls the Stream context callback.
- Visual drop on a scene row calls the Stream context callback.
- Scene drag reorder still displays the drop indicator and reorders scenes.
- Media drag does not display the scene reorder insertion line.
- End-target scene reorder still works.

Dependencies:

- Milestone 7.

### Milestone 9: Wire Stream Flow Card Drops

Goal: dropping media onto a Flow scene card creates the matching sub-cue without breaking card drag, resize, or canvas pan.

Files:

- `src/renderer/control/stream/flowCards.ts`
- `src/renderer/control/stream/flowMode.ts`
- `src/renderer/styles/control/stream/flow.css`
- `src/renderer/control/stream/flowCards.dom.test.ts`
- Possibly `src/renderer/control/stream/flowMode.dom.test.ts`

Tasks:

- Extend `FlowCardHandlers` with media drop handlers.
- Add `dragenter`, `dragover`, `dragleave`, and `drop` listeners to each scene card.
- Accept only media-pool payloads.
- Set `dropEffect = 'copy'` for accepted payloads.
- Add/remove `.media-drop-over`.
- Route drops to `ctx.addMediaPoolItemToScene(sceneId, payload)`.
- Keep pointerdown drag/resize behavior untouched.

Acceptance:

- Audio drop on a Flow card calls the Stream context callback.
- Visual drop on a Flow card calls the Stream context callback.
- Pointer-based card dragging still starts from card pointerdown.
- Resize handle still works.
- Canvas pan still works when starting outside cards.

Dependencies:

- Milestone 7.

### Milestone 10: Polish Styling And Status Feedback

Goal: make drag affordances clear but quiet across both workspaces.

Files:

- `src/renderer/styles/control/patch-media-pool/*.css`
- `src/renderer/styles/control/patch-mixer-display/*.css`
- `src/renderer/styles/control/stream/scene-list.css`
- `src/renderer/styles/control/stream/flow.css`

Tasks:

- Add `.media-pool-drag-source`.
- Add `.media-drop-over` states for output strips, display panes, list rows, and flow cards.
- Add optional `.media-drop-target` states only where they improve clarity.
- Keep styles compatible with selected/focused/running/error states.
- Avoid large overlays that hide preview content.
- Review status strings for consistency and brevity.

Acceptance:

- Drag-over target is visually obvious in Patch mixer, Patch display previews, Stream List, and Stream Flow.
- Existing selected/focus states remain readable.
- Reduced-motion users are not given animation-only feedback.

Dependencies:

- Milestones 4, 5, 8, and 9 provide the DOM classes to style.

### Milestone 11: Complete Verification Pass

Goal: prove the feature works end to end and existing drag interactions are preserved.

Files:

- Any tests added in earlier milestones
- No production file changes unless verification finds issues

Tasks:

- Run targeted unit and DOM tests for drag payload, display preview zones, mixer drops, list drops, and flow drops.
- Run broader renderer/shared tests if targeted tests pass.
- Manually smoke test Patch audio, Patch visual, Stream List audio/visual, and Stream Flow audio/visual.
- Manually retest file import drop into media pool.
- Manually retest Stream scene reorder.
- Manually retest Flow card move/resize.

Acceptance:

- All targeted tests pass.
- No regression in media pool file import.
- No regression in scene reorder.
- No regression in Flow card pointer interactions.
- Manual smoke confirms the four requested user workflows.

Dependencies:

- All previous milestones.

## Open Risks

- Display previews currently use presentation state in some contexts. Drop assignment must write raw director display layouts, not transient Stream projection layouts.
- List mode already uses HTML5 drag/drop for reordering. The custom MIME type is necessary to avoid confusing a pool media drag with a scene reorder drag.
- Empty display zones are not rendered today. This must be fixed before visual drop assignment can feel reliable.
- Stream sub-cue creation currently patches whole scene objects. A helper reduces duplication, but a future `create-subcue` IPC command would make this more robust.
- Running-scene edits need a product decision. This plan recommends rejecting drops onto running/preloading scenes to match the scene edit lock, while allowing disabled scenes to be authored.
