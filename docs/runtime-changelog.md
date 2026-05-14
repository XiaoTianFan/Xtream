# Xtream Runtime Changelog

## v0.2.4

- **Link audio and visual timing while editing:** Audio and visual sub-cues can now keep their timing connected from the cue editors, making it easier to keep paired sound and picture changes synchronized without re-entering the same values twice.
- **Separate play passes from inner loops:** Stream sub-cues now distinguish how long a cue participates in the scene from how its media loops inside that window, giving operators clearer control over repeated content without confusing scene duration.
- **Safer upgrades for existing looped cues:** Older loop policies migrate into the new pass and inner-loop controls automatically when a show opens, preserving existing playback intent while exposing the newer editing model.
- **More accurate audio duration and seeking:** Audio sub-cues now account for playback rate when calculating cue duration, playback windows, and seeks, so pitched or rate-adjusted audio lines up more reliably with the Stream timeline.
- **Clearer loop controls in audio and visual editors:** Loop range handles, infinite-loop controls, disabled loop states, and timeline duration labels now behave more consistently while editing and during playback review.
- **Better default targets for new sub-cues:** Newly created audio and visual sub-cues prefer the main output and display targets when available, reducing setup friction for common cue creation.
- **Smoother automation editing:** The audio waveform editor no longer drops operators into level or pan automation mode by default, making normal trim and timing edits feel less surprising.
- **Documentation refresh for onboarding:** Setup guidance was consolidated into the user guide with clearer install, project folder, media handling, permission, and troubleshooting notes.

## v0.2.3

- **Drag media directly from the pool:** Audio and visual pool items can now be dragged out of the shared media pool instead of being assigned only through pickers and edit forms.
- **Drop visuals onto display zones:** Patch display previews now expose drop targets for single displays and split left/right zones, including empty zones, so operators can assign or replace display visuals from the preview itself.
- **Drop audio onto output strips:** Audio sources can be dropped onto Patch output bus strips to route them quickly, with invalid media drops rejected and visible feedback while hovering over a target.
- **Build Stream scenes by dropping media:** Dropping an audio or visual pool item onto a scene row in List mode or a scene card in Flow mode creates the matching sub-cue, selects it for editing, and expands the scene so the new cue is immediately visible.
- **Smoother cue editor previews:** Audio waveforms and visual preview thumbnails can reuse loaded cache data while editors are rebuilt, reducing unnecessary pending states when returning to recently viewed sub-cues.

## v0.2.2

- **Visual sub-cue preview lane:** Visual sub-cues now have a preview-centered editor for playing, pausing, seeking, and reviewing the selected visual range directly from the scene edit pane, replacing the older timing-only controls with a clearer media lane.
- **Trim source ranges for visuals:** Operators can set and adjust visual source start/end ranges, with Stream playback, preview duration, validation, and schedule timing all respecting the trimmed portion of the media.
- **Freeze frames and fade feedback:** Visual sub-cues can hold freeze frames and show fade-in/fade-out curves in the preview lane, with marker interactions that make freeze points easier to review and remove.
- **More reliable visual preview delivery:** Display preview commands now report which display outputs received the preview and which were missing, giving the console better feedback while editing visuals across multiple displays.
- **Clearer runtime session logging:** Manual seeks, drift correction seeks, scene state changes, readiness checkpoints, and transport activity now carry richer session log details so operators and support can understand what happened during playback.
- **Friendlier imported audio labels:** Audio files added to the show now use the file basename as their source label, making imported sources easier to recognize in Patch and Stream without manual renaming.
- **Project documentation and licensing refresh:** The release includes refreshed README and user-facing documentation planning, archived completed runtime planning notes, and updates the project license to PolyForm Noncommercial.

## v0.2.1

- **Waveform editing for audio sub-cues:** Audio sub-cues now have a waveform-centered editor for trimming the playable source range, adjusting timing, auditioning the cue, changing pitch, and editing fades from the scene edit pane.
- **Level and pan automation on audio cues:** Operators can draw, clear, and switch between level and pan automation curves directly on the waveform, with clearer visual feedback for the active curve and automation points.
- **More precise audio playback ranges:** Stream playback now respects source start/end ranges, pitch shift, fade timing, loop policy, and automation data when projecting audio sub-cues onto output buses.
- **Smoother manual and parallel thread playback:** Running scenes manually, relaunching completed threads, and moving through manual boundaries now keeps playback focus and scene state more predictable, even while parallel timelines are active.
- **Better support for infinite-loop side threads:** Infinite manual loops can run beside the main Stream timeline without stretching the main duration, blocking ready manual scenes, or disturbing full-pass audio cues across loop iterations.
- **Steadier display and audio synchronization:** Display layer identity is more stable across parallel timelines, and Stream playback drift correction uses renderer-reported timing so display output and Patch-derived audio stay better aligned.
- **Clearer Flow and Gantt projection for complex streams:** Manual infinite-loop threads and side timelines are classified and positioned more consistently, making complex Stream structures easier to review while authoring.
- **Runtime and UI maintainability work:** The Stream engine, schedule builder, media pool, mixer, IPC setup, and control styles were split into smaller focused modules, giving the new waveform and multi-timeline behavior stronger test coverage and a cleaner base for future fixes.

## v0.2.0

- **Thread-based Stream playback:** Stream can now run scene chains as independent threads, so follow cues, manual starts, skipped scenes, and parallel branches behave more predictably without earlier scenes being accidentally consumed.
- **Flow mode for scene programming:** The Stream workspace adds a richer Flow view for arranging scene cards, seeing scene relationships, dragging layouts into place, and keeping disabled or manual scenes visually clear while authoring.
- **Gantt mode for timeline review:** A new Gantt view shows how scenes and threads line up over time, with shared scaling, fit and zoom behavior, lane sizing, and context actions for managing non-main timelines.
- **Output bus timelines:** Audio and visual output details can now show Gantt-style cue rows, making it easier to inspect what each output is doing and where active cues sit against the running stream.
- **Better live Stream synchronization:** Stream UI hydration, workspace rendering, playback focus, header controls, scene states, and runtime-only updates are more resilient, so the console stays lined up with the latest stream state during fast playback and editing.
- **More reliable media and display behavior:** Audio metadata probing is more consistent across source types, source URLs are resolved more carefully, and visual display layers use steadier projection keys so loops, shared cues, and live output rendering stay in sync.
- **Flow and layout recovery tools:** Operators can reset persisted Flow layouts and viewports, keep dragged card positions through runtime updates, and get cleaner toolbar actions while moving between Stream modes.
- **Thread color and playback settings polish:** Multi-timeline playback settings now normalize to sensible defaults, thread colors are presented consistently, and scene summaries can favor first- or last-instance behavior depending on the show.
- **Engineering groundwork for the new runtime:** The release includes a substantial stream engine rewrite, a documented thread runtime mechanism, Rete-powered Flow infrastructure, and broad test coverage for the new scheduling, projection, hydration, and timeline behavior.

## v0.1.6

- **Layout preferences sync across workspaces:** Pane dimensions and layout choices in Patch now carry over to Stream and vice versa, so your workspace stays consistent as you switch contexts.
- **Missing media relink in footer:** The global status footer now shows a **Relink media** button when clips are offline—jump straight to resolving paths without hunting through menus; once relinked, media operation issues refresh automatically.
- **Light theme support:** The light theme is now fully supported with improved color contrast and readability.

## v0.1.5

- **Display details in Stream:** The display inspector in the stream overlay includes **layout** controls and a toolbar for **fullscreen** and **always on top**. Detail panes track live display state, and changing scenes clears stale details so the panel matches your outputs.
- **Launch dashboard:** After you have cleared unsaved-change state, you are less likely to see a **repeat** unsaved-changes prompt when opening or creating a show from the dashboard.
- **Stream validation:** When validation results change, Stream UI updates more reliably; opening the console also **probes** media in the pool so problem states surface consistently.
- **Accurate durations:** Editing **visual** or **audio** sources refreshes media durations so timelines reflect the clips you are using now.
- **Scene editor:** The **note** field and action toolbar (enable, duplicate, remove) are laid out more clearly, and the redundant trigger-summary line was removed from scene metadata for a cleaner panel.
- **Stream mixer:** The mixer bottom strip avoids unnecessary redraws during some interactions for steadier feedback.

## v0.1.4

- **Room to work on startup:** The control window opens **maximized** in normal windowed mode (title bar and menus stay visible—not presentation fullscreen) on Windows and macOS, so the console fills your screen as soon as the app is ready.
- **Config diagnostics in one place:** **Export diagnostics** now lives next to **Clear log** on the session log card; the extra diagnostics-export block was removed from the overview grid so support export is easier to find without duplicating the layout.
- **Remove virtual outputs from the mixer:** **Right‑click** a virtual output strip in the Patch mixer for **Remove virtual output…**, with a confirmation before it goes away; if that output was selected, focus clears cleanly.
- **Stream list stays honest:** The scene list **State** column treats **authoring/validation errors** like the rest of Stream (shows **error** when a scene has fix‑me issues, not only when the live runtime already says error), including while the timeline is idle so rows don’t look “healthy” when they are not.
- **Fewer accidental scene deletes:** Removing a scene from the stream—whether from the list context menu or the stream workspace—asks you to **confirm** before it is dropped.

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

