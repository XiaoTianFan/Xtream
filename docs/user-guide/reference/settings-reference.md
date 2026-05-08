# Settings Reference

Xtream settings have different persistence scopes. Knowing the scope helps you predict what follows the show file and what stays on the workstation.

## Machine-Local Settings

Machine-local settings stay with the workstation. They do not belong to one show project.

Examples:

- Performance mode.
- Embedded audio extraction format.
- Display preview max FPS.

Use machine-local settings for workstation capability and operator preference. Do not rely on them to travel with a show folder.

## Show Project Settings

Show project settings are saved with the show file.

Examples:

- Audio mute fade.
- Display blackout fade.
- Stream playback preferences.
- Display composition settings.
- Display windows and show-level display configuration.
- Virtual outputs and routing.
- Stream scenes, triggers, and sub-cues.

Use show project settings for behavior that should reopen with the show.

## Per-Project UI State

Per-project UI state stores how the workspace is arranged for a project. It helps the console reopen in a familiar layout.

Examples:

- Active surface.
- Pane sizes.
- Stream mode.
- Bottom tab.
- Selected scene.
- Expanded scenes.
- Flow layout and viewport preferences.

UI state affects the operator view. It should not be treated as the source of show playback logic.

## Session-Only State

Some state exists only for the current session.

Examples:

- Current global audio mute button state.
- Current display blackout button state.
- Live playback state.
- Active runtime timelines.
- Current session log contents.
- Runtime telemetry.

Session-only state can affect live output, but it is not the same as editing the show file.

## Stream Playback Preferences

Stream playback preferences shape how the runtime behaves while editing or running scenes. They can affect behavior such as how orphaned cues finish or fade when a running show is edited, and how pausing interacts with the playhead.

Treat these as show-level operational choices. Rehearse after changing them.

## Display Composition Settings

Display composition settings define how layered visuals combine on display outputs. Visual mingle behavior can affect how Patch mappings and Stream visual layers appear.

Related reference: [Display composition reference](display-composition-reference.md).

## Global Fade Settings

Audio mute fade and display blackout fade affect show-wide safety actions. They can be used by footer controls and by Stream control sub-cues that toggle global mute or blackout.

## Related Tasks

- [Config and diagnostics](../workspaces/config-and-diagnostics.md)
- [Run and cue a show](../tasks/run-and-cue-a-show.md)
- [Use control sub-cues](../tasks/use-control-sub-cues.md)
- [Create and manage displays](../tasks/create-and-manage-displays.md)

