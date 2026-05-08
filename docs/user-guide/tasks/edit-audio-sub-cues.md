# Edit Audio Sub-Cues

Audio sub-cues play audio sources through virtual outputs during Stream playback.

## When To Use It

Use this task when a scene needs audio playback, output routing, trimming, fades, pitch shift, automation, looping, mute, solo, or audition preview.

## Before You Start

- Import an audio source.
- Create the virtual output that should receive the audio.
- Confirm the audio source has valid metadata.
- Select or create the scene that should contain the cue.

## Steps

1. Open Stream.
2. Select a scene.
3. Add an audio sub-cue, or drag an audio pool item onto the scene row or Flow card.
4. Select the audio source.
5. Route the cue to one or more virtual outputs.
6. Set start offset so the cue begins at the right time inside the scene.
7. Use the waveform editor to set source start and source end trim.
8. Set base level and pan.
9. Add fade in and fade out if needed.
10. Draw level or pan automation curves when values need to change over time.
11. Set pitch shift when the sound should change pitch without treating it as a simple output level change.
12. Set loop policy if the cue should repeat.
13. Use audition preview to check the cue before running the full scene.
14. Fix validation messages before showtime.

## Waveform Editor

The waveform editor is the main audio editing surface. Use it to review the source, trim the playable range, audition the cue, edit fades, and draw automation. Recent versions reuse cached waveform data when returning to cues, reducing unnecessary pending states.

## Source Range And Timing

Source start and source end trim choose the portion of the media file that the cue can play. Start offset controls when that trimmed cue begins inside the scene. Duration behavior then depends on trim length, playback rate, pitch behavior, loop policy, and any duration override available in the cue design.

Use source trim to remove silence or isolate a phrase. Use start offset to place the cue in the scene.

## Levels, Pan, Mute, And Solo

Base dB sets the cue level. Pan sets left/right placement. Mute and solo work with Patch-style output behavior so Stream audio remains understandable from the mixer.

Global audio mute is separate. It is a live safety action, not an edit to the sub-cue.

## Automation

Audio sub-cues support level and pan automation curves. Use automation when values should move during playback instead of staying fixed for the whole cue.

Automation is evaluated as part of Stream playback. Keep curves simple enough to read during troubleshooting.

## Fades

Fade in and fade out shape the cue edges. Invalid fades can become validation errors, especially when fade timing exceeds or conflicts with the cue duration.

## Pitch Shift And Playback Rate

Pitch shift changes the sound's pitch behavior. Playback timing and source ranges still matter for when the cue appears on the Stream timeline. Test pitch-shifted cues in context, especially if follow-end timing depends on the cue duration.

## Loop Policy

Use loop policy when the audio sub-cue should repeat. A looped sub-cue can affect scene duration and follow-end timing. Infinite loops should be used intentionally, especially in side timelines.

## What You Should See

- The waveform shows the selected source.
- Trim handles or range controls define the playable source region.
- Output routing points to the intended virtual outputs.
- Automation curves show on the waveform when enabled.
- Meters move on the routed output during playback or audition.

## Common Problems

**No waveform appears.** The audio source may still be probing, missing, or unsupported.

**The cue plays on the wrong output.** Check output routing on the sub-cue and the virtual output's physical device in Patch.

**The cue is silent.** Check source mute, cue level, output mute, solo state, global audio mute, and whether the source range contains audio.

**Follow timing is unexpected.** Check source trim, pitch behavior, playback rate, loop policy, fades, and duration assumptions.

## Related Pages

- [Route audio outputs](route-audio-outputs.md)
- [Build Stream scenes](build-stream-scenes.md)
- [Program scene triggers](program-scene-triggers.md)
- [Audio routing reference](../reference/audio-routing-reference.md)
- [Triggers, loops, and time](../reference/triggers-loops-and-time.md)

