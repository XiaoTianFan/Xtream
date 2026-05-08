# Export Diagnostics

Diagnostics export captures a support snapshot of the current Xtream session.

## When To Use It

Export diagnostics when:

- A show opens incorrectly.
- Media is missing or relink behaves unexpectedly.
- Stream validation blocks playback and the cause is unclear.
- Displays are blank, unhealthy, or assigned incorrectly.
- Audio routing falls back or meters do not match what you hear.
- Playback timing jumps, drifts, or seeks unexpectedly.
- You need to send support information with session context.

## Before You Start

- Keep the app open after the issue occurs.
- Do not clear the session log before exporting.
- Reproduce the problem once if it is safe to do so.
- Note what you expected and what happened.

## Steps

1. Open Config.
2. Go to the diagnostics or session log area.
3. Choose **Export diagnostics**.
4. Save the export where you can find it.
5. Include the export with a short description of the problem.

## What Is Included

The export is intended to include support-relevant information such as:

- Runtime version.
- App version.
- Platform.
- Current show and runtime state.
- Readiness issues.
- Media validation.
- Stream validation.
- Display telemetry.
- Audio routing state.
- Session log entries.

It is a troubleshooting snapshot, not a replacement for the show project folder.

## Session Log

The session log appears in Config. It can record launch/open activity, readiness checkpoints, transport events, manual seeks, drift correction seeks, and scene state changes. These entries help explain what happened before an issue appeared.

## Reading Common Issue Categories

**Media validation** points to missing, unreadable, or unprobed media.

**Stream validation** points to scene and sub-cue authoring problems.

**Display telemetry** points to display window, zone, preview, and output health.

**Audio routing state** points to virtual outputs, physical outputs, fallback, meters, mute, or solo behavior.

**Readiness** summarizes whether the show is ready, blocked, degraded, standby, or live.

## Common Problems

**The export misses the interesting event.** Reproduce the issue and export before clearing the log or restarting.

**Support also asks for the show.** Send the show project folder separately if requested. Diagnostics export does not replace media files.

**The problem disappeared after restart.** Export from the next session if it happens again, and include notes about the restart.

## Related Pages

- [Config and diagnostics](../workspaces/config-and-diagnostics.md)
- [Diagnostics and readiness](../reference/diagnostics-and-readiness.md)
- [Save, open, and relink shows](save-open-and-relink-shows.md)
- [Run and cue a show](run-and-cue-a-show.md)

