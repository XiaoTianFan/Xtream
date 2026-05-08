# Create And Manage Displays

Display windows are the visual outputs Xtream places on monitors, projectors, or local preview screens.

## When To Use It

Use this task when you need to create a new visual output, send content to a monitor, split a window into zones, or troubleshoot display placement.

## Before You Start

- Connect any projector, monitor, or capture output you want to use.
- Open or create a show project.
- Import at least one visual if you want to test content immediately.

## Steps

1. Open Patch.
2. In **Display Windows**, choose **Add**.
3. Select the new display to open Display Details.
4. Choose a layout: single or split.
5. Assign a monitor if needed. Leave it on the current/default monitor for a quick test.
6. Turn on **Fullscreen** when the output should fill the assigned monitor.
7. Turn on **Always on top** if the display window should stay above other windows.
8. Drag a visual from the media pool onto the display preview.
9. For a split display, drop onto the left or right zone.
10. Use **Show Display Labels** in the footer to identify outputs.

## Layouts And Zones

A single display has one target zone. A split display has left and right zones. Patch can assign a visual directly to either zone. Stream visual sub-cues can also target display zones during scene playback.

## Display Health

Display details include status and telemetry. Use these when a display appears blank, is assigned to the wrong monitor, or is not updating as expected.

## What You Should See

- The new display appears in the Display Windows panel.
- The display has a preview pane.
- Assigned visuals appear in the preview and output window.
- Split displays show separate left and right target zones.

## Common Problems

**The display is on the wrong monitor.** Select the display and choose the intended monitor in Display Details.

**The display is covered by another window.** Enable always-on-top or fullscreen.

**The preview says no visual selected.** Drag a visual onto the display preview or assign one from details.

**A split side is blank.** Only the zone you target receives the visual. Drop or assign a visual to the blank side.

**Everything is black.** Check the global display blackout button in the footer.

## Related Pages

- [Patch workspace](../workspaces/patch.md)
- [Map visuals to displays](map-visuals-to-displays.md)
- [Display composition reference](../reference/display-composition-reference.md)
- [Diagnostics and readiness](../reference/diagnostics-and-readiness.md)

