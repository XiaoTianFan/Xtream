# Patch Workspace

Patch is the operator console for building the live routing surface of a show and for running standalone static aesthetic scenes. Use it when simple playback needs customized visual and audio routing without the full Stream scene-programming workflow.

## When To Use It

Use Patch when you need to:

- Build a standalone static scene that routes visuals and audio directly.
- Run simple playback without programming Stream scenes.
- Bring media into a show.
- Create display windows for monitors or projectors.
- Map visuals directly to displays.
- Create and test virtual audio outputs.
- Play, pause, stop, loop, or scrub simple Patch playback.
- Check media, display, and output details.

## Main Areas

**Header.** The Patch header contains the Patch transport, timecode, timeline scrubber, playback rate, show save/open/create actions, and live state chip.

**Media Pool.** The media pool has Visuals and Audio tabs, search, sorting, visual list/grid views, and the **Add Media** action. Visuals can include files or live capture sources. Audio sources can include imported audio files or extracted embedded audio from video.

**Display Windows.** This panel lists display windows. Use **Add** to create a display. Each display can be single-zone or split left/right, and each zone can receive a visual.

**Audio Mixer.** The mixer lists virtual outputs. Use **Create Output** to add a bus, then add source rows, choose physical routing, and watch meters.

**Details.** The details panel changes with selection. It can show Patch Summary, Display Details, Output Details, visual details, or audio source details.

**Status Footer.** The footer is global. It shows shared issues and gives quick access to relinking, clearing solo, global audio mute, display blackout, display labels, output refresh, and theme switching.

## Media Pool

Choose **Add Media** to import files or add live visual sources. You can also drag supported files into the media pool.

When importing files, Xtream asks whether to link or copy:

- **Link originals** keeps files in their current location. Moving or renaming them later can create missing-media issues.
- **Copy into project** stores media under the show project, usually in `assets/visuals` or `assets/audio`.

Video files may also offer embedded audio extraction. Extracted audio becomes a project audio source.

## Display Windows

Create a display with **Add**. Select it to adjust details:

- Layout: single or split.
- Fullscreen.
- Always on top.
- Monitor assignment.
- Display health and telemetry.
- Visual mapping.

You can drag a visual pool item directly onto a display preview. In a split display, drop onto the left or right zone.

## Audio Mixer

Create a virtual output with **Create Output**. Select an output to edit:

- Label.
- Physical output device.
- Output delay.
- Source rows.
- Bus level.
- Source level.
- Pan.
- Mute and solo.
- Test tone.
- Remove output.

You can drag audio pool items onto output strips. Invalid drops are rejected.

## Transport

Patch transport controls direct Patch playback, including standalone static scenes built from Patch routing. Stream has its own transport for programmed scene playback. If Stream playback is active, Patch playback may be gated so the two systems do not fight over live output.

## What Is Saved

Saved in the show project:

- Media pool records.
- Display windows and show-level display settings.
- Visual mapping.
- Virtual outputs and routing.
- Show-level playback and composition settings.

Machine-local or session behavior:

- Some app settings, such as performance mode and preview frame-rate preferences.
- Global audio mute and display blackout as live safety actions.
- Current runtime health and telemetry.

## Common Problems

**A linked file is missing.** Use **Relink media...** from the footer.

**A display is blank.** Check whether a visual is assigned, the display is open, blackout is off, and display health is ready.

**Meters move but no sound is heard.** Check physical output selection, system audio device availability, bus mute, source mute, solo state, and global audio mute.

**Live capture does not appear.** Check capture permissions and whether the selected camera, screen, region, or application window is available.

## Related Pages

- [First show](../getting-started/first-show.md)
- [Import media](../tasks/import-media.md)
- [Create and manage displays](../tasks/create-and-manage-displays.md)
- [Route audio outputs](../tasks/route-audio-outputs.md)
- [Config and diagnostics](config-and-diagnostics.md)
