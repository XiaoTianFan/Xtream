# Xtream Stream Workspace Design Plan

## 1. Purpose

This document replaces the old long-term cue-list direction with a concrete design for the new Xtream Stream Workspace, based on the current production-level Patch workspace and schema v7 show file architecture.

The older roadmap in `docs/show-cue-system-long-term-roadmap.md` remains useful for principles: one authoritative clock, versioned show data, explicit readiness, rail-like media/control actions, and a cue engine beside the director. The implementation target is now more specific:

- A show contains one Stream.
- A Stream is a scene-by-scene sequence, comparable to a cue list.
- A Scene is the executable unit. It can contain multiple audio, visual, and control sub-cues that start together.
- The existing Patch workspace edits a dedicated hidden compatibility Scene, separate from user-authored Streams.
- Audio Mixer and Display Windows remain show-level resources shared across Patch, Stream, and Performance surfaces.

The user-facing product term is `Stream`. Internally, use `CueStream` only where it prevents ambiguity with browser `MediaStream`.

## 2. Current Architecture Findings

The current app is an Electron/Node application with one control renderer, hidden audio renderer, and one or more display renderers.

Important existing pieces:

- `src/shared/types.ts` owns schema v7 persisted types and `DirectorState`.
- `src/main/director.ts` owns the current show runtime: transport, visuals, audio sources, outputs, display windows, readiness, loop, drift correction, active timeline, and persistence conversion.
- `src/main/showConfig.ts` owns show JSON validation and v3-v7 migrations.
- `src/renderer/control/patch/*` already splits the Patch UI into reusable controllers:
  - media pool
  - display workspace and previews
  - mixer panel
  - details pane
  - transport/header
  - layout preferences
- `src/renderer/control/stream/streamSurface.ts` is currently a placeholder.
- `src/renderer/control/app/surfaceRouter.ts` already supports Patch, Stream, Performance, Config, and Logs surfaces.

Key implication: Stream should not be a separate app state tree. It should extend the show document and runtime, then reuse the existing media pool, output mixer, display preview, metadata, readiness, autosave, and show actions.

## 3. Product Model

### Show

A show is the saved project document. It contains:

- global asset pool: visuals and audio sources
- global outputs: virtual audio outputs and physical routing
- global displays: display windows and monitor placement
- one Stream
- show-level settings: extraction format, global mute/blackout fade defaults, future adapter settings

Displays and outputs are not owned by a scene. A scene references them.

### Stream

A Stream is the scene-by-scene sequence for the show.

There is exactly one user-authored Stream per show file. The Stream has one cursor, one timing origin, one trigger graph, and one runtime state. It shares the show-level media pool, outputs, display windows, and safety controls.

Patch and Stream playback are also mutually exclusive:

- When Patch is playing, Stream playback controls are disabled.
- When a Stream is playing, Patch playback controls are disabled.
- This prevents two playback models from competing for the same display windows, virtual outputs, and director transport.

### Scene

A Scene is the operator-facing executable unit. It contains multiple sub-cues that start together when the scene starts.

A scene has:

- stable generated ID, not visible to users
- cue number generated from order within its Stream
- optional title
- optional note
- trigger policy
- state
- loop policy
- preload policy
- audio sub-cues
- visual sub-cues
- control sub-cues
- optional Flow canvas position/size

Scene state values:

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

Sub-cues are scene-local actions. They should be called `subCue` internally to preserve the show-control vocabulary, but the UI can label them Audio, Visuals, and Controls.

Audio sub-cues:

- reference an audio source from the pool
- select one or more virtual outputs
- set loop within the scene
- define fade in/out
- define level automation curve
- define pan automation curve
- set playback rate
- support waveform visualization

Visual sub-cues:

- reference a visual from the pool
- select one or more display targets
- set fade in/out
- set freeze frame for video
- set loop within the scene
- set playback rate

Display targets are derived from show-level display windows:

- A display window in single mode exposes one assignable target.
- A display window in split mode exposes each split zone as its own assignable target.
- A visual sub-cue targets `{ displayId, zoneId }`, not just the display window ID.
- The same target model is used when converting Patch display layouts into the hidden compatibility Scene.

Multiple scenes or visual sub-cues may target the same display target. This is a desired feature, not a validation error. The display window owns the visual mingle algorithm that determines how simultaneous visuals are combined.

Recommended display mingle algorithms for v1:

- `latest`: latest-started visual owns the target; this is the default for new display windows
- `alpha-over`: normal opacity compositing by layer/start order
- `additive`
- `multiply`
- `screen`
- `lighten`
- `darken`
- `crossfade`: time-based blend between previous and incoming visual

Control sub-cues:

- act on running scenes and sub-cues
- support commands such as stop, pause, resume, fade out, set level, set pan, blackout display, mute output, and future adapter actions

When adding a video visual sub-cue, Xtream should automatically create or attach an embedded-audio audio sub-cue by default if the video has embedded audio. The generated audio sub-cue should reference the existing embedded audio source mechanism rather than storing duplicated media metadata inside the scene.

Embedded video audio selection priority:

- use an existing extracted embedded-audio file source when one exists
- otherwise use an existing representation source when one exists
- otherwise create the embedded-audio representation source and attach it

## 4. Proposed Persisted Schema

The next schema should be v8. It should keep existing v7 top-level media/output/display fields so current Patch projects migrate cleanly.

```ts
export type PersistedShowConfigV8 = {
  schemaVersion: 8;
  savedAt: string;
  rate?: number;
  audioExtractionFormat: AudioExtractionFormat;
  globalAudioMuteFadeOutSeconds?: number;
  globalDisplayBlackoutFadeOutSeconds?: number;

  visuals: Record<VisualId, PersistedVisualConfig>;
  audioSources: Record<AudioSourceId, PersistedAudioSourceConfig>;
  outputs: Record<VirtualOutputId, PersistedVirtualOutputConfig>;
  displays: PersistedDisplayConfigV8[];

  stream: PersistedStreamConfig;

  patchCompatibility: PersistedPatchSceneProjection;
};
```

Recommended IDs:

```ts
export type StreamId = string;
export type SceneId = string;
export type SubCueId = string;

export type PersistedPatchSceneProjection = {
  /** Hidden manual Scene used only by the Patch workspace compatibility projection. */
  scene: PersistedSceneConfig;
  migratedFromSchemaVersion?: 7;
};
```

Display config should also gain a display-level visual mingle policy:

```ts
export type VisualMingleAlgorithm =
  | 'latest'
  | 'alpha-over'
  | 'additive'
  | 'multiply'
  | 'screen'
  | 'lighten'
  | 'darken'
  | 'crossfade';

export type PersistedDisplayConfigV8 = PersistedDisplayConfig & {
  visualMingle?: {
    /** Defaults to 'latest' for new display windows. */
    algorithm: VisualMingleAlgorithm;
    defaultTransitionMs?: number;
  };
};
```

Stream config:

```ts
export type PersistedStreamConfig = {
  id: StreamId;
  label: string;
  sceneOrder: SceneId[];
  scenes: Record<SceneId, PersistedSceneConfig>;
  flowViewport?: {
    x: number;
    y: number;
    zoom: number;
  };
};
```

Scene config:

```ts
export type SceneTrigger =
  | { type: 'manual' }
  | { type: 'simultaneous-start'; followsSceneId?: SceneId }
  | { type: 'follow-end'; followsSceneId?: SceneId }
  | { type: 'time-offset'; followsSceneId?: SceneId; offsetMs: number }
  | { type: 'at-timecode'; timecodeMs: number };

export type SceneLoopPolicy =
  | { enabled: false }
  | {
      enabled: true;
      range?: { startMs: number; endMs?: number };
      iterations: { type: 'count'; count: number } | { type: 'infinite' };
    };

export type PersistedSceneConfig = {
  id: SceneId;
  title?: string;
  note?: string;
  disabled?: boolean;
  trigger: SceneTrigger;
  loop: SceneLoopPolicy;
  preload: {
    enabled: boolean;
    leadTimeMs?: number;
  };
  subCueOrder: SubCueId[];
  subCues: Record<SubCueId, PersistedSubCueConfig>;
  flow?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
```

Sub-cue config:

```ts
export type CurvePoint = {
  timeMs: number;
  value: number;
  interpolation?: 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'equal-power';
};

export type FadeSpec = {
  durationMs: number;
  curve?: 'linear' | 'equal-power' | 'log';
};

export type PersistedAudioSubCueConfig = {
  id: SubCueId;
  kind: 'audio';
  audioSourceId: AudioSourceId;
  outputIds: VirtualOutputId[];
  startOffsetMs?: number;
  durationOverrideMs?: number;
  loop?: SceneLoopPolicy;
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  levelDb?: number;
  pan?: number;
  levelAutomation?: CurvePoint[];
  panAutomation?: CurvePoint[];
  playbackRate?: number;
};

export type PersistedVisualSubCueConfig = {
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

export type DisplayZoneId = 'single' | 'L' | 'R';

export type VisualDisplayTarget = {
  displayId: DisplayWindowId;
  zoneId?: DisplayZoneId;
};

export type PersistedControlSubCueConfig = {
  id: SubCueId;
  kind: 'control';
  action:
    | { type: 'stop-scene'; sceneId: SceneId; fadeOutMs?: number }
    | { type: 'pause-scene'; sceneId: SceneId }
    | { type: 'resume-scene'; sceneId: SceneId }
    | { type: 'set-audio-subcue-level'; subCueRef: SubCueRef; targetDb: number; durationMs?: number; curve?: FadeSpec['curve'] }
    | { type: 'set-audio-subcue-pan'; subCueRef: SubCueRef; targetPan: number; durationMs?: number }
    | { type: 'stop-subcue'; subCueRef: SubCueRef; fadeOutMs?: number }
    | { type: 'set-global-audio-muted'; muted: boolean; fadeMs?: number }
    | { type: 'set-global-display-blackout'; blackout: boolean; fadeMs?: number };
};

export type SubCueRef = {
  sceneId: SceneId;
  subCueId: SubCueId;
};

export type PersistedSubCueConfig =
  | PersistedAudioSubCueConfig
  | PersistedVisualSubCueConfig
  | PersistedControlSubCueConfig;
```

## 5. Migration And Patch Compatibility

### v7 To v8

When opening an existing v7 show:

1. Create the show Stream:
   - `id: stream-main`
   - `label: Main Stream`
2. Create a first user-authored Stream Scene:
   - `id: scene-1`
   - `title: Scene 1`
   - `trigger: { type: 'manual' }`
   - empty sub-cue list by default
3. Create a hidden Patch compatibility Scene:
   - `id: patch-compat-scene`
   - `title: Patch Compatibility`
   - `trigger: { type: 'manual' }`
   - hidden from Stream List and Flow modes
   - `loop` copied from the current show-level loop
4. Convert current Patch routing into the hidden compatibility Scene:
   - each active display visual reference becomes a visual sub-cue
   - split display layouts become visual sub-cues targeting the corresponding display zones
   - each output source selection becomes an audio sub-cue
   - preserve output bus settings and display window definitions at show level
5. Preserve all existing media pool records, outputs, displays, and settings.

### Patch Workspace As Scene Projection

Patch should continue to work after v8 lands through a hidden compatibility Scene:

- Patch edits `patchCompatibility.scene`.
- Existing Patch controls remain largely unchanged.
- The director maintains a `PatchSceneProjection` that maps the hidden compatibility Scene to current `DirectorState` fields:
  - scene visual sub-cues -> display layouts
  - scene audio sub-cues -> output source selections
  - scene loop -> director loop
- Changes made in Patch update the hidden compatibility Scene.
- Patch playback uses a manual trigger and never appears as a normal Stream Scene.
- Patch and Stream playback are locked against each other: starting one disables the other's play command until playback stops.

## 6. Runtime Architecture

### Director

The existing Director should remain the authoritative low-level media transport and readiness owner for the currently active playback material.

Do not embed Stream sequencing directly into the current media methods. Add a Stream engine beside it.

### Stream Engine

Add a main-process `StreamEngine` that owns Stream runtime state:

```ts
export type StreamRuntimeState = {
  status: 'idle' | 'preloading' | 'running' | 'paused' | 'complete' | 'failed';
  originWallTimeMs?: number;
  cursorSceneId?: SceneId;
  sceneStates: Record<SceneId, SceneRuntimeState>;
  expectedDurationMs?: number;
};

export type SceneRuntimeState = {
  sceneId: SceneId;
  status: 'disabled' | 'ready' | 'preloading' | 'running' | 'paused' | 'complete' | 'failed' | 'skipped';
  scheduledStartMs?: number;
  startedAtStreamMs?: number;
  endedAtStreamMs?: number;
  progress?: number;
  error?: string;
};
```

Responsibilities:

- calculate scene numbers from `sceneOrder`
- validate trigger references
- build the trigger graph
- compute expected scene start times where possible
- compute expected Stream duration
- preload upcoming scenes
- start, pause, resume, skip, stop, and complete scenes
- emit state to control/audio/display renderers
- dispatch scene sub-cues to media/control adapters

The Stream engine should not directly manipulate DOM or renderer media elements. It should issue explicit runtime commands through adapter interfaces.

### Media Runtime Adapters

Add an adapter layer between Stream engine and current media runtime:

```ts
export type SceneActionAdapter = {
  validateScene(scene: PersistedSceneConfig, show: PersistedShowConfigV8): ReadinessIssue[];
  preloadScene(scene: PersistedSceneConfig): Promise<void>;
  startScene(scene: PersistedSceneConfig, context: SceneStartContext): Promise<void>;
  pauseScene(sceneId: SceneId): Promise<void>;
  resumeScene(sceneId: SceneId): Promise<void>;
  stopScene(sceneId: SceneId, options?: { fadeOutMs?: number }): Promise<void>;
};
```

Initial adapters:

- `VisualSceneAdapter`: display sub-cues, preview rendering, fade/freeze/loop/rate
- `AudioSceneAdapter`: audio sub-cues, routing, fade/automation/loop/rate, meters
- `ControlSceneAdapter`: scene/sub-cue/global commands

Future adapters for OSC, MIDI, serial, lighting, and timecode can follow the same pattern.

### Shared Output Behavior

Only one Stream runs at a time, but several scenes within that Stream can overlap because of simultaneous-start, time-offset, and at-timecode triggers.

Shared output behavior:

- Multiple audio sub-cues can target the same virtual output and mix together.
- Multiple visual sub-cues can target the same display target and are combined by that display window's visual mingle algorithm.
- Display target conflicts are not show-readiness errors.
- Readiness should warn only when the selected display mingle algorithm cannot support the requested behavior, such as a missing target zone or unsupported transition setting.

## 7. Trigger Semantics

All trigger policies are evaluated per Stream.

### Manual

The scene waits until the operator triggers it.

Manual scenes do not auto-link to previous scenes in Flow mode.

### Simultaneous Start

The scene starts when its followed scene starts.

Default `followsSceneId` is the literal previous scene in `sceneOrder` when omitted.

### Follow End

The scene starts when its followed scene completes.

Default `followsSceneId` is the literal previous scene in `sceneOrder` when omitted.

If the followed scene loops, follow-end waits until all loop iterations finish. When a user sets a scene to follow a looped scene, Xtream should show a confirmation reminder explaining that the dependent scene will not start until the loop completes. Infinite loops should require an especially clear confirmation because follow-end dependents will not fire without a manual stop/skip policy.

### Time Offset

The scene starts `offsetMs` after the followed scene starts.

Default `followsSceneId` is the literal previous scene in `sceneOrder` when omitted.

### At Timecode

The scene starts at an absolute Stream timecode. The Stream clock starts at 0 when the first scene in that Stream starts.

At-timecode scenes are not visually linked to previous scenes by default.

At-timecode values remain absolute even when playback starts from a later scene or later time. If playback starts after an at-timecode scene's scheduled time, that scene is marked `skipped` rather than rebasing its trigger time.

### Reordering Behavior

List drag reorder should update cue numbers automatically.

If a dragged scene has a trigger with implicit `followsSceneId`, reordering naturally changes the followed scene to the new previous row.

If a dragged scene has an explicit `followsSceneId`, reordering should preserve that reference.

If any other scene explicitly follows the dragged scene, the UI should warn before reordering because the dependency graph may be visually misleading after the move.

## 8. Duration Calculation

Scene duration:

- For non-looping scenes, duration is the longest effective duration among its sub-cues.
- Effective duration = `(media duration / playbackRate)`, optionally clipped by duration override.
- For counted scene loops, duration includes all loop iterations.
- Fade-out is included only when it extends beyond media end or stop command duration.
- Live visual sub-cues and infinite loops produce unknown or infinite duration.

Stream duration:

- Build a directed schedule graph from trigger policies.
- Calculate earliest start/end where possible.
- Manual scenes create timing breaks unless they are referenced by simultaneous/follow/offset scenes after manual start.
- At-timecode scenes have known absolute starts.
- Unknown/infinite scene duration makes dependent follow-end scenes unknown until runtime.
- Follow-end dependents of infinite loop scenes remain waiting until an operator stops, skips, or otherwise completes the looped scene.

UI should display:

- exact duration when calculable
- `live` for infinite/live scenes
- `--` for unknown
- warning badges for trigger references that cannot be resolved

## 9. Preload Model

Preloading must exist from the beginning.

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

## 10. Stream Workspace Layout

### Header

Full-width header:

- left: Stream timecode
- transport: back to first scene, play/go, pause, jump to next scene
- center: editable Scene title and note in a two-row stack
- right: Save, Save As, Open, New

Transport meaning in Stream:

- Back to first scene: set active Stream cursor to first enabled scene and reset its Stream clock.
- Play/Go: start from focused scene if one is selected, otherwise current cursor scene.
- Pause: pause active running scenes in the active Stream.
- Jump to next scene: skip/complete current cursor scene and trigger next eligible scene.

Existing global mute, blackout, performance mode, clear solo, and reset meters can stay in the existing status footer or move into Stream bottom/status chrome later.

### Middle Row

Left: existing media pool controller reused from Patch.

Right: main Stream edit pane with modes:

- List
- Flow

List and Flow should be presented as the outer wrapper of the right pane, not as tabs nested inside another titled panel. The selected tab owns the pane chrome directly.

### Bottom Section

Full-width bottom pane with subtabs:

- Scene Edit
- Audio Mixer
- Display Windows Preview

Scene Edit is the primary tab.

The bottom tabs should also be the outer wrapper of the bottom pane, not a titled pane containing nested tabs.

Audio Mixer and Display Windows Preview should reuse the current Patch controllers and the same global data/state.

Stream workspace panes should be resizable like the Patch workspace:

- media pool vs List/Flow pane
- middle workspace vs bottom section
- any internal bottom detail split introduced by Scene Edit

### Shared Output And Display Detail Editing

Stream must provide full access to virtual output details and display window details without sending the user back to Patch.

Opening mechanism:

- In the Display Windows Preview tab, clicking a display preview replaces the bottom tab content with a full-size Display Details pane.
- In the Audio Mixer tab, clicking a virtual output replaces the bottom tab content with a full-size Output Details pane.
- The temporary detail pane includes a close button that returns to the previous bottom tab.
- Detail controls should reuse existing Patch detail components where possible: label, physical monitor/sink, fullscreen/always-on-top, display layout, display mingle algorithm, output routing, bus fader, delay, mute, source controls, and test tone.

## 11. List Mode

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

## 12. Flow Mode

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

Recommended implementation:

- Use Rete.js for Flow mode.
- Persist card `flow` rect and Stream `flowViewport`.
- Keep the scene graph as Xtream-owned data; the library is the editing/view layer, not the source of truth.
- Require custom scene-card rendering, pan/zoom, selection, drag, resize, programmatic fit-view, custom links, and library-independent serialization.
- Use Rete's area/pan/zoom and connection primitives, but keep scene cards, previews, hover controls, and command dispatch as Xtream-owned components.
- Add only the Rete packages required for the selected renderer path. Because the current control renderer is vanilla TypeScript, evaluate Rete's Lit or classic renderer integration before introducing a React island.
- Treat Rete node and connection data as a projection of `PersistedSceneConfig.flow` and scene trigger policies, not as the persisted show schema.

## 13. Scene Edit Tab

Scene Edit should edit the selected scene, regardless of whether selection came from List or Flow.

Scene Edit layout:

- left: a vertical stack/rail of scene-edit sections and existing sub-cues
- right: the detail editor for the selected scene section or sub-cue
- the vertical stack includes a phantom `Add Sub-Cue` item
- clicking `Add Sub-Cue` opens a menu for choosing Audio, Visual, or Control
- after creation, the new sub-cue becomes selected in the stack and its detail editor opens on the right
- the stack should support reordering sub-cues within the scene

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

Sub-cue sections:

- Audio
- Visuals
- Controls

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

The first Stream implementation should include the full planned control sub-cue scope rather than a reduced starter subset: audio/sub-cue controls, display/global controls, and scene transport controls.

## 14. IPC And Shared Types

Add Stream-specific IPC channels rather than overloading current director channels:

```ts
export type StreamCommand =
  | { type: 'go'; sceneId?: SceneId }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'jump-next' }
  | { type: 'back-to-first' };

export type StreamEditCommand =
  | { type: 'update-stream'; label?: string }
  | { type: 'create-scene'; afterSceneId?: SceneId; trigger?: SceneTrigger }
  | { type: 'update-scene'; sceneId: SceneId; update: Partial<PersistedSceneConfig> }
  | { type: 'duplicate-scene'; sceneId: SceneId }
  | { type: 'remove-scene'; sceneId: SceneId }
  | { type: 'reorder-scenes'; sceneOrder: SceneId[] }
  | { type: 'update-subcue'; sceneId: SceneId; subCueId: SubCueId; update: Partial<PersistedSubCueConfig> };
```

Renderer API shape:

```ts
window.xtream.stream.getState()
window.xtream.stream.edit(command)
window.xtream.stream.transport(command)
window.xtream.stream.onState(callback)
```

Autosave should run for Stream edits just like current Patch edits.

## 15. Validation Rules

Show readiness should include Stream validation:

- exactly one Stream exists
- the Stream has at least one Scene
- each Scene ID is stable and unique within the show
- `sceneOrder` contains every scene exactly once
- explicit trigger references point to existing scenes in the Stream
- trigger graph has no invalid cycles
- audio sub-cues reference existing audio sources
- visual sub-cues reference existing visuals
- output/display target references exist
- split-zone target references match the current display layout or are repairable during migration
- display mingle algorithms are supported by the runtime
- disabled scenes are skipped by runtime but remain valid references with a warning
- timecode values are non-negative
- offset values are non-negative
- loop ranges are valid and within known media duration when calculable
- follow-end references to looped scenes show an authoring reminder before commit
- playback rates are positive
- at-timecode scenes before the chosen playback start time are marked skipped

## 16. Implementation Plan

### Phase 1: Data Model And Migration

- Add Stream/Scene/SubCue shared types.
- Add schema v8 persisted show types.
- Add v7->v8 migration.
- Update `Director.createShowConfig` and restore path to read/write v8.
- Create the show Stream, first user Scene, and hidden Patch compatibility Scene for new show projects.
- Add display-zone targets and display visual mingle config.
- Add tests for migration and round-trip persistence.

Exit: existing v7 show files open, save as v8, and preserve Patch behavior through the hidden compatibility Scene.

### Phase 2: Stream Engine Skeleton

- Add main-process `StreamEngine`.
- Add runtime state types and state broadcast.
- Add `stream:get-state`, `stream:edit`, and `stream:transport` IPC.
- Implement scene numbering, trigger graph validation, expected duration calculation, and simple manual GO state transitions.
- Enforce exclusive playback between Patch and Stream.
- Add unit tests for trigger semantics and duration calculation.

Exit: a Stream can be edited in data and manually stepped in tests without full UI.

### Phase 3: Patch Compatibility Projection

- Map hidden compatibility-scene sub-cues into current Patch display/output state.
- Make Patch edits update the hidden compatibility Scene.
- Keep existing media pool, mixer, display preview, details, and transport stable.
- Add regression tests for v7-style Patch shows.

Exit: Patch remains production-usable while show files are backed by Stream data.

### Phase 4: Stream Workspace Shell

- Replace placeholder Stream surface.
- Add Stream header, middle split layout, List/Flow outer tabs, and bottom outer tabs.
- Make List/Flow and bottom tabs the outer wrappers of their panes.
- Add resizable splitters for the Stream workspace panes.
- Reuse media pool controller on the left.
- Reuse mixer and display preview controllers in bottom tabs.
- Add temporary full-size display/output detail panes with close buttons.
- Add scene selection state shared by List/Flow/Scene Edit.

Exit: Stream Workspace can display and select real scenes.

### Phase 5: List Mode Editing

- Implement scene rows, expansion, state styling, progress edge, and row actions.
- Implement drag reorder with dependency warning.
- Implement duplicate, disable, remove.
- Wire Scene Edit for title/note/trigger/loop/preload.

Exit: users can build a Stream sequence in List mode.

### Phase 5.1: Stream Control Module Layout

Refactor the Stream control renderer so it follows the same pattern as Patch (`patchSurface.ts` stays thin; feature areas live in dedicated modules). This phase is **structure only**: behavior and UX from Phase 4–5 remain unchanged unless a split fixes a real bug.

- Extract `streamSurface.ts` into an orchestrator that owns lifecycle, shared UI state (selection, mode, bottom tab, detail overlay), and wiring to existing Patch controllers (`mediaPool`, `mixerPanel`, `displayWorkspace`, `assetPreview`, embedded audio import).
- Move layout persistence and splitters into a dedicated module (parallel to `patch/layoutPrefs.ts`).
- Move DOM assembly for the Stream shell (media pool and asset-preview element trees, splitter nodes, mixer/display host nodes) out of the orchestrator.
- Move the Stream header, List mode, Flow placeholder canvas, bottom pane chrome, and temporary display/output detail overlay each into their own modules.
- Move pure formatters (trigger summary, duration labels, sub-cue labels, state labels) into a small shared file for List, Flow, and Scene Edit.
- Move Scene Edit layout and the scene-level form (title, note, trigger, loop, preload) under `stream/sceneEdit/` so Phase 6 sub-cue editors can grow without a second mega-file.
- Prefer incremental extraction (formatters and layout first, then header and list, then scene form) to keep reviews small.

Exit: no single Stream control file dominates maintenance; later phases add features in the mapped locations below instead of growing one TypeScript file without bound.

### Phase 6: Sub-Cue Editing

- Implement audio sub-cue editor and routing to virtual outputs.
- Implement visual sub-cue editor and routing to display targets, including split display zones.
- Auto-create embedded audio sub-cue when adding video visual sub-cue.
- Prefer existing extracted embedded-audio file sources when auto-creating video audio sub-cues, then fall back to representation sources.
- Add display visual mingle controls in display details.
- Add basic fade/rate/loop controls.
- Implement the full planned control sub-cue scope, including scene transport controls.

Exit: scenes can contain multiple audio and visual sub-cues and save correctly.

### Phase 7: Runtime Execution And Preload

- Implement scene preload lifecycle.
- Implement audio/visual scene adapters against existing renderer media runtime.
- Implement the five trigger modes.
- Implement pause/resume/stop/jump-next/back-to-first.
- Add readiness and failure reporting.

Exit: Stream can run scene-to-scene in the app.

### Phase 8: Flow Mode

- Install and integrate Rete.js for the Flow graph/canvas surface.
- Implement scene cards, previews, links, hover actions, add-on-right interaction.
- Persist card rects and viewport.
- Support drag and resize.

Exit: users can visually author and trigger scenes in Flow mode.

### Phase 9: Advanced Scene Editing

- Add waveform display.
- Add fade handle editing.
- Add level and panning automation curves.
- Add freeze-frame picker.
- Add control sub-cues that act on running scenes/sub-cues.

Exit: Stream Workspace reaches the advanced flexible shell queue target.

### Phase 10: Production Hardening

- Add comprehensive stream validation panel entries.
- Add diagnostics entries for Stream runtime history.
- Add autosave recovery snapshots for authoring changes.
- Add integration tests for schema migration and stream execution.
- Add Playwright smoke tests for List and Flow surfaces.

Exit: Stream Workspace is production-ready.

### Stream workspace control code layout (`src/renderer/control/stream/`)

The Patch workspace uses `patchSurface.ts` plus `patch/*.ts` modules. Stream should mirror that: **one orchestrator** plus **feature modules**. Paths below are the intended homes as phases land; names can be adjusted (e.g. `streamHeader.ts` vs `header.ts`) but the split should stay coarse enough to navigate and fine enough that no file returns to multi-thousand-line scale.

| Module | Purpose | Primary phases |
| --- | --- | --- |
| `streamSurface.ts` | Mount/unmount, `render` pipeline, shared closure state, child controller wiring, `StreamSurfaceController` export | All |
| `streamTypes.ts` | UI-only types: mode, bottom tab, detail overlay shape, options | 5.1 |
| `layoutPrefs.ts` | Stream layout localStorage key, read/save/apply, splitter install and ARIA sync | 5.1 |
| `shell.ts` | Build Stream DOM shell: sections, splitters, `MediaPoolElements` / `AssetPreviewElements` factories for this surface | 5.1 |
| `streamHeader.ts` | Timecode, transport cluster, inline scene title/note editing, show file actions | 5.1 |
| `workspacePane.ts` | Outer List / Flow tab bar; delegates body to list or flow module | 5.1 |
| `listMode.ts` | Scene list toolbar, columns, row expansion, drag reorder, row actions, end-drop target | 5, 5.1 |
| `flowMode.ts` | Flow canvas host: placeholder cards today; Rete area, pan/zoom, and Xtream-owned card/link rendering later | 5.1, 8 |
| `bottomPane.ts` | Bottom tab row (Scene Edit, Mixer, Displays), mixer/display pane glue, tab-specific actions (e.g. create output/display) | 5.1 |
| `streamDetailOverlay.ts` | Full-bleed display or output detail with close → restore previous bottom tab; bridge toward Patch detail controls | 5.1, 6, 9 |
| `formatting.ts` | Pure helpers: trigger summary, scene duration, sub-cue labels, runtime state labels | 5.1 |
| `dom.ts` | Stream-specific tab bars, table cells, detail field wrappers (or fold into `../shared/dom.ts` if duplication with Patch becomes painful) | 5.1 |
| `sceneEdit/sceneEditPane.ts` | Rail + detail shell; selection between scene vs sub-cue section | 5.1, 6 |
| `sceneEdit/sceneForm.ts` | Scene-level fields only (title, note, disabled, trigger, loop, preload, duplicate/remove) | 5, 5.1 |
| `sceneEdit/subCueRail.ts` | Reorderable sub-cue stack, Add Sub-Cue entry, focus/selection | 6 |
| `sceneEdit/audioSubCueForm.ts` | Audio sub-cue editor (outputs, fades, loop, rate, routing) | 6, 9 |
| `sceneEdit/visualSubCueForm.ts` | Visual sub-cue editor (targets, zones, fades, freeze, loop, rate) | 6, 9 |
| `sceneEdit/controlSubCueForm.ts` | Control sub-cue editor (actions, targets, validation) | 6, 9 |
| `sceneEdit/waveform.ts` (or similar) | Waveform visualization for audio sub-cues | 9 |
| `flow/reteHost.ts` (optional) | Rete editor lifecycle, serialization boundary between graph UI and `PersistedSceneConfig` / triggers | 8 |

**Phase 7 (runtime)** is mostly main-process (`StreamEngine`, adapters) and IPC; the control renderer only gains incidental UI (e.g. preload or failure badges on list rows) in `listMode.ts`, `formatting.ts`, or small additions to `streamHeader.ts`.

**Phase 10** adds tests (`*.test.ts` beside modules or under `tests/`), validation/diagnostics surfacing that may live in shared control chrome, and Playwright specs that target Stream routes—not new monoliths under `stream/`.

## 17. Resolved Decisions

- A show file contains exactly one Stream.
- New display windows default to the `latest` visual mingle algorithm.
- Split display zones are named `L` and `R` in v1.
- The first Stream implementation includes the full planned control sub-cue scope, including scene transport controls.
- Auto-created embedded video audio sub-cues prefer an existing extracted embedded-audio file source, then fall back to a representation source.
- Flow mode uses Rete.js.
