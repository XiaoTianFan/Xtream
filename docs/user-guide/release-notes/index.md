# Release Notes

This page is the user-guide entry point for Xtream release notes.

The canonical chronological product-history source is the [runtime changelog](../../runtime-changelog.md).

## Documentation Release

### User guide `0.0.1` nightly

This nightly documentation version completes the first user-facing guide set:

- Phase 1: navigation and first successful show.
- Phase 2: Stream authoring.
- Phase 3: live operation and troubleshooting.
- Phase 4: deep references and release discovery.
- Phase 5: visual sub-cue preview-lane documentation.

## Runtime Highlights

### v0.2.4

- Link audio and visual sub-cue timing while editing.
- Separate cue play passes from inner media loops.
- Migrate older loop policies into the new loop controls.
- Account for audio playback rate in duration and seek behavior.
- Improve loop range controls and timeline duration labels.
- Use better default targets for new audio and visual sub-cues.
- Keep automation editing opt-in in the audio waveform editor.

### v0.2.3

- Drag media directly from the pool.
- Drop visuals onto display zones.
- Drop audio onto output strips.
- Build Stream scenes by dropping media onto List rows or Flow cards.
- Reuse cue editor preview cache data for smoother editing.

### v0.2.2

- Visual sub-cue preview lane.
- Visual source range trimming.
- Freeze frames and fade feedback.
- More reliable visual preview delivery.
- Clearer runtime session logging.
- Friendlier imported audio labels.

### v0.2.1

- Waveform editing for audio sub-cues.
- Level and pan automation.
- More precise audio playback ranges.
- Smoother manual and parallel thread playback.
- Better support for infinite-loop side threads.

### v0.2.0

- Thread-based Stream playback.
- Flow mode.
- Gantt mode.
- Output bus timelines.
- Visual mingle options.
- Schema v9.

## How To Use Release Notes

Use this page for orientation. Use the runtime changelog when you need full chronological detail. User-guide pages remain task-oriented and do not require reading releases in order.

## Related Pages

- [Xtream user guide](../index.md)
- [Stream workspace](../workspaces/stream.md)
- [Edit visual sub-cues](../tasks/edit-visual-sub-cues.md)
- [Runtime changelog](../../runtime-changelog.md)
