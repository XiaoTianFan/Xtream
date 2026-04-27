# Xtream Runtime Changelog

## v0.0.5

- Added a dedicated **audio window**; extended IPC and the control UI (timeline, transport, layout) for centralized audio management.
- Implemented **stereo source splitting** into virtual left/right mono sources, with Director support, output meter reporting (lane detail and peaks), IPC, tests, and control UI.
- Added **output soloing** (solo output IDs) across the audio runtime, IPC, and control; expanded mixer and output-rail interaction (splitter affordances, selection, “expand mixer” control, and refined output-source lists and detail panels).
- Introduced **performance mode** to reduce load (optional suppression of video previews and live meter sampling) and retuned **drift correction** (higher threshold, cooldown) with richer media-sync and telemetry hooks.
- Built **embedded audio extraction** (representation and extracted-to-file paths), Director lifecycle for pending/ready/failed extraction, project-side audio-asset layout, **schema v5** and migration, plus UI and tests.
- Refined the **display preview progress** treatment (edge/progress chrome synced to playback rate and duration).
- Polished **display removal** affordances, archived superseded internal docs, and added a custom scrollbar styling pass.

## v0.0.4

- Introduced the Morandi-Tech control shell runtime line.
- Added schema v4 show persistence for media labels, visual appearance, per-media playback rates, source levels, display labels, and refreshed file-size metadata.
- Added session-scoped global audio mute and display blackout controls. These live controls are intentionally not persisted to show files.
- Added runtime-version reporting for diagnostics alongside the packaged app version.
- Added automatic embedded-audio source creation when imported videos report an embedded audio track.
