# Stream Transport And Runtime Playback Refactor Plan

## Purpose

This plan covers the requested refactor of Stream workspace transport controls and the core Stream runtime playback logic.

The desired behavior is:

- Pause is no longer a resume toggle. It pauses only, and is disabled when Stream playback is already paused.
- The Stream play button resumes paused Stream playback. When not paused, it starts from the current selected cue or current timeline cursor without resetting the global timeline to zero.
- Paused global Play behavior is configurable in the Config surface, with a selection-aware default and a "preserve paused cursor" option.
- Stream playback always uses the calculated global Stream timeline. Selecting scene 2 and pressing play seeks the Stream cursor to scene 2's scheduled start time, not to a rebased zero.
- Scene absolute starts/ends are an engine invariant. Every Stream edit recalculates the full absolute timeline; if calculation fails, the edit timeline reports an error and the last known-good playback timeline remains available.
- Overlapping scenes remain active when the global cursor enters their time range.
- Jump next uses different reference rules for idle, paused, and running states.
- Back to first is only available when Stream playback is not actively running.
- Patch playback behavior must remain intact. Patch and Stream must remain mutually exclusive for active playback: when one workspace is playing, the other workspace's play button is disabled.

## Current Project Findings

The current architecture is already close to the right separation of concerns:

- `src/main/director.ts` owns the Patch transport, global timeline clock, readiness, displays, outputs, drift correction, and media pool state.
- `src/main/streamEngine.ts` owns Stream runtime state, scheduling, scene states, active sub-cues, and Stream transport commands.
- `src/renderer/streamProjection.ts` projects active Stream runtime state into a derived `DirectorState` for the control, audio, and display renderers.
- `src/renderer/control/stream/streamHeader.ts` renders the Stream transport buttons and Stream scrubber.
- `src/renderer/control/stream/streamSurface.ts` owns Stream UI selection state, render signatures, and connection to the Stream engine.
- `src/renderer/control/patch/transportControls.ts` owns Patch transport controls.
- `src/shared/streamSchedule.ts` owns validation and duration helpers, but `StreamEngine.buildSchedule()` currently contains its own schedule calculation.

Important existing guards:

- Patch blocks play when Stream playback is active through `Director.setStreamPlaybackGate(() => streamEngine.isStreamPlaybackActive())`.
- Stream blocks non-stop transport while Patch is actively playing through `director.isPatchTransportPlaying()`.

Important current problems:

- `StreamEngine.handleGo(sceneId)` always creates a new runtime with `offsetStreamMs: 0` and `currentStreamMs: 0`.
- `buildSchedule(anchorSceneId)` rebases schedules around the selected anchor scene in several cases, especially all-manual streams.
- The Stream play button is disabled based on `currentState?.paused`, which is Patch Director state, not the Stream runtime state.
- The Stream pause button toggles `pause` and `resume` based on `runtime.status`.
- The Stream next button is disabled unless Stream runtime is running or paused, which does not support idle focused-scene navigation.
- `handleJumpNext()` is tied to `runtime.cursorSceneId` and can start playback when jumping from idle, which conflicts with the requested idle behavior.
- `recomputeRuntime()` sets `cursorSceneId` to the first running/paused scene, even if multiple scenes are active. The requested jump behavior needs the last running or paused scene as the next reference in some modes.
- `seek()` creates a runtime by calling `handleBackToFirst()` when there is no runtime, but that path creates a paused-ish idle runtime with `pausedAtStreamMs: 0`. This can be reused, but the semantics should be made explicit.

## Target Mental Model

Stream playback should be driven by one absolute Stream clock:

- `currentStreamMs` is the global cursor on the full calculated Stream timeline.
- Scene scheduled starts are absolute positions on that same timeline.
- Starting from a selected scene means "seek to that scene's scheduled start and play", not "make this scene time zero".
- Pausing freezes the global cursor.
- Resuming restarts the clock from the frozen cursor.
- Scrubbing changes the global cursor.
- Active sub-cues are derived from all scenes whose absolute active interval contains the cursor.

The Stream runtime should not mutate Patch routing directly. It should continue to publish active Stream sub-cues, and `deriveDirectorStateForStream()` should continue to derive the temporary playback state consumed by renderers.

## Proposed Architecture

### 1. Add A Canonical Schedule Layer

Create a shared schedule resolver, preferably in `src/shared/streamSchedule.ts`, and have `StreamEngine` use it instead of maintaining schedule logic privately.

Recommended API:

```ts
export type StreamScheduleEntry = {
  sceneId: SceneId;
  startMs?: number;
  durationMs?: number;
  endMs?: number;
  triggerKnown: boolean;
};

export type StreamScheduleIssue = {
  severity: 'error' | 'warning';
  sceneId?: SceneId;
  subCueId?: SubCueId;
  message: string;
};

export type StreamSchedule = {
  status: 'valid' | 'invalid';
  entries: Record<SceneId, StreamScheduleEntry>;
  expectedDurationMs?: number;
  issues: StreamScheduleIssue[];
  notice?: string;
};

export function buildStreamSchedule(
  stream: PersistedStreamConfig,
  durations: {
    visualDurations: Record<VisualId, number>;
    audioDurations: Record<AudioSourceId, number>;
  },
): StreamSchedule;
```

Rules:

- Never rebase the schedule to a selected scene.
- Manual-only streams should be scheduled linearly from the first enabled scene:
  - scene 1 starts at 0
  - scene 2 starts at scene 1 end
  - scene 3 starts at scene 2 end
- `follow-end`, `simultaneous-start`, and `time-offset` resolve from their predecessor's absolute start/end.
- `at-timecode` scenes keep their absolute `timecodeMs`.
- Manual trigger type must not make a scene unschedulable. A manual scene with no explicit absolute trigger should receive a planned absolute position from stream order, normally after the previous enabled scene's planned end unless another trigger relation pins it elsewhere.
- Unknown duration is no longer acceptable for a scene that participates in the calculated Stream timeline. If duration cannot be derived from media metadata, loop policy, live media policy, or a duration override, timeline calculation fails with a specific error for that scene.
- Empty enabled scenes with no sub-cues are valid zero-duration scenes. This preserves the new-show/default-scene workflow and lets operators create timing placeholders without immediately invalidating the Stream.
- Disabled scenes do not contribute to the playable schedule.

This is the core change that makes example 1 and example 2 work.

Mixed manual scheduling rules:

- Iterate enabled scenes in `sceneOrder` and resolve entries until no more changes are possible.
- `at-timecode` pins a scene immediately to its absolute timecode.
- Relation triggers use their resolved predecessor:
  - `simultaneous-start` starts at predecessor start
  - `time-offset` starts at predecessor start plus offset
  - `follow-end` starts at predecessor end and fails if the predecessor duration/end is unknown
- A manual scene with no explicit absolute trigger starts after the latest planned end of preceding enabled scenes in `sceneOrder`.
- If preceding enabled scenes overlap, the manual scene starts after the maximum known end among those preceding scenes, not merely the immediately previous row.
- If a manual scene would need an unknown preceding end, timeline calculation is invalid with a scene-specific issue.
- If a relation references a disabled or missing predecessor, timeline calculation is invalid with a scene-specific issue. Existing structural validation may also report the same broken reference.
- If a scene resolves to a start but has unknown duration, timeline calculation is invalid. The entry may keep its known `startMs`, but no `endMs` or `expectedDurationMs` is produced.

### 1.1 Maintain Edit And Playback Timelines

Maintain two calculated absolute timelines for the Stream, plus the Stream snapshots that produced them:

- `editTimeline`: the latest timeline calculation attempted from the current authoring Stream state.
- `editStream`: the current authoring Stream state being edited by the UI.
- `playbackTimeline`: the last known-good timeline that is safe to use for transport, renderer projection, and play-from-scene operations.
- `playbackStream`: the last known-good Stream snapshot that produced `playbackTimeline`.

Recommended public/runtime types:

```ts
export type StreamTimelineCalculationStatus = 'valid' | 'invalid';

export type StreamTimelineIssue = {
  severity: 'error' | 'warning';
  sceneId?: SceneId;
  subCueId?: SubCueId;
  message: string;
};

export type CalculatedStreamTimeline = {
  revision: number;
  status: StreamTimelineCalculationStatus;
  entries: Record<SceneId, StreamScheduleEntry>;
  expectedDurationMs?: number;
  calculatedAtWallTimeMs: number;
  issues: StreamTimelineIssue[];
};
```

`CalculatedStreamTimeline` should be a thin wrapper over `buildStreamSchedule()` output plus revision/time metadata. Phase 2 should introduce the shared issue/status contract even before Phase 3 adds edit/playback promotion, so tests can assert the final invalid-timeline semantics without inventing a temporary `notice`-only model.

Recommended Stream public state additions:

```ts
export type StreamEnginePublicState = {
  stream: PersistedStreamConfig;
  playbackStream: PersistedStreamConfig;
  runtime: StreamRuntimeState | null;
  editTimeline: CalculatedStreamTimeline;
  playbackTimeline: CalculatedStreamTimeline;
  validationMessages: string[];
};
```

Promotion rules:

- Every Stream edit calculates a new `editTimeline`.
- If `editTimeline.status === 'valid'`, promote both the current authoring Stream snapshot and its calculated timeline to `playbackStream` / `playbackTimeline`.
- If `editTimeline.status === 'invalid'`, do not promote it. Keep the previous `playbackStream` / `playbackTimeline` so playback controls and current playback remain functional.
- Throw/surface a recoverable timeline calculation error for the edit operation so the operator is immediately reminded that the current authored Stream has a calculation problem. In practice this should be represented in Stream state and UI rather than crashing the app or clearing the last valid playback timeline.
- Surface the invalid edit timeline issues in Stream validation/config/status UI.
- The normal state is both timelines in sync with the same revision.
- The degraded authoring state is current Stream data plus invalid `editTimeline`, while transport uses the older valid `playbackStream` / `playbackTimeline`.

Playback rules:

- Transport commands read from `playbackStream` / `playbackTimeline`, not directly from the latest unvalidated authoring graph.
- Runtime sub-cue collection, active scene state derivation, and renderer projection must use `playbackStream` while the edit timeline is invalid. This prevents old timing entries from being paired with newly broken scene data.
- Explicit play-from-scene is enabled only if that scene exists in `playbackStream` and `playbackTimeline` with a calculated start. If the current edit timeline is invalid and the scene is new or changed in a way that has not promoted, the UI should show that playback is using the last valid Stream and the current edit must be fixed before that scene can be played.
- `runtime.currentStreamMs` is always an absolute timecode and survives edit timeline recalculations.
- On successful promotion while paused or running, recompute scene states, active sub-cues, and upcoming triggers against the promoted `playbackTimeline` at the existing absolute cursor time.

Running-edit rules:

- While Stream playback is running, the global cursor continues moving regardless of edits.
- Successful edits promote to `playbackStream` / `playbackTimeline` immediately, including during playback.
- After promotion during playback, the engine must recompute what should be active at the current absolute time:
  - newly scheduled scenes whose active range contains the current cursor become active
  - scenes/sub-cues no longer active at the current cursor become orphaned runtime instances and transition according to the configured `runningEditOrphanPolicy`
  - upcoming scenes follow the newly promoted timeline
  - row-triggered manual start overrides remain anchored to their actual runtime start unless explicitly invalidated by deleted scenes/sub-cues
- Failed edits do not disrupt current playback because the old `playbackStream` / `playbackTimeline` remains authoritative.

This mirrors a DAW editing model: the playhead keeps moving, edits update content under and ahead of the playhead only after they produce a valid calculated timeline.

Implementation caution:

- Do not pair timing data from one Stream snapshot with scene/sub-cue data from another. Once `playbackTimeline` exists, every runtime method that reads schedule entries should read scene content from the paired `playbackStream`.
- Until Phase 3 lands, Phase 2 tests should validate schedule calculation in isolation and keep `StreamEngine` behavior on the current single `stream` snapshot.

### 2. Split Stream Transport Commands By Intent

The current `go` command is ambiguous and should be removed from active use. Add a clear `play` command and migrate all renderer callers away from `go`.

Required command shape:

```ts
export type StreamCommand =
  | { type: 'play'; sceneId?: SceneId; source?: 'global' | 'scene-row' | 'flow-card' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'jump-next' }
  | { type: 'back-to-first' }
  | { type: 'seek'; timeMs: number };
```

- Fully migrate from `go` to `play` in `streamHeader.ts`, `listMode.ts`, future Flow controls, tests, and documentation.
- Remove `resume` from UI use. Resume is achieved by `play`.
- Keep `go` and `resume` only as temporary compatibility aliases during the implementation branch if needed to keep intermediate commits compiling. They should not remain part of the final planned public Stream command vocabulary.

Final desired command split:

- `play`: starts or resumes Stream playback.
- `pause`: freezes running Stream playback.
- `stop`: clears active Stream playback.
- `jump-next`: navigates or advances according to runtime state.
- `back-to-first`: resets Stream scene states and cursor/reference.
- `seek`: moves the global Stream cursor without implying "start from zero".

### 3. Model Runtime Cursor And Reference Scene Separately

Add explicit cursor/reference fields instead of overloading `cursorSceneId`.

Recommended runtime additions:

```ts
export type StreamRuntimeState = {
  status: 'idle' | 'preloading' | 'running' | 'paused' | 'complete' | 'failed';
  cursorSceneId?: SceneId;
  selectedReferenceSceneId?: SceneId;
  /** Absolute Stream cursor captured at the last global pause. */
  pausedCursorMs?: number;
  /** Scene selected/focused by the UI when the last global pause was captured. */
  selectedSceneIdAtPause?: SceneId;
  lastPausedSceneId?: SceneId;
  lastRunningSceneId?: SceneId;
  originWallTimeMs?: number;
  startedWallTimeMs?: number;
  offsetStreamMs?: number;
  pausedAtStreamMs?: number;
  currentStreamMs?: number;
  sceneStates: Record<SceneId, SceneRuntimeState>;
  expectedDurationMs?: number;
  activeAudioSubCues?: StreamRuntimeAudioSubCue[];
  activeVisualSubCues?: StreamRuntimeVisualSubCue[];
  timelineNotice?: string;
};
```

`cursorSceneId` can remain for UI compatibility, but the engine should update these concepts intentionally:

- `selectedReferenceSceneId`: last scene selected by user navigation or idle jump-next.
- `lastPausedSceneId`: paused scene with the latest calculated absolute scheduled start at the current paused cursor.
- `lastRunningSceneId`: running scene with the latest calculated absolute scheduled start at the current running cursor.
- `pausedCursorMs`: the absolute global timecode to prefer when the configured paused-play behavior says to preserve the paused cursor.

If adding fields feels too large, compute `lastPausedSceneId` and `lastRunningSceneId` from `sceneStates` inside `handleJumpNext()`. The key is to use the active scene with the latest calculated absolute scheduled start, not the first active scene encountered in `sceneOrder`.

### 4. Make Runtime Creation Explicit

Add helper methods in `StreamEngine`:

```ts
private ensureIdleRuntime(referenceSceneId?: SceneId): void;
private startFromStreamTime(timeMs: number, referenceSceneId?: SceneId): void;
private pauseRunningStream(): void;
private resumeFromPausedCursor(): void;
private seekIdleOrActive(timeMs: number): void;
private sceneStartMs(sceneId: SceneId, schedule: StreamSchedule): number | undefined;
private firstEnabledSceneId(): SceneId | undefined;
private nextEnabledSceneId(afterSceneId: SceneId): SceneId | undefined;
private lastSceneWithStatus(statuses: SceneRuntimeState['status'][]): SceneId | undefined;
```

Expected behavior:

- `ensureIdleRuntime()` builds schedule and scene states without starting the tick timer.
- `startFromStreamTime()` sets `status: 'running'`, sets `offsetStreamMs/currentStreamMs`, anchors wall time, clears paused fields, recomputes, and starts ticking.
- `pauseRunningStream()` works only from `running` and is idempotent otherwise.
- `resumeFromPausedCursor()` works only from `paused`, using `pausedAtStreamMs/currentStreamMs/offsetStreamMs`.
- `seekIdleOrActive()` never implicitly starts playback. It only moves the global cursor.

This makes button behavior predictable and removes the accidental "jump-next from idle starts playback" behavior.

### 5. Add Stream Playback Preferences

Add Config surface preferences for global Stream playback behavior while paused and for running-edit orphan handling.

Recommended persisted setting:

```ts
export type StreamPausedPlayBehavior =
  | 'selection-aware'
  | 'preserve-paused-cursor';

export type StreamPlaybackSettings = {
  pausedPlayBehavior: StreamPausedPlayBehavior;
  runningEditOrphanPolicy: 'fade-out' | 'let-finish';
  runningEditOrphanFadeOutMs: number;
};
```

Recommended default:

```ts
{
  pausedPlayBehavior: 'selection-aware',
  runningEditOrphanPolicy: 'fade-out',
  runningEditOrphanFadeOutMs: 500,
}
```

The setting should be persisted with the show project, because it changes how the operator expects that show to behave in performance. The best home is either:

- `PersistedShowConfigV8.streamPlaybackSettings`, if treated as a global show playback preference.
- `PersistedStreamConfig.playbackSettings`, if treated as a property of the single Stream.

Recommended: store it on `PersistedStreamConfig` as `playbackSettings`, because the behavior belongs to Stream operation and can travel with future multi-stream designs if they ever exist.

Persistence/update path:

- Extend `PersistedStreamConfig` with optional `playbackSettings?: StreamPlaybackSettings`.
- Update `getDefaultStreamPersistence()` so new shows include the default playback settings.
- Normalize defaults when loading older v8 show files where `stream.playbackSettings` is missing; this can be done during `assertShowConfig()` / migration or in `StreamEngine.loadFromShow()`, but the public state should always expose a fully defaulted settings object.
- Extend `StreamEditCommand` `{ type: 'update-stream' }` to accept `playbackSettings?: Partial<StreamPlaybackSettings>` or add a dedicated `update-playback-settings` edit command.
- Because `configSurface.ts` currently only receives `DirectorState`, Config must also fetch/subscribe to `StreamEnginePublicState` before rendering these controls, or a small shared control shell should pass Stream state into Config. Do not persist these settings through `show:update-settings`, because that path currently writes Director/show-level settings only.

Behavior modes:

- `selection-aware`:
  - Global Play with no fresh scene selection change resumes from the paused cursor.
  - If the user explicitly selects a different scene while paused, global Play starts from that selected scene's calculated absolute scheduled start.
- `preserve-paused-cursor`:
  - Global Play always resumes from the absolute paused cursor whenever one or more scenes are paused.
  - Scene selection while paused is editing/focus only and does not change the resume position.
  - If the user edits, reorders, retimes, or changes durations while paused, resume still uses the same absolute timecode. The engine recomputes the latest schedule and derives whichever scenes/sub-cues should be active at that absolute time.

Running-edit orphan policies:

- `fade-out`:
  - If a valid edit is promoted while playback is running and a previously running scene/sub-cue is no longer active at the current absolute cursor, it is not stopped immediately.
  - Instead, its active audio and visual sub-cues fade out over `runningEditOrphanFadeOutMs`.
  - The default fade is 500 ms.
- `let-finish`:
  - If a valid edit removes a running scene/sub-cue from the current cursor's active set, the already-running instance continues until its previous runtime end, explicit stop, or natural media/sub-cue completion.
  - It becomes an orphaned runtime instance: no longer part of the promoted timeline, but still intentionally allowed to finish.

No immediate-stop option should be exposed for this case. If the user wants fast cleanup, they can choose `fade-out` with a very short fade time, subject to a minimum clamp.

Implementation detail:

- Capture `pausedCursorMs` on pause.
- Recompute schedule after every Stream edit, including while paused.
- On resume in `preserve-paused-cursor`, clamp `pausedCursorMs` only if the new calculated Stream duration is known and shorter than the paused cursor.
- Do not try to preserve local scene progress across edits. Treat the timeline as DAW-like: absolute playhead time survives, content under that playhead may change.
- For `selection-aware`, the renderer needs to know whether selection changed after pause. Track `selectedSceneIdAtPause` and compare it to current `selectedSceneId`; if different, send `play(sceneId)`, otherwise send `play()` to resume.
- For running-edit promotion, compute the diff between previous active runtime instances and new active runtime instances. Instances removed by the new promoted timeline should transition according to `runningEditOrphanPolicy`.

## Required Button Behavior Matrix

### Stream Play Button

Renderer click:

- If `runtime.status === 'paused'`, use the configured paused-play behavior:
  - `selection-aware`: send `play()` when selection has not changed since pause; send `play(sceneId)` when the user explicitly selected a different scene while paused.
  - `preserve-paused-cursor`: send `play()` so the engine resumes the absolute paused cursor regardless of selection changes.
- If Stream is not paused and a selected scene exists: send `play(sceneId)`.
- If Stream is not paused and no selected scene exists: send `play()`.

Engine behavior:

- If Patch is actively playing, ignore or reject non-stop Stream playback commands.
- If paused and no `sceneId`, resume from `pausedCursorMs` / `pausedAtStreamMs` using the latest recomputed schedule.
- If `sceneId` is provided:
  - find the selected scene's absolute `scheduledStartMs` in `playbackTimeline`
  - seek to it and run
  - if the scene is absent from the last valid `playbackStream` / `playbackTimeline` because the latest edit calculation failed, do not guess; surface the timeline calculation error
- If no `sceneId` and runtime exists, play from `currentStreamMs`/`offsetStreamMs`.
- If no runtime exists, play from first enabled scene start.

Enabled when:

- Stream has at least one enabled scene.
- Patch transport is not actively playing.
- Selected scene exists in the last valid `playbackStream` / `playbackTimeline`.

Important renderer fix:

- Do not use `currentState.paused` as the Stream play enabled condition. That value is Patch Director state or derived projection state, not the canonical Stream runtime control state.
- Track the selected scene at pause time so `selection-aware` can distinguish "resume" from "play newly selected scene."

### Scene Row Play Button

The small play button at the end of each scene row is not the same intent as the global Stream play button. It is an explicit "play this scene" interaction.

Renderer click:

- Send `play(sceneId, source: 'scene-row')` or an equivalent explicit command shape.
- Select/focus the interacted scene in the UI.

Recommended command shape:

```ts
| { type: 'play'; sceneId?: SceneId; source?: 'global' | 'scene-row' | 'flow-card' }
```

Engine behavior:

1. Stream is not playing and no scene is paused:
   - Select/focus the interacted scene.
   - Move the global cursor to the scene's calculated absolute scheduled start.
   - Start playback from the beginning of that scene.

2. Stream is not playing but one or more scenes are paused:
   - Select/focus the interacted scene.
   - Move the global cursor to the scene's calculated absolute scheduled start.
   - Refresh paused scene states against the new cursor:
     - scenes ending before the interacted scene's start become complete or skipped according to the runtime policy for jumped-over scenes
     - scenes after the interacted scene return to ready
     - active scenes at the new cursor are derived from the latest schedule
   - Start playback from the beginning of the interacted scene.
   - This explicit row action overrides the global paused-play preference. Even in `preserve-paused-cursor`, row play means "play this scene now."

3. Stream is currently playing and one or more scenes are running:
   - Do not jump the global cursor.
   - Do not disturb currently running scenes.
   - Schedule or trigger the interacted scene to start from the current Stream time onward, so it runs in parallel with the main Stream progression.
   - Treat this as a manual trigger overlay against the current absolute timeline.

The third case requires a runtime concept for ad-hoc/manual starts that are not part of the static calculated schedule. Recommended model:

```ts
export type ManualSceneStartOverride = {
  id: string;
  sceneId: SceneId;
  actualStartMs: number;
  source: 'scene-row' | 'flow-card' | 'control-subcue';
};
```

During `recomputeRuntime()`, a scene with a manual start override uses `actualStartMs` for active-state and sub-cue local-time calculations while the override is active. This keeps the global cursor continuous and lets the row-triggered scene run in parallel.

The override id must be included in runtime sub-cue identity when projected into renderer media clone ids. Current projection ids are based on `sceneId:subCueId:outputId` or `sceneId:subCueId:displayId:zone`, which collides if the same scene is started more than once in parallel. Add an optional `runtimeInstanceId` / `manualStartOverrideId` to `StreamRuntimeAudioSubCue` and `StreamRuntimeVisualSubCue`, and include it in projection clone ids when present.

### Stream Pause Button

Renderer click:

- Always send `{ type: 'pause' }`.

Engine behavior:

- Pause only if runtime status is `running`.
- Capture current global `currentStreamMs`.
- Set runtime status to `paused`.
- Recompute scene states so all currently active scenes become `paused`.
- Stop ticking.
- Do not toggle resume.

Enabled when:

- `runtime.status === 'running'`.
- Patch state does not matter, except Stream itself cannot be running when Patch is actively playing under current gating.

Bug-risk fix:

- The button should not be disabled because the selected scene is not running. It should be based only on Stream runtime status.
- The current implementation disables/toggles based on `runtime?.status !== 'running' && runtime?.status !== 'paused'`; change to exactly `runtime?.status !== 'running'`.

### Stream Jump Next Button

Renderer click:

- Always send `{ type: 'jump-next' }` when enabled.

Engine behavior cases:

1. Idle/no active runtime and no paused scene:
   - Use the UI-focused scene as the reference.
   - Advance selection/runtime reference to the next enabled scene.
   - Do not start playback.
   - Equivalent to clicking the next scene in List or Flow.

2. Idle or paused with one or multiple paused scenes:
   - On first click, use the paused scene with the latest calculated absolute scheduled start as reference.
   - Seek cursor to the next scene's absolute scheduled start if known.
   - Keep runtime paused or idle, do not start playback.
   - Subsequent clicks continue from the newly referenced scene.

3. Running with one or multiple running scenes:
   - Use the running scene with the latest calculated absolute scheduled start as reference.
   - Seek to the next scene's absolute scheduled start if known.
   - Keep runtime running.
   - Mark skipped/completed state consistently for scenes before the new cursor.

Enabled when:

- There is a next enabled scene after the chosen reference.
- Patch being active should not normally occur with Stream runtime active, but if Patch is playing and Stream is idle, this button can still be allowed as selection-only navigation because it does not start media playback.

Renderer requirement:

- `streamHeader.ts` needs to pass UI-focused selection explicitly for next navigation.
- Add `referenceSceneId?: SceneId` to `jump-next`, or maintain selected reference through an explicit idle selection command.

Recommended API:

```ts
| { type: 'jump-next'; referenceSceneId?: SceneId }
```

The header should pass `selectedSceneId` so case 1 can be implemented accurately.

### Stream Back To First Button

Renderer click:

- Send `{ type: 'back-to-first' }`.

Engine behavior:

- Stop ticking.
- Reset every scene state.
- Set runtime to `idle` with `currentStreamMs/offsetStreamMs/pausedAtStreamMs` at `0`.
- Set cursor/reference scene to first enabled scene.
- This is equivalent to focusing the first scene and resetting the Stream timeline.

Enabled when:

- `runtime.status !== 'running'` and `runtime.status !== 'preloading'`.
- It may be enabled while Patch workspace playback is running, because it does not start Stream playback.

Renderer requirement:

- Disable only for active Stream playback, not for Patch playback.

## Playback Examples

### Example 1: Three Sequential One-Minute Scenes

Schedule:

- scene 1: start 0 ms, end 60,000 ms
- scene 2: start 60,000 ms, end 120,000 ms
- scene 3: start 120,000 ms, end 180,000 ms
- Stream duration: 180,000 ms

Required behavior:

- Select scene 2, press play: runtime starts at 60,000 ms.
- Scene 2 is running from local time 0.
- Scene 1 is complete.
- Press back to first while not playing: runtime resets to 0 and scene 1 becomes the reference.
- Press play: runtime starts at 0.

### Example 2: Scene 2 Starts 30 Seconds After Scene 1

Schedule:

- scene 1: start 0 ms
- scene 2: start 30,000 ms

Required behavior:

- Select scene 2, press play: runtime starts at 30,000 ms.
- Scene 2 active sub-cues start from local time 0.
- Scene 1 active sub-cues are also active at local time 30,000 ms if scene 1 has not ended.

This should work automatically if the schedule is absolute and `collectActiveSubCues()` continues to use `currentMs - sceneStartMs`.

## Renderer Control Plan

Update `src/renderer/control/stream/streamHeader.ts`:

- Change Play button label/tooltip from "Go from selected scene" to a play/resume concept:
  - paused: "Resume stream"
  - selected scene: "Play from selected scene"
  - no selected scene: "Play from cursor"
- Change Play click handler:
  - paused: `window.xtream.stream.transport({ type: 'play' })`
  - otherwise: `window.xtream.stream.transport({ type: 'play', sceneId: selectedSceneId })`
- Change Play disabled logic to use Stream runtime and Patch playback state explicitly.
- Change Pause click handler to always send `{ type: 'pause' }`.
- Change Pause icon/tooltip to always be Pause.
- Disable Pause unless `runtime?.status === 'running'`.
- Change Next click handler to pass `selectedSceneId` as reference.
- Enable Next for idle navigation when there is a selectable next scene.
- Disable Back to first only while Stream runtime is actively running/preloading.

Update `src/renderer/control/stream/streamSurface.ts`:

- Pass enough state into `renderStreamHeader()` to know:
  - whether Patch is actively playing from raw `currentState.paused`
  - whether Stream runtime is active/paused/running
  - selected focused scene id
- After an idle jump-next response, sync `selectedSceneId` to the runtime cursor/reference scene if the command returns one.

Update `src/renderer/control/stream/listMode.ts`:

- Change row action "Run from here" to explicit scene-row play intent, e.g. `play(sceneId, source: 'scene-row')`.
- Keep row click as focus-only.
- If Stream is already running, row play must not seek the global cursor; it should trigger the interacted scene in parallel from the current global Stream time.
- Ensure row action is disabled when Patch is actively playing, because it can start Stream media playback.

Update `src/renderer/control/stream/flowMode.ts` later if a Flow play affordance is added.

Update `src/renderer/control/patch/transportControls.ts`:

- Patch play is already blocked in `Director.play()` if Stream is active.
- Improve UI disable logic so Patch play is disabled when Stream playback is active, not merely ignored by main process.
- This requires passing Stream activity into Patch transport controller or deriving it in the shared control shell.

## Main Process Runtime Plan

Update `src/shared/types.ts`:

- Add `play` Stream command and remove final use of `go`.
- Add optional `source?: 'global' | 'scene-row' | 'flow-card'` to `play` so the engine can distinguish global transport resume/play from explicit row/card play.
- Prefer adding `referenceSceneId?: SceneId` to `jump-next`.
- Add persisted `StreamPausedPlayBehavior` / `StreamPlaybackSettings`.
- Consider leaving `go`/`resume` only as temporary branch compatibility aliases, not final API.

Update `src/main/streamEngine.ts`:

- Replace `handleGo()` with `handlePlay(sceneId?)`.
- Keep `handleGo()` as alias if the command remains during migration.
- Refactor `buildSchedule()` into an absolute schedule builder.
- Remove anchor rebasing from schedule calculation.
- Change `seek()` so creating an idle runtime is explicit and does not imply paused scene state unless the runtime is paused.
- Change `handleJumpNext()` to:
  - choose reference scene based on runtime state and optional `referenceSceneId`
  - navigate without starting playback when idle/paused
  - continue running when running
  - use the active scene with the latest calculated absolute scheduled start, not the first active scene
- Change `recomputeRuntime()` so:
  - active scenes are based on absolute current time
  - `cursorSceneId` can represent the highest-order active scene or explicit reference consistently
  - it does not overwrite a selection/reference in idle states unexpectedly
- Ensure pause recomputes paused scene states and always emits state.
- Ensure play from paused emits state even if no scenes are active at the cursor.
- Add manual scene start overrides for scene-row play while the Stream is already running.
- Recompute paused/resumed content from absolute time after every Stream edit, especially in `preserve-paused-cursor` mode.

Update `src/main/director.ts`:

- Keep Patch playback behavior unchanged.
- Keep `isPatchTransportPlaying()` as "Patch actively running", not "Patch paused".
- Optionally add a public helper for "Patch can play" if renderer needs clearer UI state, but do not route Stream through Director transport.

Update `src/main/main.ts` and preload:

- Wire updated command types only if the TypeScript type changes.
- No new IPC channel should be required.

Update `src/renderer/control/config/configSurface.ts`:

- Add a Stream playback preference control.
- Label options clearly:
  - "Selection-aware resume" for the default behavior.
  - "Preserve paused cursor" for DAW-like absolute-time resume.
- Add a running-edit orphan behavior control:
  - "Fade removed running content" for fade-out behavior.
  - "Let removed running content finish" for orphaned finish behavior.
- Add a fade-out duration field for running-edit orphan fade-outs:
  - default `0.5s`
  - applies to both audio and visual sub-cues
  - clamp to a non-negative practical range, such as `0.05s` to `60s`, if immediate stop must be disallowed in UI
- Persist changes through the show/stream settings path rather than local-only UI state.

Update show config and migration:

- Add a default `playbackSettings.pausedPlayBehavior = 'selection-aware'` for new and migrated shows.
- Add default `playbackSettings.runningEditOrphanPolicy = 'fade-out'`.
- Add default `playbackSettings.runningEditOrphanFadeOutMs = 500`.
- Ensure older shows load with the default without requiring manual migration edits.

## Mutual Playback Gate Plan

Desired rules:

- Patch play disabled when Stream playback is active.
- Stream play disabled when Patch playback is active.
- Patch pause/stop remain tied to Patch state.
- Stream pause/back/next remain tied to Stream state.
- Back to first in Stream is allowed while Patch playback is running because it only resets Stream state.
- Jump-next in Stream while Patch is running is allowed only if it is focus/navigation-only and does not start Stream playback.

Current main-process gating is acceptable but UI should match it:

- `Director.play()` already returns early if `streamPlaybackGate()` is true.
- `StreamEngine.applyTransport()` already returns early for non-stop commands if `director.isPatchTransportPlaying()`.
- Refine the Stream engine so non-playing commands (`back-to-first`, idle `jump-next`, maybe `seek`) can still run while Patch is playing if they only affect Stream authoring/runtime cursor and not renderer playback.

Recommended classification:

- Starts media: `play`
- Stops media: `stop`
- Pauses Stream media: `pause`
- Cursor-only when idle/paused: `seek`, `jump-next`, `back-to-first`
- Cursor plus media when running: `seek`, `jump-next`

The gate should block starts, not harmless Stream navigation. This requires changing the current broad guard:

```ts
if (this.director.isPatchTransportPlaying() && command.type !== 'stop') {
  return this.getPublicState();
}
```

to a command-aware guard.

## Testing Plan

Add and update unit tests in `src/main/streamEngine.test.ts`:

- Play button behavior:
  - play from first scene starts at 0
  - play selected second sequential scene starts at 60,000 ms
  - play selected time-offset scene starts at its absolute offset
  - global play while paused resumes paused cursor in `preserve-paused-cursor`
  - global play while paused resumes paused cursor in `selection-aware` when selection has not changed
  - global play while paused starts from selected scene in `selection-aware` after explicit selection change
  - scene-row play while paused starts from the interacted scene regardless of paused-play preference
  - scene-row play while running does not seek the global cursor and starts the interacted scene in parallel
- Pause behavior:
  - pause is idempotent when already paused
  - pause from running captures current clock
  - paused active scenes are marked paused
  - paused cursor survives edits and resumes by absolute time in `preserve-paused-cursor`
- Schedule behavior:
  - all-manual scenes produce absolute linear schedule
  - follow-end scenes use absolute predecessor end
  - time-offset scenes overlap correctly
  - at-timecode scenes keep absolute start
  - manual trigger type does not by itself make a scene unschedulable
  - scenes without calculable duration fail timeline calculation with a specific issue
  - valid edit timeline promotes to playback timeline
  - invalid edit timeline does not replace the last valid playback timeline
  - invalid edit timeline does not replace the last valid playback Stream snapshot
  - running playback keeps advancing while a failed edit timeline is reported
  - successful timeline promotion during running playback recomputes active scenes at the current absolute cursor
  - removed running audio/visual content fades out by default over 500 ms
  - removed running audio/visual content can alternatively continue until natural completion
  - removed running content is never stopped immediately by this transition path
- Jump-next behavior:
  - idle with focused scene advances selection/reference only
  - paused with multiple paused scenes uses last paused scene
  - running with overlapping scenes uses last running scene
  - reaching the end transitions to complete or last reference without accidentally starting idle playback
- Back-to-first behavior:
  - disabled in renderer while running, engine remains safe if called
  - resets scene states and cursor to first enabled scene
- Mutual gating:
  - Patch playing blocks Stream play
  - Patch playing does not block Stream back-to-first
  - Patch playing blocks scene-row play because scene-row play starts Stream media
  - Stream active blocks Patch play at Director level

Phase 1 should not attempt to add every future test in this list at once. Start with target tests that prove the Phase 2 schedule model and the existing transport regressions:

- selected sequential scene play must use absolute scheduled start, not rebased zero
- selected overlapping offset scene play must keep earlier overlapping scenes active
- all-manual scenes must schedule linearly from the first enabled scene
- mixed manual/triggered scenes must follow the deterministic mixed scheduling rules above
- empty enabled scenes must resolve as zero-duration entries
- missing media duration, infinite loops, and unknown predecessor ends must produce invalid schedule issues
- idle `jump-next` must not start playback
- pause must be pause-only and idempotent
- Stream play enabled state must not depend on Patch `DirectorState.paused`

Tests for edit/playback timeline promotion, paused-play preferences, scene-row parallel starts, running-edit orphan behavior, Config controls, and mutual playback UI polish should be added in their matching implementation phases. They are listed here as final coverage targets, not as a single Phase 1 burden.

Add and update renderer tests if practical:

- `streamHeader.ts` can be tested through DOM construction or targeted helper extraction.
- Extract a pure `deriveStreamTransportUiState()` helper to make button disabled states testable without rendering.

Update `src/renderer/streamProjection.test.ts`:

- Confirm overlapping active scenes project simultaneous audio/visual runtime clones.
- Confirm runtime offsets remain absolute stream starts.

Run:

```powershell
npm run typecheck
npm test
```

## Implementation Phases

### Phase 1: Add Target Behavior Tests For The Foundation

- Add failing tests for the Phase 2 schedule model and the transport regressions that currently block it.
- Include sequential, offset-overlap, manual linear, mixed manual/triggered, empty-scene, invalid-duration, pause-only, idle jump-next, and back-to-first cases.
- Keep tests for later-phase features out of Phase 1 unless the implementation touches that behavior directly.
- Keep Patch regression tests green.

Exit: tests clearly describe the foundation behavior before refactor without requiring edit/playback timeline promotion or running-edit orphan infrastructure.

### Phase 2: Canonical Absolute Schedule And Timeline Validation

- Move schedule building into `src/shared/streamSchedule.ts`.
- Replace anchor-based `StreamEngine.buildSchedule()` with absolute schedule calculation.
- Treat manual scenes as schedulable planned timeline entries rather than unknown breaks.
- Return `status`, `issues`, entries, and expected duration from the shared schedule builder.
- Treat empty enabled scenes as valid zero-duration entries.
- Apply the deterministic mixed manual scheduling rules from the canonical schedule section.
- Convert unknown duration/start/end cases into explicit timeline calculation errors.
- Update duration tests and expected runtime scheduled starts.

Exit: every valid scene resolves to absolute start/end timing, calculation failures are explicit, and `StreamEngine` no longer rebases schedules to a selected anchor.

### Phase 3: Edit/Playback Timeline Promotion

- Add `editTimeline` and `playbackTimeline` to Stream public/runtime state.
- Add `playbackStream` as the last valid Stream snapshot paired with `playbackTimeline`.
- Recalculate `editTimeline` on every Stream edit.
- Promote valid edit timelines and their Stream snapshots to playback.
- Preserve the last valid playback Stream/timeline pair when edit timeline calculation fails.
- Update Stream validation/status UI to expose edit timeline calculation errors.
- Recompute paused/running scene states from absolute cursor on successful promotion.

Exit: invalid edits cannot break current or future playback of the last known-good timeline.

### Phase 4: Runtime Command Refactor

- Add `play` command and optional `jump-next.referenceSceneId`.
- Migrate all active callers away from `go`; remove `go` from the final command model.
- Add `play.source` so global transport play and row/card play can have distinct behavior.
- Implement explicit idle runtime creation, play from cursor, play from scene, pause-only pause, and resume-through-play.
- Make `seek()` cursor-only unless runtime is already running.
- Add the paused-play behavior setting and default it to `selection-aware`.

Exit: engine transport behavior passes unit tests.

### Phase 5: Pause Preference And Manual Scene Starts

- Implement `selection-aware` and `preserve-paused-cursor` global Play behavior.
- Track `pausedCursorMs` and selected scene at pause time.
- Recompute the schedule after paused edits and resume from absolute time in `preserve-paused-cursor`.
- Implement scene-row play:
  - stopped/no paused scenes: focus, seek to scene start, play
  - paused: focus, refresh scene states around interacted scene, play from scene start
  - running: start scene in parallel through a manual start override without seeking the global cursor

Exit: global Play, paused editing, and row Play semantics are distinct and predictable.

### Phase 6: Running Edit Promotion

- Allow successful edit timeline promotion while Stream playback is running.
- Keep the global cursor advancing through edits.
- Recompute active scene/sub-cue projection from the promoted playback timeline at the current absolute cursor.
- Preserve currently valid row/manual start overrides unless their scene or sub-cues were removed.
- Implement configured handling for running content removed by a promoted edit:
  - `fade-out`: fade audio and visual sub-cues over `runningEditOrphanFadeOutMs`, default 500 ms
  - `let-finish`: keep orphaned runtime instances alive until natural completion or explicit stop
- Do not immediately stop removed running content.
- Keep playback on the old timeline when the edit timeline fails.

Exit: the user can rearrange upcoming Stream content during playback without disrupting the clock.

### Phase 7: Jump/Back Semantics

- Implement the three jump-next modes.
- Ensure idle and paused navigation does not start ticking.
- Ensure running jump-next keeps playback running.
- Ensure back-to-first resets only when not running, and remains engine-safe if called unexpectedly.
- Use latest calculated absolute scheduled start to choose the reference scene when multiple scenes are running or paused.

Exit: scene reference movement works independently of playback state.

### Phase 8: Renderer Header Refactor

- Update Stream header button handlers, labels, icons, tooltips, and disabled states.
- Add a pure UI-state helper if needed for tests.
- Update list row "Run from here" to call the explicit scene-row play intent.
- Add Config surface controls for paused-play behavior, running-edit orphan behavior, and orphan fade-out duration.

Exit: UI matches engine semantics.

### Phase 9: Mutual Playback UI Polish

- Pass Stream activity into Patch transport UI so Patch play visibly disables while Stream is active.
- Pass Patch active playback into Stream transport UI so Stream play visibly disables while Patch is running.
- Keep main-process guards as the final safety boundary.

Exit: neither workspace offers a misleading play button while the other workspace owns active playback.

### Phase 10: Projection And Runtime Verification

- Verify derived DirectorState still drives audio/display/control previews correctly.
- Check overlapped scene projections with runtime offsets.
- Run typecheck and unit tests.
- Optionally do a manual app smoke test with two scenes and a time-offset overlap.

Exit: Stream behavior changes without deprecating Patch behavior.

## Risks And Mitigations

- Risk: changing `go` semantics surprises existing renderer callers.
  - Mitigation: introduce `play`, migrate callers completely, and keep `go` only as a temporary branch alias if needed.
- Risk: absolute manual scheduling changes existing tests that assumed anchor rebasing.
  - Mitigation: update tests to match the requested global timeline model.
- Risk: renderer button state reads derived `DirectorState` and confuses Patch/Stream paused state.
  - Mitigation: create explicit UI-state helpers that take raw Patch `DirectorState` plus `StreamEnginePublicState`.
- Risk: paused edits make local scene progress stale.
  - Mitigation: in `preserve-paused-cursor`, resume from absolute time against the newly recomputed schedule and intentionally disregard stale local progress.
- Risk: a broken edit could leave the runtime with no valid starts/ends.
  - Mitigation: calculate into `editTimeline` first and promote only valid results with their Stream snapshot to `playbackStream` / `playbackTimeline`; keep the previous valid playback pair alive.
- Risk: running edits could cause visible discontinuities when the promoted timeline changes content under the moving cursor.
  - Mitigation: keep the clock continuous, recompute active content at the current absolute time, and use the configured orphan policy. Immediate stop is not allowed; removed running content either fades out or continues to natural completion.
- Risk: scene-row play while running creates two meanings for "play selected scene."
  - Mitigation: carry `play.source` and treat row/card play as an explicit manual start override, separate from global transport play.
- Risk: `cursorSceneId` means too many things.
  - Mitigation: add separate reference fields or compute reference locally by scene state and order.
- Risk: broad Patch-playing guard blocks harmless Stream navigation.
  - Mitigation: classify Stream commands as playback-starting vs cursor/navigation-only.
- Risk: overlapping scene jump-next is ambiguous if scene order differs from scheduled start order.
  - Mitigation: use the active scene with the latest calculated absolute scheduled start, per the resolved behavior.

## Resolved Decisions

1. Use a new clear `{ type: 'play' }` Stream command and migrate away from unclear `{ type: 'go' }` completely.

2. Add a Config surface preference for global Stream paused-play behavior:
   - default `selection-aware`
   - optional `preserve-paused-cursor`

3. In `preserve-paused-cursor`, paused scene edits do not preserve stale local scene progress. Resume uses the absolute paused timecode against the newly recalculated Stream schedule.

4. The small play button in a scene row is explicit scene-row play, not global Play:
   - stopped/no paused scenes: focus, seek to scene start, play
   - paused: focus, refresh states around that scene, play from scene start
   - running: do not seek global cursor; start the interacted scene in parallel from now

5. "Last running/paused scene" for jump-next means the active scene with the latest calculated absolute scheduled start time.

6. Idle Stream navigation commands should be allowed while Patch playback is running, as long as they do not start Stream playback.

7. Explicit play-from-scene should not normally encounter unknown absolute starts. The engine should maintain a robust calculated absolute timeline and treat uncalculable scene start/end as an edit timeline calculation error.

8. Maintain two calculated timelines:
   - `editTimeline`: latest calculation from current edited Stream data
   - `playbackTimeline`: last known-good valid timeline used by transport

9. Pair the playback timeline with `playbackStream`, the last valid Stream snapshot. Valid edit timeline calculations promote both Stream snapshot and timeline. Failed calculations do not promote, so playback stays functional with the last valid Stream/timeline pair while the UI reports the edit calculation error.

10. Manual trigger scenes must not block timeline calculation by trigger type alone. They receive planned absolute positions in the calculated timeline.

11. During running playback, successful edits can promote to the playback timeline. The global cursor continues moving, and active/upcoming content is recomputed from the current absolute time.

12. If a valid edit is promoted while playback is running and a previously running scene/sub-cue is no longer active at the current cursor, immediate stop is not allowed.

13. Running content removed by a promoted edit is governed by a Config surface global preference:
   - `fade-out`, default
   - `let-finish`

14. Running-edit orphan fade-out duration is configurable in the Config surface, defaults to `0.5s`, and applies to both audio and visual sub-cues.

## Clarification Needed

No remaining product-level decision blocks are known from this planning pass. During implementation, the main detail to confirm is the minimum allowed fade duration for "Fade removed running content"; use a small positive clamp if the UI must prevent effectively immediate stops.
