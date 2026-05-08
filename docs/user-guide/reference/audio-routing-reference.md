# Audio Routing Reference

Audio routing controls how audio sources reach virtual outputs and physical devices.

## Short Definition

An audio source is media in the show. A virtual output is a show-level bus. A physical output is the workstation device used to hear that bus.

## Audio Source Kinds

Audio sources can come from:

- Imported audio files.
- Extracted embedded audio from video files.
- Stereo sources split into separate mono sources where supported.
- Stream-projected audio sub-cues during Stream playback.

## Embedded Visual Audio

Videos can contain embedded audio. Xtream can extract that audio into a separate project audio source so it can be routed, trimmed, mixed, and used in Stream like other audio.

The extraction format setting is machine-local.

## Channel Mode And Split Stereo

Stereo audio can be used as a normal stereo source or split into separate left and right mono-style sources when the show needs channel-specific routing.

Use split stereo when different channels need different outputs, levels, or timing.

## Virtual Output Source Selection

A virtual output can contain one or more source rows. Each row chooses an audio source and has its own level, pan, mute, and solo behavior.

Stream audio sub-cues also route through virtual outputs so Patch and Stream share the same output bus model.

## Bus Level And Source Level

Bus level controls the whole virtual output. Source level controls one routed source row or cue contribution.

When troubleshooting silence, check both levels.

## Pan

Pan places the source across the left/right field of the output. Treat pan as an operator-facing mix control, not a guarantee of a specific loudspeaker unless the physical output path is configured that way.

## Output Delay

Output delay is set in milliseconds on a virtual output. Use it to align audio with displays, rooms, or capture systems.

Delay is saved with the show output configuration.

## Mute And Solo

Mute silences a source row or output. Solo isolates selected sources or outputs. Use **Clear Solo** in the footer before a show if you are unsure whether solo is active.

Global audio mute is separate. It is a live safety control for the current session.

## Physical Routing Availability

Physical output routing depends on the workstation, operating system, connected devices, and browser/Electron audio support. If Xtream cannot route to the requested device, it can report fallback state.

Refresh outputs after connecting, disconnecting, or renaming audio devices.

## Fallback States

Fallback means Xtream could not use the requested physical route and is using a safer available behavior, often the system default output. Diagnostics should explain why a fallback happened where possible.

Common causes include:

- Device unplugged.
- Only one output device available.
- API support unavailable.
- Duplicate or missing device selection.

## Related Tasks

- [Route audio outputs](../tasks/route-audio-outputs.md)
- [Edit audio sub-cues](../tasks/edit-audio-sub-cues.md)
- [Run and cue a show](../tasks/run-and-cue-a-show.md)
- [Diagnostics and readiness](diagnostics-and-readiness.md)

