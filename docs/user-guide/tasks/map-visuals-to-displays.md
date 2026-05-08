# Map Visuals To Displays

Use visual mapping to decide which visual appears on which display or display zone.

## When To Use It

Use this task when you need to route visuals in Patch, target displays from Stream, work with split display zones, review layered visual behavior, or use global display blackout.

## Before You Start

- Import or create the visual sources you need.
- Create display windows.
- Choose single or split display layouts.
- Confirm display windows are on the intended monitors.

## Patch Display Mapping

Patch mapping is direct. Drag a visual from the media pool onto a display preview.

For a single display, drop onto the single preview zone. For a split display, drop onto the left or right zone. Dropping onto a zone assigns or replaces only that zone.

Patch mapping is best for standalone static aesthetic scenes and simple routed playback.

## Stream Visual Targets

Stream visual sub-cues target displays and zones as part of scene playback. Use Stream targets when visuals should appear according to scene timing, triggers, loops, fades, freeze frames, or automation.

Stream playback projects visual layers onto displays. This can temporarily override or layer over what you see from direct Patch mapping, depending on display composition settings and current runtime state.

## Split Display Targeting

Split displays have left and right zones. Name and identify displays before showtime so operators know which side is being targeted.

When a visual is missing from one side of a split display, confirm whether the cue or Patch mapping targets that side specifically.

## Visual Mingle And Layering

Display composition settings control how multiple visual layers combine. Options include latest, alpha-over, additive, multiply, screen, lighten, darken, and crossfade.

Use the default or simplest composition mode unless the show intentionally needs layered visuals. More complex blend behavior should be tested on the actual display hardware.

## Conflict Behavior

Conflicts usually happen when more than one source wants the same display or zone. Check:

- Whether Patch mapping is still active.
- Whether Stream playback is projecting visual layers.
- Whether multiple Stream visual sub-cues target the same zone.
- Which visual mingle mode is active.
- Whether display blackout is active.

Use Gantt and display details to understand which Stream cue is active.

## Global Display Blackout

Display blackout is a live safety control in the footer. It affects display output for the current session and can use configured fade timing. Stream control sub-cues can also toggle blackout.

If everything is black, check blackout before changing display mapping.

## What You Should See

- Patch display previews show assigned visuals.
- Split displays show separate left and right zones.
- Stream visual sub-cues show selected display or zone targets.
- Display output follows Patch or Stream based on the active playback mode.

## Common Problems

**A visual appears on the wrong display.** Check display identity, monitor assignment, and the selected display target.

**Only half of a split display updates.** Check whether the left or right zone was targeted.

**A Stream visual does not appear.** Check scene playback, visual sub-cue target, display health, media readiness, fade timing, and blackout.

**Layering looks wrong.** Review display composition mode and active visual layers.

## Related Pages

- [Create and manage displays](create-and-manage-displays.md)
- [Edit visual sub-cues](edit-visual-sub-cues.md)
- [Display composition reference](../reference/display-composition-reference.md)
- [Run and cue a show](run-and-cue-a-show.md)

