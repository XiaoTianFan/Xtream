# Display Composition Reference

Display composition defines how visuals appear on display windows and zones.

## Short Definition

A display window is an output. A display zone is a target inside that output. Composition controls how visual layers combine when more than one visual targets the same output area.

## Display Layouts And Zones

Xtream supports:

- Single displays with one target zone.
- Split displays with left and right zones.

Patch can map visuals directly to zones. Stream visual sub-cues can target zones during scene playback.

## Visual Mingle Modes

Visual mingle settings define how layered visuals combine. They are show-level display composition choices.

Use simple modes for normal show operation. Use expressive blend modes only when the visual design calls for them and you have tested them on the target display.

## Algorithms

**Latest.** Shows the most recent or top active visual layer.

**Alpha-over.** Layers visuals using opacity, suitable for fade and overlay behavior.

**Additive.** Adds light values together, often creating bright composite looks.

**Multiply.** Multiplies layers, usually darkening the composite.

**Screen.** A lightening blend useful for projected or luminous overlays.

**Lighten.** Keeps lighter parts of layers.

**Darken.** Keeps darker parts of layers.

**Crossfade.** Blends between active layers as transitions change.

## Transition Timing

Transition timing can come from visual cue fades, show composition settings, or global blackout fade settings. Test transitions on real output hardware because display refresh, media type, and capture devices can affect perceived smoothness.

## Stream Display Layers

During Stream playback, visual sub-cues project display layers. Each layer can include source timing, opacity, target zone, blend algorithm, loop behavior, and freeze-frame state.

Use Gantt and display details to inspect active visual layers when output does not match expectation.

## Blackout Behavior

Display blackout is a live safety action. It affects current display output and can fade according to show settings. It is not the same as removing visual mappings or deleting cues.

Stream control sub-cues can toggle blackout, so include those actions in rehearsal notes.

## Freeze-Frame Behavior

Visual sub-cues can freeze video or live visual output.

For file video, the display holds the selected media frame. For live visual sources, Xtream captures a canvas frame and holds that image. Image visuals do not need freeze behavior because they are already static; validation can warn that freeze is ignored for images.

## Persistence And Scope

Display layouts, display composition settings, and Stream visual cue settings are saved with the show. Current display health, live preview state, and blackout button state are session/runtime behavior.

## Related Tasks

- [Create and manage displays](../tasks/create-and-manage-displays.md)
- [Map visuals to displays](../tasks/map-visuals-to-displays.md)
- [Edit visual sub-cues](../tasks/edit-visual-sub-cues.md)
- [Settings reference](settings-reference.md)

