# Triggers, Loops, And Time

This reference explains how Stream starts scenes and calculates time. Use it when Gantt timing, follow behavior, loops, or cue durations do not match what you expected.

## Trigger Types

**Manual.** Starts only when the operator starts the scene. Manual scenes are boundaries and should not auto-start as a side effect of an earlier scene.

**Follow-start.** Starts relative to another scene's start. Use it for parallel or layered scene behavior.

**Follow-end.** Starts relative to another scene's end. Use it for sequential scene chains.

**Timecode.** Starts from timecode behavior. Verify external timecode setup and rehearsal behavior before depending on it live.

## Delay

Delay offsets the trigger point. A delayed follow-start scene waits after its parent starts. A delayed follow-end scene waits after its parent ends.

Persistence: saved in the scene trigger.

## Scene Loop Policy

Scene loop policy repeats the entire scene. It affects scene duration, follow-end timing, and Gantt projection.

Use scene loops when the whole scene structure should repeat. Use sub-cue loops when only one media item should repeat inside a scene.

## Sub-Cue Loop Policy

Sub-cue loop policy repeats an individual audio or visual cue. It can create longer cue duration than the source media's natural duration.

Infinite loops should be used intentionally. They can run well as manual side timelines, but they can confuse follow timing if they are placed in a path that expects a finite end.

## Finite Duration

Finite duration means Stream can calculate when the scene or cue ends. Videos and audio sources usually have finite duration after metadata is available. Trims, playback rate, pitch behavior, loop counts, and duration overrides can change effective duration.

## Indefinite Loop

An indefinite loop keeps running until stopped or replaced by show logic. Indefinite loops are useful for ambience, holds, and operator-controlled side timelines.

## Unknown Or Error Duration

Unknown duration means Stream cannot confidently calculate timing. This can happen when media metadata is missing, a live visual or image does not have a duration, or a cue has invalid timing. Unknown or error duration can create validation warnings or block reliable follow-end behavior.

## Audio Source Range

Audio sub-cues can trim source start and source end in the waveform editor. Stream playback respects this playable range, along with pitch shift, fade timing, loop policy, and automation data.

Use source range for media-file content. Use start offset for placement inside the scene.

Related task: [Edit audio sub-cues](../tasks/edit-audio-sub-cues.md).

## Visual Source Range

Visual sub-cues can trim source start and source end for video sources. Stream playback, preview duration, validation, and schedule timing respect the trimmed portion.

Related task: [Edit visual sub-cues](../tasks/edit-visual-sub-cues.md).

## Visual Duration Semantics

**Video.** Duration usually comes from media metadata, then is adjusted by source range, playback rate, loop policy, and duration override.

**Image.** Images do not have a natural end. Set duration or loop policy so Stream knows how long the image should remain active.

**Live visual.** Live visuals do not have a natural end. Set duration or loop policy. Live visuals can also use freeze behavior, where a canvas frame is captured and held.

## Fades And Time

Audio and visual fades must fit the cue timing. A fade that exceeds the playable span can produce validation messages. Global audio mute and display blackout also have show-level fade settings.

## Gantt Review

Use Gantt mode when timing is unclear. It shows scene threads, main and parallel timelines, cue spans, and loops in one review surface.

## Related Pages

- [Program scene triggers](../tasks/program-scene-triggers.md)
- [Build Stream scenes](../tasks/build-stream-scenes.md)
- [Stream model](stream-model.md)
- [Run and cue a show](../tasks/run-and-cue-a-show.md)

