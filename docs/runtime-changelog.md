# Xtream Runtime Changelog

## v0.1.3

- **Problems in one place:** The footer now has a **global issues strip** (right after the runtime version) that lists Patch, Stream, and **shared** blockers together—so stream configuration trouble is not hidden inside Patch-only summaries. Stream no longer shows a separate “static” problem line under transport; the same issues appear in the strip (and the scene edit banner for stream checks is gone).
- **Session activity log:** The Config log is framed as a **session / activity log** with clearer naming and plumbing for future event types; **diagnostics export** still bundles the buffer when you need support details.
- **Media pool import:** Bringing files in uses a **single, consistent import flow** (link or copy into the project) for both audio and visuals; **empty pools** show clearer guidance when there is nothing to work with yet.
- **Missing media:** When clips go missing, the console is better at **nudging you toward Relink media** (including after open) so you can fix paths or bulk-match from a folder.
- **Modals:** Confirmations and prompts are routed through a **unified shell modal** path so behavior and styling stay aligned across Patch and Stream.
- **Stream validation reads clearly:** Error and warning text names **scenes by title** (or cue number in order) and **sub-cues by kind and position** (for example *audio sub-cue no.1*) instead of opaque internal ids—whether you see it in the footer strip or elsewhere.
- **See broken cues in the workspace:** Scenes with authoring problems can show **error** in the stream list **State** column; the **list row**, **flow card**, **scene pill**, and **sub-cue row** pick up a **red tint** so you can spot what still needs fixing without re-reading logs.

## v0.1.2

- **Show projects survive moves and renames** when you use **copied** visuals and audio or **extracted** embedded audio: those files are tracked with **paths relative to the project folder**, so you can relocate the whole project without breaking clips. **Linked** media (files you did not copy into the project) still remembers their exact locations on disk, as before.
- **Opening shows across Windows and Mac** is more reliable: linked paths that look like another OS’s absolute locations are no longer mistaken for files inside your project.
- **Stream playback** resumes from pause and steps through **manual** tail sequences more predictably, with clearer scene handoff when you take over from automation.
- If files go missing, use **Relink media…** in Patch Summary: see every broken visual or audio line, **link** or **import a copy** one at a time, or choose a **folder** (for example from a backup or old machine) to **match by filename** and relink or copy **in bulk**.

## v0.1.1

- **Stream triggers** use clearer **follow** and **delay** semantics (replacing the older “simultaneous start” and “time offset” labels). Opening a show migrates existing triggers automatically.
- **Following scenes and the schedule** behave more predictably around **manual** scenes: chained follows no longer auto-start when a manual parent has not run, and schedule fallback respects those relationships more reliably.
- **Playback focus** (what is on air) is separate from **edit focus** (what you are adjusting). **Double-click** a scene in the flow or list to move playback there; the console highlights which scene is driving output versus which one you are editing.
- When the automated chain finishes and only **manual** scenes remain, **stream time can hold** instead of advancing—so you are not drifting against the timeline while stepping cues by hand.
- **Global mute and blackout** fades can follow fade timing coming from the show runtime, so safety actions stay consistent with scene-driven transitions.
- **Loops** on scenes and audio/visual media cues line up better with real playback: timing, effective duration, and **seeking** respect loop counts and ongoing playback more accurately.
- **Transport shortcuts** work from both **Patch** and **Stream** workspaces for quicker hands-on control.
- The Stream **header and workspace chrome** update more lightly during scene changes, keeping the layout responsive when cueing quickly.
- **Bringing in media** lets you **link** files where they live or **copy** them into the project; new imports organize **audio** and **visual** assets separately, and the **media pool** shows whether each item is linked, copied, or embedded at a glance.
- **Visual pool grid** cards show clearer **placement** badges and a steadier hover target for remove; stopping or resetting transport clears leftover **manual tail** timing state correctly.

## v0.1.0

- Introduced the **Stream workspace** as the full programming surface for shows: streams with ordered **scenes**, scene **triggers** (manual, follow another scene, time offsets, timecode), a **flow** canvas for laying out scenes, and **sub-cues** on each scene—**audio** routes to virtual outputs (levels, pan, fades, loops, automation, Patch-style mute/solo round‑trip), **visuals** target display zones with fades, loops, and timing overrides, and **control** sub-cues automate scene transport, sub-cue levels, and global mute/blackout. Operators can tune **playback behavior** when editing a running show (for example letting orphaned cues finish or **fading** them out) and how pausing interacts with the playhead.
- Added **visual mingle** options per display so layered visuals can blend (including transitions) instead of only stacking as opaque layers.
- Advanced **show files** to **schema v9**, with automatic migration from v7/v8: new projects carry the Stream graph alongside Patch data, and a **Patch compatibility** scene keeps Patch routing aligned with Stream until you fully work in Stream.
- Moved **performance mode**, **embedded-audio extraction format**, and **control display preview frame rate** into **machine-local app settings** so these choices stay with the workstation rather than inside every show file.
- Improved **Stream playback and displays**: reworked the stream transport engine for steadier scheduling and persistence, **solo output** state is reflected on display playback, and removing or changing running cues can **fade out** cleanly instead of popping off.
- Refined **launch dashboard** feedback with clearer **loading** states when opening or creating shows.
- Expanded **diagnostics export** and in-app logging so support and operators can see more of the open-show and readiness story.
- Polished the **control shell** (Stream layouts, transport headers, audio sub-cue editing, asset preview and overlays) and unified **styling tokens** for a more consistent console.

## v0.0.8

- Added live visual sources so operators can add webcams, screens, or application windows to the visual pool and route them to display windows like other visuals.
- Added a live-capture picker with source previews, including webcam preview tiles and desktop/window thumbnails before adding a stream.
- Made live visuals persist in show files with schema v7, while existing schema v3-v6 show files continue to migrate forward as file-based visuals.
- Improved live display playback by preparing trusted screen/window capture grants, cleaning up capture streams when layouts change, and reporting live preview/display readiness back into the show state.
- Added live visual details and preview support, including capture source information and live-stream rendering in the asset preview and display windows.
- Improved embedded-audio extraction feedback with a dedicated extraction overlay and clearer long-video extraction choices.
- Renamed the planned Cue workspace to Stream across the control shell so the navigation matches the current product language.

## v0.0.7

- Reworked the control console into dedicated Patch, Stream, Performance, Config, and Logs surfaces so each workflow has a clearer home while keeping the live patch controls immediately available.
- Improved the Patch surface structure with focused controllers for media preview, display windows, mixer controls, details, layout preferences, embedded-audio import, and transport controls.
- Kept timeline scrubbing responsive while live state updates continue in the background, reducing jumpy scrubber feedback during seeks.
- Made show save, save-as, open, and create actions consistent between the Patch surface, launch dashboard, and Config surface.
- Refined the control shell and Patch surface icon wiring so navigation, show actions, transport controls, media import, display creation, and mixer actions render from their own surface-specific controls.
- Relaxed media drift correction slightly so playback sync is less likely to over-correct during normal timing variation.
- Reorganized the renderer control code into clearer app, shell, patch, media, meter, shared, config, stream, performance, and logs modules, reducing the size and responsibility of the main control entrypoint.

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
