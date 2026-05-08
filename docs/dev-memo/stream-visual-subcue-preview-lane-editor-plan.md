# Stream Visual Sub-Cue Preview Lane Editor Plan

## Purpose

Replace the current visual sub-cue Timing section in the Stream scene edit pane with a visual preview-lane editor modeled on the audio sub-cue waveform editor, but using sampled preview snapshots instead of a waveform. The new editor should let an operator preview the visual sub-cue through the same display windows and zones it is assigned to, tune fade opacity, set or drop a freeze-frame marker, and use media-appropriate render duration/loop controls.

This document is an implementation plan, not the implementation itself.

## Investigation Summary

The audio sub-cue waveform plan in `docs/archived/stream-audio-subcue-waveform-editor-plan.md` has mostly become real code. The most useful implementation patterns are:

| Area | Current role | Visual editor reuse |
| --- | --- | --- |
| `src/renderer/control/stream/sceneEdit/audioSubCueForm.ts` | Keeps I/O and Levels sections, then delegates Timing to `createAudioSubCueWaveformEditor`. | Keep visual I/O in `visualSubCueForm.ts`, replace only the current Timing section with a delegated preview-lane component. |
| `src/renderer/control/stream/sceneEdit/audioSubCueWaveformEditor.ts` | Builds dense lane UI, owns transient draft state, commits drag edits on pointerup, sends preview commands, and listens for preview position updates. | Use the same editor architecture: local draft state during lane gestures, one committed `patchSubCue()` per completed interaction, display-preview command routing, and position feedback. |
| `src/renderer/control/stream/sceneEdit/audioWaveformGeometry.ts` | Pure, testable ms/x hit testing, fade handles, range edges, automation/seek behavior, and cursors. | Add a visual equivalent for timeline ms/x conversion, fade handle hit tests, freeze marker hit tests, seek targets, and cursor choices. |
| `src/renderer/control/stream/sceneEdit/draggableNumberField.ts` | Provides compact number input plus horizontal drag-to-tweak. | Reuse for Delay Start, Playback Rate, Duration, Freeze Frame, and possibly Play Times. |
| `src/renderer/styles/control/stream/scene-edit.css` | Contains waveform editor and draggable field styling. | Add sibling visual-lane styles and share draggable number styles. |
| `src/preload/preload.ts` and `src/main/ipc/registerIpcHandlers.ts` | Audio preview commands are forwarded from control renderer to audio renderer; position updates return to control. | Add a display-preview command path from control renderer to display windows, and a position/status return path from display renderer to control. |
| `src/renderer/control/media/audioRuntime.ts` | Owns transient preview runtime separate from persisted Stream playback. | Display preview runtime should be transient and should not start Stream playback or mutate director/stream state. |

The current visual form is much simpler. `src/renderer/control/stream/sceneEdit/visualSubCueForm.ts` renders:

- Visual source select.
- Display/zone target toggles.
- Timing fields: `Playback rate`, `Freeze frame (ms)`, `Start offset (ms)`, `Duration override (ms)`, `Fade in`, `Fade out`.
- Generic `Loop` editor from `loopPolicyEditors.ts`.

The current persisted visual sub-cue model already has the fields needed for a first pass:

```ts
type PersistedVisualSubCueConfig = {
  id: SubCueId;
  kind: 'visual';
  visualId: VisualId;
  targets: VisualDisplayTarget[];
  startOffsetMs?: number;
  durationOverrideMs?: number;
  loop?: SceneLoopPolicy;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  freezeFrameMs?: number;
  playbackRate?: number;
};
```

The runtime path for live Stream visuals is:

- `src/main/streamEngine.ts` flattens active visual sub-cues into `StreamRuntimeVisualSubCue`.
- `src/renderer/streamProjection.ts` converts active stream visual sub-cues into synthetic `stream-visual:...` visual ids, display layers, opacity, playback rate, duration, runtime offset, and loop metadata.
- `src/renderer/display.ts` renders the active display window, reconciles stream layers, and syncs `<video>` elements to director time.

Important current gap: authored `fadeIn` and `fadeOut` are not carried by `StreamRuntimeVisualSubCue` or applied in `streamProjection.ts`; only orphan fade-out affects projected visual opacity today. `freezeFrameMs` also exists in the persisted model, but it is not carried into runtime visual cues or applied in `display.ts`.

## Target UX

The replacement visual Timing section should be a single preview-lane editor:

- Left rail:
  - Play preview icon button.
  - Pause preview icon button.
  - Freeze marker/drop-pin toggle button.
- Main lane:
  - A horizontal strip of preview snapshots.
  - Fade-in and fade-out regions/handles.
  - Freeze-frame marker pin when set.
  - Preview playhead.
  - Optional disabled/loading/missing states when media cannot produce snapshots.
- Bottom controls:
  - For video file media: `Play times` plus `Infinite Loop`.
  - For image media and live/stream visual media: `Duration` plus `Infinite Render`.
  - `Delay Start`.
  - `Freeze Frame`.
  - `Playback Rate` for video file media.

The lane replaces the old numeric Timing section; I/O target assignment stays above it.

## Media-Specific Semantics

### Video File Visuals

Video files have a natural timeline and can loop over their media duration.

- `Play times` maps to the existing `SceneLoopPolicy` fixed-count form:
  - `1` stores `{ enabled: false }`.
  - `2+` stores `{ enabled: true, iterations: { type: 'count', count } }`.
- `Infinite Loop` stores `{ enabled: true, iterations: { type: 'infinite' } }` and disables `Play times`.
- `durationOverrideMs` remains a legacy duration cap, but it should not be the visible primary control for normal video playback.
- `playbackRate` remains visible and affects effective duration.
- `freezeFrameMs` is a media-time marker in milliseconds.

### Image Visuals

Images have no natural playback duration.

- Replace `Play times` with explicit `Duration`.
- Replace `Infinite Loop` with `Infinite Render`.
- `Duration` writes `durationOverrideMs` and is disabled while `Infinite Render` is on.
- `Infinite Render` writes the existing infinite loop policy.
- `freezeFrameMs` is hidden or disabled, because an image is already a frozen frame.
- `playbackRate` is hidden or disabled.

### Live/Stream Visuals

Live visuals are represented as `kind: 'live'`, `type: 'video'`, and have no `url` or duration. They behave like indefinite streams, not finite clips.

- Replace `Play times` with explicit `Duration`.
- Replace `Infinite Loop` with `Infinite Render`.
- `Duration` writes `durationOverrideMs`.
- `Infinite Render` writes the existing infinite loop policy and disables `Duration`.
- `freezeFrameMs` is supported as a live freeze marker: when the sub-cue local time reaches the marker, the display freezes the current frame.
- `playbackRate` should be hidden unless a future live source can meaningfully support it.

## Preview Lane Behavior

### Snapshot Strip

The waveform canvas should be substituted by a visual lane made of preview snapshots.

Recommended first implementation:

- Use DOM tiles or a canvas-backed strip, with a stable fixed height similar to the audio waveform editor.
- For file videos, sample 8-16 frames across the known duration.
- For images, show the same still image repeated as the strip background or one continuous still tile with time divisions.
- For live visuals, show cached/live snapshots when available; otherwise show a live placeholder strip until preview starts.
- Cache snapshots by visual id, URL/capture revision, duration, dimensions, and requested sample count.

Suggested module:

```txt
src/renderer/control/stream/sceneEdit/visualPreviewSnapshots.ts
```

Responsibilities:

- Resolve whether a visual is video, image, or live stream.
- Load image snapshots.
- Seek hidden video elements to sample times and capture JPEG/data URL thumbnails.
- Reuse `visualPoolThumbnailCache.ts` ideas, but use a separate cache key because lane snapshots are time-indexed.
- Expose loading/error states without blocking the form.

Potential API:

```ts
type VisualPreviewSnapshot = {
  timeMs: number;
  dataUrl?: string;
  state: 'ready' | 'pending' | 'error' | 'placeholder';
};
```

### Fade Editing

Visual fade is opacity fade, not audio gain. There is no automation curve drawing for visuals.

- Fade-in handle starts at lane start and drags right.
- Fade-out handle starts at lane end and drags left.
- Fade handles write `fadeIn` and `fadeOut`.
- Double-click a fade region cycles curve in the same order as audio: `linear`, `equal-power`, `log`.
- Fade durations clamp to half the effective finite duration when finite.
- For infinite render, allow fade-in editing and keep fade-out editable only as a stop/orphan behavior candidate if runtime support is added; first implementation can disable fade-out with a clear disabled state while infinite render is active.

### Freeze Frame

Two authoring paths should write the same `freezeFrameMs` field:

- Type an explicit millisecond value in the bottom `Freeze Frame` input.
- Toggle the freeze pin button, then click the lane to drop a marker.

Behavior:

- The marker is media-local time for video file visuals.
- For live visuals, the marker is sub-cue local time; when local time reaches the marker, the display captures the current frame and holds it.
- Clicking and dragging an existing marker moves it.
- Clearing the input removes the marker.
- A dedicated clear affordance can be added if the input-clearing flow is not discoverable enough.

Runtime behavior:

- Before marker time, media plays/renders normally.
- At or after marker time, the corresponding display output freezes on the frame at that moment.
- For video files, freezing can be implemented by seeking/holding the `<video>` at `freezeFrameMs / 1000`.
- For live visuals, freezing requires display-side canvas capture, because there is no seekable source frame.

### Seeking And Preview Playhead

When no edit handle is active:

- Clicking the lane seeks the transient preview cursor.
- If preview is playing, the assigned display windows seek/update immediately.
- If preview is paused, the cursor moves without starting playback.
- If preview is stopped, the next Play should start from the last clicked cursor if this matches audio editor behavior after its seek mode; otherwise it can reset to lane start. Pick one behavior and test it.

## Display-Window Preview Plan

The user requirement is explicit: preview playback must be rendered through the corresponding display windows assigned to the sub-cue. Do not preview only inside the control pane.

Add a transient visual sub-cue preview path parallel to audio preview, but routed to display windows:

```ts
type VisualSubCuePreviewPayload = {
  previewId: string;
  visualId: VisualId;
  targets: VisualDisplayTarget[];
  visual: VisualState;
  playTimeMs?: number;
  durationMs?: number;
  playbackRate?: number;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  freezeFrameMs?: number;
  loop?: SceneLoopPolicy;
  startedAtLocalMs?: number;
};

type VisualSubCuePreviewCommand =
  | { type: 'play-visual-subcue-preview'; payload: VisualSubCuePreviewPayload }
  | { type: 'pause-visual-subcue-preview'; previewId: string }
  | { type: 'seek-visual-subcue-preview'; previewId: string; localTimeMs: number; sourceTimeMs?: number }
  | { type: 'stop-visual-subcue-preview'; previewId: string };

type VisualSubCuePreviewPosition = {
  previewId: string;
  displayId: DisplayWindowId;
  localTimeMs: number;
  sourceTimeMs?: number;
  playing: boolean;
  paused: boolean;
};
```

Implementation path:

- Add shared types in `src/shared/types.ts`.
- Add preload methods under `window.xtream.visualRuntime` or `window.xtream.displays.preview`.
- Add IPC handlers in `src/main/ipc/registerIpcHandlers.ts`.
- Add `DisplayRegistry.sendVisualPreviewCommand(command)` to fan out preview commands only to display windows referenced by the payload targets.
- In `src/renderer/display.ts`, add a transient display preview runtime that overlays or temporarily replaces the target zone with preview media.
- Display renderer reports position back to control via main IPC, similar to `audio:subcue-preview-position`.

Preview must not:

- Change `DirectorState.displays`.
- Start Stream transport.
- Mutate the persisted Stream config.
- Interfere permanently with Patch or Stream display layout after preview stops.

Display precedence:

- While a visual sub-cue preview is active for a display/zone, show the preview layer above the normal display content for that zone.
- Stopping preview removes the preview layer and reveals the previous display content.
- If multiple visual sub-cue editors preview the same display/zone, newest preview wins for that zone; stopping the newest restores the previous preview if still active, or the normal content.

## Runtime Visual Processing Plan

### Carry Authoring Fields Into Runtime

Extend `StreamRuntimeVisualSubCue`:

```ts
type StreamRuntimeVisualSubCue = {
  // existing fields...
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  freezeFrameMs?: number;
};
```

Update `StreamEngine.collectActiveSubCues()` to copy visual `fadeIn`, `fadeOut`, and `freezeFrameMs`.

### Apply Authored Opacity Fades

Add shared visual fade helpers, likely:

```txt
src/shared/visualSubCueTiming.ts
```

Functions:

- `getVisualSubCueBaseDurationMs(sub, visual)`
- `getVisualSubCueEffectiveDurationMs(sub, visual)`
- `evaluateVisualSubCueOpacity(sub, localTimeMs, baseOpacity)`
- `normalizeVisualFreezeFrameMs(sub, visual)`

`streamProjection.ts` should combine:

- Base visual opacity.
- Authored fade-in/fade-out opacity factor.
- Existing orphan fade-out factor.
- Display mingle/crossfade opacity.

Order should be documented and tested. Recommended:

```txt
projectedOpacity = visual.opacity * authoredFade * orphanFade * mingleSelectionFade
```

### Apply Freeze Frame In Display Renderer

For file videos:

- Extend projected visual runtime metadata with `runtimeFreezeFrameSeconds`.
- In `display.ts`, when syncing a video, clamp effective target to freeze time once local source time reaches the freeze point.
- Pause the video element at the frozen frame while director time continues.
- If the operator seeks back before the freeze point, unfreeze and resume normal sync.

For live visuals:

- At freeze trigger time, draw the current `<video>` into a canvas.
- Hide or pause the live element and show the canvas in the same layer.
- If the operator seeks before the marker or stops the cue, release the freeze canvas and resume live attachment as needed.

For images:

- No special runtime freeze behavior is needed.

## Duration And Loop Timing Plan

Current visual duration calculation lives in `src/shared/streamSchedule/durations.ts` and treats `durationOverrideMs` as a cap over video media duration.

Update semantics carefully:

- Video file visual:
  - Base duration is visual duration divided by effective playback rate.
  - `Play times` uses `SceneLoopPolicy.iterations.count`.
  - `Infinite Loop` is indefinite.
  - `durationOverrideMs`, if present from older files, remains a cap.
- Image visual:
  - Base duration is `durationOverrideMs`.
  - Missing duration is an authoring error unless infinite render is enabled.
  - Infinite render is indefinite.
- Live/stream visual:
  - Base duration is `durationOverrideMs`.
  - Missing duration is an authoring error unless infinite render is enabled.
  - Infinite render is indefinite.

This may require replacing the current generic visual branch in `subCueBaseDurationMs()` with a helper that receives enough visual metadata to distinguish file video, file image, and live visual.

## Component Plan

Recommended files:

```txt
src/renderer/control/stream/sceneEdit/visualSubCuePreviewLaneEditor.ts
src/renderer/control/stream/sceneEdit/visualPreviewLaneGeometry.ts
src/renderer/control/stream/sceneEdit/visualPreviewSnapshots.ts
src/shared/visualSubCueTiming.ts
```

### `visualSubCuePreviewLaneEditor.ts`

Responsibilities:

- Build the replacement Timing section DOM.
- Choose control set based on selected visual kind/type.
- Own transient draft state for fade handles, freeze marker, and preview cursor.
- Render snapshot lane, fade regions, marker pin, and playhead.
- Commit `patchSubCue()` on completed edits, not every pointer move.
- Build and send visual preview commands.
- Listen for preview position updates from display windows.
- Clean up preview when the editor is removed.

### `visualPreviewLaneGeometry.ts`

Pure functions:

- `msToLaneX`.
- `laneXToMs`.
- `normalizeVisualDurationForLane`.
- `hitTestVisualPreviewLane`.
- `clampVisualFadeDurationMs`.
- `clampFreezeFrameMs`.
- `cursorForVisualPreviewLaneHit`.
- `cycleFadeCurve`.

Hit priority:

1. Fade-in handle/region.
2. Fade-out handle/region.
3. Freeze marker pin.
4. Freeze marker drop target when pin mode is active.
5. Seek body.
6. Disabled.

### `visualPreviewSnapshots.ts`

Snapshot service:

- Cache sampled snapshots.
- Support image, video, and live visual placeholders.
- Avoid blocking the scene edit pane.
- Clean up hidden videos and live capture attachments.
- Time out slow video seeks.

### CSS

Add styles near the audio waveform block in `src/renderer/styles/control/stream/scene-edit.css`.

Use the same dense operator-console language:

- Stable lane height.
- Icon buttons for Play, Pause, and freeze pin.
- No nested cards.
- Snapshot tiles should not resize the form as they load.
- Bottom controls should wrap cleanly in narrow bottom panes.

## Validation And Normalization

Update `src/shared/streamSchedule/contentValidation.ts`:

- Visual `freezeFrameMs` must be finite and non-negative when present.
- For file video with known duration, `freezeFrameMs` must not exceed duration.
- For image visual, warn or ignore if `freezeFrameMs` is present.
- For image/live visual, require `durationOverrideMs` unless infinite render is enabled.
- `fadeIn.durationMs` and `fadeOut.durationMs` must be finite and non-negative for visual sub-cues too. Audio already validates these; visual currently does not.
- `playbackRate` should be required positive only for media where it is applicable, but malformed persisted values should still be reported.

Update normalization/migration handling in `src/shared/streamWorkspace.ts` if malformed persisted visual timing fields can currently pass through unchecked.

## Implementation Milestones

### Milestone 1: Shared Timing Semantics

- Add `visualSubCueTiming.ts`.
- Implement media-specific base duration logic.
- Extend duration schedule tests for video, image, and live visual semantics.
- Add validation for visual fade and freeze fields.
- Keep legacy `durationOverrideMs` video cap behavior covered by tests.

### Milestone 2: Runtime Projection Plumbing

- Extend `StreamRuntimeVisualSubCue` with `fadeIn`, `fadeOut`, and `freezeFrameMs`.
- Copy fields in `StreamEngine.collectActiveSubCues()`.
- Extend `streamProjection.ts` projected visual metadata with runtime freeze data.
- Apply authored visual fade opacity in projection.
- Add projection tests for authored fade, orphan fade composition, and freeze metadata.

### Milestone 3: Display Freeze Runtime

- Update `display.ts` video sync to honor runtime freeze seconds.
- Add live freeze canvas capture for live visual layers.
- Ensure seeking before the marker unfreezes.
- Ensure stopping/replacing a layer releases live/canvas resources.
- Add focused tests where practical and manual QA for real display windows.

### Milestone 4: Snapshot Lane Service

- Add snapshot extraction/cache module.
- Implement file video sampling with seek timeouts.
- Implement image still snapshots.
- Implement live placeholder/cache behavior.
- Add tests for cache keys, sample times, and error states.

### Milestone 5: Visual Preview IPC And Display Runtime

- Add `VisualSubCuePreviewCommand`, payload, and position types.
- Add preload and IPC handlers.
- Add `DisplayRegistry` fan-out to target display windows.
- Add display-side transient preview overlay runtime.
- Add position/status reporting back to control.
- Verify preview does not mutate director or stream state.

### Milestone 6: Visual Preview Lane Editor UI

- Add `visualPreviewLaneGeometry.ts`.
- Add `visualSubCuePreviewLaneEditor.ts`.
- Replace `visualSubCueForm.ts` Timing section with the editor.
- Implement fade handle dragging and curve cycling.
- Implement freeze input, pin toggle, marker drop, and marker drag.
- Implement media-specific bottom controls.
- Add DOM tests for patches, control switching by media kind, and cleanup.

### Milestone 7: Integration QA

- Verify file video preview plays on the assigned display/zone.
- Verify image preview renders for explicit duration and infinite render.
- Verify live visual preview renders on assigned displays without stealing permanent layout.
- Verify fade-in/fade-out opacity during live Stream playback.
- Verify freeze frame for file video and live visual.
- Verify split displays target L/R independently.
- Verify missing media and closed display windows fail gracefully.
- Verify legacy shows open and retain old duration override behavior.

## Testing Checklist

Automated tests:

- Visual duration helper returns video duration/rate for videos.
- Image/live visual requires explicit duration unless infinite render is enabled.
- Video `Play times` maps to fixed-count loop policy.
- `Infinite Loop` disables `Play times` for videos.
- `Infinite Render` disables `Duration` for image/live visuals.
- Visual fade opacity evaluates correctly for fade-in/fade-out.
- Orphan fade and authored fade multiply predictably.
- Freeze marker clamps to media duration for known-duration videos.
- Geometry hit testing prioritizes fades over marker over seek.
- Pointermove during lane drag does not call `patchSubCue()`.
- Pointerup commits one consolidated patch.
- Preview payload includes only assigned display targets.
- Stopping/removing the editor sends a stop preview command.
- Display preview overlay cleanup restores normal display content.

Manual QA:

- Preview appears on the physical display window(s), not just control UI.
- Preview target zones match selected display targets.
- Preview playhead follows display-side playback.
- Pausing preview leaves the display and lane at the same frame.
- Dragging fade handles does not scroll/rebuild the scene edit pane mid-edit.
- Dropping a freeze pin on video freezes the expected frame.
- Dropping a freeze pin on live visual freezes the frame reached at that moment.
- Image and live cues use Duration/Infinite Render instead of Play times/Infinite Loop.
- Video cues use Play times/Infinite Loop.
- Existing stream runtime playback is unchanged when no preview is active.

## Risks And Decisions

### Preview On Real Display Windows

Rendering preview through assigned display windows is the right operator behavior, but it means preview can temporarily cover live output. The UI should make preview mode visually explicit on the display, probably with a small non-intrusive preview badge that can be disabled later for show conditions.

### Live Freeze Frame

Live freeze requires canvas capture and resource management. This is more complex than video freeze because live sources cannot be seeked. Keep this isolated in display runtime helpers so file video freeze stays simple.

### Snapshot Extraction Cost

Sampling many video frames can be expensive. Start with a small fixed count, cache aggressively, and show placeholders quickly. Do not block form rendering while snapshots load.

### Duration Override Compatibility

`durationOverrideMs` currently acts as a visual duration cap. The new UI makes it the explicit Duration for image/live visuals and a legacy cap for videos. Tests should lock this behavior so old shows keep playing.

## Acceptance Criteria

- The visual sub-cue Timing section is replaced by a preview-lane editor.
- The lane displays preview snapshots instead of a waveform.
- Video file visuals show `Play times` and `Infinite Loop`.
- Image and live/stream visuals show `Duration` and `Infinite Render`.
- Visual fades are edited from the lane and affect opacity in runtime playback.
- Freeze frame can be typed as milliseconds or dropped as a marker pin on the lane.
- File video freeze holds the selected media frame.
- Live/stream freeze captures and holds the frame reached at the marker moment.
- Preview playback renders through every assigned display window/zone.
- Preview playback is transient and does not mutate Stream or Patch state.
- Dragging lane handles commits persisted edits only after the gesture completes.
- Missing media, unknown duration, and unavailable display windows produce usable disabled/error states.
