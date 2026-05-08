# Route Audio Outputs

Virtual outputs are show-level audio buses. Use them to combine audio sources, control levels, pan, mute, solo, delay, meter output, and choose physical destinations.

## When To Use It

Use this task when you need audio playback, a routed mix, a delayed output, a specific audio interface destination, or a quick sound check.

## Before You Start

- Import at least one audio source.
- Connect the audio interface or output device if you need physical routing.
- Open Patch.

## Steps

1. In **Audio Mixer**, choose **Create Output**.
2. Select the output strip to open Output Details.
3. Rename the output if helpful.
4. Add audio to the output by dragging an audio pool item onto the output strip, or by using the output source controls in details.
5. Choose a **Physical output**. Leave **System default output** for a quick test.
6. Adjust bus level.
7. Adjust each source row level and pan.
8. Use mute and solo to isolate or silence sources.
9. Set **Delay Offset (ms)** if the output needs time alignment.
10. Press **Play** in Patch or run Stream playback that routes to the output.
11. Watch the meters.

## Virtual Output Basics

A virtual output is saved with the show project. It can contain multiple source rows. Each source row points to an audio source and has its own level, pan, mute, and solo behavior.

The physical output setting tells the workstation where to send that virtual output. Availability depends on the operating system, browser audio APIs, Electron, and connected devices. If the requested physical route is unavailable, Xtream reports fallback state in the UI.

## Mute And Solo

Use source mute to silence one row. Use bus mute to silence an output. Use solo to isolate one or more sources or outputs while checking a mix. Use **Clear Solo** in the footer when you are done.

Global audio mute in the footer affects live output as a safety action. It is separate from editing a bus or source row.

## Output Delay

Output delay is set in milliseconds. Use it to align audio to displays, rooms, or capture systems. Delay is part of the output configuration and is saved with the show.

## What You Should See

- The output strip appears in the Audio Mixer.
- Routed source rows appear under the output or in Output Details.
- Meters move during playback.
- The selected physical output label reflects the target device or system default.

## Common Problems

**No meters move.** Check that playback is running and an audio source is routed to the output.

**Meters move but no sound is heard.** Check physical output selection, system volume, output mute, source mute, solo state, and global audio mute.

**The physical output is not available.** Use **Refresh Outputs** in the footer, reconnect the device, or choose the system default output.

**Only one output device seems active.** The workstation may not expose per-output routing support. Check diagnostics for fallback state.

## Related Pages

- [Patch workspace](../workspaces/patch.md)
- [Import media](import-media.md)
- [Audio routing reference](../reference/audio-routing-reference.md)
- [Diagnostics and readiness](../reference/diagnostics-and-readiness.md)

