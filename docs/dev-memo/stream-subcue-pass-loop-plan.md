# Stream sub-cue pass and loop mechanism plan

Date: 2026-05-08

## Goal

Decouple audio and finite-video visual sub-cue pass count from inner loop behavior.

Today, audio sub-cues and video visual sub-cues use one `SceneLoopPolicy` field named `loop`. In the waveform/video lane editors, "Play times" writes a counted loop policy over the whole selected source range, and the "Infinite Loop/Infinite Render" button writes the same field with infinite iterations. This makes the pass count, loop range, and infinite state mutually exclusive.

The new model needs two independent layers:

- Pass: how many times the selected main source range is performed. The current "Play times" control becomes this. It accepts integer values greater than or equal to 1, or an infinity toggle.
- Loop: an optional range inside each pass, repeated after the first pass-through of that loop range. The new "Loop time" control accepts integers greater than or equal to 0, defaulting to 0, or an infinity toggle.

For a selected source range of `10s..40s` with an inner loop range of `20s..30s`:

- `pass=1`, `loop=0` has duration `30s`.
- `pass=1`, `loop=1` has duration `40s`: play `10..30`, replay `20..30` once, then play `30..40`.
- `pass=2`, `loop=3` has duration `(30 + 10 * 3) * 2 = 120s`. Loop time means extra repeats after the first natural traversal of the loop range, so `loop=3` adds three more `20s..30s` traversals inside each pass.
- `pass=infinity`, `loop=3` repeats finite passes forever, with fades per pass.
- `pass=1`, `loop=infinity` plays up to the loop end once, jumps back to loop start, then stays inside the inner loop forever.
- `pass>1` with `loop=infinity` is invalid and should be auto-normalized to `pass=1`.
- `pass=infinity` and `loop=infinity` is invalid. Toggling one infinity disables or clears the other.

## Current architecture

Relevant files found during investigation:

- `src/shared/types.ts`
  - `SceneLoopPolicy` is a generic enabled/range/iterations policy.
  - `PersistedAudioSubCueConfig.loop?: SceneLoopPolicy` and `PersistedVisualSubCueConfig.loop?: SceneLoopPolicy` use it for sub-cue looping.
  - Runtime sub-cues carry `localEndMs` and `mediaLoop?: LoopState`.
- `src/shared/streamLoopTiming.ts`
  - `resolveLoopTiming(policy, naturalDurationMs)` currently expands one policy into total duration and phase mapping.
  - Its counted policy currently behaves like "start at loopStart and then play loop duration * count"; it does not represent a pass plus extra inner repeats.
- `src/shared/audioSubCueAutomation.ts` and `src/shared/visualSubCueTiming.ts`
  - Base sub-cue duration means selected source range duration after playback rate and optional `durationOverrideMs`.
- `src/shared/streamSchedule/durations.ts`
  - Scene duration estimates use base sub-cue duration, expand via `resolveLoopTiming`, then scene loops are applied.
  - Infinite sub-cue loops classify the owning scene/thread as `indefinite-loop`.
- `src/main/streamEngine.ts`
  - `collectActiveSubCues` gets scene phase, expands each sub-cue with `resolveLoopTiming`, and emits runtime audio/visual cue objects.
  - Runtime media looping is represented by `mediaLoop?: LoopState` and projected into renderer state.
  - Fades are currently attached to the one active runtime cue and evaluated by local elapsed time.
- `src/renderer/streamProjection.ts`
  - Runtime audio/visual cues are cloned into `DirectorState`, including runtime source ranges, offsets, fades, and `runtimeLoop`.
- `src/renderer/control/media/audioRuntime.ts`
  - `getRuntimeAudioTarget` maps director time into media time, respecting `runtimeLoop`.
  - Preview playback also maps local time through `resolveLoopTiming`.
- `src/renderer/display.ts`
  - Visual preview and display video playback use the same loop timing helpers.
- `src/renderer/control/stream/sceneEdit/audioSubCueWaveformEditor.ts`
  - "Play times" and "Infinite Loop" both write `sub.loop`.
  - The canvas currently supports source range edges and fade handles, but no inner loop handles.
- `src/renderer/control/stream/sceneEdit/visualSubCuePreviewLaneEditor.ts`
  - Finite video visuals mirror audio behavior.
  - Images/live visuals use `durationOverrideMs` plus "Infinite Render"; they are out of scope unless product decides to rename that UI too.
- `src/renderer/control/stream/sceneEdit/audioWaveformGeometry.ts` and `visualPreviewLaneGeometry.ts`
  - Hit testing knows range edges and top fade handles only. New bottom loop handles belong here.
- `src/shared/subCueTimingLink.ts`
  - Linked visual/audio timing currently syncs the `loop` field. This must be expanded for the new pass and inner-loop fields.
- `src/shared/streamWorkspace.ts` and `src/main/showConfig.ts`
  - Stream persistence normalization and show schema migration are the right places to normalize legacy `loop` into the new fields.

## Data model

Add sub-cue-specific timing types instead of overloading `SceneLoopPolicy` further:

```ts
export type PassIterations = { type: 'count'; count: number } | { type: 'infinite' }; // count >= 1
export type LoopIterations = { type: 'count'; count: number } | { type: 'infinite' }; // count >= 0

export type SubCuePassPolicy = {
  iterations: PassIterations;
};

export type SubCueInnerLoopPolicy =
  | { enabled: false }
  | {
      enabled: true;
      range: { startMs: number; endMs: number };
      iterations: LoopIterations; // counted value means extra repeats after first traversal
    };
```

Recommended persisted fields:

```ts
pass?: SubCuePassPolicy;
innerLoop?: SubCueInnerLoopPolicy;
```

Because `loop` is already used by scenes and old sub-cues, there are two reasonable paths:

1. Cleaner schema: rename sub-cue loop to `innerLoop?: SubCueInnerLoopPolicy` and add `pass?: SubCuePassPolicy`, keeping scene `loop: SceneLoopPolicy` unchanged.
2. Lower churn: keep sub-cue `loop` but change its type to `SubCueInnerLoopPolicy`, and add `pass`.

I recommend option 1 (`pass` + `innerLoop`) because it avoids ambiguity with scene loops, `LoopState`, and old `SceneLoopPolicy`. The implementation can still accept legacy sub-cue `loop?: SceneLoopPolicy` during migration/normalization.

Normalized defaults:

- Missing `pass` means `{ iterations: { type: 'count', count: 1 } }`.
- Missing `innerLoop`, disabled inner loop, or counted loop `count=0` means no inner loop expansion.
- `innerLoop.range` is clamped inside the selected main source range expressed as local pass time. If source range is `sourceStartMs..sourceEndMs`, an authored inner loop of `20s..30s` can be stored as local pass times `10s..20s`, or as absolute source times. I recommend local pass times for consistency with fades/automation and easier selected-range edits.
- If source range changes, clamp the inner loop into the new selected range; if it collapses below the minimum span, disable it.
- If `innerLoop.iterations.type === 'infinite'`, normalize `pass` to count 1.
- If `pass.iterations.type === 'infinite'`, disallow or clear inner-loop infinity.

Migration from legacy sub-cue `loop?: SceneLoopPolicy`:

- Legacy disabled/missing loop -> `pass=count 1`, `innerLoop=disabled`.
- Legacy counted loop without a custom range -> `pass=count legacy.count`, `innerLoop=disabled`. This preserves current "Play times" behavior for existing shows.
- Legacy infinite loop without a custom range -> `pass=infinite`, `innerLoop=disabled`. This preserves current "Infinite Loop" behavior as pass infinity.
- Legacy counted loop with custom range -> ambiguous. Preserve playback closest to old behavior by setting `pass=count 1`, `innerLoop.range=legacy.range`, and `innerLoop.count=max(0, legacy.count - 1)` if old semantics counted total loop traversals. If existing custom-range UI was not broadly used, add a migration warning in dev notes/tests.
- Legacy infinite loop with custom range -> `pass=count 1`, `innerLoop.range=legacy.range`, `innerLoop=infinite`.

This likely requires a show schema bump from v9 to v10, plus idempotent loose normalization for hand-edited v9 files.

## Timing helper architecture

Create a new shared module, for example `src/shared/subCuePassLoopTiming.ts`, and keep `streamLoopTiming.ts` for scene-level loops.

Core helper shape:

```ts
type SubCuePassLoopTiming = {
  baseDurationMs: number;
  passDurationMs?: number;
  totalDurationMs?: number;
  pass: PassIterations;
  innerLoop: NormalizedInnerLoop;
};
```

Rules:

- `baseDurationMs` is the selected main range duration after playback rate and duration override.
- Counted inner-loop duration is `baseDurationMs + loopDurationMs * loopExtraCount`.
- No loop range or `loopExtraCount=0` gives `passDurationMs = baseDurationMs`.
- Counted pass total is `passDurationMs * passCount`.
- Infinite pass gives `totalDurationMs = undefined`, `classification = indefinite-loop`.
- Infinite inner loop gives `totalDurationMs = undefined`, but its active local phase never exits the inner loop after reaching the loop end.
- Fade and automation local time must be pass-local, not total-subcue-local, so each pass has its own fade in/out envelope.

Required mapping helpers:

- `resolveSubCuePassLoopTiming(subTiming, baseDurationMs)`.
- `isElapsedWithinSubCueTotal(elapsedMs, timing)`.
- `mapElapsedToSubCuePassPhase(elapsedMs, timing)` returning:
  - `passIndex`
  - `passElapsedMs`
  - `mediaElapsedMs`
  - `phaseZeroElapsedMs`
  - `insideInfiniteInnerLoop`
- `mapPassElapsedToMediaElapsed(passElapsedMs, timing)` for previews/display/audio.
- `subCueDurationClassification(timing)` for schedule and thread planning.

Important distinction:

- `passElapsedMs` drives fade and automation.
- `mediaElapsedMs` drives actual source media position.
- `phaseZeroElapsedMs` or a runtime pass id should drive projection keys so the runtime restarts fade envelopes at each pass.

## Runtime integration

Update `src/main/streamEngine.ts` so active sub-cue collection is pass-aware:

- Replace `resolveLoopTiming(sub.loop, baseDurationMs)` with `resolveSubCuePassLoopTiming(sub.pass, sub.innerLoop, baseDurationMs)`.
- Use `isElapsedWithinSubCueTotal` to decide whether the sub-cue is active.
- Use `mapElapsedToSubCuePassPhase` to compute:
  - current pass index
  - local pass start in stream time
  - pass-local fade/automation time
  - media loop state only when useful for renderer native looping
- Set runtime cue `streamStartMs` to the current pass start for finite repeated passes so existing fade evaluation restarts per pass.
- Add runtime fields if needed:
  - `passIndex?: number`
  - `passLocalStartMs?: number`
  - `mediaPhaseStartMs?: number`
  - `innerLoop?: RuntimeSubCueInnerLoop`
- Avoid relying only on `mediaLoop?: LoopState` for counted inner loops. `LoopState` represents indefinite media wrapping, not "repeat exactly N extra times then exit." Counted inner loops need explicit local-time-to-media-time mapping.

Recommended renderer payload change:

- Add a compact runtime timing object to `StreamRuntimeAudioSubCue`, `StreamRuntimeVisualSubCue`, `AudioSubCuePreviewPayload`, and `VisualSubCuePreviewPayload`, for example:

```ts
subCueTiming?: {
  pass: PassIterations;
  innerLoop?: {
    range: { startMs: number; endMs: number };
    iterations: LoopIterations;
  };
  baseDurationMs: number;
};
```

Then `audioRuntime.ts`, `display.ts`, and preview code can call the same shared mapping helper instead of inferring behavior from `LoopState`.

Fades:

- For finite pass repeats, each pass should create a distinct active cue with `streamStartMs` equal to that pass start, or pass-local time should be passed directly into fade evaluation.
- For `pass=infinity`, repeat the same finite pass forever and keep fade-in/out per pass.
- For `innerLoop=infinity`, fade-in occurs only while entering the first pass. Fade-out should not occur because the pass never reaches its end.

Automation:

- Level and pan automation are currently authored over selected range duration. Treat automation like fades: evaluate against pass-local media timeline, not total elapsed time.
- For an inner loop, automation points inside the loop range repeat with the looped media. Automation points after loop end are unreachable when the inner loop is infinite.

## Preview integration

Audio preview:

- `buildAudioSubCuePreviewPayload` should include `pass` and `innerLoop`.
- `getAudioSubCuePreviewPlayTimeMs` should use the new timing helper. It should be undefined for either infinite pass or infinite inner loop.
- `getPreviewSourceMsForLocalMs` should map preview local time through pass/loop timing and return selected source start plus `mediaElapsedMs * playbackRate`.
- `syncPreviewAutomation` should evaluate fades and automation with pass-local elapsed time, not total local time.

Visual preview:

- `buildVisualSubCuePreviewPayload` should include `pass` and `innerLoop`.
- `sourceTimeMsForVisualPreview`, `effectiveVisualPreviewDurationMs`, and `updateVisualPreviewTime` should use the new timing helper.
- The preview lane playhead for video files should show source/media position, while any optional elapsed counter should represent total preview elapsed.

## Display and audio projection

`src/renderer/streamProjection.ts` currently projects runtime cues into cloned media with:

- `durationSeconds: cue.localEndMs / 1000`
- `runtimeOffsetSeconds`
- `runtimeSourceStartSeconds`
- `runtimeSourceEndSeconds`
- `runtimeLoop`
- fade fields on output selections/layers

That works for simple source trimming and indefinite media looping, but not enough for counted inner loops. Add runtime pass/loop timing to projected audio and visual clones, or pre-split counted passes/inner loops into renderer-friendly segments.

Recommendation:

- For finite counted pass/loop combinations, let `streamEngine` emit one active cue per current pass, and let renderers compute exact media time via the shared mapper. This avoids pre-scheduling many short runtime cue segments.
- For `innerLoop=infinity`, emit one cue with undefined `localEndMs` or with timing metadata that marks it indefinite.
- Keep `mediaLoop` only as an optimization for native full-range infinite loops. Do not make it the source of truth for the new mechanism.

## Scene, thread, and stream duration compatibility

Duration calculation must remain layered:

1. Source selected range and playback rate produce `baseDurationMs`.
2. Sub-cue pass/inner-loop timing produces `subCueEffectiveDurationMs`.
3. Scene pass duration is the max of `subCue.startOffsetMs + subCueEffectiveDurationMs`.
4. Scene-level `SceneLoopPolicy` still expands scene duration.
5. Thread planning classifies any infinite sub-cue pass or inner loop as `indefinite-loop`, same as today, so infinite-loop side threads continue to detach from the main timeline.
6. Main stream expected duration and `activeTimeline.loopRangeLimit` continue using finite main timeline duration and excluding detached infinite-loop threads.

Update these files:

- `src/shared/streamSchedule/durations.ts`
  - Replace sub-cue loop expansion with the new helper.
  - Keep scene loop expansion unchanged.
- `src/shared/streamThreadPlan.ts` and `src/shared/streamSchedule/buildSchedule.ts`
  - Confirm their `indefinite-loop` logic still consumes classification from `classifySceneDurationMs`, requiring minimal changes if `durations.ts` owns classification.
- `src/renderer/control/stream/ganttProjection.ts` and output Gantt projection tests
  - Ensure finite pass/loop expansion changes displayed bars, while infinite sub-cues remain detached/indefinite.

Backwards compatibility:

- Existing shows with play times count should keep the same total duration.
- Existing shows with infinite sub-cue loop should still become indefinite side timelines.
- Patch compatibility scene loops are scene-level loops and should not move to sub-cue pass/inner-loop.

## UI/UX plan

Shared control:

- Build a reusable half-toggle/half-input control, for example `createInfinityNumberToggle`.
- Left half toggles infinity. Right/input half edits a whole number.
- When infinity is active, render an infinity icon in the input area, disable numeric editing, and expose `aria-pressed`.
- Use lucide icon if available; otherwise render the text symbol through CSS/icon helper. The persisted value remains structured data, not a string.

Audio waveform editor:

- Replace current `Play times` draggable number + separate `Infinite Loop` button with:
  - `Pass time`: min 1, default 1, infinity toggle.
  - `Loop time`: min 0, default 0, infinity toggle.
- Keep delay, pitch, and rate controls.
- Add bottom loop handles in whitish color on the waveform canvas:
  - Handles live at bottom, visually opposite top fade handles.
  - Start/end are clamped inside the selected main source range.
  - If no loop range is selected, the handles can be hidden until loop time is greater than 0 or until the user drags from a bottom affordance. Recommended: show faint bottom handles at selected range boundaries when hovering or when loop time is active.
  - Dragging selected range edges clamps existing loop range.
- Add hit targets to `AudioWaveformHitTarget`: `loop-start`, `loop-end`, maybe `loop-body`.
- Draw loop region after range fill but before automation/playhead so it remains visible without hiding waveform content.

Visual video lane editor:

- For finite video visuals, mirror the audio controls:
  - `Pass time`
  - `Loop time`
  - bottom whitish loop handles bounded inside the main video source range
- Keep image/live controls as `Duration`/`Infinite Render` unless product decides pass/loop semantics should apply there too.
- Add hit targets to `VisualPreviewLaneHitTarget`: `loop-start`, `loop-end`, maybe `loop-body`.
- Add CSS classes near current lane overlay styles for bottom handles, loop region, hover/active states, and disabled state.

Interlocks:

- Toggling pass infinity disables loop infinity.
- Toggling loop infinity sets pass to count 1 and disables pass infinity.
- If loop infinity is active, pass numeric input is fixed at 1.
- Loop time count 0 means inner loop disabled even if a loop handle range exists; the range can remain persisted for convenience, but playback ignores it.
- If no valid loop handle range exists and loop time is set above 0/infinity, initialize a default loop range inside the selected range, e.g. middle third or full selected range minus a small minimum span.

Copy:

- Use "Pass time" and "Loop time" if matching the user request exactly.
- Consider "Passes" and "Loop repeats" if later user testing suggests less ambiguity, but keep the data model names `pass` and `innerLoop`.

## Validation and normalization

Add validation messages in `src/shared/streamSchedule/contentValidation.ts`:

- Pass count must be integer >= 1.
- Loop count must be integer >= 0.
- Inner loop range must have `endMs > startMs`.
- Inner loop range must sit inside selected source range/base pass duration.
- Pass infinity and loop infinity cannot both be active.
- Loop infinity requires pass count 1.

Normalization in `normalizeStreamPersistence`:

- Round counts to integers.
- Clamp counts to min values.
- Clamp loop range to base selected duration when source duration is known; otherwise clamp non-negative and let runtime validate when metadata arrives.
- Convert impossible infinity combinations using the interlock rules above.

## Testing plan

Shared timing tests:

- `pass=1`, no loop -> total base duration.
- `pass=2`, no loop -> total `base * 2`; pass phase resets fade local time.
- `pass=infinity`, no loop -> indefinite; phase wraps every base duration.
- `pass=1`, `loop=0` with range -> same as no loop.
- `pass=1`, `loop=1` -> total `base + loopDuration`.
- `pass=2`, `loop=3` -> total `(base + loopDuration * 3) * 2`; counted loop values are extra repeats after the first natural traversal.
- `pass=1`, `loop=infinity` -> indefinite and source phase stays inside loop after loop end.
- Invalid infinity combinations normalize as specified.

Schedule tests:

- Existing legacy play-times fixtures still produce same durations after migration.
- Finite pass plus finite inner loop expands scene and stream duration.
- Infinite pass and infinite inner loop classify as `indefinite-loop` and detach from main timeline.
- Scene-level loop still wraps the already-expanded sub-cue pass duration.

Runtime tests:

- `collectActiveSubCues` restarts audio/visual fades on each pass.
- Counted inner loops exit to post-loop tail after the requested extra repeats.
- `loop=infinity` keeps pass fixed at 1 and never reaches fade-out.
- Seeking into pass 2 or into a counted inner loop produces the expected media source time.
- Orphan/fade-out behavior still works when stopping a scene mid-pass or mid-loop.

Preview/UI DOM tests:

- Audio and visual controls render the two half-toggle/half-input components.
- Pass infinity disables loop infinity; loop infinity fixes pass to 1.
- Loop time default is 0.
- Dragging bottom loop handles commits `innerLoop.range`.
- Dragging source range edges clamps loop handles.
- Existing timing link tests include `pass` and `innerLoop`.

Renderer tests:

- Audio preview source mapping matches examples B1-B6.
- Visual preview source mapping matches examples B1-B6.
- Fade gain is evaluated per pass, not across total expanded duration.
- Display runtime maps counted inner loop source time without relying on native `LoopState`.

## Implementation phases

1. Add shared types, normalization, and pure timing helpers.

   Scope:
   - Add `SubCuePassPolicy`, `SubCueInnerLoopPolicy`, `PassIterations`, and `LoopIterations` in `src/shared/types.ts`.
   - Add a new shared timing module, recommended name `src/shared/subCuePassLoopTiming.ts`.
   - Keep scene-level `SceneLoopPolicy` and `src/shared/streamLoopTiming.ts` unchanged except for imports or naming cleanup required by the new helper.
   - Define one canonical meaning for counted loop values: loop count is extra repeats after the first natural traversal.
   - Add normalization helpers for pass count, inner-loop count, infinity interlocks, and loop-range clamping.

   Deliverables:
   - A pure `resolveSubCuePassLoopTiming` helper that returns base duration, pass duration, total duration, normalized pass policy, and normalized inner loop.
   - A pure `mapElapsedToSubCuePassPhase` helper that returns pass index, pass-local elapsed time, media elapsed time, and whether playback is trapped in an infinite inner loop.
   - A pure `isElapsedWithinSubCueTotal` helper for active-cue checks.
   - Unit tests covering A1-A3 and B1-B8 using the exact example values from this memo.

   QA standard:
   - Timing helper tests must not touch DOM, Electron, or renderer state.
   - Boundary tests must include elapsed values exactly at pass start, loop start, loop end, pass end, and total end.
   - Infinite cases must never return a finite total duration.
   - Counted cases must return exact integer millisecond totals, including B4 as `120000ms`.
   - Existing scene loop tests in `src/shared/streamLoopTiming.test.ts` and stream schedule tests must continue to pass without changing scene-loop semantics.

2. Add migration, persistence normalization, and validation.

   Scope:
   - Decide whether this lands as schema v10 or as v9 loose normalization. Prefer schema v10 because persisted sub-cue `loop` changes meaning.
   - Migrate legacy audio/visual sub-cue `loop?: SceneLoopPolicy` into `pass` and `innerLoop`.
   - Preserve patch compatibility scene loops as scene-level loops.
   - Update `normalizeStreamPersistence` to normalize new pass/inner-loop fields on every load.
   - Update `contentValidation.ts` to report invalid pass counts, loop counts, impossible infinity combinations, and loop ranges outside the selected pass range.

   Deliverables:
   - Migration tests showing old "Play times" count becomes `pass=count N` with no inner loop.
   - Migration tests showing old full-range infinite sub-cue loop becomes `pass=infinite` with no inner loop.
   - Migration tests for old custom-range loops using the compatibility mapping described in this memo.
   - Validation messages with scene and sub-cue labels consistent with current Stream validation output.

   QA standard:
   - `assertShowConfig(JSON.parse(JSON.stringify(migrated)))` must round-trip migrated shows.
   - Loading an already-normalized file must be idempotent: repeated `normalizeStreamPersistence` calls cannot keep rewriting counts, ranges, or infinity states.
   - Invalid persisted combinations must be either normalized deterministically or reported as validation errors, never silently interpreted differently in runtime and schedule code.
   - Existing v7-v9 migration tests must still pass, and any schema support message must name the new supported schema range.

3. Update duration, schedule, thread, and Gantt calculations.

   Scope:
   - Replace sub-cue duration expansion in `src/shared/streamSchedule/durations.ts` with the new pass/inner-loop timing helper.
   - Keep scene-level duration expansion on `SceneLoopPolicy`.
   - Ensure thread planning still treats infinite sub-cue pass or infinite inner loop as `indefinite-loop`.
   - Update Gantt projections and labels only where they rely on sub-cue effective duration.

   Deliverables:
   - Schedule tests for finite pass repeats, finite inner-loop repeats, pass infinity, and inner-loop infinity.
   - Tests proving scene-level loops wrap the expanded sub-cue pass duration rather than the raw source duration.
   - Gantt/output projection tests updated to reflect expanded finite durations and unchanged detached infinite-loop behavior.

   QA standard:
   - Main stream expected duration must include finite pass and finite inner-loop expansion.
   - Main stream expected duration must exclude detached infinite-loop side threads as it does today.
   - `activeTimeline.loopRangeLimit` must continue to use the finite active timeline span and must not stretch to infinity.
   - Existing manual/follow/timecode thread tests must pass without unrelated expectation churn.

4. Update Stream runtime activation and renderer projection contracts.

   Scope:
   - Update `src/main/streamEngine.ts` to collect active audio/visual sub-cues using pass/inner-loop phase mapping.
   - Add runtime timing metadata to `StreamRuntimeAudioSubCue` and `StreamRuntimeVisualSubCue`, or add equivalent projected fields that let renderers map total elapsed time to media time.
   - Keep `mediaLoop?: LoopState` only as a full-range infinite-loop optimization.
   - Ensure pass-local fade and automation evaluation restart on each pass.
   - Preserve orphaned cue fade-out behavior when scenes are stopped mid-pass or mid-loop.

   Deliverables:
   - Runtime tests for active cue presence across pass boundaries.
   - Runtime tests for seeking into a later pass and into each portion of a counted inner loop: pre-loop head, repeated loop body, and post-loop tail.
   - Runtime tests proving fade-in/fade-out occur once per finite pass, not once across the expanded total.
   - Updated public runtime types and projection code in `src/renderer/streamProjection.ts`.

   QA standard:
   - Runtime projection keys must remain stable during a pass, but must change or carry pass identity when a new pass starts so fades and media starts do not smear across passes.
   - Counted inner loops must exit to the post-loop tail at the exact expected local time.
   - `innerLoop=infinity` must never emit or evaluate a fade-out based on a fictional finite pass end.
   - Parallel timelines and detached infinite-loop threads must still keep distinct runtime instance identities.

5. Update audio renderer, display renderer, and preview timing consumers.

   Scope:
   - Update `audioRuntime.ts` so `getRuntimeAudioTarget`, preview source mapping, preview stop timers, fades, and automation use pass/inner-loop timing metadata.
   - Update `display.ts` so visual preview and display video source mapping use the same shared mapper.
   - Update `buildAudioSubCuePreviewPayload` and `buildVisualSubCuePreviewPayload` to include pass/inner-loop timing metadata and expanded finite play time.
   - Keep native media element looping disabled for counted inner loops; use explicit source-time mapping.

   Deliverables:
   - Audio preview tests for examples B1-B6.
   - Visual preview tests for examples B1-B6.
   - Renderer tests proving counted inner loop playback does not rely on `HTMLMediaElement.loop`.
   - Drift/sync behavior remains compatible with runtime source start/end and playback rate.

   QA standard:
   - Preview playhead source time must match the media position, including jumps back to loop start.
   - Preview local elapsed time must remain monotonic even when source time jumps.
   - Audio and visual preview stop timers must stop at finite expanded totals and never arm for either infinity mode.
   - Playback rate must be applied exactly once in source mapping for audio and visual video.

6. Update editors, controls, and lane geometry.

   Scope:
   - Build a reusable half-toggle/half-input infinity number control.
   - Replace audio and finite-video visual "Play times" plus "Infinite Loop" with "Pass time" and "Loop time".
   - Add bottom loop handles and loop region rendering to `audioWaveformGeometry.ts`, `audioSubCueWaveformEditor.ts`, `visualPreviewLaneGeometry.ts`, and `visualSubCuePreviewLaneEditor.ts`.
   - Keep existing top fade handles, selected source range handles, automation controls, freeze marker, delay, pitch, and playback rate behavior.
   - Update CSS for whitish loop handles, active/hover states, disabled states, and mobile/narrow layouts.

   Deliverables:
   - DOM tests for the infinity number control and interlocks.
   - DOM tests for audio loop-handle drag/commit and source-range clamping.
   - DOM tests for visual video loop-handle drag/commit and source-range clamping.
   - Updated snapshots or DOM assertions for the visual preview lane control layout.

   QA standard:
   - Pass input accepts only integers >= 1 or infinity.
   - Loop input accepts only integers >= 0 or infinity.
   - Toggling loop infinity sets pass to count 1 and disables pass infinity.
   - Toggling pass infinity clears or disables loop infinity.
   - Loop handles cannot be dragged outside the selected main source range.
   - Text, buttons, and handles must not overlap at current supported desktop widths; verify with a browser screenshot when running the app is practical.

7. Update timing links and cross-subcue editing behavior.

   Scope:
   - Update `src/shared/subCueTimingLink.ts` so linked embedded audio/visual timing includes `pass` and `innerLoop`.
   - Ensure linked timing patches preserve existing visual/audio differences such as targets, output routing, pitch, freeze marker, and media kind.
   - Update live preview coupling between audio waveform and linked visual lane so both previews seek through the same expanded pass/loop timeline.

   Deliverables:
   - Unit tests for `audioTimingPatchToVisual`, `visualTimingPatchToAudio`, and `pickLinkedTimingFields`.
   - DOM tests proving linked visual/audio edits propagate pass count, loop count, infinity state, and loop range.
   - Preview tests or integration-style tests proving linked audio and visual previews stay aligned after seeking into a counted inner loop.

   QA standard:
   - Linking must not drop unrelated authored fields.
   - Linking must not create invalid infinity combinations; interlock normalization must run before emitting patches.
   - A linked pair with the same selected source range and timing metadata must report the same local elapsed and equivalent source phase during preview.

8. Add end-to-end regression coverage and manual QA checklist.

   Scope:
   - Consolidate new tests into focused suites first, then run the broader project suites.
   - Manually verify the Stream workspace UI for one audio sub-cue and one finite-video visual sub-cue.
   - Record any known limitations or deferred UI polish in `docs/dev-memo` or follow-up issues before shipping.

   Deliverables:
   - Focused test command list in the implementation PR description or dev notes.
   - Manual QA checklist covering A1-A3 and B1-B8 for audio and finite video.
   - Screenshots or notes for the waveform and video lane with visible bottom loop handles.
   - Release note draft for the user-facing changelog once implementation is complete.

   QA standard:
   - `npm run typecheck` passes.
   - Focused Vitest suites for shared timing, schedule, stream runtime, audio preview, visual preview, and editor DOM behavior pass.
   - `npm test` passes before merge unless an unrelated flaky failure is documented with evidence.
   - Manual QA confirms: finite totals, infinite interlocks, pass-local fades, counted loop exit, infinite inner-loop hold, seek behavior, linked timing, and scene/thread duration display.
   - No existing Patch compatibility scene behavior regresses.

## Settled behavior

Loop time is an extra-repeat count. A loop time of `0` disables inner-loop expansion, a loop time of `1` replays the selected loop range once after its first natural traversal, and a loop time of `3` replays that range three additional times before exiting to the pass tail. Therefore B4 is `(One Pass: 30 + 10 * 3) * 2 = 120s`.

## Phase 6-8 implementation notes

Focused verification commands:

- `npm run typecheck`
- `npm test -- --run src/renderer/control/stream/sceneEdit/audioSubCueWaveformEditor.dom.test.ts src/renderer/control/stream/sceneEdit/visualSubCuePreviewLaneEditor.dom.test.ts src/renderer/control/stream/sceneEdit/audioWaveformGeometry.test.ts src/renderer/control/stream/sceneEdit/visualPreviewLaneGeometry.test.ts src/shared/subCueTimingLink.test.ts`

Manual QA checklist:

- Audio sub-cue shows `Pass time` and `Loop time`; pass accepts integers >= 1 or infinity, loop accepts integers >= 0 or infinity.
- Finite-video visual sub-cue shows the same controls; image and live visuals still use `Duration` and `Infinite Render`.
- Toggling loop infinity sets pass to count 1 and disables pass infinity while loop infinity remains active.
- Toggling pass infinity clears loop infinity and keeps any finite loop range available for later reuse.
- Bottom loop handles render inside the selected source range and cannot drag outside it.
- Moving source range edges clamps the authored inner-loop range.
- Audio and linked finite-video visual timing patches propagate `pass`, `innerLoop`, loop count, loop infinity, and loop range.
- Preview seeking into A1-A3 and B1-B8 cases keeps audio and finite-video source phase aligned with the expanded pass/loop timeline.

Release note draft:

- Stream audio sub-cues and finite video visual sub-cues now separate whole-range pass count from inner loop repeats. Use `Pass time` for how many times the selected source range plays and `Loop time` for optional repeats inside each pass, including infinity interlocks that prevent invalid infinite combinations.
