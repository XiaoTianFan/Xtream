# Stream Model

Stream is Xtream's scene-programming model. It describes how scenes, triggers, sub-cues, threads, timelines, and output projection work together during authored playback.

## Stream

A Stream is the show graph saved inside the show project. It contains ordered scenes, scene relationships, Flow layout, playback preferences, and cue data.

Persistence: saved in the show file.

## Scene

A scene is a programmed moment. It has a title, note, enabled state, trigger, preload lead time, loop policy, and sub-cues.

Persistence: saved in the show file.

## Trigger

A trigger decides when a scene starts. The main user-facing trigger types are manual, follow-start, follow-end, and timecode.

Persistence: saved in the show file.

Related task: [Program scene triggers](../tasks/program-scene-triggers.md).

## Sub-Cue

A sub-cue is work performed inside a scene.

Audio sub-cues play audio sources through virtual outputs. Visual sub-cues target displays and zones. Control sub-cues automate scene transport, audio cue values, global audio mute, or display blackout.

Persistence: saved in the show file.

Related tasks:

- [Edit audio sub-cues](../tasks/edit-audio-sub-cues.md)
- [Edit visual sub-cues](../tasks/edit-visual-sub-cues.md)
- [Use control sub-cues](../tasks/use-control-sub-cues.md)

## Thread

A thread is an independent running branch of Stream playback. Thread-based playback lets manual starts, follow chains, skipped scenes, loops, and parallel branches run without consuming or flattening unrelated scene paths.

Scope: runtime behavior derived from the saved Stream.

## Timeline Instance

A timeline instance is one visible running or reviewable timeline in Stream. The main timeline is the primary show path. Parallel and side timelines can appear when scenes branch, manual roots are launched, or loops run beside the main path.

Scope: runtime and review state. The underlying scenes and triggers are saved; active timeline instances are session behavior.

## Playback Focus

Playback focus is what is currently driving live output. Double-clicking a scene in List or Flow can move playback focus depending on the playback context.

Scope: runtime/session state.

## Edit Focus

Edit focus is what the operator is currently adjusting. It can differ from playback focus so you can edit one scene while another scene is live.

Scope: UI/session state.

## Runtime Scene States

Scenes can appear ready, running, complete, paused, blocked, degraded, disabled, or error-like depending on authoring and runtime state. Validation errors can show even while the timeline is idle so broken scenes do not look healthy just because playback has not started.

Scope: derived from saved Stream, media readiness, and runtime state.

## Main And Parallel Timelines

The main timeline is the primary path through the show. Parallel timelines come from branches, manual starts, or side loops. Infinite manual loops can run beside the main timeline without stretching the main duration.

Review complex shows in Gantt mode to see these timelines clearly.

## Related Pages

- [Stream workspace](../workspaces/stream.md)
- [Build Stream scenes](../tasks/build-stream-scenes.md)
- [Program scene triggers](../tasks/program-scene-triggers.md)
- [Triggers, loops, and time](triggers-loops-and-time.md)

