# Use Live Visual Sources

Live visual sources let Xtream use cameras, screens, screen regions, and application windows as visuals.

## When To Use It

Use this task when a show needs a webcam, desktop capture, screen region, or application window to appear on a display or inside Stream playback.

## Before You Start

- Connect cameras or displays before opening the show when possible.
- Grant operating-system permissions for camera or screen capture.
- Create the display windows you want to test.
- Decide whether the live source is for Patch playback, Stream playback, or both.

## Add A Live Visual Source

1. Open Patch.
2. In the Media Pool, choose **Add Media**.
3. Choose the live capture option.
4. Select a webcam, screen, screen region, or application window.
5. Confirm the live source appears in the Visuals tab.
6. Drag it to a display in Patch or use it in a Stream visual sub-cue.

## Source Identity

Live sources are saved in the show as visual records, but the actual camera, screen, or window depends on the current workstation. A source that exists on one machine may not exist on another.

Use clear labels so operators can recognize the intended live source.

## Preview Tiles

Live capture selection can show webcam previews and desktop or window thumbnails. Use these previews to confirm the correct source before adding it.

If previews are blank, check permissions and whether the source is available.

## Updating A Live Source

If the camera, screen, region, or window changes, update the live visual source rather than creating duplicate sources blindly. After updating, check Patch display output and any Stream visual sub-cues that use the source.

## Duration And Playback Limits

Live visuals do not have a natural media duration. When using a live source in Stream, set a duration or loop policy if the cue participates in follow timing.

Playback rate is limited for live sources because there is no fixed media file to speed up or slow down.

## Live Freeze Behavior

Visual sub-cues can freeze live visuals by capturing a canvas frame and holding it. Test live freeze behavior on the target machine because capture permissions and source availability affect reliability.

## What You Should See

- The live source appears in the Visuals tab.
- Patch display previews can render the live source.
- Stream visual sub-cues can target displays with the live source.
- Diagnostics report permission or readiness problems when capture fails.

## Common Problems

**The live source is unavailable.** Check camera/screen permissions and whether the device or window still exists.

**The wrong window appears.** Reopen the live source picker and select the intended source.

**Stream timing is invalid.** Add a duration or loop policy to the live visual sub-cue.

**Freeze does not hold the expected frame.** Check that the live source was rendering at the freeze point and test again after permissions are stable.

## Related Pages

- [Import media](import-media.md)
- [Map visuals to displays](map-visuals-to-displays.md)
- [Edit visual sub-cues](edit-visual-sub-cues.md)
- [Diagnostics and readiness](../reference/diagnostics-and-readiness.md)

