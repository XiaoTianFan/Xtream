# Config And Diagnostics

Config is the workspace for runtime overview, show and playback settings, display composition, diagnostics, and the session log.

Use it when the show is not ready, media is missing, displays are unhealthy, Stream validation is blocked, audio routing is uncertain, or support needs a diagnostics export.

## When To Use It

Use Config when you need to:

- Check runtime version and readiness.
- Review topology and show state.
- Change show-level playback settings.
- Review display composition behavior.
- Review app-local settings.
- Inspect diagnostics for Patch, Stream, displays, media, and audio routing.
- Export diagnostics or clear the session log.

## Overview

The Overview tab summarizes the running Xtream environment. It can include runtime version, readiness, topology, and app-local settings.

Use Overview at the start of a session to confirm the workstation is in the expected state before deeper troubleshooting.

## Show And Playback

The Show and playback tab is for show-level behavior such as global audio mute fade, display blackout fade, Stream playback preferences, and display composition settings.

These settings affect how the show behaves when saved and reopened. They are different from session-only safety button states.

## Diagnostics

The Diagnostics tab is the troubleshooting surface. It centers on:

- Patch readiness.
- Stream validation.
- Display telemetry.
- Audio routing state.
- Media validation.
- Session/activity log.

Use Diagnostics before changing the show. It often tells you whether the issue is missing media, invalid Stream authoring, unavailable audio hardware, a display problem, or an expected standby state.

## Session Log

The session log records meaningful runtime events for the current session. Recent logging includes clearer entries for manual seeks, drift correction seeks, scene state changes, readiness checkpoints, and transport activity.

Use the log to answer "what happened?" after an unexpected output change.

## Export Diagnostics

Use **Export diagnostics** when you need to send support information or preserve a troubleshooting snapshot. The export can include runtime version, app version, platform, current state, readiness, media validation, and session log details.

Export diagnostics before restarting the app if the current session contains useful evidence.

## Clear Log

Use **Clear log** when you want a clean rehearsal or troubleshooting pass. Clearing the log affects the current session log view; it does not fix show data.

## Machine-Local Settings And Show Settings

Machine-local settings stay with the workstation. Examples include performance mode, embedded audio extraction format, and control display preview frame rate.

Show settings stay with the show project. Examples include audio mute fade, display blackout fade, Stream playback preferences, and display composition settings.

## Common Problems

**Diagnostics shows missing media.** Use **Relink media...** from the footer or the relink flow.

**Stream is blocked.** Open the Stream workspace and fix the highlighted scene or sub-cue validation errors.

**Displays are unhealthy.** Check display windows, monitor assignment, fullscreen state, blackout, and display telemetry.

**Audio output fallback appears.** Refresh outputs, reconnect the device, or choose an available physical output.

## Related Pages

- [Run and cue a show](../tasks/run-and-cue-a-show.md)
- [Save, open, and relink shows](../tasks/save-open-and-relink-shows.md)
- [Export diagnostics](../tasks/export-diagnostics.md)
- [Diagnostics and readiness](../reference/diagnostics-and-readiness.md)
- [Settings reference](../reference/settings-reference.md)

