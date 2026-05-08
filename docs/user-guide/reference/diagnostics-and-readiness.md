# Diagnostics And Readiness

Diagnostics explain whether Xtream is ready to play and where to look when it is not.

## Readiness Terms

**Ready** means the relevant part of the show appears usable.

**Blocked** means an issue prevents reliable operation. Fix blocked issues before showtime.

**Degraded** means operation may continue, but something is missing, falling back, or not ideal.

**Standby** means the runtime is not currently live.

**Live** means playback or output activity is currently running.

## Patch Readiness

Patch readiness covers direct routed playback, media pool state, display windows, virtual outputs, and mixer behavior.

Common Patch issues include missing media, no display assignment, display blackout, unavailable physical output devices, muted outputs, solo state, and output fallback.

Related pages:

- [Patch workspace](../workspaces/patch.md)
- [Route audio outputs](../tasks/route-audio-outputs.md)
- [Create and manage displays](../tasks/create-and-manage-displays.md)

## Stream Validation

Stream validation covers scene structure and sub-cue authoring. It can report problems even while playback is idle.

Common Stream issues include missing scene targets, invalid trigger relationships, disabled scenes in expected paths, missing audio or visual sources, missing outputs, missing display targets, invalid fade timing, invalid freeze points, and missing duration for image or live visual cues.

Validation messages should use scene titles and sub-cue positions when possible, making them suitable for operators rather than only developers.

Related pages:

- [Stream workspace](../workspaces/stream.md)
- [Build Stream scenes](../tasks/build-stream-scenes.md)
- [Program scene triggers](../tasks/program-scene-triggers.md)

## Display Telemetry

Display telemetry describes display window health, monitor assignment, preview readiness, display zones, and output behavior.

Use it when a display is blank, on the wrong monitor, not previewing, not receiving Stream preview commands, or not reflecting the expected visual layer.

## Audio Routing State

Audio routing state describes virtual outputs, source rows, meters, physical output availability, and fallback behavior.

Use it when meters move but no sound is heard, sound comes from the wrong device, output selection fails, or solo/mute state is confusing.

## Media Validation

Media validation reports whether visual and audio sources are available and usable. Missing linked files, failed metadata probing, unsupported files, and unavailable live sources can all appear here.

Use **Relink media...** when media paths are broken.

## Session Log Checkpoint Categories

The session log can include:

- Show open and create activity.
- Readiness checkpoints.
- Transport activity.
- Manual seeks.
- Drift correction seeks.
- Scene state changes.
- Display or audio routing events.

Use the log to reconstruct a session after something unexpected happens.

## Scope

Readiness and diagnostics are mostly runtime/session state. Some fixes change the show file, such as relinking media, editing Stream cues, changing display settings, or changing output routing. Other actions are session-only, such as clearing the log or toggling global mute.

## Related Tasks

- [Run and cue a show](../tasks/run-and-cue-a-show.md)
- [Export diagnostics](../tasks/export-diagnostics.md)
- [Save, open, and relink shows](../tasks/save-open-and-relink-shows.md)
- [Config and diagnostics](../workspaces/config-and-diagnostics.md)

