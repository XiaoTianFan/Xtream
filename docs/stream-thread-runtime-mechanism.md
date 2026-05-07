# Stream Thread And Multi-Timeline Runtime Mechanism

## Purpose

This document records the Stream "thread" model as the runtime benchmark for implementation, regression testing, and display/audio projection work.

The mechanism below is now largely implemented. The implementation keeps one authored Stream, an edit timeline, a last-known-good playback timeline, derived canonical threads, runtime timeline instances, runtime thread instances, flattened active sub-cue projection, list/flow/gantt visualization support, and Patch/Stream playback separation. The remaining value of this document is to keep the sequencing rules explicit enough for future fixes and to prevent regressions around Flow mode, thread coloring, multi-timeline playback, display projection, and the edge cases around "run from here".

Patch workspace playback and timeline behavior are out of scope. The new mechanism must affect Stream only.

## Current Implementation Snapshot

The current source of truth is:

- `PersistedStreamConfig`: one Stream with `sceneOrder` and `scenes`.
- `PersistedSceneConfig`: trigger, loop, preload, sub-cues, and optional Flow rect.
- `SceneTrigger`: `manual`, `follow-start`, `follow-end`, `at-timecode`.
- `buildStreamSchedule()`: derived canonical thread plan plus latest main timeline composition.
- `StreamEngine`: one public runtime state with a main clock, optional parallel timeline instances, runtime thread instances, canonical scene summaries, and flattened active audio/visual sub-cues.
- `deriveDirectorStateForStream()` and `buildStreamDisplayFrames()`: flattened audio/display projections consumed by audio and display renderers.

Important current behaviors to preserve unless explicitly replaced:

- Every Stream edit recalculates an edit timeline.
- Only valid edit timelines promote to `playbackStream` and `playbackTimeline`.
- Transport uses the playback pair, not an invalid authoring snapshot.
- Pause is pause-only; resume happens through `play`.
- Header Play uses playback focus when available.
- Double-clicking a scene sets playback focus.
- A scene row "Run from here" is explicit scene play intent.
- If playback reaches a point where no auto-triggered scene can continue and only manual-gated scenes remain, Stream time pauses and waits for the operator.
- The global header rail seeks on the latest main Stream timeline and applies the configured parallel-timeline seek behavior.
- `back-to-first` resets the Stream when not running.
- Display windows consume flattened per-display/per-zone Stream frames. They must reconcile zones and layers by stable IDs so a change in one zone or parallel timeline does not tear down unrelated media elements.

Implementation constraints that still matter:

- The persisted Stream remains scene-centric; canonical threads and runtime instances are derived, not directly authored.
- `cursorSceneId`, playback focus, edit focus, and timeline cursors must stay conceptually separate even when UI surfaces summarize them.
- Renderers should not need to understand the thread graph. They should consume flattened active cue and display-frame projections.
- Display-side projection is correct only if DOM/media reconciliation is incremental; full display-window rebuilds during active playback can produce black refreshes even when the Stream runtime state is correct.

## Core Vocabulary

### Stream

The user-authored Stream remains the saved top-level sequence. It owns all scenes and the author-facing linear list order.

### Scene

A Scene remains the operator-facing executable unit. It contains sub-cues and has a trigger policy.

### Sub-Cue

A Sub-Cue remains a scene-local audio, visual, or control action. Scene and thread duration still derive from sub-cue duration rules.

### Trigger Classes

Operation triggers start a thread:

- `manual`
- `at-timecode`
- future non-follow triggers

Auto triggers continue from another scene:

- `follow-start`
- `follow-end`

Auto trigger delay remains part of the edge timing. Current code stores delay on `follow-start` and `follow-end`; that should continue to be supported.

### Thread

A Thread is an internal, non-user-exposed organization level between Stream and Scene.

A thread is a tree of scenes rooted at an operation-triggered scene. Auto-triggered scenes reachable from that root belong to the same thread. A Stream can contain multiple threads.

Thread identity is derived, not manually authored. The user still authors scenes and triggers.

### Thread Root

A thread root is a scene that is not itself triggered by a scene-following trigger. In the current trigger set, root scenes are `manual` and `at-timecode` scenes.

### Thread Branch

A branch is one path through a thread tree. A thread can branch when multiple scenes auto-follow the same predecessor, or when auto-follow chains diverge.

### Thread Duration

The default planned duration of a thread is the duration of its longest branch. Scene duration still follows existing sub-cue and loop calculation rules.

### Canonical Thread

The derived thread from the authored Stream graph. It is used for planning and authoring display.

### Thread Instance

A runtime copy of a thread on a timeline. A canonical thread can have zero, one, or multiple runtime instances. Retriggering a completed or already-running thread creates a new instance when it would otherwise conflict with the existing instance.

### Timeline Instance

A virtual runtime timeline with its own ordered thread instances, cursor, status, pause state, and active sub-cue projection.

The first/default timeline is the main timeline. Additional timelines are spawned when the operator launches a thread in parallel with an already-running timeline.

### Playback Focus

Playback focus is an operator intent pointer: "if the header Play button is pressed, launch from this scene."

Playback focus is not the same as timeline cursor, edit focus, or calculated timeline order. It should update on scene progression events, double-clicks, and explicit run/play actions, not every animation frame.

### Edit Focus

Edit focus remains the selected scene/sub-cue for the Scene Edit pane. It is separate from playback focus.

## Thread Graph Derivation

Use a hybrid derivation algorithm with a backward ownership pass followed by a forward branch pass.

The backward ownership pass is the authority for thread membership:

1. Resolve every scene's effective trigger predecessor first. Explicit `followsSceneId` wins; omitted `followsSceneId` resolves to the previous scene in `sceneOrder`, matching current behavior.
2. Classify every scene as one of:
   - operation root: `manual`, `at-timecode`, or future non-follow trigger
   - auto-follow scene: `follow-start` or `follow-end`
   - disabled scene: visible in authoring but not runnable
   - broken auto-follow scene: auto trigger whose predecessor is missing, disabled, or invalid
3. For each enabled auto-follow scene, walk backward through predecessor links until an operation root is found.
4. Assign the auto-follow scene to that root's canonical thread.
5. If the walk hits a missing predecessor, disabled predecessor, cycle, or ambiguous ownership, mark that scene and all downstream scenes in that branch as temporarily disabled for runtime scheduling.
6. If the invalid predecessor becomes valid again later, the next graph derivation restores the affected branch automatically.

The forward branch pass builds display and scheduling structure after ownership is known:

1. For each operation root, collect all owned scenes.
2. Build parent-to-children auto-trigger edges.
3. Walk forward from the root to enumerate branches.
4. Calculate local scene offsets and the longest branch.
5. Emit warning stubs for missing predecessor references in Flow mode, while keeping the affected branch temporarily disabled for runtime.

This hybrid is preferred because the backward pass prevents accidental double ownership, while the forward pass naturally produces branches, Flow links, longest-branch duration, and layout hints.

The required planner output is:

- `threadId`
- `rootSceneId`
- `sceneIds`
- auto-trigger edges
- branch paths
- longest branch
- local per-scene offsets within the thread
- thread duration
- temporarily disabled branch/scene ids
- validation issues

Rules and validation:

- Disabled scenes do not run. They remain visible in List and Flow mode, dimmed.
- Missing predecessor references produce warning stubs in Flow mode, validation errors in scheduling, and temporarily disable the affected branch until the predecessor is valid again.
- Cycles in auto triggers are invalid.
- A scene must not belong to two canonical threads. If trigger references create ambiguity, the schedule is invalid until repaired.
- Implicit `followsSceneId` currently means previous row. Thread derivation must resolve implicit follows before building thread edges.
- `at-timecode` scenes are operation-triggered roots even though their trigger is time-based.

## Default Main Timeline Composition

The default main timeline is derived from canonical threads.

Default ordering:

1. Find all thread roots.
2. Exclude `at-timecode` rooted threads from main timeline composition.
3. Sort the remaining threads by the root scene's relative position in `sceneOrder`.
4. Lay those threads in series on the main timeline.
5. Each thread segment length is that thread's longest branch duration.
6. The default total Stream duration is the sum of all included default thread segment lengths.

The blue dotted path in the reference image represents this default main timeline: it connects the longest branch of each main-composed thread in default root order.

At-timecode rooted threads are operational side threads. They are never included in the default main timeline duration. Their trigger time refers to a timecode on the default main timeline, or to an external timecode source after external timecode support exists.

The main timeline is dynamic. It can be recalculated when:

- scene/sub-cue duration changes
- thread duration changes
- scene order changes
- trigger graph changes
- a thread is moved out to a parallel timeline
- unplayed thread order is changed by operator launch behavior

Duration calculation and ordering must remain decoupled. Changing a scene duration recalculates its scene, thread, and timelines. Reordering thread segments changes placement but not intrinsic thread duration.

## Thread-Local Time

Every canonical thread should have a local timeline from `0` to `threadDurationMs`.

For any scene in a thread:

- `threadLocalStartMs` is where that scene begins in the thread's local schedule.
- `threadLocalEndMs` is start plus scene duration when known.
- A selected middle scene can be launched by starting the thread instance at that scene's `threadLocalStartMs`.

For branching threads, a scene's local offset comes from its resolved auto-trigger path. If branches overlap, multiple scenes can be active at the same thread-local time.

## Main Timeline And External Timecode

The header timecode and global scrub rail refer to the latest ordered main timeline.

At-timecode scenes are always operation roots and are never included in default main timeline duration calculation.

There are two intended at-timecode source modes:

1. External timecode source:
   - future default once external timecode is supported
   - the at-timecode rooted thread listens to that external clock
   - the thread remains outside the main timeline composition

2. Main timeline timecode:
   - current supported mode because external timecode is not implemented yet
   - the at-timecode rooted thread listens to the latest ordered main timeline's timecode
   - the thread still remains outside the main timeline composition

Because user interaction can reorder the main timeline during playback, assigning `at-timecode` in main-timeline mode should show an authoring reminder:

"This trigger follows the Stream main timeline. The main timeline can be recalculated or reordered during Pro playback by operator interaction, so this timecode may not be stable unless an external timecode source is added later."

## Timeline Instance Model

The runtime represents playback with a collection of timeline instances.

Implemented state shape, conceptually:

```ts
type RuntimeTimelineInstance = {
  id: string;
  kind: 'main' | 'parallel';
  status: 'idle' | 'running' | 'paused' | 'complete' | 'failed';
  orderedThreadInstanceIds: string[];
  cursorMs: number;
  pausedAtMs?: number;
  originWallTimeMs?: number;
  durationMs?: number;
};

type RuntimeThreadInstance = {
  id: string;
  canonicalThreadId: string;
  timelineId: string;
  rootSceneId: string;
  launchSceneId: string;
  launchLocalMs: number;
  state: 'ready' | 'running' | 'paused' | 'complete' | 'failed' | 'skipped';
  copiedFromCompletedThread?: boolean;
};
```

This is a conceptual summary of the TypeScript schema. It describes the separation the implementation maintains:

- canonical thread plan
- runtime thread instance
- timeline instance
- playback focus
- edit focus
- scene runtime state

## Scene State Semantics

Scene states remain:

- `disabled`
- `ready`
- `preloading`
- `running`
- `paused`
- `complete`
- `failed`
- `skipped`

New expectations:

- A scene in an unlaunched detached thread remains `ready`, even if its default main timeline position is before the current main cursor.
- A scene in a branch whose auto-trigger predecessor is missing, disabled, or invalid becomes temporarily `disabled` for runtime scheduling and restores automatically when the predecessor is valid again.
- A scene earlier in the same launched thread than the launch scene becomes `skipped` when launching from the middle.
- A completed scene can be relaunched by creating a new thread instance if the original canonical thread has already completed and the main timeline should not be changed.
- A scene can have multiple runtime instances only through thread-instance copying. The Gantt view is the planned instance-monitoring surface.
- Canonical scene state summarization is configurable:
  - `Last instance` is the default.
  - `First instance` is the alternate mode.
  - This setting belongs in Config beside the Stream pause/resume behavior settings.

This is a key change from a pure single-cursor schedule: global time position alone cannot decide every canonical scene state.

## Operational Launch Rules

"Run from here" should be exactly two logical actions:

1. Set playback focus to the scene.
2. Execute the same command as header Play from that playback focus.

Double-clicking a scene sets playback focus. It may also align edit focus depending on existing UI convention, but playback focus is the transport reference.

The header Play handler decides what to do based on:

- runtime status
- whether there are active timeline instances
- selected scene's canonical thread
- whether that thread is already running, complete, skipped, or not launched
- whether the selected scene is the thread root or a middle scene
- whether the selected thread is next in the current main timeline
- whether launching would be serial or parallel

### Header Play Decision Tree

This is the target decision tree for header Play. Run from here must enter this same tree after setting playback focus to the interacted scene.

1. Gate invalid or blocked playback.
   - If the playback timeline/thread plan is invalid, do not start.
   - If Patch owns active playback and the command would start Stream media, do not start.
   - If no enabled playable scene exists, do not start.

2. Resolve the launch scene.
   - If playback focus points to a playable scene, use it.
   - Else if runtime has a cursor scene and that scene is playable, use it.
   - Else use the first enabled scene in the latest main timeline order.
   - If the only focused scene is temporarily disabled because its predecessor branch is broken, Play should no-op and surface the branch validation issue.

3. Resolve the selected canonical thread and selected thread-local start.
   - If selected scene is the thread root, `launchLocalMs = 0`.
   - If selected scene is inside the thread, `launchLocalMs = selectedScene.threadLocalStartMs`.
   - Scenes earlier than `launchLocalMs` in that same thread instance become `skipped`.

4. If there is no active runtime, or runtime is idle/reset:
   - If selected thread is included in the main timeline, seek the main timeline to the selected scene's latest main-timeline position and start the main timeline from there.
   - Earlier scenes in other detached threads remain `ready`.
   - Earlier scenes in the selected thread become `skipped`.
   - If selected thread is an `at-timecode` rooted thread, launch it as an explicit operator-triggered thread instance outside main timeline composition.

5. If runtime is paused because all currently reachable auto-triggered work finished and ready scenes remain:
   - If selected thread is the immediate next ready thread in the current main timeline order, resume serially on the main timeline without reordering.
   - If selected thread is a later unplayed main-composed thread, move that thread to immediately after the previously finished thread and start it serially on the main timeline.
   - If selected scene is a middle scene, start at its thread-local offset and mark earlier same-thread scenes skipped.
   - Total main timeline duration does not change when this is only a serial reorder.
   - If selected thread is `at-timecode` rooted, launch it outside main timeline composition.
   - If a paused runtime has multiple paused timeline instances, use the multi-timeline resume setting before applying serial-reorder behavior.

6. If runtime is paused due to user Pause during active playback:
   - If paused-play behavior is `preserve-paused-cursor`, resume according to the stored paused cursors.
   - If paused-play behavior is `selection-aware` and playback focus changed, route the focused scene through this launch tree.
   - If playback focus did not change, resume from paused cursor.

7. If one main timeline is running and selected thread is an unplayed future main-composed thread:
   - Spawn a new parallel timeline for the selected thread.
   - Remove that thread from the remaining main timeline plan.
   - Recalculate the main timeline duration and segment order.
   - If selected scene is a middle scene, start the parallel timeline at that scene's thread-local offset and mark earlier same-thread scenes skipped.

8. If one main timeline is running and selected thread is currently running on that same main timeline:
   - If selected scene is at or ahead of the current running point, seek that running thread instance forward to the selected scene's thread-local position.
   - If selected scene is earlier than the current running point, create a copied thread instance on a new parallel timeline.
   - Do not rewind the currently running thread instance.

9. If selected thread is already running on any parallel timeline:
   - If selected scene would rewind that running thread instance, create a copied thread instance on a new parallel timeline.
   - If selected scene is at or ahead of that instance's current position, seek that parallel timeline forward to the selected scene's thread-local position.
   - Keep the main timeline intact when seeking within a running parallel timeline.

10. If selected thread is complete:
   - Create a copied thread instance.
   - Launch the copy on a new parallel timeline.
   - Do not mutate the current main timeline order or duration.

11. If selected thread was removed from main because it is already running or complete elsewhere:
   - Launching it again creates a copied thread instance on a new parallel timeline.
   - Main timeline order is not recalculated for the relaunch.

12. If multiple timelines are paused and header Play is pressed without a changed playback focus:
   - If multi-timeline resume behavior is `resume all clocks`, resume every paused timeline from its own cursor. This is the default.
   - If multi-timeline resume behavior is `launch focused cue only`, only route the playback-focused scene through this decision tree.

13. After any successful launch:
   - update playback focus to the last launched scene by relative position in List mode `sceneOrder`
   - update playback focus again only on scene progression events
   - keep edit focus independent unless the UI action explicitly aligned edit focus too

## Case Matrix

### Case 1: Full Reset, Play First Scene

Initial state:

- no active additional timelines
- main timeline is default ordered thread list
- all scenes are `ready` unless disabled/error
- playback focus is first enabled scene

Action:

- user presses header Play

Expected:

- main timeline starts at the first enabled scene's main timecode
- first thread instance runs on main timeline
- playback focus updates on scene progression events

### Case 2: Full Reset, Launch A Scene In A Later Thread

Initial state:

- all threads are reset and ready
- no timeline is running
- selected scene belongs to Thread B
- Thread A appears before Thread B in default order

Action:

- user double-clicks the scene and presses header Play, or uses Run from here

Expected:

- no additional timeline is spawned
- no thread reordering occurs
- the main timeline cursor jumps to the selected scene's default main timeline position
- Thread B starts from that scene
- scenes in earlier detached threads, such as Thread A, remain `ready`
- scenes earlier within Thread B become `skipped`
- playback focus follows scene progression from the launched point

Principle:

Starting from a later detached thread in a reset Stream is a main timeline jump, not a parallel launch.

### Case 3: Thread Ends, Operator Uses Header Play For Immediate Next Thread

Initial state:

- previous thread has completed
- no auto-triggered scenes remain active from that thread
- main runtime is paused at the manual tail
- playback focus has advanced to the beginning scene of the immediately following thread

Action:

- user presses header Play

Expected:

- the immediately following thread starts on the main timeline
- main timeline order is unchanged
- total duration is unchanged
- no additional timeline is spawned

### Case 4: Thread Ends, Operator Launches Non-Immediate Later Thread

Initial state:

- previous thread has completed
- main runtime is paused waiting for an operation trigger
- user selects a scene in a later thread that is not the immediate next thread

Action:

- user presses header Play or uses Run from here

Expected:

- selected thread is moved to immediately follow the previously finished thread in the main timeline order
- total main timeline duration does not change because only thread order changed
- if the selected scene is the thread root, launch from thread local `0`
- if the selected scene is a middle scene, launch from that scene's thread-local start and mark earlier scenes in the same thread `skipped`
- detached threads that were moved later remain `ready`

Principle:

When playback is paused between threads, launching another unplayed thread is serial reordering, not parallel playback.

### Case 5: Main Timeline Running, Launch Root Of Another Unplayed Thread

Initial state:

- Thread A or Thread B is running on the main timeline
- Thread C is unplayed and belongs to the main timeline's future thread list

Action:

- user launches Thread C's root scene

Expected:

- create a new parallel timeline instance for Thread C
- create a runtime thread instance for Thread C on that new timeline
- start the new timeline at `0`
- remove Thread C from the main timeline's remaining ordered list
- recalculate the main timeline duration without Thread C
- keep already completed/running main timeline state intact
- threads that originally followed Thread C in default order move forward on the main timeline unless they are also launched elsewhere

Example:

- default: A, B, C, D
- B is running on main
- C is launched in parallel
- main remaining order becomes A, B, D
- C timeline duration is Thread C duration

### Case 6: Main Timeline Running, Launch Middle Scene Of Another Unplayed Thread

Initial state:

- main timeline is running
- selected scene is inside unplayed Thread C, not the root

Action:

- user launches the selected scene

Expected:

- create a parallel timeline for Thread C
- start that timeline at the selected scene's thread-local start time
- mark earlier scenes in Thread C as `skipped` for that thread instance
- remove Thread C from the main timeline's remaining ordered list
- recalculate main timeline duration without Thread C

### Case 7: Cascading Future Thread Shift

Initial state:

- default main order is A, B, C, D, E
- A is complete
- B is running on main
- C is launched to a parallel timeline

Expected:

- C is removed from the remaining main timeline plan
- D moves forward after B on the main timeline
- E remains after D on the main timeline
- main duration is recalculated as A + B + D + E
- C keeps its own parallel timeline duration

If D is later launched manually while B is still running:

- D is also removed from the main timeline
- D gets its own parallel timeline
- E moves forward after B
- main duration is recalculated as A + B + E

If D is not launched manually:

- D remains on the main timeline and moves forward in placement.
- Because D must start with its own operation-triggered root, it never auto-spawns merely because C was moved out.
- D starts only through the normal triggering mechanism for its root, usually operator manual launch or future operation trigger.

### Case 8: Multiple Parallel Timelines Running, Relaunch Completed Thread

Initial state:

- Thread A is complete
- Thread B is running on main
- Thread C and Thread D may be running on parallel timelines
- later main timeline order has already shifted to account for moved-out threads

Action:

- user launches a scene from completed Thread A

Expected:

- do not refresh or reorder the main timeline
- create a copy/thread instance of Thread A
- launch the copy on a new parallel timeline
- if launched from a middle scene, start at that scene's thread-local start and mark earlier scenes in the copy skipped

Principle:

Completed thread relaunch is an additive copy, not a mutation of the already-running main plan.

### Case 9: Same Thread Already Running, Relaunch Earlier Scene

Initial state:

- Thread B is currently running
- selected scene belongs to Thread B and is earlier than the currently running point
- selected scene may be `skipped` or `complete`

Action:

- user launches the selected earlier scene

Expected:

- create a copy of Thread B as a new thread instance
- launch the copy on a new parallel timeline from the selected scene
- do not rewind the currently running Thread B instance
- do not recalculate the main timeline unless the selected canonical thread was still only an unplayed future thread

### Case 10: At-Timecode Trigger Fires

Initial state:

- a scene has `at-timecode`
- it is a thread root
- its thread is not included in the default main timeline calculation

Action:

- the selected timecode source reaches the scene's configured timecode

Expected:

- at-timecode acts as an operation trigger
- current implementation mode uses latest ordered main timeline timecode as the source
- future external-timecode mode should use the selected external source
- the thread launches outside main timeline composition
- if the same canonical thread is already running or complete, behavior follows the same copy/parallel rules as manual operation launch

### Case 11: Header Back To First

Action:

- user clicks Back to first scene

Expected:

- reset all temporal additional timelines
- restore default main timeline order and durations
- reset all scene states
- restore playback focus to the first enabled scene
- keep edit focus according to UI convention unless reset is intentionally tied to edit selection

### Case 12: Header Main Rail Seek

Action:

- user manually seeks on the global header timeline rail

Expected:

- seek applies to the latest ordered main timeline
- timecode display reflects the main timeline cursor
- displays and audio outputs refresh to the selected main timeline moment
- the rail's duration and segmentation reflect the latest main timeline order

Parallel timeline behavior is configurable in Config:

- `Leave parallel timelines running` is the default. Main seek affects only the main timeline; parallel timelines keep running at their own cursors.
- `Follow relative seek`: calculate the main seek delta and apply the same delta to every active parallel timeline on a best-effort basis, clamped to each timeline's valid range.
- `Pause parallel timelines`: pause active parallel timelines at their current cursors when the main seek is committed.
- `Clear parallel timelines`: remove active parallel timelines when the main seek is committed.

## Pause And Resume

### Single Timeline

When only one timeline is active, pause/resume should match the current implementation:

- Pause freezes the timeline cursor.
- Pause is idempotent.
- Resume happens through Play.
- The configured paused-play behavior still applies:
  - `selection-aware`
  - `preserve-paused-cursor`

### Multiple Timelines

When multiple timelines are active:

- global Pause should freeze all active timeline instances
- each timeline stores its own paused cursor
- active scene states become `paused` per timeline instance
- projected audio/visual sub-cues freeze at their timeline-local positions
- global Play resumes according to the current playback focus and paused-play behavior

Multi-timeline resume behavior is configurable in Config:

- `Resume all clocks` is the default. Header Play resumes every paused timeline from its own cursor when playback focus has not changed to a new launch target.
- `Launch focused cue only` routes only the playback-focused scene through the header Play decision tree and leaves other paused timelines paused unless another command resumes them.

This setting should sit beside the existing pause/resume mechanism selection in the Config surface.

## Playback Focus Rules

Playback focus should be stored independently from:

- main timeline cursor
- timeline ordering
- timeline reset state
- edit focus
- scene runtime state

Focus update events:

- double-click scene row/card: set playback focus to that scene
- Run from here: set playback focus to that scene, then perform header Play
- scene progression: update playback focus when the active scene advances to another scene
- auto-pause after a thread/manual-tail boundary: move playback focus to the next ready manually triggered root scene by relative position in List mode `sceneOrder`
- Back to first: set playback focus to first enabled scene

Focus should not update every frame.

The auto-pause focus advance should only happen when the engine has reached a real waiting boundary: no scene is running, no auto-triggered scene can continue from the just-finished work, and at least one ready manually triggered thread root remains later in List mode order.

## Output Projection

The renderer projection derives active audio/visual/control output from all active timeline instances:

1. main timeline active sub-cues
2. parallel timeline active sub-cues
3. orphaned/fading sub-cues from running edits or stop actions
4. global mute/blackout/control effects

`StreamEngine` keeps timeline/thread instance internals in `StreamRuntimeState`, then exposes flattened `activeAudioSubCues` and `activeVisualSubCues`. Runtime projection keys include runtime instance identity so copied or parallel instances that share scene, sub-cue, and target do not collapse.

Audio renderers consume `deriveDirectorStateForStream()`, which clones active Stream audio sub-cues into runtime audio sources and output selections while preserving Patch state outside Stream playback.

Display renderers consume `buildStreamDisplayFrames()`, which groups active Stream visual sub-cues into deterministic per-display/per-zone layer frames. The display window must apply these frames atomically but incrementally: preserve zone containers and media elements when layer identity is unchanged, update opacity/blend/ordering in place, and only remove the specific layer that actually ended. This is required for multi-thread and multi-timeline playback because unrelated zones can change at different times.

## Flow Mode Relationship

Flow mode naturally visualizes the derived thread graph:

- operation-triggered roots start separate visual groups
- auto-trigger links form tree edges
- missing followed scene references render warning stubs and temporarily disable the downstream branch
- branches appear as divergent auto-trigger paths
- thread color can be derived from canonical thread id
- thread default layout can place canonical threads left-to-right in default main timeline order

Flow mode should remain an editing/view layer. Xtream-owned Stream data and derived thread plans remain the source of truth.

### Flow Canvas

Background:

- Use a denser grid than the current placeholder.
- Grid styling should match the rest of the app: quiet, technical, low-contrast, and not decorative.

Canvas operations:

- pan
- zoom in/out
- fit to content / reset view
- drag cards to reposition
- resize cards
- right-click empty space to open a menu with `Add Scene`
- hover just outside the right edge of a card to show an add button
- clicking that add button creates a new scene that follows the hovered scene by default

Add-scene behavior:

- New scene trigger defaults to `{ type: 'follow-end', followsSceneId: hoveredScene.id }`.
- New scene position defaults to the right of the hovered card.
- Empty-space add should place the new manual-root scene at the clicked canvas position unless the user later connects or edits the trigger.

### Flow Scene Cards

Cards:

- resizable
- show scene number
- show title
- show duration as the bottom metadata line
- render visual sub-cue previews in a dynamic grid inside the card
- live source previews default to paused
- render running progress along the bottom edge
- render the metadata/footer section with the owning thread's color shade
- render edit focus as a top-edge indicator, matching the list row's edit-focus language
- render playback focus as a border around the card

Hover actions:

- centered play/pause toggle icon
- centered Edit icon beside the play/pause icon
- Edit selects the card and opens Scene Edit

Context menu:

- duplicate
- disable/enable
- remove

State styling:

- `ready`: normal card style with thread-colored metadata/footer.
- `running`: normal card plus thread-colored bottom progress bar.
- `paused`: yellow-ish card shade, consistent with list row pause styling.
- `failed`: reddish card shade.
- `preloading`: loading animation.
- `complete`: lightest dimming among terminal states.
- `skipped`: medium dimming.
- `disabled`: dimmest entire-card treatment.
- Broken temporary-disabled branches from missing predecessors use disabled-level dimming plus a warning cue.

### Flow Links And Main Timeline Curve

Link rules:

- Auto triggers link to the followed scene.
- `manual` and `at-timecode` do not link by default because they are thread roots.
- Missing followed scene references render warning stubs.
- Links are virtual projections of trigger policies, not persisted independent edges.

Main timeline curve:

- Render a dotted curve that passes through the longest branch of each main-composed thread.
- The curve should pass through each scene card on the main timeline's composed path.
- The curve should not include at-timecode side threads because they are outside main duration.
- When the main timeline is playing, animate a left-to-right glow along the dotted curve.
- The glow should reflect main timeline progress and respect reordered main timeline composition.

### Flow Default Layout

Default layout:

- Main-composed threads are placed left-to-right in default main timeline order.
- Within each thread, branches are arranged vertically.
- The longest branch should be visually centered among that thread's branches.
- The thread root anchors the group.
- Dragging the thread root moves the whole thread group.
- Dragging any other scene moves only that scene.

At-timecode rooted threads:

- Place them spatially above or below the main flow, not inside the main dotted timeline path.
- Their horizontal starting position is determined by their timecode's relative position on the left-to-right main timeline.
- If the main timeline duration changes, their default/reset horizontal position recalculates from their timecode ratio.
- If an external timecode source is used later, the horizontal placement should still be shown in a time-reference lane, but the exact mapping will need external-source scale rules.

### Flow Implementation

- Use Rete.js for Flow mode.
- Persist card rects and Stream `flowViewport`.
- Keep the scene graph as Xtream-owned data; the library is the editing/view layer, not the source of truth.
- Require custom scene-card rendering, pan/zoom, selection, drag, resize, programmatic fit-view, custom links, and library-independent serialization.
- Use Rete area/pan/zoom and connection primitives.
- Keep scene cards, previews, hover controls, thread colors, focus styling, progress, and command dispatch as Xtream-owned components.
- Add only the Rete packages required for the selected renderer path.
- Because the current control renderer is vanilla TypeScript, evaluate Rete Lit or classic renderer integration before introducing a React island.
- Treat Rete node and connection data as a projection of `PersistedSceneConfig.flow` and scene trigger policies.

## List Mode Relationship

List mode remains the author-facing linear scene list. Thread membership is derived and can be displayed without changing the persisted list model.

### Thread Color Palette

Maintain a fixed thread color palette that matches the current Stream token atmosphere: muted, low-chroma, Morandi-like, visually distinct, and compatible with both dark and light themes.

Recommended canonical thread palette:

| Token | Base | Bright | Dim |
| --- | --- | --- | --- |
| `thread-sage` | `#7f927d` | `#a6b8a2` | `rgb(127 146 125 / 0.20)` |
| `thread-teal` | `#5c9ead` | `#86bfcb` | `rgb(92 158 173 / 0.20)` |
| `thread-ochre` | `#c29958` | `#d7b77a` | `rgb(194 153 88 / 0.20)` |
| `thread-clay` | `#b77a62` | `#d29b85` | `rgb(183 122 98 / 0.20)` |
| `thread-rosewood` | `#a96f78` | `#ca929a` | `rgb(169 111 120 / 0.20)` |
| `thread-plum` | `#8c7a99` | `#ad9cba` | `rgb(140 122 153 / 0.20)` |
| `thread-steel` | `#748895` | `#9aabb5` | `rgb(116 136 149 / 0.20)` |
| `thread-moss` | `#79885e` | `#9eab7b` | `rgb(121 136 94 / 0.20)` |
| `thread-linen` | `#aa9d82` | `#c7bda5` | `rgb(170 157 130 / 0.20)` |
| `thread-copper` | `#a97f5b` | `#cba17a` | `rgb(169 127 91 / 0.20)` |
| `thread-slate` | `#6f7d88` | `#95a2ac` | `rgb(111 125 136 / 0.20)` |
| `thread-seafoam` | `#6f9b91` | `#96bdb4` | `rgb(111 155 145 / 0.20)` |
| `thread-olive` | `#8f8f68` | `#b1b087` | `rgb(143 143 104 / 0.20)` |
| `thread-mauve` | `#987984` | `#ba9aa5` | `rgb(152 121 132 / 0.20)` |
| `thread-cadet` | `#667f94` | `#8da2b4` | `rgb(102 127 148 / 0.20)` |
| `thread-umber` | `#94725d` | `#b6937c` | `rgb(148 114 93 / 0.20)` |

Assignment rules:

- Assign color by stable canonical thread order, not by runtime instance.
- Wrap around when there are more threads than palette entries.
- Runtime copied instances use the same thread color plus an instance marker in Gantt.
- Temporarily disabled/broken branches keep their thread color but are dimmed.

Expected list affordances:

- scenes belonging to the same canonical thread share a background shade
- row progress uses the thread color
- scene edit pill uses the thread color
- the global rail can render thread-duration segments in main timeline order

List details:

- All scenes in the same calculated thread use the same shaded row background, even when they are not adjacent in `sceneOrder`.
- The bottom-edge row progress bar uses the owning thread's bright color.
- The Scene Edit scene pill uses the owning thread's dim/background shade.
- Disabled, skipped, complete, paused, failed, and preloading visual states layer over the thread shade rather than replacing thread identity.

These are UI consequences of the runtime mechanism, not separate scheduling rules.

## Header Timeline Rail

The full-width Stream timeline rail in the header always reflects the latest ordered default main timeline.

Required behavior:

- The scrubber position and timecode are relative to the latest main timeline cursor.
- Manual seeks apply to the latest ordered main timeline.
- At-timecode side threads are not rendered as main duration segments.
- Parallel timelines are not directly represented on this rail; they belong in Gantt.

Segment rendering:

- Dynamically calculate each main-composed thread's proportional width from its thread duration divided by main timeline duration.
- Render the rail background as contiguous dim thread-color segments.
- Render the progressed foreground as contiguous bright thread-color segments.
- The foreground must preserve the same segmentation as the background and clip at the current scrubber position.
- If a thread has zero duration, render it as a minimum visible tick or marker only if needed for operator orientation.
- If the main timeline is invalid, fall back to the current blocked/error rail state.

## Gantt / Multi-Timeline Monitor

Gantt is the planned third Stream view beside List and Flow. It is the natural way to show active timeline instances:

- one lane per timeline instance
- thread instances as colored bars
- local cursor per lane
- main timeline lane first
- parallel lanes below
- copied/relaunched thread instances visually marked as copies

Gantt requirements:

- view-only monitor
- one horizontal lane per active timeline instance
- main timeline lane is pinned first
- parallel timeline lanes appear below in launch order
- thread instances render as colored bars using the canonical thread palette
- copied/relaunched instances use the same thread color plus a copy/instance indicator
- each lane has its own local cursor
- paused timelines show frozen cursors
- running timelines show moving cursors
- lane duration reflects that timeline's own duration, not the main timeline duration
- scene/sub-cue detail can be surfaced through hover or selection later, but initial Gantt should focus on timeline/thread instance readability
- style should match the rest of Xtream: dense, restrained, low-contrast, and operator-focused

This should not become the source of truth. It is a runtime monitor.

## Config Surface Additions

Add these Stream runtime settings beside the existing pause/resume and running-edit behavior controls:

- Multi-timeline resume behavior:
  - `Resume all clocks` default
  - `Launch focused cue only`

- Main rail seek behavior for parallel timelines:
  - `Leave parallel timelines running` default
  - `Follow relative seek`
  - `Pause parallel timelines`
  - `Clear parallel timelines`

- Canonical scene state summary when multiple instances exist:
  - `Last instance` default
  - `First instance`

## Proposed Orchestration Principles

1. Derive thread graph before calculating timeline order.
2. Calculate thread-local schedules independently from timeline placement.
3. Compose the main timeline from ordered manual-rooted thread segments; keep at-timecode-rooted threads outside main duration.
4. Keep canonical thread duration independent from runtime launch order.
5. Treat operator launch as a routing decision: main seek, main reorder, parallel spawn, or copy spawn.
6. Keep playback focus as intent, not as cursor.
7. Keep edit focus as editing state, not as runtime state.
8. Keep scene state instance-aware internally, but provide a stable canonical summary to list/flow UI.
9. Temporarily disable broken auto-follow branches and restore them automatically after graph repair.
10. Keep renderer projection flattened so audio/display systems do not need to understand authoring graph details.
11. Keep Patch timeline and Stream timeline separate.

## Implementation Milestones

### Milestone 1: Thread Planner

- Add a shared thread derivation module using the backward ownership plus forward branch algorithm.
- Resolve implicit auto-trigger predecessors.
- Produce canonical threads, branches, local scene offsets, longest branch, temporarily disabled branch state, and validation issues.
- Add tests for root detection, branching, missing predecessors, temporary branch disable/restore, cycles, and disabled scenes.

### Milestone 2: Main Timeline Composer

- Compose default main timeline from canonical manual-rooted threads.
- Exclude at-timecode-rooted threads from main timeline duration.
- Preserve existing scene/sub-cue duration calculation.
- Add segment metadata for rail rendering.
- Add per-thread proportion data for header rail segmentation.
- Keep compatibility with edit/playback timeline promotion.

### Milestone 3: Runtime Timeline Instances

- Introduce timeline and thread-instance runtime state.
- Keep a flattened active sub-cue projection.
- Port current single-timeline behaviors into the main timeline instance.

### Milestone 4: Launch Router

- Implement the case matrix.
- Make Run from here call the same logic as playback-focus Play.
- Implement forward seek inside already-running main and parallel thread instances.
- Add tests for reset launch, paused serial reorder, running parallel spawn, completed thread relaunch, same-thread relaunch, running-thread forward seek, and at-timecode roots.

### Milestone 5: Pause, Resume, Seek, Reset

- Implement global pause across active timelines.
- Implement configurable multi-timeline resume behavior.
- Implement Back to first clearing additional timelines.
- Implement main rail seek against latest ordered main timeline.
- Implement configurable parallel-timeline seek behavior.

### Milestone 6: List And Header Thread UI

- Expose derived thread membership and colors.
- Add the maintained Morandi-like thread color palette.
- Render list row thread shading.
- Render row progress bars in the owning thread's bright color.
- Render Scene Edit scene pills with the owning thread shade.
- Render segmented main timeline rail.
- Ensure header rail background and foreground both preserve thread segment proportions.

### Milestone 7: Flow Mode

- Integrate Rete.js as the Flow editing/view layer.
- Render custom Xtream scene cards with previews, focus styling, state styling, progress, hover actions, and context menu.
- Render virtual auto-trigger links and missing-reference warning stubs.
- Implement denser grid, pan, zoom, fit/reset, drag, resize, add-on-right, and empty-space add.
- Implement default thread layout, branch layout, root-drag whole-thread movement, and non-root single-card movement.
- Place at-timecode rooted threads above or below the main flow at their relative timecode position.
- Render the dotted main timeline curve through longest branches and animate progress glow while playing.

### Milestone 8: Gantt Runtime Monitor

- Add Gantt as the third Stream view beside List and Flow.
- Render view-only timeline lanes for main and parallel timelines.
- Show thread instance bars, copied-instance markers, per-lane cursors, paused/running states, and launch order.
- Keep styling consistent with the rest of Xtream.

## Testing Benchmark

Tests should cover:

- thread root derivation from `manual` and `at-timecode`
- auto-trigger scenes attach to the correct thread
- multiple auto followers create branches
- thread duration is longest branch
- missing predecessor branches become temporarily disabled and restore after repair
- disabled scenes remain visible and dimmed
- default main timeline orders manual-rooted threads by root scene order
- at-timecode-rooted threads are excluded from default main timeline duration
- at-timecode-rooted threads trigger from main timeline timecode in current mode
- launching later thread from reset does not mark earlier detached threads skipped
- launching a middle scene marks earlier same-thread scenes skipped
- paused manual-tail Play starts immediate next thread without reorder
- paused manual-tail launch of non-immediate thread reorders without changing total duration
- running main launch of unplayed later thread spawns parallel timeline and removes that thread from main
- following unplayed threads move forward on main after a thread is removed
- completed thread relaunch creates copy timeline
- same-thread earlier relaunch creates copy timeline
- same-thread later launch while running seeks that running instance forward
- already-running parallel thread later launch seeks that parallel timeline forward and leaves main intact
- global pause freezes all active timelines
- multi-timeline Play resumes all clocks by default
- Back to first clears parallel timelines and restores default main timeline
- main rail seek uses latest main timeline order
- main rail seek leaves parallel timelines running by default
- follow-relative seek applies main seek delta to parallel timelines with clamping
- `at-timecode` warning appears when authoring timecode trigger
- canonical scene state summary defaults to last instance
- auto-pause playback focus advances to the next ready manually triggered root scene in List mode order
- successful launch updates playback focus to the last launched scene by List mode relative position
- list rows, row progress, and scene edit pills use thread colors
- header timeline rail renders dim and bright segmented thread colors with matching proportions
- Flow cards render thread-colored metadata, focus styles, state styles, previews, progress, hover actions, and context menus
- Flow default layout places main threads left-to-right, centers longest branches, and places at-timecode side threads by relative timecode
- Flow dotted main curve passes through longest branches and animates glow during playback
- Gantt renders main and parallel timelines as view-only lanes with thread instance bars
- Patch playback behavior is unchanged

## Open Questions

None currently. Future UI/UX details for Flow and Gantt can extend this document without changing the core thread/timeline mechanism.
