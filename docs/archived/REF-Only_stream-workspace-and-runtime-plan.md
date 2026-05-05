# Stream Workspace And Runtime Plan

## Purpose

This is the canonical Stream workspace and runtime design document. It merges the product and workspace requirements from the earlier Stream workspace design plan with the newer core Stream transport/runtime architecture.

The runtime architecture in this document is authoritative. Older references to `go`/`resume` transport commands, anchor-rebased schedules, manual scenes as timing breaks, and single-timeline playback are superseded by the absolute timeline model here.

Current implementation context:

- The core transport/runtime refactor is considered complete for roadmap purposes.
- The remaining roadmap work is the product/workspace work formerly tracked as workspace phases 8, 9, and 10: Flow mode, advanced scene editing, and production hardening.
- Patch playback behavior must remain intact. Patch and Stream are mutually exclusive for active playback, while harmless Stream navigation may still be allowed when Patch owns active playback.
- Operator-visible validation (persisted stream checks, live engine `validationMessages`, timeline notices) is aggregated in the **global session problems strip** in the control footer and in the Config **Session log**, not in a separate Stream transport status row. See `docs/in-app-config-log-roadmap.md` (Stage 1).

## Canonical Decisions

1. A show contains exactly one user-authored Stream.
2. A Stream is a scene-by-scene sequence with one absolute global Stream clock.
3. Scene scheduled starts and ends are absolute positions on the full calculated Stream timeline.
4. Selecting a later scene and pressing play seeks to that scene's calculated absolute start. It does not rebase that scene to zero.
5. Manual scenes do not block timeline calculation by trigger type alone. They receive planned absolute positions in the calculated timeline.
6. Every Stream edit recalculates an edit timeline. Only valid edit timelines promote to the playback timeline.
7. Playback uses `playbackStream` paired with `playbackTimeline`; it must not pair timing data from one Stream snapshot with scene/sub-cue data from another.
8. Pause is pause-only. Resume is achieved through `play`.
9. The small scene-row play affordance is explicit scene play, not the same intent as global Stream play.
10. Running edits keep the Stream clock moving. Valid edits update content under and ahead of the playhead; invalid edits do not disturb last known-good playback.
11. Running content removed by a valid promoted edit is never stopped immediately by that transition path. It either fades out or is allowed to finish, based on Stream playback settings.
12. Flow mode uses Rete.js as an editing/view layer, not as the persisted source of truth.

## Product Model

### Show

A show is the saved project document. It contains:

- global asset pool: visuals and audio sources
- global outputs: virtual audio outputs and physical routing
- global displays: display windows and monitor placement
- one Stream
- show-level settings: extraction format, global mute/blackout fade defaults, and future adapter settings
- Patch compatibility data for the Patch workspace

Displays and outputs are show-level resources. A scene references them; it does not own them.

### Stream

A Stream is the show-level scene sequence. It has one cursor, one timing origin, one trigger graph, one edit timeline, one playback timeline, and one runtime state.

The Stream shares media, output, display, readiness, autosave, and show-file infrastructure with Patch. Stream should not be a separate app state tree.

### Scene

A Scene is the operator-facing executable unit. It can contain multiple sub-cues that become active relative to the scene start.

A scene has:

- stable generated ID, not visible to users
- cue number generated from order within its Stream
- optional title
- optional note
- trigger policy
- disabled state
- loop policy
- preload policy
- audio sub-cues
- visual sub-cues
- control sub-cues
- optional Flow canvas position and size

Scene runtime states are:

- `disabled`
- `ready`
- `preloading`
- `running`
- `paused`
- `complete`
- `failed`
- `skipped`

`focused` is UI selection state, not persisted runtime state.

### Sub-Cues

Sub-cues are scene-local actions. Internally, keep `subCue` naming to preserve show-control vocabulary. The UI may label the groups Audio, Visuals, and Controls.

Audio sub-cues:

- reference an audio source from the pool
- select one or more virtual outputs
- set loop within the scene
- define fade in/out
- define level automation
- define pan automation
- set playback rate
- support waveform visualization

Visual sub-cues:

- reference a visual from the pool
- select one or more display targets
- set fade in/out
- set freeze frame for video
- set loop within the scene
- set playback rate

Control sub-cues:

- act on running scenes, sub-cues, outputs, displays, or global safety state
- support commands such as stop, pause, resume, fade out, set level, set pan, blackout display, mute output, and future adapter actions

The first complete Stream implementation should include the full planned control sub-cue scope rather than a reduced starter subset.

## Display And Output Model

Display targets are derived from show-level display windows:

- A display window in single mode exposes one assignable target.
- A display window in split mode exposes each split zone as its own assignable target.
- A visual sub-cue targets `{ displayId, zoneId }`, not just a display window ID.
- The same target model is used when converting Patch display layouts into the hidden compatibility scene.

Multiple scenes or visual sub-cues may target the same display target. This is a desired feature, not a validation error. The display window owns the visual mingle algorithm used to combine simultaneous visuals.

Recommended display mingle algorithms:

- `latest`: latest-started visual owns the target; default for new display windows
- `alpha-over`: normal opacity compositing by layer/start order
- `additive`
- `multiply`
- `screen`
- `lighten`
- `darken`
- `crossfade`: time-based blend between previous and incoming visual

Multiple audio sub-cues may target the same virtual output and mix together.

## Embedded Video Audio

When adding a video visual sub-cue, Xtream should automatically create or attach an embedded-audio audio sub-cue by default if the video has embedded audio.

The generated audio sub-cue should use the existing embedded audio source mechanism rather than storing duplicated media metadata inside the scene.

Embedded video audio selection priority:

1. Use an existing extracted embedded-audio file source when one exists.
2. Otherwise use an existing representation source when one exists.
3. Otherwise create the embedded-audio representation source and attach it.

## Persistence And Patch Compatibility

The current persisted schema should preserve existing show-level media, output, display, and settings data while adding Stream data and Patch compatibility data.

Important persisted concepts:

- `PersistedStreamConfig`
- `PersistedSceneConfig`
- `PersistedSubCueConfig`
- display-zone visual targets
- display-level visual mingle settings
- Stream playback settings
- hidden Patch compatibility scene/projection

The source of truth for exact persisted TypeScript shapes is `src/shared/types.ts`. This document describes requirements and invariants, not a second schema definition.

### v7 To v8 Compatibility

When opening an older Patch-only show:

1. Create the show Stream:
   - `id: stream-main`
   - `label: Main Stream`
2. Create a first user-authored Stream scene:
   - `id: scene-1`
   - `title: Scene 1`
   - `trigger: { type: 'manual' }`
   - empty sub-cue list by default
3. Create a hidden Patch compatibility scene:
   - `id: patch-compat-scene`
   - `title: Patch Compatibility`
   - `trigger: { type: 'manual' }`
   - hidden from Stream List and Flow modes
   - loop copied from the current show-level loop
4. Convert current Patch routing into the hidden compatibility scene:
   - each active display visual reference becomes a visual sub-cue
   - split display layouts become visual sub-cues targeting corresponding display zones
   - each output source selection becomes an audio sub-cue
   - preserve output bus settings and display window definitions at show level
5. Preserve all existing media pool records, outputs, displays, and settings.

Patch continues to edit `patchCompatibility.scene`. Existing Patch controls remain largely unchanged. Patch playback uses a manual trigger and never appears as a normal Stream scene.

## Runtime Mental Model

Stream playback is driven by one absolute Stream clock:

- `currentStreamMs` is the global cursor on the full calculated Stream timeline.
- Scene scheduled starts are absolute positions on that same timeline.
- Starting from a selected scene means seek to that scene's scheduled start and play.
- Pausing freezes the global cursor.
- Resuming restarts the clock from the frozen cursor.
- Scrubbing changes the global cursor.
- Active sub-cues are derived from all scenes whose absolute active interval contains the cursor.

The Stream runtime must not mutate Patch routing directly. It publishes active Stream sub-cues, and `deriveDirectorStateForStream()` derives the temporary playback state consumed by renderers.

## Main Runtime Boundaries

### Director

`src/main/director.ts` remains the Patch transport, low-level media transport, readiness, display, output, drift correction, and media pool owner.

Director should not embed Stream sequencing. Stream sequencing belongs in `StreamEngine`.

### StreamEngine

`src/main/streamEngine.ts` owns:

- Stream runtime state
- schedule/timeline calculation orchestration
- scene states
- active sub-cues
- transport command handling
- edit/playback timeline promotion
- running edit behavior
- state broadcast to renderers

### Projection

`src/renderer/streamProjection.ts` projects active Stream runtime state into a derived `DirectorState` for control, audio, and display renderers.

Projection must use the paired `playbackStream` and `playbackTimeline` while the edit timeline is invalid.

## Canonical Schedule Layer

Schedule calculation belongs in a shared schedule resolver, currently expected in `src/shared/streamSchedule.ts`.

Required API shape:

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

Schedule rules:

- Never rebase the schedule to a selected scene.
- Manual-only streams schedule linearly from the first enabled scene.
- `follow-end`, `simultaneous-start`, and `time-offset` resolve from their predecessor's absolute start/end.
- `at-timecode` scenes keep their absolute `timecodeMs`.
- Manual trigger type must not make a scene unschedulable.
- A manual scene with no explicit absolute trigger receives a planned absolute position from stream order, normally after the previous enabled scene's planned end unless another trigger relation pins it elsewhere.
- Unknown duration is not acceptable for a scene that participates in the calculated Stream timeline.
- If duration cannot be derived from media metadata, loop policy, live media policy, or a duration override, timeline calculation fails with a specific issue for that scene.
- Empty enabled scenes with no sub-cues are valid zero-duration scenes.
- Disabled scenes do not contribute to the playable schedule.

Mixed manual scheduling rules:

- Iterate enabled scenes in `sceneOrder` and resolve entries until no more changes are possible.
- `at-timecode` pins a scene immediately to its absolute timecode.
- `simultaneous-start` starts at predecessor start.
- `time-offset` starts at predecessor start plus offset.
- `follow-end` starts at predecessor end and fails if predecessor duration/end is unknown.
- A manual scene with no explicit absolute trigger starts after the latest planned end of preceding enabled scenes in `sceneOrder`.
- If preceding enabled scenes overlap, the manual scene starts after the maximum known end among those preceding scenes, not merely the immediately previous row.
- If a manual scene would need an unknown preceding end, timeline calculation is invalid with a scene-specific issue.
- If a relation references a disabled or missing predecessor, timeline calculation is invalid with a scene-specific issue.
- If a scene resolves to a start but has unknown duration, timeline calculation is invalid. The entry may keep its known `startMs`, but no `endMs` or `expectedDurationMs` is produced.

## Trigger Semantics

All trigger policies are evaluated per Stream.

### Manual

Manual scenes do not auto-link to previous scenes in Flow mode. They still receive planned absolute schedule positions when no explicit timing relation pins them elsewhere.

### Simultaneous Start

The scene starts when its followed scene starts.

If `followsSceneId` is omitted, the default is the literal previous scene in `sceneOrder`.

### Follow End

The scene starts when its followed scene completes.

If `followsSceneId` is omitted, the default is the literal previous scene in `sceneOrder`.

If the followed scene loops, follow-end waits until all loop iterations finish. When a user sets a scene to follow a looped scene, Xtream should show a confirmation reminder explaining that the dependent scene will not start until the loop completes.

Infinite loops should require an especially clear confirmation because follow-end dependents will not fire without a manual stop/skip policy.

### Time Offset

The scene starts `offsetMs` after the followed scene starts.

If `followsSceneId` is omitted, the default is the literal previous scene in `sceneOrder`.

### At Timecode

The scene starts at an absolute Stream timecode. At-timecode values remain absolute even when playback starts from a later scene or later time.

If playback starts after an at-timecode scene's scheduled time, that scene is marked `skipped` rather than rebasing its trigger time.

### Reordering Behavior

List drag reorder updates cue numbers automatically.

If a dragged scene has a trigger with implicit `followsSceneId`, reordering naturally changes the followed scene to the new previous row.

If a dragged scene has an explicit `followsSceneId`, reordering preserves that reference.

If any other scene explicitly follows the dragged scene, the UI should warn before reordering because the dependency graph may be visually misleading after the move.

## Duration Calculation

Scene duration:

- For non-looping scenes, duration is the longest effective duration among sub-cues.
- Effective duration is media duration divided by playback rate, optionally clipped by duration override.
- For counted scene loops, duration includes all loop iterations.
- Fade-out is included only when it extends beyond media end or stop command duration.
- Live visual sub-cues, unknown media duration, and infinite loops require explicit policy or override before they can participate in a valid calculated timeline.

Stream duration:

- Build a directed schedule graph from trigger policies.
- Calculate absolute starts/ends where possible.
- Manual scenes are planned in absolute time rather than treated as timing breaks.
- At-timecode scenes have known absolute starts.
- Unknown or infinite duration makes the calculated edit timeline invalid unless the scene's runtime policy makes the duration calculable.
- Follow-end dependents of infinite loop scenes remain waiting until an operator stops, skips, or otherwise completes the looped scene; authoring should warn clearly before committing this relationship.

UI should display:

- exact duration when calculable
- `live` for explicitly live/infinite scenes
- `--` for unknown
- warning/error badges for trigger references and timeline issues that cannot be resolved

## Edit And Playback Timelines

The Stream engine maintains two calculated absolute timelines plus the Stream snapshots that produced them:

- `editTimeline`: latest timeline calculation attempted from the current authoring Stream state
- `editStream`: current authoring Stream state being edited by the UI
- `playbackTimeline`: last known-good timeline safe to use for transport, renderer projection, and play-from-scene operations
- `playbackStream`: last known-good Stream snapshot that produced `playbackTimeline`

Required public/runtime shape:

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
- If `editTimeline.status === 'invalid'`, do not promote it.
- Keep the previous `playbackStream` / `playbackTimeline` so playback controls and current playback remain functional.
- Surface invalid edit timeline issues in Stream validation/config/status UI.
- The normal state is both timelines in sync with the same revision.
- The degraded authoring state is current Stream data plus invalid `editTimeline`, while transport uses the older valid `playbackStream` / `playbackTimeline`.

Playback rules:

- Transport commands read from `playbackStream` / `playbackTimeline`, not directly from the latest unvalidated authoring graph.
- Runtime sub-cue collection, active scene state derivation, and renderer projection use `playbackStream` while the edit timeline is invalid.
- Explicit play-from-scene is enabled only if that scene exists in `playbackStream` and `playbackTimeline` with a calculated start.
- If the current edit timeline is invalid and the scene is new or changed in a way that has not promoted, the UI should show that playback is using the last valid Stream and the current edit must be fixed before that scene can be played.
- `runtime.currentStreamMs` is always an absolute timecode and survives edit timeline recalculations.
- On successful promotion while paused or running, recompute scene states, active sub-cues, and upcoming triggers against the promoted `playbackTimeline` at the existing absolute cursor time.

## Runtime Cursor And Reference State

The engine should model cursor and reference concepts separately rather than overloading `cursorSceneId`.

Recommended runtime fields:

```ts
export type StreamRuntimeState = {
  status: 'idle' | 'preloading' | 'running' | 'paused' | 'complete' | 'failed';
  cursorSceneId?: SceneId;
  selectedReferenceSceneId?: SceneId;
  pausedCursorMs?: number;
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

Meaning:

- `selectedReferenceSceneId`: last scene selected by user navigation or idle jump-next
- `lastPausedSceneId`: paused scene with the latest calculated absolute scheduled start at the current paused cursor
- `lastRunningSceneId`: running scene with the latest calculated absolute scheduled start at the current running cursor
- `pausedCursorMs`: absolute global timecode preferred when paused-play behavior says to preserve the paused cursor

If these fields are not all stored directly, the engine must still compute the same concepts for transport behavior.

## Runtime Helpers

The engine should use explicit helpers for runtime transitions:

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
- `seekIdleOrActive()` never implicitly starts playback.

## Stream Transport Commands

The canonical command vocabulary is:

```ts
export type StreamCommand =
  | { type: 'play'; sceneId?: SceneId; source?: 'global' | 'scene-row' | 'flow-card' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'jump-next'; referenceSceneId?: SceneId }
  | { type: 'back-to-first' }
  | { type: 'seek'; timeMs: number };
```

Final intent split:

- `play`: starts or resumes Stream playback
- `pause`: freezes running Stream playback
- `stop`: clears active Stream playback
- `jump-next`: navigates or advances according to runtime state
- `back-to-first`: resets Stream scene states and cursor/reference
- `seek`: moves the global Stream cursor without implying start-from-zero

`go` and `resume` are obsolete. They may exist only as temporary compatibility aliases inside an implementation branch, not in the final public command model.

## Stream Playback Settings

Stream playback settings belong on `PersistedStreamConfig` so the behavior travels with Stream operation and future multi-stream designs.

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

Default:

```ts
{
  pausedPlayBehavior: 'selection-aware',
  runningEditOrphanPolicy: 'fade-out',
  runningEditOrphanFadeOutMs: 500,
}
```

Behavior modes:

- `selection-aware`: global Play with no fresh scene selection change resumes from the paused cursor; if the user explicitly selects a different scene while paused, global Play starts from that selected scene's calculated absolute scheduled start.
- `preserve-paused-cursor`: global Play always resumes from the absolute paused cursor whenever one or more scenes are paused. Scene selection while paused is editing/focus only and does not change resume position.

Running-edit orphan policies:

- `fade-out`: content removed from the promoted active set fades out over `runningEditOrphanFadeOutMs`; default is 500 ms.
- `let-finish`: already-running orphaned runtime instances continue until previous runtime end, explicit stop, or natural media/sub-cue completion.

No immediate-stop option should be exposed for running-edit orphan transitions. If a user wants fast cleanup, they can choose `fade-out` with a short positive fade duration subject to UI clamping.

## Button Behavior Matrix

### Global Stream Play

Renderer click:

- If `runtime.status === 'paused'`, use configured paused-play behavior.
- In `selection-aware`, send `play()` when selection has not changed since pause; send `play(sceneId)` when the user explicitly selected a different scene while paused.
- In `preserve-paused-cursor`, send `play()` so the engine resumes the absolute paused cursor regardless of selection changes.
- If Stream is not paused and a selected scene exists, send `play(sceneId)`.
- If Stream is not paused and no selected scene exists, send `play()`.

Engine behavior:

- If Patch is actively playing, reject playback-starting Stream commands.
- If paused and no `sceneId`, resume from `pausedCursorMs` / `pausedAtStreamMs` using the latest promoted schedule.
- If `sceneId` is provided, find the selected scene's absolute scheduled start in `playbackTimeline`, seek to it, and run.
- If no `sceneId` and runtime exists, play from `currentStreamMs` / `offsetStreamMs`.
- If no runtime exists, play from first enabled scene start.

Enabled when:

- Stream has at least one enabled scene.
- Patch transport is not actively playing.
- Selected scene exists in the last valid `playbackStream` / `playbackTimeline` when playing from selection.

### Scene Row Play

The scene-row play button is explicit "play this scene" intent.

Renderer click:

- Select/focus the interacted scene.
- Send `play(sceneId, source: 'scene-row')`.

Engine behavior:

1. Stream is not playing and no scene is paused:
   - Move the global cursor to the scene's calculated absolute scheduled start.
   - Start playback from that scene.
2. Stream is not playing but one or more scenes are paused:
   - Move the global cursor to the scene's calculated absolute scheduled start.
   - Refresh paused scene states against the new cursor.
   - Start playback from the interacted scene.
   - Override the global paused-play preference.
3. Stream is currently playing:
   - Do not jump the global cursor.
   - Do not disturb currently running scenes.
   - Start the interacted scene in parallel from the current Stream time through a manual start override.

Manual override model:

```ts
export type ManualSceneStartOverride = {
  id: string;
  sceneId: SceneId;
  actualStartMs: number;
  source: 'scene-row' | 'flow-card' | 'control-subcue';
};
```

Projection clone IDs must include `runtimeInstanceId` / `manualStartOverrideId` when present to avoid collisions if the same scene is started more than once in parallel.

### Pause

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

### Jump Next

Renderer click:

- Send `{ type: 'jump-next', referenceSceneId: selectedSceneId }` when enabled.

Engine behavior:

1. Idle/no active runtime and no paused scene:
   - Use UI-focused scene as the reference.
   - Advance selection/runtime reference to the next enabled scene.
   - Do not start playback.
2. Idle or paused with one or more paused scenes:
   - Use the paused scene with the latest calculated absolute scheduled start as reference.
   - Seek cursor to the next scene's absolute scheduled start if known.
   - Keep runtime paused or idle.
   - Do not start playback.
3. Running with one or more running scenes:
   - Use the running scene with the latest calculated absolute scheduled start as reference.
   - Seek to the next scene's absolute scheduled start if known.
   - Keep runtime running.
   - Mark skipped/completed state consistently for scenes before the new cursor.

Enabled when:

- There is a next enabled scene after the chosen reference.
- Patch playback may be active only if the command is focus/navigation-only and will not start Stream media.

### Back To First

Renderer click:

- Send `{ type: 'back-to-first' }`.

Engine behavior:

- Stop ticking.
- Reset every scene state.
- Set runtime to `idle` with cursor/offset/paused time at `0`.
- Set cursor/reference scene to first enabled scene.

Enabled when:

- `runtime.status !== 'running'` and `runtime.status !== 'preloading'`.
- It may be enabled while Patch playback is running because it does not start Stream playback.

## Running Edit Behavior

While Stream playback is running:

- The global cursor continues moving regardless of edits.
- Successful edits promote to `playbackStream` / `playbackTimeline` immediately.
- Failed edits do not disrupt current playback because the old playback pair remains authoritative.

After promotion during playback:

- newly scheduled scenes whose active range contains the current cursor become active
- scenes/sub-cues no longer active at the current cursor become orphaned runtime instances
- orphaned runtime instances follow `runningEditOrphanPolicy`
- upcoming scenes follow the newly promoted timeline
- row-triggered manual start overrides remain anchored to their actual runtime start unless invalidated by deleted scenes/sub-cues

This is a DAW-like model: the playhead keeps moving, edits update content under and ahead of the playhead only after they produce a valid calculated timeline.

## Mutual Playback Gate

Desired rules:

- Patch play is disabled when Stream playback is active.
- Stream play is disabled when Patch playback is active.
- Patch pause/stop remain tied to Patch state.
- Stream pause/back/next remain tied to Stream state.
- Stream back-to-first is allowed while Patch playback is running because it only resets Stream state.
- Stream jump-next while Patch is running is allowed only if it is focus/navigation-only and does not start Stream playback.

Command classification:

- Starts media: `play`
- Stops media: `stop`
- Pauses Stream media: `pause`
- Cursor-only when idle/paused: `seek`, `jump-next`, `back-to-first`
- Cursor plus media when running: `seek`, `jump-next`

The main-process gate should block media starts, not harmless Stream navigation.

## Preload Model

Preloading must be part of Stream production behavior.

Scene preload states:

- `ready`: all required assets and outputs validate
- `preloading`: media elements, audio buffers/graphs, and live capture grants are being prepared
- `ready-to-start`: preload completed and no blocking readiness issues remain
- `failed`: preload failed

Default policy:

- preload the current scene and next scene
- scenes with `preload.enabled` can request a lead time
- simultaneous and time-offset dependent scenes should preload with their source scene
- live capture sub-cues should prepare permission/grant state but avoid starting visible output until scene start

## Workspace Layout

### Header

Full-width header:

- left: Stream timecode
- transport: back to first, play, pause, jump next
- center: editable scene title and note in a two-row stack
- right: Save, Save As, Open, New

Transport semantics are defined by the button behavior matrix above. Do not reintroduce legacy `go` or pause/resume toggle semantics in the UI copy.

Existing global mute, blackout, performance mode, clear solo, and reset meters can stay in the existing status footer or move into Stream bottom/status chrome later.

### Middle Row

Left:

- existing media pool controller reused from Patch

Right:

- main Stream edit pane with List and Flow modes

List and Flow should be presented as the outer wrapper of the right pane, not as tabs nested inside another titled panel.

### Bottom Section

Full-width bottom pane with subtabs:

- Scene Edit
- Audio Mixer
- Display Windows Preview

Scene Edit is the primary tab.

Audio Mixer and Display Windows Preview reuse current Patch controllers and the same global data/state.

Stream workspace panes should be resizable like the Patch workspace:

- media pool vs List/Flow pane
- middle workspace vs bottom section
- any internal bottom detail split introduced by Scene Edit

### Shared Output And Display Details

Stream must provide full access to virtual output details and display window details without sending the user back to Patch.

Opening mechanism:

- In Display Windows Preview, clicking a display preview replaces bottom tab content with a full-size Display Details pane.
- In Audio Mixer, clicking a virtual output replaces bottom tab content with a full-size Output Details pane.
- The temporary detail pane includes a close button that returns to the previous bottom tab.
- Detail controls should reuse existing Patch detail components where possible.

## List Mode

List mode presents scenes as rows, similar to QLab-style cue lists.

Columns:

- cue number
- title
- trigger summary
- duration
- state

Row behavior:

- click selects/focuses a scene and opens it in Scene Edit
- expand row to show sub-cues
- drag row to reorder scenes
- bottom edge renders minimalist progress when running
- disabled rows dim foreground and background
- complete rows dim foreground
- running rows use theme color at about 50 percent opacity with progress edge
- failed rows use red shade
- skipped rows use orange shade
- paused rows highlight
- focused row has a lit border

Row actions:

- duplicate
- disable/enable
- remove
- run from here

Reorder warning:

- before dragging a scene that is explicitly referenced by other scenes, warn the user and offer cancel/continue
- after reorder, implicit follow references resolve to the new previous row

## Flow Mode

Flow mode is a canvas-based scene graph inspired by TouchDesigner.

Scene cards:

- resizable
- show scene number, title, duration, trigger state
- render previews for visual sub-cues in a dynamic grid
- render progress along the bottom edge when running
- show virtual links derived from trigger policies
- on hover, show centered play/pause and add icons
- on hover, show top-right remove icon
- edit icon selects the card and opens Scene Edit

Link rules:

- `simultaneous-start`, `follow-end`, and `time-offset` link to the followed scene
- `manual` and `at-timecode` do not link by default
- missing followed scene references render as warning stubs

Canvas operations:

- pan
- zoom in/out
- fit to content
- reset view
- drag cards
- resize cards
- add scene by hovering outside the right edge of any existing card

Add-scene behavior:

- new scene follows the hovered scene by default
- trigger defaults to `{ type: 'follow-end', followsSceneId: hoveredScene.id }`
- position defaults to the right of the hovered card

Implementation:

- Use Rete.js for Flow mode.
- Persist card rects and Stream `flowViewport`.
- Keep the scene graph as Xtream-owned data; the library is the editing/view layer, not the source of truth.
- Require custom scene-card rendering, pan/zoom, selection, drag, resize, programmatic fit-view, custom links, and library-independent serialization.
- Use Rete area/pan/zoom and connection primitives, but keep scene cards, previews, hover controls, and command dispatch as Xtream-owned components.
- Add only the Rete packages required for the selected renderer path.
- Because the current control renderer is vanilla TypeScript, evaluate Rete Lit or classic renderer integration before introducing a React island.
- Treat Rete node and connection data as a projection of `PersistedSceneConfig.flow` and scene trigger policies.

## Scene Edit

Scene Edit edits the selected scene regardless of whether selection came from List or Flow.

Layout:

- left: vertical stack/rail of scene-edit sections and existing sub-cues
- right: detail editor for the selected scene section or sub-cue
- vertical stack includes a phantom `Add Sub-Cue` item
- clicking `Add Sub-Cue` opens a menu for Audio, Visual, or Control
- after creation, the new sub-cue becomes selected and its detail editor opens
- the stack supports reordering sub-cues within the scene

Top scene controls:

- title
- note
- disabled toggle
- trigger mode
- followed scene picker when needed
- offset/timecode input when needed
- scene loop toggle
- loop range
- loop count/infinite selector
- preload toggle and lead time
- duplicate/remove controls

Audio sub-cue editor:

- add audio source from media pool
- choose virtual outputs
- loop toggle/range/count
- waveform preview
- fade-in/fade-out handles
- level automation curve editor
- pan automation curve editor
- playback rate

Visual sub-cue editor:

- add visual from media pool
- choose display targets, including split display zones
- preview thumbnail
- fade-in/fade-out timings
- freeze frame picker for video
- loop toggle/range/count
- playback rate

Control sub-cue editor:

- choose target scene or sub-cue
- choose action
- choose fade/automation duration where relevant
- show validation if the target is missing or creates a risky self-reference

## Validation Requirements

Show readiness should include Stream validation:

- exactly one Stream exists
- the Stream has at least one scene
- each scene ID is stable and unique within the show
- `sceneOrder` contains every scene exactly once
- explicit trigger references point to existing scenes in the Stream
- trigger graph has no invalid cycles
- audio sub-cues reference existing audio sources
- visual sub-cues reference existing visuals
- output/display target references exist
- split-zone target references match the current display layout or are repairable during migration
- display mingle algorithms are supported by the runtime
- disabled scenes are skipped by runtime but remain valid references with warning where needed
- timecode values are non-negative
- offset values are non-negative
- loop ranges are valid and within known media duration when calculable
- follow-end references to looped scenes show an authoring reminder before commit
- playback rates are positive
- at-timecode scenes before the chosen playback start time are marked skipped
- edit timeline calculation errors are visible in validation/status UI
- invalid edit timelines do not replace the last valid playback timeline

## IPC And Renderer API

Renderer Stream API:

```ts
window.xtream.stream.getState()
window.xtream.stream.edit(command)
window.xtream.stream.transport(command)
window.xtream.stream.onState(callback)
```

Autosave should run for Stream edits just like current Patch edits.

Config surface Stream playback controls:

- paused-play behavior:
  - `Selection-aware resume`
  - `Preserve paused cursor`
- running-edit orphan behavior:
  - `Fade removed running content`
  - `Let removed running content finish`
- running-edit orphan fade-out duration:
  - default `0.5s`
  - applies to audio and visual sub-cues
  - clamp to a practical positive range if immediate stop must be disallowed

Persist these settings through the Stream settings path, not through local UI-only state.

## Control Code Layout

The Stream control renderer should mirror the Patch workspace pattern: one orchestrator plus feature modules.

| Module | Purpose | Primary phase |
| --- | --- | --- |
| `streamSurface.ts` | Mount/unmount, render pipeline, shared closure state, child controller wiring, `StreamSurfaceController` export | All |
| `streamTypes.ts` | UI-only types: mode, bottom tab, detail overlay shape, options | 5.1 |
| `layoutPrefs.ts` | Stream layout localStorage key, read/save/apply, splitter install and ARIA sync | 5.1 |
| `shell.ts` | Build Stream DOM shell: sections, splitters, media pool and asset-preview element trees | 5.1 |
| `streamHeader.ts` | Timecode, transport cluster, inline scene title/note editing, show file actions | 5.1 |
| `workspacePane.ts` | Outer List / Flow tab bar; delegates body to list or flow module | 5.1 |
| `listMode.ts` | Scene list toolbar, columns, row expansion, drag reorder, row actions, end-drop target | 5, 5.1 |
| `flowMode.ts` | Flow canvas host: placeholder cards today; Rete area, pan/zoom, Xtream-owned card/link rendering later | 5.1, 8 |
| `bottomPane.ts` | Bottom tab row, mixer/display pane glue, tab-specific actions | 5.1 |
| `streamDetailOverlay.ts` | Full-bleed display or output detail with close/restore behavior | 5.1, 6, 9 |
| `formatting.ts` | Pure helpers: trigger summary, scene duration, sub-cue labels, runtime state labels | 5.1 |
| `dom.ts` | Stream-specific tab bars, table cells, detail field wrappers | 5.1 |
| `sceneEdit/sceneEditPane.ts` | Rail + detail shell; selection between scene and sub-cue sections | 5.1, 6 |
| `sceneEdit/sceneForm.ts` | Scene-level fields only | 5, 5.1 |
| `sceneEdit/subCueRail.ts` | Reorderable sub-cue stack, Add Sub-Cue entry, focus/selection | 6 |
| `sceneEdit/audioSubCueForm.ts` | Audio sub-cue editor | 6, 9 |
| `sceneEdit/visualSubCueForm.ts` | Visual sub-cue editor | 6, 9 |
| `sceneEdit/controlSubCueForm.ts` | Control sub-cue editor | 6, 9 |
| `sceneEdit/waveform.ts` | Waveform visualization for audio sub-cues | 9 |
| `flow/reteHost.ts` | Optional Rete editor lifecycle and serialization boundary | 8 |

Phase 7 runtime work is mostly main-process and IPC; the control renderer only gains incidental UI in `listMode.ts`, `formatting.ts`, or `streamHeader.ts`.

Phase 10 adds tests, validation/diagnostics surfacing, and Playwright specs. It should not create new monoliths under `stream/`.

## Testing Targets

Runtime and schedule tests:

- selected sequential scene play uses absolute scheduled start, not rebased zero
- selected overlapping offset scene play keeps earlier overlapping scenes active
- all-manual scenes schedule linearly from first enabled scene
- mixed manual/triggered scenes follow deterministic mixed scheduling rules
- empty enabled scenes resolve as zero-duration entries
- missing media duration, infinite loops, and unknown predecessor ends produce invalid schedule issues
- valid edit timeline promotes to playback timeline
- invalid edit timeline does not replace last valid playback timeline
- invalid edit timeline does not replace last valid playback Stream snapshot
- running playback keeps advancing while a failed edit timeline is reported
- successful timeline promotion during running playback recomputes active scenes at the current absolute cursor
- removed running audio/visual content fades out by default over 500 ms
- removed running audio/visual content can alternatively continue until natural completion
- removed running content is never stopped immediately by this transition path
- global play while paused follows configured paused-play behavior
- scene-row play while paused starts from the interacted scene regardless of paused-play preference
- scene-row play while running does not seek the global cursor and starts the interacted scene in parallel
- idle jump-next does not start playback
- paused/running jump-next use latest scheduled active scene as reference
- pause is pause-only and idempotent
- back-to-first resets scene states and cursor to first enabled scene
- Patch playing blocks Stream play
- Patch playing does not block Stream back-to-first
- Patch playing blocks scene-row play because it starts Stream media
- Stream active blocks Patch play at Director level

Renderer/projection tests:

- Stream header button disabled states derive from Stream runtime and Patch active playback explicitly
- Stream play enabled state does not depend on Patch `DirectorState.paused`
- row action sends explicit scene-row play intent
- overlapping active scenes project simultaneous audio/visual runtime clones
- runtime offsets remain absolute Stream starts

Production test commands:

```powershell
npm run typecheck
npm test
```

## Sequential Roadmap

This roadmap merges the old workspace roadmap and the completed transport/runtime roadmap into one sequence. Phases 1 through 7 are treated as completed or historical for planning purposes. The remaining planned work is Phase 8 through Phase 10.

### Phase 1: Data Model And Migration

Status: completed/historical.

Scope:

- Add Stream/Scene/SubCue shared types.
- Add schema v8 persisted show types.
- Add v7 to v8 migration.
- Update show create/restore paths to read/write Stream-backed shows.
- Create the show Stream, first user scene, and hidden Patch compatibility scene for new projects.
- Add display-zone targets and display visual mingle config.
- Add persistence and migration tests.

Exit: existing Patch shows open, save as Stream-backed shows, and preserve Patch behavior through the hidden compatibility scene.

### Phase 2: Stream Engine Skeleton And Absolute Schedule

Status: completed/historical.

Scope:

- Add main-process `StreamEngine`.
- Add runtime state types and state broadcast.
- Add `stream:get-state`, `stream:edit`, and `stream:transport` IPC.
- Implement scene numbering and trigger validation.
- Add canonical absolute schedule calculation in `src/shared/streamSchedule.ts`.
- Treat manual scenes as schedulable planned timeline entries.
- Return timeline status, issues, entries, and expected duration.
- Enforce active playback exclusivity between Patch and Stream.

Exit: a Stream can be edited and scheduled with absolute timing; valid scenes resolve to absolute start/end timing; calculation failures are explicit.

### Phase 3: Patch Compatibility And Edit/Playback Timeline Promotion

Status: completed/historical.

Scope:

- Map hidden compatibility-scene sub-cues into current Patch display/output state.
- Make Patch edits update the hidden compatibility scene.
- Add `editTimeline`, `playbackTimeline`, and `playbackStream` to Stream public/runtime state.
- Recalculate `editTimeline` on every Stream edit.
- Promote valid edit timelines and paired Stream snapshots to playback.
- Preserve the last valid playback pair when edit timeline calculation fails.
- Surface edit timeline errors in Stream validation/status UI.

Exit: Patch remains production-usable and invalid Stream edits cannot break current or future playback of the last known-good timeline.

### Phase 4: Stream Workspace Shell And Transport Command Refactor

Status: completed/historical.

Scope:

- Replace placeholder Stream surface.
- Add Stream header, middle split layout, List/Flow outer tabs, and bottom tabs.
- Make List/Flow and bottom tabs the outer wrappers of their panes.
- Add resizable splitters.
- Reuse media pool, mixer, display preview, and detail panes.
- Add `play` command and migrate away from `go`.
- Add `jump-next.referenceSceneId`.
- Add `play.source` for global vs scene-row vs flow-card intent.
- Implement explicit idle runtime creation, play from cursor, play from scene, pause-only pause, and resume-through-play.
- Add paused-play behavior setting and default it to `selection-aware`.

Exit: Stream workspace shell exists and transport command semantics match the absolute runtime model.

### Phase 5: List Mode, Pause Preference, And Manual Scene Starts

Status: completed/historical.

Scope:

- Implement scene rows, expansion, state styling, progress edge, and row actions.
- Implement drag reorder with dependency warning.
- Implement duplicate, disable, remove.
- Wire Scene Edit for title/note/trigger/loop/preload.
- Implement `selection-aware` and `preserve-paused-cursor` global Play behavior.
- Track paused cursor and selected scene at pause time.
- Implement scene-row play:
  - stopped/no paused scenes: focus, seek to scene start, play
  - paused: focus, refresh states around that scene, play from scene start
  - running: start scene in parallel through a manual start override without seeking the global cursor

Exit: users can build a Stream sequence in List mode, and global Play vs row Play semantics are distinct and predictable.

### Phase 5.1: Stream Control Module Layout

Status: completed/historical.

Scope:

- Extract `streamSurface.ts` into an orchestrator.
- Move layout persistence and splitters into a dedicated module.
- Move DOM assembly for the Stream shell out of the orchestrator.
- Move header, List mode, Flow host, bottom pane chrome, and temporary detail overlay into their own modules.
- Move pure formatters into shared Stream helpers.
- Move Scene Edit layout and scene-level form under `stream/sceneEdit/`.

Exit: no single Stream control file dominates maintenance; later features land in mapped modules.

### Phase 6: Sub-Cue Editing And Running Edit Promotion

Status: completed/historical.

Scope:

- Implement audio sub-cue editor and virtual output routing.
- Implement visual sub-cue editor and display target routing.
- Auto-create embedded audio sub-cue when adding video visual sub-cue.
- Add display visual mingle controls in display details.
- Add basic fade/rate/loop controls.
- Implement full planned control sub-cue scope.
- Allow valid edit timeline promotion while Stream playback is running.
- Keep global cursor advancing through edits.
- Recompute active scene/sub-cue projection from promoted playback timeline at current cursor.
- Preserve valid manual start overrides unless removed by edit.
- Implement `fade-out` and `let-finish` orphan policies.

Exit: scenes can contain audio, visual, and control sub-cues; running edits update Stream content without disrupting the clock.

### Phase 7: Runtime Execution, Preload, Jump/Back Semantics, And Projection Verification

Status: completed/historical.

Scope:

- Implement scene preload lifecycle.
- Implement audio/visual scene adapters against existing renderer media runtime.
- Implement the five trigger modes.
- Implement stop, jump-next, and back-to-first with state-specific semantics.
- Ensure idle and paused navigation does not start ticking.
- Ensure running jump-next keeps playback running.
- Ensure back-to-first resets only when not running and remains engine-safe if called unexpectedly.
- Use latest calculated absolute scheduled start to choose reference scene when multiple scenes are running or paused.
- Update Stream header button handlers, labels, icons, tooltips, and disabled states.
- Update list row "Run from here" to explicit scene-row play intent.
- Add Config controls for paused-play behavior and running-edit orphan behavior.
- Pass Stream activity into Patch transport UI and Patch activity into Stream transport UI.
- Verify derived `DirectorState` still drives audio/display/control previews correctly.
- Check overlapped scene projections with runtime offsets.

Exit: Stream runtime execution, transport UX, mutual playback UI, and projection behavior match this canonical plan.

### Phase 8: Flow Mode

Status: remaining.

Scope:

- Install and integrate Rete.js for the Flow graph/canvas surface.
- Implement scene cards with scene number, title, duration, trigger state, progress, and previews.
- Render virtual links from trigger policies.
- Render warning stubs for missing followed-scene references.
- Implement hover actions: play/pause, add, remove, edit.
- Implement pan, zoom, fit to content, reset view, card drag, and card resize.
- Implement add-on-right interaction.
- Persist card rects and `flowViewport`.
- Keep Rete data as a projection of Xtream-owned Stream data.
- Support flow-card play intent through `play(sceneId, source: 'flow-card')`.

Exit: users can visually author, arrange, inspect, and trigger Stream scenes in Flow mode.

### Phase 9: Advanced Scene Editing

Status: remaining.

Scope:

- Add waveform display for audio sub-cues.
- Add fade handle editing.
- Add level automation curve editing.
- Add pan automation curve editing.
- Add freeze-frame picker for visual/video sub-cues.
- Expand control sub-cues that act on running scenes/sub-cues.
- Validate risky control self-references and missing targets.
- Keep advanced editor UI inside the established `sceneEdit/` module structure.

Exit: Stream Workspace reaches the advanced flexible show-control target for audio, visual, and control sub-cue authoring.

### Phase 10: Production Hardening

Status: remaining.

Scope:

- Add comprehensive Stream validation panel entries.
- Add diagnostics entries for Stream runtime history.
- Add autosave recovery snapshots for authoring changes.
- Add integration tests for schema migration and Stream execution.
- Add Playwright smoke tests for List and Flow surfaces.
- Verify production workflows with Patch and Stream mutual playback gates.
- Verify invalid edit timeline reporting and last-known-good playback behavior through UI.
- Run typecheck and full unit tests.

Exit: Stream Workspace is production-ready.

## Superseded Source Mapping

This document replaces the older two-doc split:

- `docs/stream-workspace-design-plan.md`: product model, workspace layout, List/Flow/Scene Edit, validation, module layout, and remaining product roadmap were imported here.
- `docs/stream-transport-runtime-refactor-plan.md`: runtime mental model, canonical schedule, dual timelines, transport command model, paused-play settings, running-edit policy, gating, and tests were imported here as the authoritative runtime design.

Specific superseded ideas:

- Legacy `go` / `resume` command model is replaced by `play`, pause-only `pause`, and state-aware `jump-next`.
- Anchor-rebased schedule calculation is replaced by one absolute global Stream timeline.
- Manual scenes as timing breaks are replaced by planned absolute manual scheduling.
- Single-timeline runtime state is replaced by edit timeline plus playback timeline and paired `playbackStream`.
- Broad Patch-playing guard is replaced by command-aware media-start gating.

