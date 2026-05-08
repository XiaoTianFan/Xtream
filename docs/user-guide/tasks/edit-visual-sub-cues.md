# Edit Visual Sub-Cues

Visual sub-cues send visuals to display windows and zones during Stream playback.

## When To Use It

Use this task when a scene needs video, image, or live visual output with display targets, source trimming, playback rate, fades, freeze frames, loops, or preview review.

## Before You Start

- Import a visual source or add a live visual source.
- Create the display windows and zones you need.
- Confirm the visual source has valid metadata, or set duration values for image and live sources where required.
- Select or create the scene that should contain the cue.

## Steps

1. Open Stream.
2. Select a scene.
3. Add a visual sub-cue, or drag a visual pool item onto the scene row or Flow card.
4. Select the visual source.
5. Choose display and zone targets.
6. Set start offset so the cue begins at the right time inside the scene.
7. Use the preview lane to play, pause, seek, and review the selected visual range.
8. Set source start and source end trim for video sources when only part of the file should play.
9. Set duration override when the cue needs a specific length.
10. Set playback rate when the visual should run faster or slower.
11. Set loop policy if the visual should repeat.
12. Add fade in and fade out.
13. Add or remove a freeze frame when the cue should hold a selected frame.
14. Fix validation messages before showtime.

## Preview Lane

The visual sub-cue editor uses a preview-centered lane. Use it to review the selected range, seek through media, check fade feedback, and place or remove freeze markers. Preview commands can report which display outputs received the preview and which were missing, which helps when several displays are involved.

Recent versions reuse preview thumbnail cache data when returning to cues, so the editor should feel steadier while you move between sub-cues.

## Display And Zone Targets

A visual sub-cue must target at least one display or display zone. Single displays have one target. Split displays have left and right zones.

If a cue targets a missing display, a missing zone, or no target at all, Stream can warn or block playback depending on severity.

## Source Range And Duration

Video visuals can use source start and source end trim. Stream playback, preview duration, validation, and schedule timing all respect the trimmed portion of the media.

Images and live visual sources may need explicit duration because they do not naturally end like a normal video clip. Without a duration or loop policy, Stream may not be able to calculate follow timing.

## Fades And Opacity

Fade in and fade out affect visual opacity in display layers. Invalid fade timing can create validation messages. Keep fade durations shorter than the playable cue span unless you are intentionally designing a long transition.

## Freeze Frames

Freeze frames let a visual hold at a selected media frame.

For file video, freeze holds the selected frame from the media. For live visuals, freeze captures a canvas frame so the output can hold the current live image. Validate freeze points carefully: an invalid freeze marker or missing source frame can prevent the cue from behaving as expected.

## Loop Policy

Use loop policy when a video, image, or live source should repeat or remain active. Loop choices affect Stream timing and follow behavior, especially in side timelines or manual loops.

## What You Should See

- The visual appears in the preview lane.
- Display and zone targets are selected.
- Trimmed video ranges affect preview and timeline duration.
- Fade feedback appears in the lane.
- Freeze markers appear where a frame should hold.
- Display output receives preview when targets are available.

## Common Problems

**The cue has no output.** Select a display or zone target and confirm the display window exists.

**An image or live visual has invalid timing.** Add a duration or use an intentional loop policy.

**The fade is invalid.** Shorten fade in or fade out, or lengthen the cue.

**The freeze frame is invalid.** Move the freeze marker inside the playable source range or remove it.

**Preview reaches only some displays.** Check display availability and target zones. Use diagnostics if a display is missing or unhealthy.

## Related Pages

- [Create and manage displays](create-and-manage-displays.md)
- [Map visuals to displays](map-visuals-to-displays.md)
- [Build Stream scenes](build-stream-scenes.md)
- [Triggers, loops, and time](../reference/triggers-loops-and-time.md)
- [Display composition reference](../reference/display-composition-reference.md)

