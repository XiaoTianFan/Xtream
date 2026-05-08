# Core Concepts

This page gives you the vocabulary needed to operate Xtream without reading implementation notes.

## Patch And Stream

**Patch** is the live wiring desk and the place for standalone static aesthetic scenes. Use it when a show needs simple playback with customized visual and audio routing: import media, create display windows, map visuals, route audio through virtual outputs, watch meters, and play the scene directly.

**Stream** is the show-programming workspace. Use it to build scenes, triggers, sub-cues, and timelines when a show needs ordered or branched cueing.

Patch and Stream share the same show project. Patch is fastest for direct routing and static-scene playback. Stream is better when timing, scene order, loops, manual boundaries, and automation matter.

## Media Pool

The media pool is the project list of visual and audio sources. A media pool record can point to:

- Linked media at its original disk path.
- Copied media under the project folder.
- Extracted embedded audio under the project folder.
- Live visual sources such as webcams, screens, regions, or application windows.

Removing an item from the media pool removes the project record. It does not erase the original disk file.

## Display Windows

A display window is an output window that can be placed on a monitor or projector. It can use a single zone or a split left/right layout. Patch can assign visuals directly to display zones. Stream can also target display zones through visual sub-cues.

Fullscreen, always-on-top, and monitor assignment are display-window settings. They affect the current show output and are saved with the show where applicable.

## Virtual Audio Outputs

A virtual output is a show-level output bus. Add audio source rows to a bus, then control level, pan, mute, solo, delay, and physical output selection. A physical output is the actual device destination, such as the system default output or an audio interface channel exposed by the workstation.

Meters show what the bus is doing during playback. If physical routing is unavailable, Xtream falls back where possible and reports the state in the UI.

## Scenes And Sub-Cues

A **scene** is a programmed moment in Stream. Scenes can start manually, follow another scene, follow the end of another scene, or use timecode behavior.

A **sub-cue** is work done inside a scene:

- Audio sub-cues play and route audio.
- Visual sub-cues target displays and zones.
- Control sub-cues automate scene transport, audio cue values, global audio mute, or display blackout.

## Threads And Timelines

Stream playback can run more than one scene chain at the same time. A thread is one running branch of scene playback. A timeline instance is how that branch appears while it is running or being reviewed.

This is why Stream can handle manual roots, side timelines, loops, and parallel branches without flattening the entire show into one fixed linear track.

## Playback Focus And Edit Focus

Playback focus is what is driving live output. Edit focus is what you are currently adjusting in the UI. They are intentionally separate so you can edit one scene while another scene is on air.

## Safety Controls

Global audio mute and display blackout are live safety controls in the status footer. They affect the current session output and use the configured fade timing. They are not media-pool edits and should be treated as operator actions.

## Related Pages

- [First show](first-show.md)
- [Patch workspace](../workspaces/patch.md)
- [Stream workspace](../workspaces/stream.md)
- [Show project format](../reference/show-project-format.md)
