# PRD: Xtream MVP Refactor - Visual Pool, Audio Pool, and Multi-Output Playback

## 1. Summary

Xtream is a Windows and macOS Electron application for operator-controlled multi-display exhibition playback. The current MVP is largely functional: one control window owns interaction, the main process owns director state and display-window registry, display windows are output-only renderers, two video slots can be mapped through mode presets, audio can be sourced from an external file or embedded slot audio, Mode 3 can attempt split L/R routing, show configuration can be saved/restored, diagnostics can be exported, and readiness/drift state is surfaced in the control UI.

This refactor updates the product model from fixed video slots and a single stereo audio rail into three general-purpose concepts:

- **Visual Pool**: a user-managed pool of video and image media items. A visual is any visual media asset that can be assigned to display windows.
- **Audio Pool**: a user-managed pool of playable audio sources, including external audio files and embedded audio extracted from visuals that support audio.
- **Virtual Outputs**: user-created audio mix buses that select one or more audio-pool clips, expose per-clip level controls plus a bus fader/meter, and route to physical system audio endpoints through the current selectable-output mechanism.

The MVP should preserve the current working show behavior while making the architecture more configurable: any number of visuals, any number of display windows, any number of virtual audio outputs where the runtime supports them, and data-driven mapping between pools, display records, and physical outputs.

## 2. Current Implementation Baseline

The following behavior exists in the current implementation and should be treated as a working baseline unless superseded by this PRD.

### 2.1 Implemented Product Behavior

- The app launches exactly one interactive control window and no display windows by default.
- The main process owns `Director` state, transport commands, readiness checks, drift correction, show persistence, diagnostics export, and IPC fan-out.
- Display windows are dynamically created and tracked by registry ids such as `display-0`, not by fixed hardcoded windows.
- Mode presets exist:
  - Mode 1 creates or updates one split display mapped to slots `A` and `B`.
  - Mode 2 creates or updates two single displays mapped to slots `A` and `B`.
  - Mode 3 uses the Mode 2 display mapping and enables split-audio routing behavior.
- Two default video slots, `A` and `B`, are available in state and UI.
- Display layouts currently support `single` and `split` profiles.
- Video display renderers use muted `HTMLVideoElement` playback synchronized to director time.
- Audio playback is owned by the control renderer through hidden media elements and Web Audio routing.
- Audio can be sourced from an external audio file or embedded audio from a selected video slot.
- Audio output devices can be enumerated from `navigator.mediaDevices.enumerateDevices()`.
- Main, Mode 3 left, and Mode 3 right sink selections are persisted where available.
- Split-audio capability is feature-detected and deterministic fallback reasons are recorded.
- Play is blocked by readiness errors such as missing display windows, missing slot media, unready audio, unavailable Mode 3 fallback acceptance, or invalid loop end.
- Drift is reported from control audio and display renderers, and repeated over-threshold drift can degrade a rail/display.
- Show configuration is persisted as schema version 1 JSON, including mode, slots, audio configuration, display mappings, loop, rate, and sink labels.
- Runtime diagnostics can be exported as JSON.
- Unit tests cover director transport, readiness, display state, slot metadata, embedded audio source selection, sink state, fallback state, show-config persistence, timeline loop helpers, and audio capability assessment.

### 2.2 Baseline Gaps the Refactor Addresses

- Video media is still framed as fixed **slots**, and the default pool is limited to `A` and `B`.
- Images are not first-class visual media.
- Display mappings select slot ids, not arbitrary visuals from a media pool.
- Display record cards do not contain live previews.
- The control window has a numeric seek input but not a full visual timeline/scrubber.
- Looping is currently director-level and collective; it does not yet express per-video end behavior when active assigned videos have different durations.
- Audio is framed as one audio rail with main/left/right paths, not a pool of sources plus independently created virtual outputs.
- Virtual output faders and meters do not yet exist.
- Director State is expanded by default in the control UI.

## 3. Goals

- Preserve the current reliable MVP behavior while replacing fixed slot terminology and architecture with scalable pools and assignments.
- Let operators add as many visuals as needed, where each visual can be a video or image.
- Let operators bulk-import multiple visuals at once through multi-select file picking.
- Let operators add multiple audio sources, including external audio files and embedded audio from visuals.
- Let operators create multiple virtual audio outputs, each with one or more selected audio clips, per-clip dB faders, a bus dB fader, a digital meter, and a destination selection.
- Keep display windows output-only, with all control, preview, routing, and diagnostics in the control window.
- Add live display previews in the control window so every display record can be monitored from the operator surface.
- Replace the bare seek input with a visual timeline/scrubber that reflects the active assigned visual set.
- Define explicit policies for images, mixed-duration videos, loop ranges, and assigned-media changes.
- Keep current test and diagnostics affordances such as Refresh Outputs, Clear, test tones, readiness issues, and diagnostics export.
- Keep the app cross-platform and honest about physical audio-routing limitations.

## 4. Non-Goals

- No networked multi-machine synchronization in the MVP.
- No timeline authoring, cue-list programming, transitions, fades, playlists, or project-bundle asset management in this refactor.
- No timeline-synchronized image animation; image and GIF assets are not driven by director time.
- No automatic physical routing based on monitor placement.
- No guarantee that every OS/hardware setup exposes independent audio sinks.
- No interactive controls inside public display windows.
- No automatic extraction/transcoding pipeline for embedded audio; embedded sources should use browser-supported media decoding.

## 5. Users and Use Cases

### 5.1 Exhibition Operator

The operator configures visuals, audio sources, display windows, mappings, transport, loop state, and output routing from the control window. During playback, the operator needs confidence that every public display is showing the intended content and every audio output is routed at the intended level.

### 5.2 Installer or Technician

The technician verifies hardware capabilities before show time: display placement, fullscreen behavior, media decoding, audio output enumeration, physical sink routing, output faders/meters, test tones, sync drift, and diagnostics export.

### 5.3 Required MVP Playback Cases

The old Mode 1 and Mode 2 cases remain useful as presets, but they should become descriptive presets over the new pool/output model rather than separate product modes. The old Mode 3 is no longer a distinct preset because split or multi-endpoint audio routing is handled by virtual outputs.


| Preset                      | Display Setup                                  | Visual Mapping                    | Audio Setup                                                                                             |
| --------------------------- | ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Split Display on One Screen | One public display window using split layout   | Two selected visuals side by side | Existing virtual outputs remain available; the preset may create one default output if no output exists |
| Two Displays                | Two public display windows using single layout | One selected visual per display   | Existing virtual outputs remain available; routing is configured in the output section                  |


Operators may manually adjust mappings and outputs after applying a preset.

## 6. Product Requirements

### 6.1 Control Window

- There must be exactly one interactive control window.
- The control window owns:
  - Visual Pool management.
  - Audio Pool management.
  - Virtual output creation and assignment.
  - Display-window creation, closing, reopening, fullscreen, monitor placement, layout, and visual assignment.
  - Transport, rate, timeline seek, and loop controls.
  - Show configuration save/open, diagnostics export, readiness status, and issue display.
  - Test functions such as Refresh Outputs, Clear, and test tones.
  - Collapsible Director State diagnostics.
- The Director State section must be collapsed by default.
- The control window may host hidden media elements, preview elements, Web Audio graph nodes, and output meters.
- The control window must not depend on display windows as the source of playback truth.

### 6.2 Visual Pool

- Replace the operator-facing phrase **Video Slots** with **Visual Pool**.
- Replace **slot** phrasing with **visual** in user-facing UI where the concept refers to pool media.
- A visual is a visual media item of type `video` or `image`.
- The user can add as many visuals as needed.
- The MVP must support multi-select/bulk import for adding multiple visual files in one file-picking flow.
- Supported image formats for the MVP should be common browser-safe formats only: PNG, JPEG/JPG, WebP, and GIF.
- Each visual item appears as a card with:
  - stable id,
  - editable label,
  - media type,
  - source path,
  - readiness/error state,
  - duration for videos,
  - dimensions where available,
  - whether embedded audio is available or selected into the Audio Pool,
  - preview thumbnail or live preview image,
  - Replace and Clear/Remove actions.
- Visual ids should be stable data ids, not presentation letters. Labels may default to `Visual 1`, `Visual 2`, etc.
- The system should keep a small compatibility bridge in the migration from `A`/`B` slots to initial visuals, but new saved configuration should use visual records.
- Adding a video visual loads metadata and reports readiness before playback can start if that visual is assigned to an active display.
- Adding an image visual loads image metadata and reports readiness before playback can start if that visual is assigned to an active display.
- Unassigned visuals may remain invalid without blocking show readiness, but their cards must show their error state.

### 6.3 Image Playback and Synchronization

- Images are timeline-static visual media.
- If a display window selects an image visual, the display surface shows it indefinitely.
- Image visuals do not seek, play, pause, loop, or drift-correct in the same way videos do.
- When global playback is running, paused, seeking, or looping, image displays remain visually stable unless their assigned visual changes.
- Images do not determine timeline duration.
- Images do not create synchronization pressure against video media.
- If a layout contains both video and image visuals, videos follow director/media timeline rules while images remain static.

### 6.4 Display Windows and Mapping

- Display windows remain display-only Electron `BrowserWindow` instances.
- Display windows must not expose file dialogs, transport controls, routing controls, or operator diagnostics.
- Display windows are addressed by registry id and may be created dynamically.
- Display records in the control UI must allow mapping from the Visual Pool instead of fixed `A`/`B` slots.
- Display records must include:
  - display id,
  - health state,
  - current layout,
  - mapped visual ids and labels,
  - monitor selection,
  - fullscreen state,
  - drift/last correction status for video content,
  - Close, Reopen, Remove, and Fullscreen actions,
  - a live preview section.
- Existing single and split layouts remain in scope.
- Split layout should choose two visuals from the pool, not fixed slots.
- A future grid layout should be possible without redesigning the state model, but grid is not required for this MVP refactor.

### 6.5 Live Display Previews

- Every display record card in the control window must include a live preview section.
- The preview should show the same assigned content and layout as the corresponding display window.
- Preview playback should be frame-accurate relative to the public display window for the same record, using the same director time, effective media time, and media-end policy.
- Preview audio must remain muted; audio remains controlled by Audio Pool and Virtual Outputs.
- Preview fidelity should prioritize timing accuracy and truthful content state over presentation size; visual scaling may differ from the public display card size.
- If a display window is closed, the preview card should still show the configured mapping and a clear closed/degraded state.
- If preview playback fails while the public display remains healthy, the preview error should not block show readiness unless it indicates a shared media problem.

### 6.6 Audio Pool

- Replace **Stereo Audio Rail** with **Audio Pool** in the control UI.
- Remove the stereo label from user-facing source naming. The app may still validate channel support internally.
- The user can add multiple audio sources.
- Audio source types include:
  - external audio file,
  - embedded audio from a video visual,
  - embedded audio from a video-like container selected as a visual.
- Each audio source appears as a card with:
  - stable id,
  - editable label,
  - source type,
  - source path or source visual reference,
  - readiness/error state,
  - duration,
  - channel/capability status where useful but not as the primary label,
  - Replace, Clear/Remove, and preview/test affordances where practical.
- The old Choose Audio action should become Add Audio Source or Add External Audio inside the Audio Pool.
- Existing Clear behavior remains desirable and should apply at the source-card level.
- Embedded audio from a visual should remain selectable even if the visual is not assigned to a display, as long as the underlying media is available and decodable.
- Audio Pool sources do not directly play to physical outputs; virtual outputs do.

### 6.7 Virtual Outputs

- Replace hardcoded Main Output, Mode 3 Left Output, and Mode 3 Right Output with user-created virtual outputs.
- A virtual output is a logical audio mix bus that can be routed to a physical/system audio output endpoint.
- The user can create multiple virtual outputs.
- Multiple virtual outputs can play simultaneously.
- Multiple virtual outputs may use the same audio source at the same time, but they are not required to; each output owns its own selected source list and levels.
- Each virtual output record includes:
  - stable id,
  - editable label,
  - one or more selected Audio Pool sources,
  - independent dB level fader for each selected source,
  - bus-level dB fader for the final virtual output,
  - physical/system output endpoint selection,
  - digital meter display,
  - mute or enable state if feasible,
  - readiness and routing status,
  - test tone action,
  - Clear/Remove action.
- The existing Refresh Outputs function remains and refreshes physical endpoint options.
- The existing test tone functions remain but become per-virtual-output actions.
- Physical routing should continue to use the current dropdown mechanism backed by enumerated `audiooutput` devices and `setSinkId`/Web Audio capability detection.
- The system should clearly distinguish logical virtual outputs from physical output availability.
- If physical sink routing is unavailable, the virtual output must show deterministic fallback status instead of silently routing somewhere unexpected.
- Per-source faders control the level of each selected clip inside the virtual output mix.
- The bus fader controls the final level of the virtual output after its selected clips are mixed.
- Faders and meters should use audio-style dB values and digital metering.
- Meters should represent final post-bus-fader output signal where feasible; if exact post-fader metering is not feasible in the MVP, the UI should label the meter scope clearly.

### 6.8 Presets Over Pools

- Replace current Mode 1/2/3 buttons with descriptive preset actions for fast setup.
- Presets should create or update pool/output assignments rather than depending on fixed slots.
- Applying the **Split Display on One Screen** preset should:
  - ensure one display window exists,
  - set that display to split layout,
  - assign the first two available visuals if no explicit selection exists,
  - ensure at least one virtual output exists if an audio source exists.
- Applying the **Two Displays** preset should:
  - ensure two display windows exist,
  - map one visual to each display using single layout,
  - preserve existing manually selected audio outputs when possible.
- The old Mode 3 should not remain a distinct display preset; split or multi-endpoint audio is configured by creating and routing virtual outputs.
- Presets must not remove user-created extra visuals, audio sources, outputs, or display records unless explicitly requested.

### 6.9 Transport and Timeline

- Replace or supplement the numeric seek input with a full timeline/scrubber.
- The timeline must dynamically update based on currently assigned display visuals and active audio outputs.
- Video visuals assigned to active display windows participate in timeline length calculations.
- Images assigned to displays do not extend or constrain the timeline.
- Unassigned pool videos do not affect the timeline.
- The default timeline duration is the maximum duration among assigned video visuals.
- If no assigned video visual exists, but active virtual outputs have selected audio sources, the timeline follows the maximum duration among the active audio sources used by those outputs.
- If no assigned video visual and no active audio output source exists, the timeline should show an explicit no-active-duration state.
- The operator can click or drag the timeline to seek.
- The timeline should show:
  - current playhead position,
  - total active timeline duration,
  - loop start/end markers when loop is enabled,
  - optionally per-assigned-video and per-active-audio-source duration indicators or end markers.
- Existing play, pause, stop, rate, and loop controls remain.
- The bare seek input may remain as an advanced/manual field, but the timeline is the primary seek control.

### 6.10 Mixed-Duration Media Policy

The refactor must support assigned videos and active audio sources of different lengths without requiring all active media to share one duration.

- The active timeline duration is the maximum duration of assigned video visuals and, when no videos are assigned, the maximum duration of active audio sources selected by virtual outputs.
- When playback reaches a video's own end before the active timeline ends and loop is not enabled, that video freezes on its last frame while other videos continue.
- When playback reaches an audio source's own end before the active timeline ends and loop is not enabled, that audio source stops or outputs silence while other active media continue.
- When loop is enabled with the default full range from zero to the active timeline end, a shorter video loops independently from its own start when it reaches its own end. It must not force every video back to zero.
- Active audio sources should behave similarly under full-range loop: a shorter audio source loops independently from its own start when it reaches its own end.
- When a specific loop range is set, each video uses the shared loop start/end range, constrained by that video's own valid time span.
- Active audio sources also use the shared loop start/end range, constrained by each source's valid time span.
- When a video or audio source reaches the applicable loop end for that media item, it restarts from the designated loop start point.
- If the configured loop start/end cannot be applied to all currently assigned videos and active audio sources, the system must reset or adjust invalid loop settings and notify the user.
- The loop start and loop end controls must be confined to the unison time span of video media currently assigned to display windows; this means the custom loop end is constrained by the shortest assigned video.
- If no videos are assigned and the timeline is audio-driven, the loop controls are confined to the unison time span of active audio sources selected by virtual outputs.
- Unassigned videos in the Visual Pool and unused audio sources in the Audio Pool do not constrain loop settings.
- Whenever a display assignment changes, visual metadata changes, output source assignment changes, audio metadata changes, or a display is removed/reopened, the system must revalidate active timeline and loop constraints.
- If constraints are no longer met, the system should:
  - pause or keep paused if needed to avoid surprising playback,
  - reset invalid loop end to the active maximum or disable custom range,
  - preserve playhead when valid, otherwise clamp it,
  - show an operator-facing notification explaining what changed and what must be reconfigured.

### 6.11 Director and Sync

- The Electron main process remains the authoritative owner of director state.
- The director should evolve from slot-based state to pool-based state:
  - visual pool,
  - audio pool,
  - virtual outputs,
  - display mappings,
  - active timeline summary,
  - loop policy,
  - readiness and issue state,
  - drift/correction state for video renderers and audio outputs.
- Renderers subscribe to director state by IPC.
- Display renderers and control previews render from the same assignment and timeline state.
- Video media elements should use a media-specific effective time derived from director time and the mixed-duration policy.
- Image renderers ignore time-based playback controls except for assignment changes.
- Audio outputs should mix selected Audio Pool sources and apply media-specific effective time for each source.
- Audio output source playback should follow the same freeze/silence and independent loop policies as active display videos, adapted for audio.
- Drift correction should remain explicit and main-owned.
- The readiness gate should continue to block playback on required active media, display, audio-output, loop/timeline, and fallback errors.

### 6.12 Persistence and Migration

- Show configuration remains versioned JSON.
- The refactor should introduce a new schema version for pool-based configuration.
- Persisted configuration should include:
  - visual pool records,
  - audio pool records,
  - virtual output records,
  - display mappings and layouts,
  - monitor/fullscreen preferences,
  - physical output endpoint ids and labels where stable,
  - loop policy,
  - rate and relevant operator preferences.
- The app should migrate schema version 1 slot/audio configs into the new schema when opened:
  - slots `A` and `B` become initial visual records,
  - external audio file becomes an Audio Pool source,
  - embedded slot audio becomes an embedded audio source referencing the migrated visual,
  - main/left/right sink settings become virtual output records where applicable,
  - display layouts remap slot ids to migrated visual ids.
- After migration, missing files and unavailable devices must be reported as recoverable warnings or errors.
- Once a pool-based schema has shipped, future compatibility must be handled through explicit migrations rather than ad hoc fallbacks.

### 6.13 Diagnostics and Readiness

- Diagnostics export must include the new pool/output state.
- Readiness should distinguish:
  - invalid unassigned pool items,
  - active display assignment errors,
  - active audio output errors,
  - physical routing fallback state,
  - loop/timeline constraint errors,
  - preview-only errors.
- Show readiness should not be blocked by unassigned media unless that media is referenced by an active display, active audio source, active output, or preset requirement.
- Operator-facing issues should name the affected visual, audio source, output, display, or physical endpoint.
- Existing runtime fallback clarity for audio routing must be preserved.

## 7. Technical Architecture Requirements

### 7.1 State Model Sketch

```ts
type MediaId = string;
type VisualId = MediaId;
type AudioSourceId = MediaId;
type VirtualOutputId = string;
type DisplayWindowId = string;

type VisualMediaType = 'video' | 'image';

type VisualState = {
  id: VisualId;
  label: string;
  type: VisualMediaType;
  path?: string;
  url?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  hasEmbeddedAudio?: boolean;
  previewUrl?: string;
  ready: boolean;
  error?: string;
};

type AudioSourceState =
  | {
      id: AudioSourceId;
      label: string;
      type: 'external-file';
      path?: string;
      url?: string;
      durationSeconds?: number;
      ready: boolean;
      error?: string;
    }
  | {
      id: AudioSourceId;
      label: string;
      type: 'embedded-visual';
      visualId: VisualId;
      durationSeconds?: number;
      ready: boolean;
      error?: string;
    };

type LayoutProfile =
  | { type: 'single'; visualId?: VisualId }
  | { type: 'split'; visualIds: [VisualId | undefined, VisualId | undefined] };

type VirtualOutputSourceSelection = {
  audioSourceId: AudioSourceId;
  levelDb: number;
  muted?: boolean;
};

type VirtualOutputState = {
  id: VirtualOutputId;
  label: string;
  sources: VirtualOutputSourceSelection[];
  sinkId?: string;
  sinkLabel?: string;
  busLevelDb: number;
  muted?: boolean;
  meterDb?: number;
  ready: boolean;
  physicalRoutingAvailable: boolean;
  fallbackAccepted?: boolean;
  fallbackReason?: string;
  error?: string;
};

type ActiveTimelineState = {
  durationSeconds?: number;
  assignedVideoIds: VisualId[];
  activeAudioSourceIds: AudioSourceId[];
  loopRangeLimit?: { startSeconds: number; endSeconds: number };
};

type DirectorState = {
  paused: boolean;
  rate: number;
  anchorWallTimeMs: number;
  offsetSeconds: number;
  loop: { enabled: boolean; startSeconds: number; endSeconds?: number };
  visuals: Record<VisualId, VisualState>;
  audioSources: Record<AudioSourceId, AudioSourceState>;
  outputs: Record<VirtualOutputId, VirtualOutputState>;
  displays: Record<DisplayWindowId, DisplayWindowState>;
  activeTimeline: ActiveTimelineState;
  readiness: ShowReadinessState;
  corrections: CorrectionState;
};
```

### 7.2 Renderer Responsibilities

- Main process:
  - owns director state and schema migrations,
  - owns display registry,
  - owns file dialogs and persisted path handling,
  - computes active timeline and loop validity,
  - broadcasts state to all renderers,
  - receives metadata, readiness, drift, and routing capability reports.
- Control renderer:
  - renders Visual Pool, Audio Pool, Virtual Outputs, Display Records, previews, timeline, and diagnostics,
  - hosts audio graph/output elements where Electron/Chromium requires renderer-owned media APIs,
  - reports audio metadata, meter values, routing capability, and output errors,
  - keeps preview audio muted.
- Display renderer:
  - renders assigned visual layout only,
  - supports video and image elements,
  - keeps all media muted,
  - reports video readiness and drift for video content,
  - applies media-specific effective time from director state.

### 7.3 IPC Direction

The current typed preload API should remain, but channels should be renamed or extended around pool concepts:

- `visual:add`, `visual:replace`, `visual:clear`, `visual:remove`, `visual:metadata`
- `audio-source:add-file`, `audio-source:add-embedded`, `audio-source:remove`, `audio-source:metadata`
- `output:create`, `output:update`, `output:remove`, `output:test-tone`, `output:capabilities`
- `display:create`, `display:update`, `display:close`, `display:reopen`, `display:remove`, `display:list-monitors`
- `director:get-state`, `director:transport`, `director:apply-preset`, `director:state`
- `show:save`, `show:save-as`, `show:open`, `show:export-diagnostics`
- `renderer:ready`, `renderer:drift`

## 8. Acceptance Criteria

- The app still launches one control window and no display windows by default.
- The operator can add at least three visuals without code or UI assumptions limiting the pool to two.
- The operator can bulk-import multiple visual files in one file-picking flow.
- The Visual Pool supports both video and browser-safe image media.
- Each visual appears as a card with metadata and preview.
- Display mapping controls select visuals from the Visual Pool instead of slots `A` and `B`.
- A display assigned to an image shows the image indefinitely and does not create sync warnings.
- A display assigned to a video follows director transport and correction policy.
- Display record cards include frame-accurate live previews that mirror public display layout/content.
- The timeline duration updates from the maximum duration of videos assigned to active displays, or from active audio output sources when no videos are assigned.
- The operator can click or drag the timeline to seek.
- Mixed-duration assigned videos and active audio sources follow the specified freeze/silence/loop behavior.
- Invalid loop ranges are confined to the shared valid span of assigned videos, or active audio sources for audio-only playback, reset when needed, and surfaced to the operator.
- The Audio Pool supports multiple audio sources, including external files and embedded audio from visuals.
- The UI no longer labels the main audio section as stereo.
- The old Choose Audio flow is replaced by Audio Pool add-source behavior.
- The operator can create multiple virtual outputs.
- Each virtual output can select multiple audio sources, provide per-source dB faders, provide a bus dB fader, select a physical endpoint, show a digital meter, and run a test tone.
- Refresh Outputs and Clear remain available in the relevant audio/output sections.
- Existing split-audio fallback clarity is preserved through virtual output routing status.
- Existing Mode 1/2 display behavior remains available through descriptive presets over the new pool/output model; old Mode 3 behavior is covered by virtual output routing rather than a separate preset.
- Show config save/open works through a new schema version and migrates old slot-based configs.
- Diagnostics export includes Visual Pool, Audio Pool, Virtual Outputs, display mappings, readiness, and active timeline state.
- Director State is collapsed by default.
- Unit tests cover pool state, migration, active timeline calculation, image behavior, mixed-duration video/audio loop policy, output routing state, and readiness classification.

## 9. Build Phases

### Phase 1: Schema and Terminology Refactor

- Introduce pool-based shared types while preserving current runtime behavior.
- Add schema migration from slot/audio schema version 1 to pool-based schema version 2.
- Rename user-facing Video Slots to Visual Pool and Stereo Audio Rail to Audio Pool.
- Keep compatibility tests for the current two-visual show setup.

### Phase 2: Visual Pool and Image Support

- Add arbitrary visual creation/removal.
- Support multi-select visual import.
- Support browser-safe image file selection and metadata readiness.
- Update display layouts to reference visual ids.
- Update display renderer to render video or image visuals.
- Add visual cards with preview image/thumbnail.

### Phase 3: Display Records and Live Previews

- Add display card preview surfaces in the control renderer.
- Share display layout rendering logic between public display and control preview where practical.
- Keep previews muted and operator-scoped.
- Preserve close/reopen/remove/fullscreen/monitor controls.

### Phase 4: Active Timeline and Mixed-Duration Policy

- Compute active timeline from assigned video visuals and active output audio sources.
- Add timeline scrubber UI with loop markers.
- Implement per-media effective time behavior for video freeze, audio silence, and independent loop policies.
- Revalidate loop constraints on display assignment, output source assignment, and media metadata changes.
- Add operator notifications for automatic loop resets/clamps.

### Phase 5: Audio Pool

- Add multiple audio sources.
- Migrate external audio and embedded slot audio into audio source records.
- Update source readiness and duration handling.
- Preserve embedded audio from visuals.
- Move Choose Audio and Clear actions into source-card behavior.

### Phase 6: Virtual Outputs

- Replace main/left/right hardcoded UI with virtual output records.
- Add output creation/removal, multi-source assignment, sink assignment, per-source dB faders, bus dB fader, digital meter, and test tone controls.
- Preserve physical routing capability detection and fallback classification.
- Update readiness and diagnostics for virtual outputs.

### Phase 7: Presets, Persistence, and Hardening

- Rebuild Mode 1/2 display behavior as descriptive presets over Visual Pool, Audio Pool, and Virtual Outputs.
- Save/open pool-based show configuration.
- Export updated diagnostics.
- Add focused unit tests and manual test updates.
- Validate packaged behavior on Windows and macOS hardware.

## 10. Risks and Mitigations

- Risk: Frame-accurate live previews double media element count and may increase CPU/GPU load.
  - Mitigation: Share timing helpers, keep previews muted and modest in size, test with representative media, and add future preview quality controls if needed.
- Risk: Mixed-duration loop behavior is more complex than the current director-wide loop.
  - Mitigation: Isolate active timeline and media-effective-time helpers in shared pure modules with tests.
- Risk: Multi-source virtual output mixing increases Web Audio graph complexity.
  - Mitigation: Keep the MVP graph explicit: one gain node per selected source, one bus gain per virtual output, and clear capability/error reporting.
- Risk: Physical audio output routing remains platform-dependent.
  - Mitigation: Keep current capability detection, explicit fallback reasons, test tones, and readiness warnings.
- Risk: Schema migration could break current working show configs.
  - Mitigation: Add migration tests with representative version 1 configs before replacing persistence behavior.
- Risk: Virtual outputs could imply true independent hardware routing even when Chromium/OS cannot provide it.
  - Mitigation: Label logical routing and physical routing separately, and block show readiness where physical routing is required but unavailable.

## 11. Open Questions

- Should visual previews be generated as static thumbnails, live muted media elements, or both depending on media type?
- Should virtual outputs support mute/solo at the per-source level in the MVP, or only per-source level and output-level mute?
- Should meters show peak, RMS/LUFS-style values, or a simple digital peak meter for the MVP?
- Should audio-only timelines visually distinguish output buses and source clips, or keep a single global playhead only?
- Should GIFs be treated as static image assets or animated browser image assets in display windows?

## 12. Definition of Done for the Refactor MVP

- Current two-display exhibition playback remains functional through presets.
- The old fixed slot model is replaced in user-facing UI by Visual Pool and display visual assignment.
- Video and image visuals can be assigned to displays and previewed frame-accurately from the control window.
- Timeline, seek, loop, mixed-duration video behavior, and mixed-duration audio behavior are deterministic and covered by tests.
- Audio sources are managed through Audio Pool.
- Audio routing is managed through virtual outputs with multi-source dB faders, bus dB fader, digital meter UI, and physical endpoint selection.
- Show config migration preserves existing practical configurations.
- Readiness and diagnostics clearly identify active media, display, output, timeline, loop, and routing problems.
- Director State is collapsed by default while remaining available for diagnostics.

