# Xtream User-Facing Documentation Plan

## Purpose

Plan a gradual, user-facing documentation system for Xtream based on the current repository, runtime changelog, existing docs, and latest implementation state.

This is an information architecture and writing roadmap, not the finished user manual. It should guide future documentation work so each page lands in a coherent structure instead of becoming another isolated note.

## Current Documentation Inventory

Existing public-facing docs are small:

- `README.md` gives the product summary, workspace overview, show project format, developer setup commands, and license.
- `docs/runtime-changelog.md` is the best product-history source. It documents v0.0.4 through v0.2.3 with operator-facing release notes.
- `docs/mac-setup-cn.md` is a Chinese beginner Terminal setup guide, but it references a missing `docs\project-setup-and-manual-testing.md` and still reads like a generic Electron setup guide in places.
- `docs/stream-visual-subcue-preview-lane-editor-plan.md` is an implementation plan. It is useful source material, but it should not sit in the primary user manual without being rewritten around user outcomes.

Recent archived implementation notes were removed from the current tree. The public docs should absorb only the user-relevant concepts from those plans, not recreate internal architecture notes.

## Product Surface To Document

The current app is a desktop show-control system with four shell surfaces:

- Patch: media pool, display windows, visual mapping, audio outputs, meters, transport, and asset details.
- Stream: scene programming with List, Flow, and Gantt modes; audio, visual, and control sub-cues; thread-based playback; Stream transport.
- Config: runtime overview, show and playback settings, diagnostics, session log, display composition, and app-local settings.
- Performance: currently a planned live execution/monitoring surface.

Important current user concepts:

- Show projects are folders containing `show.xtream-show.json`; copied and extracted media lives under project-local `assets/audio` and `assets/visuals`; linked media remains at its original path.
- Current show schema is v9, with automatic migrations from supported older schemas.
- Media can be linked or copied; missing media can be relinked one by one or batch matched from a folder.
- Displays can be single or split zones, fullscreen, always-on-top, and assigned to physical monitors.
- Virtual audio outputs can route source rows, use levels, pan, mute, solo, output delay, meters, and physical sink fallback handling.
- Stream scenes use manual, follow-start, follow-end, and timecode triggers.
- Stream playback can run manual roots, side timelines, loops, and parallel branches without flattening the show into one linear timeline.
- Audio sub-cues include source range trimming, waveform editing, audition preview, pitch shift, fades, level automation, pan automation, output routing, loop policy, mute, and solo.
- Visual sub-cues include visual source, display/zone targets, start offset, duration override, playback rate, loop policy, fades, and freeze frame.
- Latest implementation adds visual fade and freeze-frame runtime behavior: visual fade opacity is projected into display layers, file video freeze holds at the selected media frame, and live visual freeze captures a canvas frame.
- Control sub-cues can play, stop, pause, or resume scenes; automate audio sub-cue level/pan; stop sub-cues; and toggle global audio mute or display blackout with fades.
- Config exposes machine-local app settings separately from show-file settings.
- Diagnostics now center on readiness issues, media validation, display telemetry, audio routing state, session/activity log, and diagnostics export.

## Recommended Documentation Structure

Use `docs/user-guide/` for end-user material. Keep implementation plans outside the user-guide path.

```txt
docs/
  user-guide/
    index.md
    getting-started/
      install-and-open.md
      first-show.md
      core-concepts.md
      project-files-and-media.md
    workspaces/
      patch.md
      stream.md
      config-and-diagnostics.md
      performance.md
    tasks/
      import-media.md
      create-and-manage-displays.md
      map-visuals-to-displays.md
      route-audio-outputs.md
      use-live-visual-sources.md
      build-stream-scenes.md
      program-scene-triggers.md
      edit-audio-sub-cues.md
      edit-visual-sub-cues.md
      use-control-sub-cues.md
      run-and-cue-a-show.md
      save-open-and-relink-shows.md
      export-diagnostics.md
    reference/
      show-project-format.md
      stream-model.md
      triggers-loops-and-time.md
      audio-routing-reference.md
      display-composition-reference.md
      diagnostics-and-readiness.md
      settings-reference.md
      glossary.md
    release-notes/
      index.md
```

## Landing Page

`docs/user-guide/index.md`

Audience: operators, artists, venue techs, demo teams, and technically comfortable users setting up shows.

Should answer:

- What Xtream is.
- Which workspace to use for which job.
- The fastest path to a first working show.
- Where to go when media, displays, audio, or Stream validation is blocked.

Suggested sections:

- Start here
- Workspaces at a glance
- Common tasks
- Troubleshooting and diagnostics
- Release notes

## Getting Started

### `getting-started/install-and-open.md`

Merge and replace the useful parts of `docs/mac-setup-cn.md` over time.

Cover:

- Installing a packaged app when available.
- Running from source for development/testing.
- Windows and macOS notes.
- Required permissions for live capture, screen capture, and audio routing.
- Where recent shows and default show live conceptually.

Write later:

- A Chinese version should be a translation of the real guide, not a separate generic guide.

### `getting-started/first-show.md`

Goal: get a user from blank app to visible output and audible routing.

Flow:

1. Create or open a show.
2. Import one visual and one audio source.
3. Create a display window.
4. Route the visual to the display in Patch.
5. Create a virtual audio output.
6. Add an audio source to the output.
7. Press Play/Pause/Stop.
8. Save the show.

Keep this page intentionally simple. Link outward for Stream, live capture, automation, and diagnostics.

### `getting-started/core-concepts.md`

Explain:

- Patch vs Stream.
- Media pool vs display windows vs virtual outputs.
- Scene, trigger, sub-cue, thread, timeline, and output bus.
- Playback focus vs edit focus.
- Global mute and blackout as live safety controls.
- Linked, copied, and embedded/extracted media.

This page should be conceptual and short enough to read before operating the app.

### `getting-started/project-files-and-media.md`

Cover:

- Project folder layout.
- `show.xtream-show.json`.
- Linked media outside the project.
- Copied media under `assets/`.
- Extracted embedded audio.
- Moving projects between machines.
- Schema migrations at a user level.
- Why linked media can go missing and how relink works.

## Workspace Guides

### `workspaces/patch.md`

Cover the operator console for building the patch:

- Patch header and transport.
- Media pool tabs.
- Importing visual and audio files.
- Link vs copy.
- Live capture sources.
- Display workspace.
- Display details: layout, fullscreen, always on top, monitor assignment.
- Visual details: metadata, appearance, replacement, clearing/removal.
- Audio source details: metadata, embedded audio extraction, split stereo, replacement.
- Mixer: virtual outputs, routing rows, level, pan, mute, solo, output delay, physical output selection, meters.
- Interaction with Stream playback state.

### `workspaces/stream.md`

Cover Stream as the show-programming workspace:

- Header transport, timecode rail, rate control, live state chip, scene title/note editing.
- List mode for ordered editing and quick review.
- Flow mode for spatial scene authoring, cards, links, drag/resize, add follower, context actions, fit/reset.
- Gantt mode for runtime timeline monitoring, zoom/fit, main vs parallel timelines, remove timeline.
- Bottom tabs: Scene, Mixer, Displays.
- Scene edit panel and sub-cue rail.
- Validation highlighting and blocked/degraded states.

### `workspaces/config-and-diagnostics.md`

Cover:

- Overview tab: runtime version, readiness, topology, app-local settings.
- Show & playback tab: show fades, Stream playback preferences, display composition.
- Diagnostics tab: patch readiness, stream validation, display telemetry, audio routing.
- Session log pane.
- Export diagnostics and clear log.
- Difference between machine-local settings and show-file settings.

### `workspaces/performance.md`

For now:

- State that Performance is planned.
- Tell users to use Patch and Stream for live operation in the current runtime.
- Link to the changelog for status.

## Task Guides

### `tasks/import-media.md`

Cover:

- Supported visual/audio import paths at a user level.
- Drag and drop.
- Link vs copy.
- Embedded audio prompt.
- Extraction format setting.
- Metadata probing and pending/error states.
- Removing from the pool vs deleting a disk file.

### `tasks/create-and-manage-displays.md`

Cover:

- Creating display windows.
- Single vs split layout.
- Target zones.
- Assigning monitors.
- Fullscreen and always-on-top.
- Reopen, close, remove.
- Identify labels and display health.

### `tasks/map-visuals-to-displays.md`

Cover:

- Patch display mapping.
- Stream visual targets.
- Split display L/R targeting.
- Visual mingle settings from Config.
- Layering and conflict behavior in Stream.
- Global display blackout.

### `tasks/route-audio-outputs.md`

Cover:

- Virtual outputs.
- Adding/removing source rows.
- Output device selection and fallback.
- Bus level, source level, pan, mute, solo.
- Output delay.
- Meters and meter lanes.
- Global audio mute.

### `tasks/use-live-visual-sources.md`

Cover:

- Webcams, screens, screen regions, and application windows.
- Capture permissions.
- Preview tiles and source identity.
- Updating live capture sources.
- Limitations for duration, playback rate, and live freeze behavior.

### `tasks/build-stream-scenes.md`

Cover:

- Creating, duplicating, removing, enabling/disabling scenes.
- Scene title and note.
- Preload lead time.
- Scene loop policy.
- Adding audio, visual, and control sub-cues.
- Scene and sub-cue validation errors.

### `tasks/program-scene-triggers.md`

Cover:

- Manual triggers.
- Follow-start and follow-end triggers.
- Delay.
- Timecode trigger caveat.
- Manual boundaries.
- Thread-based behavior: main timeline, side timelines, parallel branches, infinite loops.

### `tasks/edit-audio-sub-cues.md`

Cover:

- Selecting an audio source.
- Output routing.
- Base dB, pan, mute, solo.
- Waveform editor.
- Source start/end trim.
- Start offset and duration behavior.
- Fade in/out.
- Level and pan automation curves.
- Pitch shift vs playback rate.
- Loop policy.
- Audition/preview behavior.

### `tasks/edit-visual-sub-cues.md`

Cover current implementation first:

- Selecting a visual.
- Display/zone target toggles.
- Playback rate.
- Start offset.
- Duration override.
- Loop policy.
- Fade in/out and opacity behavior.
- Freeze frame for file video and live visuals.
- Image/live duration requirements.
- Validation messages for missing targets, missing visual, invalid fade, invalid freeze, and missing image/live duration.

Later, when the preview-lane editor is implemented, revise this page around:

- Snapshot lane.
- Play/pause preview on display windows.
- Fade handles.
- Freeze marker pin.
- Video play times vs image/live duration and infinite render.

### `tasks/use-control-sub-cues.md`

Cover:

- Play, stop, pause, resume scene actions.
- Fade-out on stop scene.
- Set audio sub-cue level.
- Set audio sub-cue pan.
- Stop audio sub-cue.
- Set global audio muted.
- Set global display blackout.
- Self-target warnings.

### `tasks/run-and-cue-a-show.md`

Cover:

- Patch transport vs Stream transport.
- Stream play, pause, back to first, next.
- Playing from playback focus.
- Paused global Play behavior.
- Timeline scrubbing.
- Rate adjustment.
- Running manual scenes and side timelines.
- Global mute and blackout safety actions.
- Reading live state chips.

### `tasks/save-open-and-relink-shows.md`

Cover:

- New, open, save, save as.
- Unsaved-change prompts.
- Recent shows.
- Moving show folders.
- Relink media one by one.
- Batch relink from folder.
- Link vs copy during relink.
- What diagnostics to export if a show opens incorrectly.

### `tasks/export-diagnostics.md`

Cover:

- When to export diagnostics.
- What is included: runtime version, app version, platform, state, readiness, media validation, session log.
- Where the session log appears.
- How to read common issue categories.

## Reference Pages

### `reference/show-project-format.md`

User-level reference, not a developer schema dump.

Cover:

- Project folder.
- Show file.
- Relative project assets.
- Linked absolute paths.
- App-local preferences that are not saved in show files.
- Schema migration promise and supported versions.

### `reference/stream-model.md`

Cover:

- Stream.
- Scene.
- Trigger.
- Sub-cue.
- Thread.
- Timeline instance.
- Playback focus.
- Edit focus.
- Runtime scene states.
- Main vs parallel timelines.

### `reference/triggers-loops-and-time.md`

Cover:

- Trigger types.
- Delay and timecode.
- Scene loop policy.
- Sub-cue loop policy.
- Finite duration, indefinite loop, unknown/error duration.
- Audio source range.
- Visual duration semantics for video, image, and live visual media.

### `reference/audio-routing-reference.md`

Cover:

- Audio source kinds.
- Embedded visual audio.
- Channel mode and split stereo.
- Virtual output source selection.
- Bus level and source level.
- Pan laws at a user level.
- Output delay.
- Solo behavior.
- Physical routing availability and fallback states.

### `reference/display-composition-reference.md`

Cover:

- Display layouts and zones.
- Visual mingle modes.
- Algorithms: latest, alpha-over, additive, multiply, screen, lighten, darken, crossfade.
- Transition timing.
- Stream display layers.
- Blackout behavior.
- Freeze-frame behavior.

### `reference/diagnostics-and-readiness.md`

Cover:

- Ready, blocked, degraded, standby, live.
- Patch readiness.
- Stream validation.
- Display telemetry.
- Audio routing state.
- Media validation.
- Session log checkpoint categories.

### `reference/settings-reference.md`

Separate settings by persistence:

- Machine-local: performance mode, embedded audio extraction format, display preview max FPS.
- Show project: audio mute fade, display blackout fade, Stream playback preferences, display composition settings.
- Per-project UI state: active surface, pane sizes, Stream mode, bottom tab, selected scene, expanded scenes.

### `reference/glossary.md`

Define short terms:

- Audio source
- Blackout
- Cue
- Display
- Display zone
- Flow
- Gantt
- Linked media
- Copied media
- Embedded audio
- Extracted audio
- Output bus
- Patch
- Scene
- Stream
- Sub-cue
- Thread
- Timeline
- Visual mingle

## Release Notes

### `release-notes/index.md`

Turn `docs/runtime-changelog.md` into a browsable release-notes entry point.

Options:

- Keep `runtime-changelog.md` as canonical and link to it.
- Later split into one file per minor version if the changelog gets too long.

Writing rule:

- Release notes can stay chronological.
- User guides should be task-oriented and should not require users to read releases in order.

## Gradual Writing Roadmap

### Phase 1: Navigation And First Successful Show

Write these first because they unblock real users fastest:

1. `user-guide/index.md`
2. `getting-started/first-show.md`
3. `getting-started/core-concepts.md`
4. `workspaces/patch.md`
5. `tasks/import-media.md`
6. `tasks/create-and-manage-displays.md`
7. `tasks/route-audio-outputs.md`

Acceptance check:

- A new user can create a show, import media, create output windows, route audio, and save without reading implementation notes.

### Phase 2: Stream Authoring

Write:

1. `workspaces/stream.md`
2. `tasks/build-stream-scenes.md`
3. `tasks/program-scene-triggers.md`
4. `tasks/edit-audio-sub-cues.md`
5. `tasks/edit-visual-sub-cues.md`
6. `tasks/use-control-sub-cues.md`
7. `reference/stream-model.md`
8. `reference/triggers-loops-and-time.md`

Acceptance check:

- A user can understand scenes, triggers, sub-cues, manual boundaries, loops, Flow, Gantt, and thread-based playback well enough to build a multi-scene show.

### Phase 3: Live Operation And Troubleshooting

Write:

1. `tasks/run-and-cue-a-show.md`
2. `workspaces/config-and-diagnostics.md`
3. `tasks/save-open-and-relink-shows.md`
4. `tasks/export-diagnostics.md`
5. `reference/diagnostics-and-readiness.md`
6. `reference/settings-reference.md`

Acceptance check:

- A user can diagnose missing media, display problems, Stream validation errors, and audio routing issues without reading source code or asking a developer.

### Phase 4: Deep References And Polish

Write:

1. `reference/show-project-format.md`
2. `reference/audio-routing-reference.md`
3. `reference/display-composition-reference.md`
4. `reference/glossary.md`
5. `release-notes/index.md`
6. Replace or rewrite `docs/mac-setup-cn.md` as a translated user-facing setup page.

Acceptance check:

- The docs support recurring questions, onboarding, support handoff, and release discovery.

### Phase 5: Future Visual Preview Lane Update

After the visual preview-lane editor is implemented:

1. Update `tasks/edit-visual-sub-cues.md`.
2. Update `workspaces/stream.md`.
3. Add screenshots or diagrams for the lane.
4. Move `docs/stream-visual-subcue-preview-lane-editor-plan.md` into an internal/planning area if still needed.

Acceptance check:

- Visual sub-cue docs match the shipped UI, including preview on assigned display windows.

## Source Mapping For Writers

Use these implementation areas as source truth while writing:

- Shell navigation: `src/renderer/control/shell/rail.ts`
- Patch surface: `src/renderer/control/patch/`
- Stream shell and modes: `src/renderer/control/stream/`
- Scene edit forms: `src/renderer/control/stream/sceneEdit/`
- Config and diagnostics: `src/renderer/control/config/configSurface.ts`
- Show file handling and migrations: `src/main/showConfig.ts`, `src/shared/types.ts`, `src/shared/streamWorkspace.ts`
- Stream runtime: `src/main/streamEngine.ts`, `src/shared/streamSchedule/`
- Display projection/runtime: `src/renderer/streamProjection.ts`, `src/renderer/display.ts`
- Audio runtime: `src/renderer/control/media/audioRuntime.ts`
- Runtime changelog: `docs/runtime-changelog.md`

## Writing Standards

Use operator-facing language:

- Prefer "Create a display window" over "call display:create".
- Prefer "show project" over "persisted config" unless the page is a reference.
- Explain consequences: what changes live output, what is saved, and what is machine-local.
- Distinguish Patch playback from Stream playback whenever transport is mentioned.
- Always call out whether an action affects the show file, the current session, or app-local settings.
- Keep implementation notes out of task pages unless they explain user-visible behavior.

Each task page should include:

- When to use it.
- Before you start.
- Steps.
- What you should see.
- Common problems.
- Related pages.

Each reference page should include:

- Short definition.
- Fields or options in user language.
- Persistence/scope.
- Related tasks.

## Open Questions Before Full Manual Drafting

- Which platforms should the first public docs target: Windows only, Windows and macOS, or source-run users on all platforms?
- Are packaged releases available to users, or should setup docs remain source-first for now?
- Should docs be English-only first, or should Chinese setup material be maintained in parallel?
- Should screenshots be added now, or after the current UI stabilizes around visual sub-cue preview lanes?
- What level of commercial/licensing wording should be visible in the user guide beyond the README license section?
