# Run And Cue A Show

Use this guide when the show is built and you need to operate it live.

## When To Use It

Use this task for playback checks, rehearsals, and live operation. It covers Patch transport, Stream transport, playback focus, manual scenes, timelines, rate adjustment, and global safety actions.

## Before You Start

- Save the show.
- Resolve missing media.
- Confirm display windows are open and assigned to the correct monitors.
- Confirm virtual outputs are routed to the intended physical devices.
- Review Stream validation and Patch readiness in the footer.
- Rehearse global audio mute and display blackout behavior with the team.

## Patch Transport Or Stream Transport

Use **Patch transport** for standalone static scenes and direct routed playback. Patch playback follows the current Patch routing surface.

Use **Stream transport** for programmed scene playback. Stream playback runs scenes, triggers, sub-cues, manual branches, loops, and automation.

Avoid treating the two transports as interchangeable. If Stream playback is active, Patch playback can be gated so both systems do not fight over live output.

## Stream Transport

Stream transport is used for authored show flow. Common live actions include:

- Play.
- Pause.
- Back to first.
- Next.
- Start a manual scene.
- Scrub timeline position.
- Adjust playback rate.

The live state chip and scene states tell you whether Stream is standby, live, paused, blocked, or otherwise waiting for action.

## Playback Focus And Edit Focus

Playback focus is what is on air. Edit focus is what you are currently adjusting. They can be different.

This matters during live operation. You can inspect or edit a scene while a different scene is driving output. When you intentionally move playback, confirm the highlighted live scene or live state before assuming output changed.

## Running Manual Scenes

Manual scenes are operator boundaries. When the show reaches a manual scene, it may wait for you instead of drifting forward. Start manual scenes intentionally from List or Flow when the cue is called.

Manual roots and side timelines can run beside the main Stream timeline. Gantt mode is the best way to review which timelines are active.

## Side Timelines And Parallel Branches

Stream can run side timelines, loops, and parallel branches as independent threads. This lets ambience loops, manual inserts, and follow-start branches run while the main show continues.

During live operation:

- Watch the live state chip.
- Review Gantt when timing feels unclear.
- Stop or remove side timelines only when you are sure they are no longer needed.
- Use scene notes to document manual branches.

## Timeline Scrubbing And Rate

Use scrubbing for rehearsal, troubleshooting, and controlled repositioning. Scrubbing during a show can create abrupt output changes, so use it carefully.

Rate adjustment changes playback speed. Test rate changes in rehearsal, especially if audio pitch, visual playback rate, automation, or follow timing are important.

## Paused Global Play Behavior

When playback is paused, the next play action should be understood in context: it may resume the current Stream timeline rather than starting from the beginning. If you need a clean start, use the explicit reset or back-to-first behavior first.

## Safety Actions

Global audio mute and display blackout live in the footer. They affect current session output and can use configured fades.

Use them for safety, room resets, or emergency silence/blackout. Remember that Stream control sub-cues can also toggle these actions, so rehearse any automated safety changes.

## What You Should See

- The footer shows no blocking readiness issues.
- Stream scene state reflects live playback accurately.
- Gantt shows active main and side timelines.
- Meters move on intended outputs.
- Displays show the expected Patch or Stream projection.
- Session log entries appear for meaningful transport and runtime events.

## Common Problems

**Play does not start.** Check validation, readiness, missing media, disabled scenes, and whether the target scene is manual or blocked.

**The wrong scene is live.** Check playback focus versus edit focus. Use List, Flow, or Gantt to confirm what is driving output.

**A side loop keeps running.** Locate the side timeline in Gantt and stop or resolve it through the intended scene/control path.

**Output goes black or silent.** Check global display blackout, global audio mute, scene control sub-cues, display targets, output routing, mute, and solo.

**Timing drifts or jumps.** Check session log entries for seeks or drift correction, then review media duration, loops, playback rate, and output delay.

## Related Pages

- [Stream workspace](../workspaces/stream.md)
- [Program scene triggers](program-scene-triggers.md)
- [Use control sub-cues](use-control-sub-cues.md)
- [Config and diagnostics](../workspaces/config-and-diagnostics.md)
- [Diagnostics and readiness](../reference/diagnostics-and-readiness.md)

