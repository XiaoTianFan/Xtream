# Build Stream Scenes

Use Stream scenes to turn media, routing, timing, and automation into a programmed show.

## When To Use It

Use this task when a show needs more than a standalone Patch scene: ordered scenes, manual cue points, follow behavior, side timelines, loops, sub-cues, or automation.

## Before You Start

- Import the audio and visual media you need.
- Create display windows and virtual audio outputs in Patch.
- Fix missing media and output readiness issues before building complex scenes.
- Decide which moments should be manual and which should follow automatically.

## Steps

1. Open Stream.
2. Choose List mode for ordered editing, or Flow mode if you want to arrange scene relationships visually.
3. Create a scene.
4. Give the scene a clear title. Add a note if an operator needs context.
5. Set whether the scene is enabled.
6. Choose the scene trigger behavior. Use manual for operator-started moments.
7. Set preload lead time if the scene needs media prepared before it starts.
8. Set scene loop policy if the whole scene should repeat.
9. Add audio, visual, or control sub-cues.
10. To create media sub-cues quickly, drag an audio or visual pool item onto a scene row in List mode or a scene card in Flow mode.
11. Fix validation warnings or errors before relying on playback.
12. Save the show.

## Scene Structure

A scene is a programmed moment. It can contain:

- Audio sub-cues for source playback and output routing.
- Visual sub-cues for display and zone targeting.
- Control sub-cues for transport, global safety actions, and audio automation.

Scenes can be duplicated, removed, enabled, or disabled. Removing a scene should be treated as a structural edit because downstream follow relationships and manual paths may change.

## Scene Title And Note

Use scene titles as operator-facing labels. Validation messages and workspace highlights use scene titles where possible, so clear titles make troubleshooting faster.

Use notes for show-calling context, setup reminders, or cues that are not obvious from the media names.

## Preload Lead Time

Preload lead time tells Stream how early to prepare scene media. Increase it for heavy visuals, large files, or scenes that need reliable starts under show pressure.

## Scene Loop Policy

Scene loop policy controls whether the full scene repeats. Use scene loops for repeated scene structures. Use sub-cue loops when only one media item should repeat inside a scene.

## Validation

Stream validates both scene structure and sub-cue content. Common authoring problems include:

- Missing audio source.
- Missing visual source.
- Missing virtual output.
- Missing display or zone target.
- Invalid trigger relationship.
- Invalid fade or freeze timing.
- Missing duration for image or live visual cues.
- Disabled scenes that are still expected by follow relationships.

Scenes with problems can show error state in List mode, Flow cards, scene pills, and sub-cue rows.

## What You Should See

- New scenes appear in List mode and Flow mode.
- Dragged media creates a matching sub-cue and selects it for editing.
- Scene state reflects authoring errors while idle and runtime state during playback.
- Gantt mode can show how the scene fits into timelines once timing is valid.

## Common Problems

**A scene will not play.** Check whether it is enabled, whether its trigger is reachable, and whether blocking validation errors remain.

**A dragged media item created the wrong type of cue.** Confirm whether the pool item is in the Audio or Visual tab.

**A follow scene starts earlier or later than expected.** Review trigger type, delay, source media duration, scene loop policy, and sub-cue loop policy.

**A manual scene does not auto-start.** Manual scenes are operator boundaries. Start them directly when the show reaches that point.

## Related Pages

- [Stream workspace](../workspaces/stream.md)
- [Program scene triggers](program-scene-triggers.md)
- [Edit audio sub-cues](edit-audio-sub-cues.md)
- [Edit visual sub-cues](edit-visual-sub-cues.md)
- [Use control sub-cues](use-control-sub-cues.md)
- [Stream model](../reference/stream-model.md)

