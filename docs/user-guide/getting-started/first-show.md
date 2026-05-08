# First Show

Use this walkthrough to get from a blank Xtream project to visible output, audible routing, and a saved show.

## When To Use It

Use this page when you are setting up Xtream for the first time, testing a workstation, or confirming that a project can play one visual and one audio source.

## Before You Start

- Have one visual file ready, such as an image or video.
- Have one audio file ready, such as a WAV, MP3, FLAC, OGG, or Opus file.
- If you want to test a real projector or second screen, connect it before creating display windows.
- If you want to test physical audio routing, connect the audio interface before creating virtual outputs.

## Steps

1. Open Xtream.
2. From the launch dashboard, choose **Create New**. Choose a project folder when prompted.
3. In Patch, find **Media Pool** and choose **Add Media**.
4. Pick your visual and audio file, or drag them into the media pool.
5. Choose **Copy into project** if you want the show folder to carry the media with it. Choose **Link originals** if the files should stay where they are.
6. In **Display Windows**, choose **Add**.
7. Drag the visual from the media pool onto the display preview. For a split display, drop onto the left or right zone.
8. In **Audio Mixer**, choose **Create Output**.
9. Drag the audio source from the media pool onto the output strip, or select the output and add the audio source from its details.
10. Select the output and choose a **Physical output** if you need a specific device. Leave it at the system default for a quick test.
11. Use the Patch transport controls: **Play**, **Pause**, and **Stop**.
12. Choose **Save**.

## What You Should See

- The visual appears in the display window preview and in the actual display window.
- The audio source appears as a row on the virtual output.
- Meters move when audio is playing.
- The status footer stays quiet, or reports issues that can be acted on.
- The project folder contains `show.xtream-show.json`. Copied media is stored under project-local `assets/audio` or `assets/visuals`.

## Common Problems

**The media did not import.** The file may be unsupported or unreadable. Try a common image, video, or audio format first.

**The visual is in the pool but not on the display.** Create a display window, then drag the visual onto the display preview or assign it from display details.

**The display window is on the wrong monitor.** Select the display and set its monitor in Display Details.

**No audio is heard.** Check that the audio source is routed to a virtual output, the output is not muted, global audio mute is off, and the physical output device is available.

**The project breaks after moving folders.** Copied media moves with the project folder. Linked media stays at its original disk path and may need to be relinked.

## Related Pages

- [Core concepts](core-concepts.md)
- [Patch workspace](../workspaces/patch.md)
- [Import media](../tasks/import-media.md)
- [Create and manage displays](../tasks/create-and-manage-displays.md)
- [Route audio outputs](../tasks/route-audio-outputs.md)

