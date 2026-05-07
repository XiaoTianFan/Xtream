# Stream Audio Sub-Cue Waveform Editor Plan

## Purpose

Replace the current audio sub-cue Timing section in the Stream scene edit pane with a waveform-centered editor where the operator can trim the playable source range, edit fades, draw level or pan automation, preview the current sub-cue through the main output bus, and tune playback rate plus pitch shift.

This document is an implementation plan, not the implementation itself.

## Current Implementation Snapshot

Relevant source areas:

| Area | Current role |
| --- | --- |
| `src/renderer/control/stream/sceneEdit/audioSubCueForm.ts` | Builds the current audio sub-cue form. It has I/O, Levels, and Timing sections. Timing currently exposes playback rate, start offset, duration override, fade in/out fields, and loop policy. |
| `src/renderer/control/stream/sceneEdit/numericField.ts` | Provides simple number inputs. It does not support drag-to-tweak yet. |
| `src/renderer/control/stream/sceneEdit/fadeFields.ts` | Provides separate fade duration and curve controls. These should be replaced for audio sub-cues by waveform handles. |
| `src/shared/types.ts` | `PersistedAudioSubCueConfig` already contains `levelAutomation?: CurvePoint[]` and `panAutomation?: CurvePoint[]`, but does not yet contain pitch shift or source range fields. |
| `src/main/streamEngine.ts` | Flattens active audio sub-cues into `StreamRuntimeAudioSubCue`, currently carrying level, pan, playbackRate, loop, and timing, but not fade specs, automation curves, source range, or pitch shift. |
| `src/renderer/streamProjection.ts` | Converts active stream audio sub-cues into derived virtual output sources. It currently applies orphan fade-out only, not authored fade-in/fade-out or automation. |
| `src/renderer/control/media/audioRuntime.ts` | Owns the output bus audio graph. It currently drives media elements into gain, panner, bus gain, global mute, transport envelope, output delay, and meters. It does not yet apply per-sub-cue automation or independent pitch shifting. |

Important current semantics to preserve:

- `startOffsetMs` delays the sub-cue start from the beginning of the scene.
- `playbackRate` affects media duration and runtime playback.
- `durationOverrideMs` currently caps the sub-cue duration.
- `loop` uses `SceneLoopPolicy` and can express infinite loops.
- Audio sub-cues route to one or more virtual output buses.
- Stream playback projects active sub-cues into cloned runtime-only audio source ids such as `stream-audio:...`.

## Target UX

The new audio sub-cue editor keeps the existing I/O and base Levels sections initially, then replaces the existing Timing section with a single waveform editor section.

### Layout

The replacement Timing section should use the layout implied by the mockup:

- A narrow left rail:
  - square Play button
  - square Pause button
  - Level automation toggle
  - Pan automation toggle
- A large waveform display to the right.
- A bottom row below the waveform:
  - Play time integer input
  - Infinite loop toggle
  - Start offset input with drag-to-tweak
  - Pitch shift control
  - Playback rate input with drag-to-tweak

The Level and Pan automation toggles are mutually exclusive. The active toggle decides which automation curve is editable in the waveform display. Level is the default active automation mode.

### Waveform Display

The waveform display should render these layers at the same time:

| Layer | Meaning | Suggested color |
| --- | --- | --- |
| Waveform peaks | Audio amplitude context | neutral low-contrast gray/blue |
| Start/end range | Selected playable media in/out range | accent teal handles/vertical rails |
| Fade handles and fade regions | Fade-in and fade-out durations and curve shapes | accent ochre or amber |
| Automation line | Active Level or Pan curve | Level: green/teal, Pan: mauve/rose |
| Automation points | Editable curve points | same as active automation line, brighter |
| Preview playhead | Temporary preview position while auditioning | white/text-primary with subtle glow |

The visible waveform must remain usable even when the source is missing or metadata is pending:

- Missing source: show an empty waveform state inside the editor, keep numeric fields editable where meaningful.
- Pending metadata: show a low-contrast loading placeholder.
- Unknown duration: disable range dragging and waveform automation timing until duration is known, but keep `startOffsetMs`, `pitchShiftSemitones`, and `playbackRate` editable.

### Pointer Behavior

Hit testing priority inside the waveform:

1. Top-left fade handle area: drag fade-in duration.
2. Top-right fade handle area: drag fade-out duration.
3. Left range edge: drag source start.
4. Right range edge: drag source end.
5. Automation point: drag existing automation point.
6. Elsewhere: draw or insert automation point when Level or Pan is active.

Cursor behavior:

| Hover target | Cursor |
| --- | --- |
| Top-left or top-right fade handle | diagonal resize cursor, matching handle direction when possible |
| Left or right range edge | horizontal resize cursor |
| Existing automation point | move cursor |
| Empty waveform body with automation toggle active | crosshair or pen-like cursor |
| Disabled waveform | default or not-allowed cursor |

Double-click behavior:

- Double-click inside the fade-in handle/region cycles the fade-in curve.
- Double-click inside the fade-out handle/region cycles the fade-out curve.
- Curve cycle order should match existing fade options: `linear`, `equal-power`, `log`.
- Double-clicking an automation point can remove it, if this does not conflict with fade-region double-click hit testing.

### Numeric Control Behavior

| Control | Behavior |
| --- | --- |
| Play time | Integer ms input. Disabled when the sub-cue has an infinite loop. For non-looping cues, this mirrors the effective playable selected range duration unless explicitly overridden. |
| Infinite loop | Toggle. When enabled, stores `loop: { enabled: true, iterations: { type: 'infinite' } }` over the selected source range. When disabled, returns to non-looping playback unless legacy loop settings exist. |
| Start offset | Keeps current meaning: delay the start of this sub-cue from the start of the scene by ms. Number input supports drag-to-tweak. Minimum 0. |
| Pitch shift | New semitone control, range -12 to +12. It is independent from playback rate. |
| Playback rate | Number input supports typing and drag-to-tweak. Minimum remains 0.01. |

Drag-to-tweak number fields should support:

- Horizontal drag on the input label or a dedicated grip area.
- Step based on field type.
- `Shift` for coarse movement.
- `Alt` for fine movement.
- Commit through the same `patchSubCue` path as typed changes.

## Data Model Plan

### Add Source Range Fields

Add audio-only source range fields to `PersistedAudioSubCueConfig`:

```ts
sourceStartMs?: number;
sourceEndMs?: number;
```

Semantics:

- `sourceStartMs` is the media in point, in source-media milliseconds.
- `sourceEndMs` is the media out point, in source-media milliseconds.
- Both are clamped to source duration when duration is known.
- If omitted, source start defaults to 0 and source end defaults to source duration.
- The waveform start/end edges edit these fields.

Why not reuse `startOffsetMs`:

- `startOffsetMs` is scene-time delay.
- Source start/end are media-time trim points.
- Keeping them separate preserves current scene scheduling behavior and makes the waveform editor easier to reason about.

### Preserve Duration Override As Play Time

Keep `durationOverrideMs` for backward compatibility and use it as the persisted backing field for the Play time input in phase 1.

Rules:

- When the user drags source range edges and `durationOverrideMs` is not explicitly locked, update Play time to the selected source range duration divided by `playbackRate`.
- When the user types Play time, store it as `durationOverrideMs` and keep source range unchanged.
- Effective base duration is the minimum of selected source range duration and `durationOverrideMs` when both are known.
- Infinite loop disables the Play time input because the effective duration is controlled by loop policy.

This keeps existing show files and schedule calculations viable while introducing source in/out selection.

### Add Pitch Shift

Add:

```ts
pitchShiftSemitones?: number;
```

Rules:

- Default is 0.
- Clamp to integer or decimal range -12 to +12. The UI can display semitone steps, but the runtime should tolerate fractional values for future fine pitch.
- Pitch shift must not alter the scene schedule. `playbackRate` controls playback speed and duration; `pitchShiftSemitones` controls pitch only.

### Carry Authoring Fields Into Runtime

Extend `StreamRuntimeAudioSubCue` with:

```ts
sourceStartMs?: number;
sourceEndMs?: number;
fadeIn?: FadeSpec;
fadeOut?: FadeSpec;
levelAutomation?: CurvePoint[];
panAutomation?: CurvePoint[];
pitchShiftSemitones?: number;
```

`StreamEngine.collectActiveSubCues()` should copy these fields from `PersistedAudioSubCueConfig` into each flattened runtime audio cue.

### Projection Fields For Audio Runtime

`deriveDirectorStateForStream()` currently creates cloned `AudioSourceState` plus `VirtualOutputSourceSelection`.

Add runtime-only fields to the cloned audio source and/or output selection:

```ts
runtimeSourceStartSeconds?: number;
runtimeSourceEndSeconds?: number;
runtimeFadeIn?: FadeSpec;
runtimeFadeOut?: FadeSpec;
runtimeLevelAutomation?: CurvePoint[];
runtimePanAutomation?: CurvePoint[];
runtimePitchShiftSemitones?: number;
runtimeSubCueStartMs?: number;
```

Preferred split:

- Put source timing and pitch fields on the cloned `AudioSourceState`.
- Put gain/pan automation fields on `VirtualOutputSourceSelection`, because those control the output slot.

This avoids teaching the whole app about these runtime-only fields as persisted source properties.

## Timing Semantics

### Scene Time Vs Source Time

Definitions:

- Scene time: time since the scene started.
- Sub-cue local time: scene time minus `startOffsetMs`.
- Source time: media time inside the audio file.
- Selected source range: `sourceStartMs` to `sourceEndMs`.

Effective playback target:

```txt
sourceTimeSeconds = sourceStartSeconds + effectiveSubCueSeconds * playbackRate
```

where `effectiveSubCueSeconds` is derived from stream/director time, loop phase, and runtime offset.

When `sourceEndMs` is known:

- Non-looping playback is audible only while `sourceTime < sourceEnd`.
- Looping playback loops between `sourceStartMs` and `sourceEndMs`.

### Fades

Fade durations are relative to the playable selected range, not the whole source file.

Rules:

- Fade-in starts at selected range start.
- Fade-out ends at selected range end or effective Play time end, whichever ends playback first.
- Dragging fade handles clamps them inside the selected start/end range.
- If the selected range shrinks below the combined fade durations, clamp both fades proportionally or cap each to half the selected range. The simpler first implementation should cap each to half the selected range to avoid overlap surprises.

### Automation Time

Automation point `timeMs` values are relative to the sub-cue playable timeline, with 0 at selected source range start.

Rules:

- Level automation values use dB, same range as the base dB control: -60 to +12.
- Pan automation values use constant-power pan range: -1 to +1.
- If a curve is empty, runtime uses the base `levelDb` or base `pan`.
- If the selected range or Play time changes, clamp automation points to the new effective duration.
- If only one automation point exists, treat it as a constant value after that point.
- Interpolation defaults to `linear`.

## Waveform Data Plan

Add a renderer-side waveform peak service used by the scene edit pane.

Recommended module:

```txt
src/renderer/control/stream/sceneEdit/audioWaveformPeaks.ts
```

Responsibilities:

- Resolve the playable URL for `external-file` and ready `embedded-visual` audio sources.
- Decode audio asynchronously with `AudioContext.decodeAudioData()` or `OfflineAudioContext`.
- Downsample into a fixed number of peak buckets, for example 2048 or 4096.
- Cache by `audioSourceId`, URL, duration, file size, channel count, and revision-like metadata.
- Emit a lightweight result usable by canvas rendering:

```ts
type AudioWaveformPeaks = {
  durationMs: number;
  channelCount: number;
  buckets: Array<{ min: number; max: number; rms?: number }>;
};
```

Performance requirements:

- Decoding must not block the scene edit pane.
- Large files should show a placeholder quickly and fill in peaks later.
- Cache must be invalidated when source URL, duration, file size, or extraction status changes.
- Failed waveform decoding should not block actual sub-cue playback.

Potential future improvement:

- Use a main-process ffmpeg peak extraction cache for very long files. The first implementation can stay renderer-only if performance is acceptable.

## UI Component Plan

Add the waveform editor as a dedicated component instead of expanding `audioSubCueForm.ts` inline.

Recommended files:

```txt
src/renderer/control/stream/sceneEdit/audioSubCueWaveformEditor.ts
src/renderer/control/stream/sceneEdit/audioWaveformGeometry.ts
src/renderer/control/stream/sceneEdit/audioWaveformPeaks.ts
src/renderer/control/stream/sceneEdit/draggableNumberField.ts
```

### `audioSubCueWaveformEditor.ts`

Responsibilities:

- Build the replacement Timing section DOM.
- Own transient UI state:
  - active automation mode: `level` or `pan`
  - active drag gesture
  - hover target
  - preview playing/paused state
  - latest waveform peaks load state
- Render waveform and overlays to canvas.
- Dispatch `patchSubCue()` updates.
- Dispatch preview commands.

### `audioWaveformGeometry.ts`

Pure functions for testable geometry:

- Convert ms to x coordinate.
- Convert x coordinate to ms.
- Convert dB/pan automation value to y coordinate.
- Hit-test fade handles, range edges, automation points, and drawable areas.
- Clamp range, fades, and automation points.

This keeps pointer behavior testable without a browser canvas.

### Rendering Approach

Use a canvas with CSS-sized stable dimensions:

- Canvas fills the waveform area.
- Use device-pixel-ratio scaling for crisp rendering.
- Re-render on:
  - waveform peaks loaded
  - form state changes
  - hover/drag changes
  - preview playhead ticks
  - resize observer changes

Canvas is preferred over many DOM nodes because waveform peaks and automation overlays can be redrawn cheaply and precisely.

### CSS

Add styles to `src/renderer/styles/control/stream.css`.

Keep the visual language dense and operator-focused:

- No nested cards inside cards.
- Use existing tokens: `--surface`, `--surface-low`, `--border-subtle`, `--accent-teal`, `--accent-ochre`, `--text-secondary`.
- Stable heights for waveform, buttons, toggles, and bottom numeric controls.
- Ensure labels and inputs do not overflow in the bottom row.

## Preview Playback Plan

The preview buttons should audition the current sub-cue through the main output bus without starting Stream playback and without persisting any runtime state.

### Main Output Bus Selection

Define main output bus for preview as:

1. First selected `sub.outputIds` entry if present.
2. Otherwise the first virtual output id in sorted order.
3. If no output exists, disable preview buttons.

### Runtime Path

Add a preview path in the audio renderer/runtime rather than creating an independent local `<audio>` in the control pane. This is needed so preview respects real bus routing and sink assignment.

Recommended approach:

- Add an IPC command from control renderer to the audio renderer:

```ts
type AudioSubCuePreviewCommand =
  | { type: 'play-audio-subcue-preview'; payload: AudioSubCuePreviewPayload }
  | { type: 'pause-audio-subcue-preview'; previewId: string }
  | { type: 'stop-audio-subcue-preview'; previewId: string };
```

- Add preload methods under an audio preview namespace.
- Implement transient preview sources in `audioRuntime.ts` or a nearby module:

```txt
src/renderer/control/media/audioPreviewRuntime.ts
```

Preview payload should include:

- audio source id and resolved URL
- output id
- source start/end
- fade in/out
- level and pan base values
- active automation curves
- playback rate
- pitch shift semitones
- loop policy
- play time

Preview behavior:

- Play starts at selected source start.
- Pause freezes preview only, not Stream transport.
- Preview uses the output bus route and physical sink.
- Preview should stop automatically at Play time for non-looping cues.
- Preview should keep running when infinite loop is enabled until paused/stopped or the selected sub-cue changes.
- Changing fields while preview is active should either update the preview live or restart it. First implementation can restart preview on structural changes and update gain/pan live.

## Runtime Audio Processing Plan

### Fade And Automation Evaluation

Add shared helpers for audio envelope evaluation.

Recommended file:

```txt
src/shared/audioSubCueAutomation.ts
```

Functions:

- `normalizeAudioSourceRange(...)`
- `normalizeFadeSpec(...)`
- `evaluateFadeGain(...)`
- `evaluateCurvePointValue(...)`
- `evaluateAudioSubCueLevelDb(...)`
- `evaluateAudioSubCuePan(...)`
- `clampPitchShiftSemitones(...)`

Use these helpers in:

- Stream schedule duration calculations.
- `StreamEngine` runtime flattening.
- `streamProjection` derived state.
- `audioRuntime` live evaluation.
- Tests.

### Where To Apply Automation

Do not bake automation into one static `levelDb` during `deriveDirectorStateForStream()`, because the audio renderer updates every animation frame and owns the audio context clock.

Instead:

- Projection passes base values plus runtime automation metadata.
- `audioRuntime.syncAudioRuntimeToDirector()` evaluates level, fade, and pan for the current director/sub-cue time.
- `setSourceRuntimeGain()` receives the current automated target gain.
- `sourcePanner.pan` receives the current automated pan.

This keeps automation smooth during playback and avoids needing a new derived state event for every point along the curve.

### Pitch Shift Mechanism

Independent pitch shift is not the same as `HTMLMediaElement.playbackRate`.

Recommended first production mechanism:

- Insert a pitch-shift processing node between the media element source and the gain/pan chain.
- Use an `AudioWorkletNode` backed by a granular or phase-vocoder pitch shifter.
- Keep `element.playbackRate = state.rate * source.playbackRate` for speed/timing.
- Apply `pitchShiftSemitones` in the worklet so pitch changes without changing duration.

Graph shape:

```txt
MediaElementAudioSourceNode
  -> optional channel splitter/mode handling
  -> PitchShiftNode when semitones != 0
  -> GainNode
  -> StereoPannerNode
  -> BusGain
```

Implementation notes:

- Start with mono/stereo support. Preserve existing left/right split behavior.
- Clamp pitch semitones to -12..+12 before sending to the worklet.
- Crossfade or smooth pitch parameter changes to avoid zipper noise.
- If `AudioWorklet` setup fails, surface a warning and fall back to unshifted pitch rather than breaking playback.
- Keep pitch shift out of schedule duration calculations.

Future alternative:

- Evaluate a small maintained DSP package or WASM processor if in-house worklet quality is not acceptable. The first plan should avoid adding a large dependency until audio quality and licensing are clear.

### Source Range And Looping

The current audio runtime uses `getAudioEffectiveTime()` with a `runtimeOffsetSeconds` and optional `runtimeLoop`.

Update runtime source timing so:

- `runtimeOffsetSeconds` still aligns source playback with the sub-cue scene start.
- A new `runtimeSourceStartSeconds` shifts media current time into the selected range.
- `runtimeLoop` should use selected source start/end seconds, not whole-source 0/duration.
- Audible gating should become false outside selected range for non-looping cues.

Careful point:

- Existing `getAudioEffectiveTime()` assumes loop start/end are source-relative seconds. Confirm and update tests so selected ranges loop exactly between source start/end.

## Validation And Normalization Plan

Update validation in `src/shared/streamSchedule/contentValidation.ts`:

- `sourceStartMs >= 0`
- `sourceEndMs > sourceStartMs` when both are present
- source range within known media duration when duration is available
- `pitchShiftSemitones` is finite and within -12..+12 after normalization
- automation point time is non-negative
- automation values are in range:
  - level: -60..+12
  - pan: -1..+1
- fade durations are non-negative

Update normalization in `src/shared/streamWorkspace.ts`:

- Default new audio sub-cues to:

```ts
playbackRate: 1,
pitchShiftSemitones: 0,
levelAutomation: undefined,
panAutomation: undefined
```

- Preserve legacy files that omit new fields.
- Clamp malformed persisted values rather than throwing where possible.

## Implementation Milestones

### Milestone 1: Shared Model And Timing Helpers

- Add `sourceStartMs`, `sourceEndMs`, and `pitchShiftSemitones` to shared types.
- Add shared audio sub-cue normalization and automation helpers.
- Extend stream content validation.
- Extend stream duration helpers so selected source range can define base duration.
- Add tests for source range duration, playback rate interaction, infinite loop behavior, fade clamping, automation evaluation, and pitch clamp.

### Milestone 2: Runtime Projection Plumbing

- Extend `StreamRuntimeAudioSubCue` with range, fades, automation, and pitch.
- Copy fields in `StreamEngine.collectActiveSubCues()`.
- Pass runtime-only metadata through `deriveDirectorStateForStream()`.
- Add tests proving active stream audio cues carry the new data into projected output selections.

### Milestone 3: Waveform Data Service

- Add waveform peak extraction/cache module.
- Resolve audio URLs for external and embedded sources.
- Decode, downsample, cache, and report loading/error states.
- Add tests for cache keys, bucket generation, and missing-source handling where feasible.

### Milestone 4: Waveform Editor UI

- Add `audioSubCueWaveformEditor.ts`, `audioWaveformGeometry.ts`, and draggable number field utilities.
- Replace the current audio Timing section in `audioSubCueForm.ts`.
- Implement range edge dragging.
- Implement fade handle dragging and double-click curve cycling.
- Implement mutually exclusive Level/Pan automation editing.
- Implement Play time, Infinite loop, Start offset, Pitch shift, and Playback rate controls.
- Add CSS for stable layout and responsive behavior.
- Add DOM/unit tests for hit testing, cursor state, drag gestures, and patch payloads.

### Milestone 5: Preview Through Main Output Bus

- Add audio sub-cue preview IPC/preload surface.
- Add transient preview runtime routed through the selected main output bus.
- Wire Play/Pause buttons in the waveform editor.
- Render preview playhead in the waveform.
- Add tests for command payload construction and preview cleanup.

### Milestone 6: Live Runtime Audio Processing

- Evaluate authored fade-in/fade-out in `audioRuntime`.
- Evaluate level and pan automation per frame.
- Respect selected source range during live playback and loops.
- Add pitch-shift node/worklet path.
- Preserve current mute, solo, bus gain, global mute, transport envelope, output delay, and meter behavior.
- Add focused runtime tests around gain/pan targets and graph signature stability.

### Milestone 7: QA And Polish

- Verify with real audio files:
  - short clips
  - long clips
  - embedded visual audio
  - missing/pending media
  - stereo split / left / right channel modes
  - multiple output buses
  - running stream edits with orphan fade-out
- Confirm that Patch workspace audio behavior is unchanged.
- Confirm that saved legacy shows open without requiring migration edits.
- Confirm light and dark theme contrast.
- Confirm waveform text/input layout does not overflow in narrow bottom panes.

### Milestone 8: Waveform Editor Bug Fix Pass

This milestone fixes the first implementation issues found in the audio sub-cue waveform editor and tightens the UX semantics before deeper runtime polish.

Investigation snapshot:

| Bug area | Current implementation | Root cause |
| --- | --- | --- |
| Preview transport buttons and playhead | `audioSubCueWaveformEditor.ts` builds text buttons with `createRailButton('Play'/'Pause')`; `pausePreview()` flips `previewPlaying` before reading elapsed UI time. | The buttons never use the shared lucide icon helpers, and the UI playhead can store `0` on pause because `getPreviewElapsedMs()` branches on `previewPlaying`. The UI position is also locally estimated instead of being driven by the preview runtime's actual media cursor. |
| Waveform interactions refresh the scene edit form | Range/fade/automation drag calls `patchAndRefreshPreview()` on pointer move, which calls `patchSubCue()`, which sends `update-subcue` through the stream engine. | Every draw/drag gesture mutates persisted stream state immediately. Because the bottom-pane render signature includes the full stream, the scene edit pane can be rebuilt after those updates and scroll the operator away from the waveform. |
| Start/play control naming | Bottom controls show `Play ms` and `Start ms`; `Play ms` edits `durationOverrideMs`. | The UI exposes a duration cap as if it were the requested fixed repeat count, while `startOffsetMs` already has the desired scene-delay behavior but the wrong label. |
| Fixed play count vs infinite loop | The current `Loop` button writes `{ enabled: true, iterations: { type: 'infinite' } }`; `durationOverrideMs` stays the visible "play" control. | The UI does not expose fixed loop/play count through `SceneLoopPolicy.iterations.count`, so fixed play count and infinite loop are not presented as mutually exclusive alternatives. |
| Automation mode and waveform seeking | `automationMode` is always `'level'` or `'pan'`; one toggle is always active; hit testing always returns `automation-body` for the waveform body. | The editor cannot represent "no automation edit mode", so a waveform click always inserts/draws automation rather than seeking the preview cursor. Automation rendering is also tied to the selected source range instead of being guaranteed across the whole waveform display. |

Fix plan:

- Replace transport text with icon buttons:
  - Import and use `decorateRailButton()` or `decorateIconButton()` with lucide `Play` and `Pause`.
  - Keep accessible labels and titles as "Play preview" and "Pause preview".
  - Add a DOM test that the transport buttons expose icon-only visible UI plus screen-reader labels.
- Make the UI playhead follow the actual preview cursor:
  - Fix the immediate pause bug by computing elapsed time before setting `previewPlaying = false`.
  - Prefer a runtime-driven position feed from `audioRuntime` to the control renderer, for example `{ previewId, sourceTimeMs, localTimeMs, paused, playing }`, emitted from the existing preview automation timer.
  - Store the latest reported source position in the editor and draw the playhead from that source time, not from a local `performance.now()` estimate.
  - For fixed-count and infinite loops, draw the playhead modulo the selected source range so the UI cursor loops exactly where the audible preview loops.
  - On pause, leave the UI playhead at the last reported source position and resume from that same position.
- Stop waveform edits from rebuilding the scene edit pane during continuous interaction:
  - Split waveform pointer handling into transient editor state and persisted commits.
  - During pointer drag/draw, update local range/fade/automation state and redraw the canvas only.
  - Commit a single `patchSubCue()` on pointerup/pointercancel, or a throttled low-frequency commit only if live preview must restart during the gesture.
  - Keep preview updates local during drag where possible; if a structural preview restart is needed, restart from the current preview cursor rather than from the selected range start.
  - Add tests that pointermove on the waveform does not call `patchSubCue()`, and pointerup commits one consolidated patch.
  - Add a render/signature regression test or DOM harness proving waveform pointer interactions do not cause `syncStreamSceneEditPaneContent()` to replace the form while editing.
- Rename and preserve scene-delay behavior:
  - Rename `Start ms` to `Delay Start`.
  - Keep it backed by `startOffsetMs`, minimum `0`, integer milliseconds, and drag-to-tweak.
  - Add a test that changing Delay Start patches `{ startOffsetMs }` and does not touch source range, loop, or play count.
- Replace `Play ms` with fixed `Play times`:
  - Change the control label to `Play times`.
  - Make it an integer-only input with minimum `1`.
  - Map `1` to non-looping playback over the selected range, and map values above `1` to a fixed-count `SceneLoopPolicy`, for example `{ enabled: true, iterations: { type: 'count', count: playTimes } }`.
  - Treat `durationOverrideMs` as a legacy/back-compat duration cap, not the visible Play times field. Do not update it from this control.
  - Decide whether opening a legacy cue with `durationOverrideMs` should show a subtle derived play-count default of `1` or preserve the hidden cap until the user edits Play times; document that behavior in the code comment and tests.
  - Update duration/schedule tests so fixed Play times repeats the selected source range the requested number of times.
- Rename `Loop` to `Infinite Loop` and make it mutually exclusive with Play times:
  - Button label becomes `Infinite Loop`.
  - Enabling it writes the existing infinite loop policy and disables the Play times input.
  - Disabling it restores fixed Play times, defaulting to `1` unless a previous count loop is available.
  - Editing Play times while Infinite Loop is off clears infinite loop state and writes a fixed count or no-loop policy.
  - Add tests for toggling Infinite Loop, restoring a count loop, and disabling the Play times field.
- Allow both automation toggles to be disabled:
  - Change `AudioWaveformAutomationMode` to support a no-mode state, for example `'level' | 'pan' | undefined` or `'none'`.
  - Make Level and Pan buttons independently toggleable while preserving exclusivity when either one is active.
  - Default can remain Level for new mounts if desired, but clicking the active mode must turn it off.
  - When no mode is active, do not render automation points as editable and make waveform body clicks seek the preview/UI cursor instead of inserting automation.
  - Add hit-test tests for disabled automation mode returning a seek target rather than `automation-body`.
- Make automation rendering and editing match the requested waveform behavior:
  - When Level or Pan mode is active, render the automation line across the full waveform display width.
  - If existing points are sparse, extend the first and last values to the canvas edges so the line is always continuous.
  - Keep point values clamped to the current level or pan range.
  - Clicking or dragging the waveform body in an active automation mode inserts or updates automation values; clicking with both modes off only seeks.
  - Add geometry tests for full-width automation rendering inputs and DOM tests for click-to-seek vs click-to-draw mode switching.
- Seek behavior when automation is off:
  - Add a preview seek command or extend the preview play command with a `resumeFromMs/sourceTimeMs` seek value.
  - On waveform click with no active automation mode, update the local UI playhead immediately and seek the preview runtime if preview exists.
  - If preview is paused, seek the paused cursor without starting playback.
  - If preview is stopped, move only the preview/UI cursor so the next Play starts from that position if that is the intended audition behavior.
- Acceptance checks for this bug pass:
  - Play/Pause controls are icon buttons with accessible labels.
  - Pausing preview leaves the UI playhead at the audible paused position.
  - Resuming preview keeps UI and playback cursor synchronized.
  - Dragging range/fade/automation no longer scrolls or rebuilds the sub-cue edit form mid-edit.
  - `Delay Start` delays the sub-cue from the scene start via `startOffsetMs`.
  - `Play times` is an integer fixed repeat count and is mutually exclusive with `Infinite Loop`.
  - Level and Pan remain mutually exclusive, and both can be off.
  - With both automation modes off, waveform clicks seek; with either mode on, waveform clicks/draws edit automation.

## Testing Checklist

Automated tests:

- Shared range normalization clamps negative and over-duration values.
- Source range duration combines correctly with `playbackRate`.
- `durationOverrideMs` remains backward compatible as Play time.
- Infinite loop disables Play time UI state and produces the expected loop policy.
- Fade handles clamp within selected source range.
- Double-click fade region cycles curves in the expected order.
- Level automation interpolation returns expected dB values.
- Pan automation interpolation returns expected pan values.
- Automation point times clamp to the effective duration.
- Pitch shift clamps to -12..+12 and defaults to 0.
- Stream runtime active audio cues include range, fades, automation, and pitch.
- Projection preserves new runtime metadata.
- Audio runtime graph signature only rebuilds for topology changes, not every automation change.
- Draggable number fields commit expected values with normal, Shift, and Alt drag modifiers.

Manual/audio QA:

- Dragging left/right range edges audibly changes the in/out point.
- Fade-in and fade-out handles sound correct and visually follow the range.
- Level automation changes gain smoothly without zipper noise.
- Pan automation moves smoothly through the stereo field.
- Pitch shift changes pitch without changing duration.
- Playback rate changes speed without breaking selected range math.
- Preview plays through the intended output bus and stops cleanly.
- Runtime playback and preview do not fight each other.

## Risks And Decisions

### Pitch Shift Quality

Independent pitch shift is the highest-risk part. A basic granular worklet is relatively straightforward but may sound rough on music. A phase-vocoder or proven DSP package may sound better but increases implementation and licensing complexity.

Decision for first implementation:

- Build the graph hook and parameter plumbing cleanly.
- Start with the simplest acceptable worklet.
- Keep the mechanism isolated so it can be swapped for a higher-quality processor later.

### Duration Override Vs Source Range

The existing `durationOverrideMs` field overlaps conceptually with the requested Play time input.

Decision for first implementation:

- Keep `durationOverrideMs` as Play time for compatibility.
- Add explicit source range fields for waveform edge dragging.
- Treat source range as media trimming and `durationOverrideMs` as scene play duration cap.

### Automation Ownership

Automation should be evaluated in the audio runtime, not flattened into static state, because the audio runtime already syncs per frame and owns the actual gain/pan nodes.

Decision:

- Projection passes automation metadata.
- Audio runtime evaluates it against current sub-cue local time.

## Acceptance Criteria

- The audio sub-cue Timing section is replaced by the waveform editor.
- Operators can drag waveform left/right edges to edit source start/end.
- Operators can drag top-left/top-right fade handles, and fade handles remain inside the selected range.
- Double-clicking fade regions cycles fade curves.
- Operators can toggle Level or Pan automation, with only one active for editing at a time.
- The waveform displays range, fades, and the active automation line simultaneously with distinct colors.
- Pointer cursor changes match hover intent.
- Play/Pause preview buttons audition the current sub-cue through the main output bus.
- Play time is an integer input and is disabled for infinite loops.
- Start offset keeps existing scene-delay behavior and supports drag-to-tweak.
- Pitch shift supports -12 to +12 semitones as a new runtime audio mechanism.
- Playback rate supports typing and drag-to-tweak.
- Stream playback respects source range, fades, automation, playback rate, and pitch shift.
- Existing shows without the new fields continue to open and play.
