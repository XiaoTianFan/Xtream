# PRD: Electron Cross-Platform Multi-Display Player

## 1. Summary

Build a Windows and macOS Electron application for synchronized multi-display exhibition playback. The app has exactly one interactive control window and a dynamic number of display-only windows. It supports three initial playback modes over one shared playback engine: single public split screen, two extended displays with shared stereo audio, and two extended displays with left/right audio routing to selectable physical outputs.

The product must treat video and audio as decoupled rails driven by one authoritative timeline. Display windows are video-only surfaces. The control window owns all interaction, routing configuration, transport, status, and audio playback or audio graph control.

## 2. Goals

- Provide a reliable operator-controlled player for exhibition playback on Windows and macOS.
- Support one control window plus `0..N` display-only windows without hardcoding two display windows into the architecture.
- Support the current show requirement of two video slots and two display windows while leaving room for additional display windows, slots, and layout profiles.
- Keep audio and video decoupled, joined only through a shared director clock.
- Provide mode-based configuration for the three required playback cases without creating separate products or separate playback engines.
- Support per-output audio routing where Chromium, Electron, and the host OS expose multiple `audiooutput` devices.
- Make the app testable on show hardware through device enumeration, test tones, sync diagnostics, and clear fallback states.

## 3. Non-Goals

- No Python server in the default application stack.
- No interactive controls in display windows.
- No automatic audio routing based on which monitor a window is on.
- No guarantee that every OS or hardware combination exposes independent physical audio sinks.
- No networked multi-machine synchronization in the first version.
- No editing, transcoding, playlist authoring, or media asset management beyond selecting and validating playback assets.

## 4. Users and Use Cases

### Primary User: Exhibition Operator

The operator needs to configure media files, assign video slots to screens, choose playback mode, choose audio routing, monitor status, and run playback without exposing controls to the audience.

### Secondary User: Installer or Technician

The technician needs to verify that the target machine, displays, and audio devices can support the selected playback mode before the exhibition opens.

### Required Playback Cases


| Mode | Screens                                           | Windowing                                           | Video                                                             | Audio                                                                       |
| ---- | ------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1    | One audience screen plus optional operator screen | One control window plus one display window          | Two video slots rendered side by side in one split display window | One stereo stream to default or selected sink                               |
| 2    | Two extended screens plus operator screen         | One control window plus two display windows for MVP | One slot per display window                                       | One stereo stream to default or selected sink                               |
| 3    | Two extended screens plus operator screen         | Same as mode 2                                      | One slot per display window                                       | One stereo file, routed as L/R mono paths to selected sinks where available |


For future `N > 2` display windows, the same registry, slot mapping, and layout profile model must apply.

## 5. Product Requirements

### 5.1 Control Window

- There must be exactly one control window.
- The control window contains all interactive UI:
  - Transport: play, pause, stop, seek, rate where applicable.
  - Media selection for video slots and audio file.
  - Mode selection.
  - Slot-to-display mapping.
  - Display window creation, closing, fullscreen, monitor placement, and layout profile selection.
  - Audio sink selection and L/R output assignment.
  - Loop settings.
  - Read-only status such as timecode, duration, drift, display connection state, and audio device availability.
- The control window may contain hidden media elements or Web Audio graph nodes for audio playback.
- The control window must not depend on a display window as the source of playback truth.

### 5.2 Display Windows

- Display windows are display-only Electron `BrowserWindow` instances.
- Display windows must not expose menus, file dialogs, transport controls, or routing controls.
- Display windows render assigned video slots based on state received from the main process.
- Display windows must be addressable by registry id, not by fixed names such as `win1` and `win2`.
- Each display window registry entry should track:
  - `id`
  - `webContents`
  - bounds
  - target display or monitor metadata
  - fullscreen state
  - layout profile
  - assigned slot mapping
  - renderer health and drift status

### 5.3 Layout Profiles

- The first supported display layout profiles are:
  - `single`: one video slot fills the display window.
  - `split`: two video slots side by side in one display window.
- Layout profile state must be per display window.
- The state model should support future profiles such as grid, confidence-monitor overlays, or picture-in-picture without redesigning the director.

### 5.4 Slot Mapping

- Media is assigned to logical video slots such as `A`, `B`, and future `C..N`.
- Display windows consume slots through a mapping table, for example:
  - Mode 1: display `0` uses layout `split` with slots `A` and `B`.
  - Mode 2: display `0` uses layout `single` with slot `A`; display `1` uses layout `single` with slot `B`.
  - Mode 3: same video mapping as mode 2, with different audio routing.
- Slot mapping must live in shared app state controlled by the main process.

### 5.5 Audio Routing

- Audio playback is owned by the control window renderer or a main-process-supported audio service.
- Display windows must remain video-only.
- Mode 1 and mode 2 require one stereo audio path to one selected output sink.
- Mode 3 requires one stereo source split into assignable paths:
  - Left channel to a selected physical output path.
  - Right channel to a selected physical output path.
  - If independent sinks are unavailable, degrade clearly and preserve logical L/R separation in the UI.
- The app must enumerate `audiooutput` devices and show meaningful labels when permitted by the OS and browser permissions model.
- The app should provide test tones per output path so installers can confirm routing before show playback.
- Mode 3 fallback must be deterministic:
  - If two independent sinks are available, route left and right mono paths to the selected sinks.
  - If only one sink is available, route the original stereo file to that sink, keep logical L/R assignments visible but marked as not physically separated, and block "show ready" status until the operator accepts the fallback.
  - If sink assignment APIs are unavailable, use the system default output, keep mode 3 selectable for rehearsal only, and show a blocking warning for exhibition readiness.
- The Mode 3 audio architecture is a blocking spike. Implementation should not proceed beyond prototype status until packaged Windows and macOS builds prove that the selected approach can route two independent test tones to two sinks on target-like hardware.

### 5.6 Director and Sync

- The Electron main process owns the director clock.
- The director state includes:
  - paused/running state
  - playback rate
  - anchor wall time
  - offset seconds
  - duration
  - loop policy
  - active mode
  - active media and mapping configuration
- All renderers subscribe to director events via IPC.
- The main process fans out sync, time update, config, and correction events to the control window and all display windows.
- Audio and video renderers report observed media time and readiness status back to the main process.
- Main applies one correction policy for drift across all rails.
- Target sync tolerance should initially be 50-100 ms, then tightened only if hardware validation supports it reliably.
- Playback start requires a readiness barrier. The director should not enter running state until required audio and video rails have loaded metadata, accepted the current config, and acknowledged the pending start command.
- Transport commands should be two-phase where needed: main broadcasts prepare/seek, waits for readiness or timeout, then broadcasts the shared start anchor.
- Correction policy should be explicit in implementation:
  - Under small drift, allow natural playback to continue and report status only.
  - Over threshold, seek or adjust the affected rail according to one main-owned policy.
  - If a rail repeatedly fails to catch up, mark it degraded and surface the issue in the control window.
- The MVP sync target is steady-state drift within 100 ms after startup, seek, and loop boundaries. Startup and seek settling time should be measured and reported during validation.

### 5.7 Media Duration Policy

- The expected exhibition case is duration-matched video and audio assets.
- The app must validate durations after metadata load and warn when any active slot or audio file differs from the director duration beyond a configurable tolerance.
- For MVP, the audio file is the default director duration when present. If no audio file is present, the longest active video slot is the director duration.
- Assets shorter than the active loop or director duration are not silently looped independently. They should block show-readiness unless the operator explicitly accepts a rehearsal-only degraded state.
- Loop start and end points are director-level values and apply to all active rails.

### 5.8 Looping

- Looping is controlled by the director.
- At loop boundaries, the director resets the timeline iteration and broadcasts coordinated seek/reset commands.
- All video slots and audio rails must seek together.

### 5.9 Persistence

- The app should persist show configuration separately from transient playback state.
- Persisted configuration should include:
  - mode
  - slot media paths
  - audio file path
  - slot-to-display mapping
  - layout profiles
  - fullscreen preferences
  - preferred audio sink ids where stable
  - loop policy
- On startup, missing media files or unavailable devices must be surfaced as recoverable warnings.
- Configuration files should be importable and exportable as versioned JSON.
- Media paths should be stored as absolute paths for local machine restore, with room to add relative paths if a future project-bundle format is introduced.
- Persisted audio devices should store both sink ids and human-readable labels. If restored ids are unavailable, match by label when safe, otherwise require operator confirmation.
- The app must preserve backward compatibility for saved show files once the first exhibition version is shipped.

## 6. Technical Architecture

### 6.1 Stack

- Electron main process as application server, director, IPC router, and display window registry.
- Electron renderers for the control UI and display-only video surfaces.
- Node modules may be loaded by main for filesystem, persistence, and platform integration.
- No Python service in the default design.

### 6.2 Main Process Responsibilities

- Create and own the single control window.
- Create, register, route IPC to, and destroy `0..N` display windows.
- Maintain authoritative playback state and app configuration.
- Broadcast director state to all renderers.
- Receive drift and readiness reports.
- Apply correction policy.
- Persist and restore show configuration.

### 6.3 Control Renderer Responsibilities

- Render all UI controls and status.
- Manage file selection flows.
- Host or control the audio engine.
- Enumerate available audio output devices.
- Apply `setSinkId` or `AudioContext.setSinkId` where supported.
- Report audio readiness, playback time, drift, and device routing status to the director.

### 6.4 Display Renderer Responsibilities

- Render assigned video slots only.
- Keep video muted when audio is sourced separately.
- Subscribe to director sync and config events.
- Seek and correct video based on director time.
- Report video readiness, current media time, and drift.

### 6.5 IPC Model

- IPC channels should be typed and route by window registry id or broadcast group.
- Avoid fixed channels or code paths such as `display1` and `display2`.
- Suggested channel groups:
  - `director:state`
  - `director:transport`
  - `director:sync`
  - `display:create`
  - `display:update`
  - `display:close`
  - `renderer:ready`
  - `renderer:drift`
  - `audio:devices`
  - `audio:routing`

## 7. Leverage Points and Improvements

- Treat modes as presets over a shared configuration schema. This keeps mode switching simple and prevents mode-specific playback engines from diverging.
- Build a capability matrix at runtime. The UI should know which features are currently possible: number of displays, number of audio outputs, `setSinkId` support, `AudioContext.setSinkId` support, fullscreen availability, and permissions state.
- Add a show-readiness checklist in the control window. It can confirm media loaded, durations match, displays open, fullscreen active, audio outputs assigned, drift within tolerance, and loop policy selected.
- Add a diagnostics panel early. Drift logs, renderer heartbeats, device ids, display ids, and correction events will be critical during installation.
- Make test media a first-class tool. Include simple test tone generation and visual sync markers so hardware validation does not require final assets.
- Store layout and routing as data, not branching UI logic. This makes future display surfaces, confidence monitors, and additional slots much cheaper.
- Create a thin media adapter boundary. Start with HTML media elements and Web Audio, but isolate timing operations so future canvas or WebCodecs rendering can be introduced without replacing the director.
- Validate media compatibility up front. Duration mismatch, missing audio channels, unsupported codecs, and absent files should appear before playback starts.
- Prefer explicit degradation over hidden fallback. If independent audio sinks are unavailable, mode 3 should clearly say that physical split routing is not available on this machine.
- Design for show recovery. A renderer crash, unplugged display, or missing sink should produce an actionable status and allow the operator to reopen or remap without restarting the app where practical.

## 8. Platform Requirements

### Windows

- Enumerate WASAPI audio endpoints exposed to Chromium.
- Verify HDMI, Bluetooth, default device, and external interfaces on target hardware.
- Confirm per-element or per-context sink routing behavior in packaged Electron builds.
- Confirm fullscreen and monitor placement behavior across extended displays.

### macOS

- Enumerate available audio outputs exposed to Chromium.
- Verify whether multiple HDMI endpoints appear as independent devices on target hardware.
- Confirm that manual in-app assignment is used for physical output routing.
- Confirm fullscreen behavior, Spaces behavior, and external display placement.

### Cross-Platform Spike

The first hardware spike must verify:

- `navigator.mediaDevices.enumerateDevices()` returns expected `audiooutput` devices.
- `HTMLMediaElement.setSinkId` works where expected.
- `AudioContext.setSinkId` works where expected, or an equivalent per-output strategy is available.
- Two different sinks can play independent test tones.
- Display windows can be placed and fullscreened on intended monitors.
- Drift reports can be collected from control audio and each display video renderer.

### Packaging Baseline

- Define supported OS versions before the MVP implementation begins.
- Validate sink APIs, fullscreen behavior, and media decoding in packaged builds, not only in Electron development mode.
- Installer, code-signing, and notarization requirements should be decided before exhibition hardening starts.

## 9. User Experience Requirements

- The operator should be able to configure a complete show from the control window only.
- Display windows should have no visible control chrome during exhibition playback.
- The UI should clearly distinguish logical routing from physical device availability.
- Mode selection should apply a preset mapping but allow manual adjustment afterward.
- The app should warn before entering playback if required assets, windows, or audio routes are missing.
- The control window should remain usable on the operator display while public display windows are fullscreen.
- A third display window must be creatable, assignable to a slot/layout, fullscreenable, and visible in diagnostics in the MVP architecture validation even if the current show only uses two public surfaces.
- Operator-facing errors should name the failed subsystem, the affected display or sink, and the next available recovery action.

### Error and Recovery Requirements

- Missing media file: keep configuration loaded, mark the affected slot or audio file invalid, and prompt for replacement.
- Unavailable audio sink: fall back according to the Mode 3 fallback policy and require operator acknowledgement before show-ready status.
- Display disconnected or fullscreen placement failed: keep the display window registry entry degraded, allow remapping to another monitor, and avoid losing slot assignments.
- Display renderer crash: show degraded status, allow reopening the display window with its previous mapping, and keep director state authoritative.
- Codec or media decode failure: block playback readiness for the affected asset and show the failing file path.
- Drift outside tolerance: warn while attempting the configured correction policy; escalate to degraded if correction repeatedly fails.

## 10. Acceptance Criteria

- The app launches one control window and no display windows by default.
- The operator can create and close display windows dynamically.
- The main process tracks display windows in a registry keyed by id.
- Mode 1 can play two muted video slots side by side in one display window with one stereo audio file from the control audio rail.
- Mode 2 can play two video slots in two separate display windows with one stereo audio file from the control audio rail.
- Mode 3 can split a stereo audio file into logical L/R paths and assign each path to available sinks where supported.
- If only one sink is available, mode 3 routes stereo to the single sink, marks physical split routing unavailable, and requires operator acknowledgement before rehearsal playback.
- All playback rails are driven by director time.
- Renderers report drift to main.
- Looping resets audio and video rails together.
- A third display window can be created, mapped, fullscreened, and monitored without changing core director or IPC assumptions.
- The same codebase packages and runs on Windows and macOS.

## 11. Build Phases

### Phase 1: Electron Shell and Director

- Scaffold Electron app.
- Create one control `BrowserWindow`.
- Add display window factory and registry.
- Implement director state in main.
- Implement IPC fan-out to registered windows.

### Phase 2: Display Template and Mapping

- Build display-only renderer.
- Implement `single` and `split` layout profiles.
- Add slot-to-display mapping state.
- Support mode 1 with one split display window.

### Phase 3: Video Rail

- Add two video slots with generalizable slot state.
- Drive video current time from director time.
- Add readiness and drift reporting from display windows.
- Support mode 2 with two display windows.

### Phase 4: Stereo Audio Rail

- Add control-owned audio playback.
- Support one selected stereo sink.
- Decouple audio current time from video elements.
- Validate mode 1 and mode 2 with shared audio.

### Phase 5: L/R Routing

- Implement Web Audio split path for stereo source.
- Add sink selection per output path where supported.
- Add test tones and sink diagnostics.
- Validate mode 3 fallback when independent sinks are unavailable.

### Phase 6: Cross-Platform Validation

- Test on Windows and macOS show hardware.
- Validate monitor placement, fullscreen behavior, audio device enumeration, sink independence, and drift.
- Capture platform-specific caveats in operator-facing status text.

### Phase 7: Persistence and Hardening

- Persist show configuration.
- Add recovery flows for missing files, unavailable sinks, display disconnects, and renderer crashes.
- Add diagnostics export.
- Package and smoke test production builds.

## 12. Risks and Mitigations

- Risk: `setSinkId` or `AudioContext.setSinkId` support differs by Electron version or OS.
  - Mitigation: spike early, feature-detect at runtime, and keep mode 3 fallback explicit.
- Risk: device ids are unstable across reboot or hardware changes.
  - Mitigation: persist preferred labels and ids, then require operator confirmation when restored devices do not match.
- Risk: independent audio outputs are not available on show hardware.
  - Mitigation: provide pre-show readiness checks and clear fallback behavior.
- Risk: video drift varies across displays or codecs.
  - Mitigation: collect drift reports, apply main-owned correction, validate codecs, and expose diagnostics.
- Risk: fullscreen placement differs across macOS Spaces and Windows extended display setups.
  - Mitigation: test packaged builds on target hardware and provide manual remapping controls.
- Risk: future display counts get blocked by two-window assumptions.
  - Mitigation: enforce registry-based routing and avoid fixed display identifiers from the first phase.

## 13. Open Questions

- Which Electron version will be used, and does it expose the required sink APIs in packaged builds on both target platforms?
- Which Mode 3 audio approach passes the blocking packaged-build spike: hidden media elements with `setSinkId`, Web Audio with `AudioContext.setSinkId`, or a hybrid fallback?
- What codecs, containers, frame rates, and resolutions are expected for final exhibition media?
- Is sub-frame sync required, or is 50-100 ms acceptable for the installation?
- Should display layouts support bezel compensation or pixel-precise offsets in the first release?
- What installer, signing, notarization, and auto-update expectations apply to the packaged app?
- Should show configuration eventually support a portable project bundle with relative media paths?

## 14. Initial Data Model Sketch

```ts
type SlotId = string;
type DisplayWindowId = string;

type LayoutProfile =
  | { type: 'single'; slot: SlotId }
  | { type: 'split'; slots: [SlotId, SlotId] };

type DisplayWindowState = {
  id: DisplayWindowId;
  bounds: Electron.Rectangle;
  displayId?: string;
  fullscreen: boolean;
  layout: LayoutProfile;
  health: 'starting' | 'ready' | 'stale' | 'closed';
  lastDriftSeconds?: number;
};

type DirectorState = {
  paused: boolean;
  rate: number;
  anchorWallTimeMs: number;
  offsetSeconds: number;
  durationPolicy: 'audio' | 'longest-video';
  durationSeconds?: number;
  loop: { enabled: boolean; startSeconds: number; endSeconds?: number };
  mode: 1 | 2 | 3;
  slots: Record<SlotId, { videoPath?: string; durationSeconds?: number }>;
  audio: {
    path?: string;
    sinkId?: string;
    leftSinkId?: string;
    rightSinkId?: string;
    physicalSplitAvailable: boolean;
    fallbackAccepted: boolean;
  };
  displays: Record<DisplayWindowId, DisplayWindowState>;
};
```

## 15. Definition of Done for MVP

- Modes 1, 2, and 3 are selectable from the control window.
- Current show setup with two video slots and two display windows works on Windows and macOS test machines.
- Mode 3 has verified sink independence on at least one supported hardware setup, with a clear fallback elsewhere.
- Display window count is dynamic in code and not limited by fixed `win1`/`win2` paths.
- Audio and video are synchronized by director time, not by one media element following another.
- Operator can save and restore a show configuration.
- Packaged builds include a hardware validation checklist and diagnostics logs sufficient for installation troubleshooting.

