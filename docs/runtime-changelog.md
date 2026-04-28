# Xtream Runtime Changelog

## v0.0.7

- Reworked the control console into dedicated Patch, Cue, Performance, Config, and Logs surfaces so each workflow has a clearer home while keeping the live patch controls immediately available.
- Improved the Patch surface structure with focused controllers for media preview, display windows, mixer controls, details, layout preferences, embedded-audio import, and transport controls.
- Kept timeline scrubbing responsive while live state updates continue in the background, reducing jumpy scrubber feedback during seeks.
- Made show save, save-as, open, and create actions consistent between the Patch surface, launch dashboard, and Config surface.
- Refined the control shell and Patch surface icon wiring so navigation, show actions, transport controls, media import, display creation, and mixer actions render from their own surface-specific controls.
- Relaxed media drift correction slightly so playback sync is less likely to over-correct during normal timing variation.
- Reorganized the renderer control code into clearer app, shell, patch, media, meter, shared, config, cue, performance, and logs modules, reducing the size and responsibility of the main control entrypoint.

## v0.0.6

- Added per-output audio delay controls so each virtual output can be time-aligned from the output details panel and carried through live playback.
- Added always-on-top display control, giving operators a quick way to keep a display window above other desktop windows.
- Added configurable fade timing for global audio mute and display blackout, so show-wide safety actions can transition smoothly instead of snapping instantly.
- Improved the audio mixer readout with clearer fader scale marks, meter zones, and level positioning for faster visual scanning.
- Added drag-and-drop import for media files directly into the media pool.
- Added a launch dashboard with recent shows, making it easier to create, open, and return to projects.
- Updated show files to schema v6 with durable pan settings for outputs and routed sources, including migration for older v5 shows.
- Added source and output panning controls with wider visual travel, rounded knob indicators, and a cleaner output-source row layout.
- Added Windows/macOS app icon assets and startup wiring for a more complete desktop shell.

## v0.0.5

- Added a dedicated audio playback window and expanded the control surface so audio can be managed from one place alongside timeline and transport controls.
- Added stereo source splitting, allowing a stereo file to be routed as separate left and right mono sources when a show needs channel-specific routing.
- Added output solo controls and refined the mixer/output details experience, including better source lists, detail panels, splitter affordances, and mixer expansion.
- Added performance mode for lighter operation when previews or live meter sampling are not needed.
- Improved drift correction so media sync is less jumpy and exposes better telemetry when timing needs attention.
- Added embedded-audio extraction for imported video files, with project-side audio asset tracking and clearer ready/pending/failed states.
- Updated show files to schema v5 to preserve embedded-audio extraction data and migrate older projects forward.
- Improved display preview progress styling so playback position is easier to read at a glance.
- Cleaned up display removal controls, scrollbar styling, and older internal documentation.

## v0.0.4

- Introduced the Morandi-Tech control shell as the active operator-console runtime line.
- Updated show files to schema v4 so projects remember media labels, visual appearance settings, per-media playback rates, source levels, display labels, and refreshed file-size metadata.
- Added global audio mute and display blackout controls for live operation. These are session controls and are intentionally not saved into show files.
- Added runtime-version reporting to diagnostics alongside the packaged app version.
- Added automatic embedded-audio source creation when imported videos report an embedded audio track.

