# Live Visual Capture Source Plan

## Purpose

Xtream currently treats visual media as file-backed `video` or `image` records. This plan designs a new live visual source path for webcam, screen, screen-region, and app/window capture while preserving the existing media pool and multi-display renderer architecture.

The target UX is:

1. In the media pool `Visuals` tab, clicking `Add Media` opens a compact menu instead of immediately opening the file picker.
2. The first menu offers `Local static files` and `Live stream`.
3. `Local static files` keeps the current file dialog behavior.
4. `Live stream` opens a second picker with:
   - `Webcam`
   - `Screen`
   - `Screen region`
   - `App/window`
5. Technically tricky items can be staged, but the data model should leave room for all four options.

## Current Architecture Findings

Relevant files:

- `src/renderer/index.html` owns the media pool shell and `#addVisualsButton`.
- `src/renderer/control.ts` handles tab state, add button clicks, drag-drop import, asset rows, previews, and details.
- `src/main/main.ts` owns file dialogs and IPC handlers such as `visual:add`, `visual:add-dropped`, `visual:replace`, and `visual:metadata`.
- `src/main/director.ts` owns authoritative `DirectorState`, visual records, readiness, timeline calculation, persistence projection, and restore.
- `src/shared/types.ts` defines serializable state and IPC contracts.
- `src/renderer/display.ts` renders assigned visuals in output windows from serialized `DirectorState`.
- `src/main/displayRegistry.ts` creates output `BrowserWindow`s and broadcasts director state to them.
- `src/main/showConfig.ts` persists file-backed media paths and rebuilds renderer file URLs on load.

Important constraints:

- `DirectorState` is broadcast through IPC and must stay serializable. `MediaStream`, `MediaStreamTrack`, `HTMLVideoElement`, and `DesktopCapturerSource` objects cannot be stored in it.
- Display windows render independently. Any live source assigned to two displays needs each display renderer to acquire and own its own stream, or a future compositor needs to distribute frames through a different channel.
- Current visual playback assumes finite media for timeline sync. Live sources should be treated as indefinite video rails with no duration and no seek/loop behavior.
- Current embedded audio detection auto-creates audio sources for file videos with audio. Live camera audio should also become an audio source, but it must not be routed automatically and every routing action should warn about feedback risk.
- Current show config schema is `schemaVersion: 4`; adding live sources should be a schema migration, not a loose optional field layered onto v4.

## Recommended Source Model

Change `VisualState` from one flat file-oriented shape into a discriminated model while keeping common display controls:

```ts
type VisualState = FileVisualState | LiveVisualState;

type FileVisualState = {
  kind: 'file';
  type: 'video' | 'image';
  path?: string;
  url?: string;
  // existing metadata and controls
};

type LiveVisualState = {
  kind: 'live';
  type: 'video';
  capture: LiveVisualCaptureConfig;
  linkedAudioSourceId?: string;
  durationSeconds?: undefined;
  path?: undefined;
  url?: undefined;
  hasEmbeddedAudio?: boolean;
  // existing label, opacity, brightness, contrast, ready/error
};

type LiveVisualCaptureConfig =
  | { source: 'webcam'; deviceId?: string; groupId?: string; facingMode?: string; label?: string; includeAudio?: boolean; audioDeviceId?: string }
  | { source: 'screen'; sourceId?: string; displayId?: string; label?: string }
  | { source: 'screen-region'; sourceId?: string; displayId?: string; label?: string; crop: CaptureCropRect }
  | { source: 'window'; sourceId?: string; appName?: string; windowName?: string; label?: string };
```

Persist this as `PersistedShowConfigV5`. For file visuals, migrate v4 records to `kind: 'file'`. For live visuals, persist user intent and labels, but treat operating-system source IDs as hints because screen/window IDs are not guaranteed to survive app restarts.

Recommended live metadata:

- `ready`: renderer reported at least one active video track.
- `error`: permission denied, source missing, device missing, or stream ended unexpectedly.
- `width` / `height`: live track settings or video element metadata.
- `capture.revision`: optional increment whenever the user reselects the live source, so display renderers can reacquire streams.
- `linkedAudioSourceId`: optional audio-pool source created from webcam microphone input.

## Main Process Capture Broker

Add a small live capture broker in main, either inside `src/main/main.ts` initially or as `src/main/liveCapture.ts` once it grows.

Responsibilities:

- List available webcam devices through a renderer request flow, or through control renderer `enumerateDevices` after permission is granted.
- List screen/window sources through Electron `desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize, fetchWindowIcons: true })`.
- Use Xtream's own source picker as the cross-platform default. Electron's native system picker path is currently experimental and macOS 15+ only, so it is not enough for deterministic Windows, macOS, and Linux behavior.
- Install Electron session permission handlers early in `app.whenReady()`:
  - `session.defaultSession.setPermissionCheckHandler(...)`
  - `session.defaultSession.setPermissionRequestHandler(...)`
  - `session.defaultSession.setDisplayMediaRequestHandler(...)`
- Only grant `media` and `display-capture` permissions to Xtream-controlled windows.
- For `getDisplayMedia`, consume a pending grant keyed by requesting `webContents.id`.

The pending grant handshake is important because `setDisplayMediaRequestHandler` receives the requesting frame, but not Xtream's `visualId`.

Proposed IPC:

- `live-capture:list-desktop-sources`: returns serializable source summaries with `id`, `name`, `displayId`, `thumbnailDataUrl`, `appIconDataUrl`, and `kind`.
- `live-capture:create`: creates a live visual record in `Director`.
- `live-capture:update`: updates capture config or crop.
- `live-capture:prepare-display-stream`: called by a renderer immediately before `navigator.mediaDevices.getDisplayMedia()`. Main records `{ webContentsId, visualId, sourceId }`.
- `live-capture:release-display-stream`: optional cleanup for stale pending grants.
- `live-capture:permission-status`: reports macOS media/screen permission status where available.
- `live-capture:confirm-feedback-risk`: optional main-mediated confirmation helper before routing live microphone sources.

Flow for screen/window capture:

1. Control renderer asks main for `desktopCapturer` sources.
2. User selects a screen or window in the live-source picker.
3. Main creates a `LiveVisualState` with the selected source descriptor.
4. When a display renderer needs that visual, it calls `prepare-display-stream(visualId)`.
5. Display renderer calls `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })`.
6. Main `setDisplayMediaRequestHandler` grants the matching `DesktopCapturerSource`.
7. Display renderer attaches the resulting stream to a `<video>` with `srcObject`.

For webcam capture, renderers can call `navigator.mediaDevices.getUserMedia({ video: { deviceId } })` directly after permission is granted. Main permission handlers still decide whether media access is allowed.

## Native Picker Decision

Electron exposes `session.defaultSession.setDisplayMediaRequestHandler(..., { useSystemPicker: true })`, but current Electron documentation describes this as experimental and currently available only on macOS 15+. When the system picker is used, Electron's request handler is not invoked, which also makes deterministic source assignment and persisted source restore harder.

Recommendation:

- Use `desktopCapturer.getSources` plus an Xtream-rendered picker as the primary picker on Windows, macOS, and Linux.
- Keep `useSystemPicker` behind a future platform flag only if we decide native macOS picker trust is more important than deterministic selection.
- Do not base MVP behavior on the native picker.

## Renderer Runtime

Create `src/renderer/control/liveCaptureRuntime.ts` or `src/renderer/liveCaptureRuntime.ts` to avoid duplicating live stream handling in `control.ts` and `display.ts`.

Responsibilities:

- Acquire webcam streams with `getUserMedia`.
- Acquire screen/window streams with the `prepare-display-stream` plus `getDisplayMedia` handshake.
- Attach streams to video elements.
- Stop tracks when visuals are removed, layout changes, previews close, or windows unload.
- Listen for `track.onended` and report `visual:metadata` with `ready: false` plus a useful error.
- Report dimensions from `video.videoWidth/videoHeight` or track settings.
- Apply region crop presentation where needed.
- Treat live visuals as independent indefinite image-like sources, not timed transport media.

Display renderer changes:

- `createVisualElement` branches on `visual.kind === 'live'`.
- Live visuals create a muted autoplay `<video>` with `srcObject`, not `src`.
- `syncVideoElements` skips seek/currentTime sync for live visuals but still applies opacity, brightness, contrast, global blackout, and display health reporting.
- `createRenderSignature` includes live capture config and revision.
- Loop, seek, playback rate, and stop-to-zero behavior never mutate live stream playback. A live visual in a display behaves like an indefinitely running image rail.

Control renderer changes:

- Replace the direct `window.xtream.visuals.add()` click path with an add menu when `activePoolTab === 'visuals'`.
- Reuse the existing `.context-menu` visual language for the menu.
- Keep audio-tab behavior unchanged: `Add Media` still calls `audioSources.addFile()`.
- Add live visual rows with metadata such as `live | webcam | 1920x1080` and a live status indicator.
- Update asset preview to render live streams through the same runtime helper.
- Add details controls to reselect device/source and, later, edit crop.

## Preview And Transport Semantics

Live streams need two distinct preview/output lifecycles.

### Media Pool Preview

When the selected media-pool item is a live visual, the small asset preview panel should acquire and render the stream immediately. It must stop immediately when:

- The user selects a different visual or audio source.
- The active pool tab changes away from the selected live visual.
- The asset preview is hidden or destroyed.
- The source is removed.

This preview is only an operator preview. It does not imply the stream is currently being sent to any display.

### Display Card Preview

When a display mapping references a live visual, the preview inside the Display Windows section should render continuously, even if global transport is paused or stopped. This gives the operator confidence that the live input is healthy before taking it to output.

The display-card preview is separate from the real display output. If transport is paused or stopped and the display output is already showing an older frame/state, updating the preview must not update the actual display window. Play, pause, and stop determine when the live stream is committed to or refreshed on the real display output.

### Real Display Output

A display output assigned to a live visual should not be driven by loop timing. It should:

- Ignore loop range changes.
- Ignore seek operations.
- Ignore file-style currentTime correction.
- Continue using live frames while transport is playing.
- Freeze, hold, or blackout according to explicit transport/display policy when paused or stopped.

The exact paused/stopped visual policy should be confirmed before implementation. The safest production default is to hold the last committed live frame on pause and clear/blackout on stop only if the user explicitly asks for that behavior.

## Stream Ownership Options

### Independent Streams Per Consumer

Each preview or display window independently calls `getUserMedia` or `getDisplayMedia` for the same logical live source.

Pros:

- Fits the current architecture where control and display windows are independent renderer processes.
- Simple lifecycle ownership: each window stops its own tracks.
- A crash or reload in one display does not break the others.
- No custom frame transport layer is required.

Cons:

- Multiple camera/screen captures can increase CPU/GPU load.
- Some cameras/drivers may not allow multiple simultaneous opens.
- Permissions and source prompts may need careful brokering to avoid repeated prompts.
- Multiple independent captures can have small timing/latency differences across displays.

### Shared Capture Architecture

One owner captures the stream and distributes it to previews/displays through a shared frame or media pipeline.

Pros:

- Opens physical cameras/screens once.
- More consistent frame timing across multiple displays.
- Central place for crop, scaling, metering, and feedback detection.
- Easier to implement "latest frame" hold semantics for pause/stop.

Cons:

- More engineering complexity than the current state-broadcast architecture.
- `MediaStream` cannot be sent directly through existing IPC, so this requires canvas frame transport, WebRTC-like local distribution, offscreen rendering, native capture, or another compositor layer.
- Higher risk of introducing latency or frame drops if implemented naively.
- The shared owner becomes a single point of failure for all displays using that source.

Recommendation:

- Implement independent streams for the first webcam/screen MVP because it matches the existing Electron renderer architecture.
- Design the `LiveVisualState` as a logical source so the runtime can later swap to a shared-capture backend without changing show files or display mappings.
- Revisit shared capture before optimizing for many displays, high-resolution screen capture, or robust pause-frame commit semantics.

## Option Feasibility

### Webcam

Feasibility: high on Windows and macOS.

Mechanism:

- Use `navigator.mediaDevices.enumerateDevices()` and `getUserMedia({ video: { deviceId } })`.
- Store `deviceId`, `groupId`, last known label, and optional audio device hints.
- On first use, labels may be empty until permission is granted.
- If audio is available, create a linked live audio source in the audio pool. Do not route it by default.

Windows considerations:

- Windows 10/11 privacy settings can globally block camera access for Win32 apps.
- Electron's `systemPreferences.getMediaAccessStatus('camera')` may report `granted` even when older Windows APIs do not expose a prompt, so renderer errors still need to be surfaced.

macOS considerations:

- Requires `NSCameraUsageDescription` in the packaged app `Info.plist`.
- `systemPreferences.askForMediaAccess('camera')` can prompt for camera permission.
- If denied, the user must change System Settings and usually restart the app.

MVP recommendation: implement first.

### Live Camera Audio

Feasibility: high for capture, medium for safe routing.

Mechanism:

- When adding a webcam live visual, request video and optionally audio from the matching device group.
- Create a linked `AudioSourceState` with a new type such as `live-input`, or add a live-input branch to the audio source union.
- Keep the audio source muted/unrouted by default.
- Any attempt to add the live input to a display, virtual output, or physical output should show a confirmation warning: live microphone routing can cause acoustic feedback.

Feedback detection:

- A simple first pass can watch for sustained high input levels while the same live input is routed to an output whose sink is likely audible in the room.
- If the input level rises rapidly after routing and stays above a threshold, automatically mute the routed selection and show a warning.
- More reliable detection can compare output and input signals with correlation/echo signatures, but that requires more DSP work and should be treated as a later safety enhancement.

MVP recommendation: create the linked audio source and confirmation warnings now; add automatic feedback muting after basic live audio routing works.

### Screen

Feasibility: high, with macOS permission caveats.

Mechanism:

- Use Electron `desktopCapturer.getSources({ types: ['screen'] })` to list screens in main.
- Use `session.defaultSession.setDisplayMediaRequestHandler` to grant the selected source to renderer `getDisplayMedia`.
- Store `displayId`, source name, and source ID as a best-effort restore hint.

Windows considerations:

- Desktop capture generally works without a special OS prompt.
- Monitor IDs and source IDs may change across hotplug, sleep, or reboot.

macOS considerations:

- macOS 10.15+ requires Screen Recording permission.
- Electron can check screen status with `systemPreferences.getMediaAccessStatus('screen')`, but apps generally cannot force the Screen Recording prompt the same way they can for camera.
- Users may need to grant permission in System Settings and restart Xtream.
- macOS 15+ has an experimental system picker path in Electron, but it is not cross-platform and bypasses the handler path Xtream needs for deterministic source assignment.

MVP recommendation: implement after webcam.

### Screen Region

Feasibility: medium. Technically possible as a crop over full-screen capture, but not a true lower-level regional capture in the current Electron path.

Mechanism:

- Capture the whole screen using the screen pipeline.
- Store a normalized crop rectangle `{ x, y, width, height }` relative to the captured source.
- Render the live video inside a clipped container with CSS transforms for display output.
- If a real cropped `MediaStream` is needed later, draw the hidden full-screen video to a canvas and use `canvas.captureStream()`.

Risks:

- Capturing the whole screen and cropping in renderer has the same privacy footprint as full-screen capture.
- Canvas cropping adds GPU/CPU overhead, especially for multiple displays or high refresh rates.
- Coordinate mapping must handle per-monitor scaling and macOS/Windows DPI differences.

MVP recommendation: defer the UI and implement only after screen capture is stable. Reserve schema support now.

### App / Window

Feasibility: medium-high for individual windows, medium-low for "whole app" semantics.

Mechanism:

- Use `desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: true })`.
- Let the user choose a window. Grouping multiple windows by app can be a later UX layer.
- Store source ID, window title, app icon/name if available, and last known label.

Windows considerations:

- Window capture is generally reliable for visible windows.
- Minimized, protected, GPU-accelerated, or DRM windows may show stale/blank content.

macOS considerations:

- Requires Screen Recording permission.
- Window lists may include privacy-protected or hidden windows.
- Source identity can change when apps relaunch.

MVP recommendation: implement as `Window` capture, label the UI `App/window`, and explain that whole-app grouping is future work.

## Permissions And Packaging

Add a permission policy before live capture ships:

- Deny capture permissions for non-Xtream origins.
- Grant `media` only to control/display/audio windows when user initiated or when a persisted live visual needs restore.
- Grant `display-capture` only through the pending source grant flow.
- Show a feedback warning before routing live microphone audio to any audible output.
- Surface permission blockers in the media pool and diagnostics.

Packaging gaps to resolve:

- macOS app packaging must define `NSCameraUsageDescription`.
- Live camera audio requires `NSMicrophoneUsageDescription`; screen/system audio capture would require `NSAudioCaptureUsageDescription` on newer macOS versions.
- Screen Recording permission cannot be fully automated; docs and in-app guidance are needed.

## Persistence And Restore

Introduce `PersistedShowConfigV5`:

- Existing v4 file visuals migrate to `kind: 'file'`.
- Live visuals persist capture intent, labels, crop settings, and last known source hints.
- On show open, live visuals restore as `ready: false` until a renderer reacquires a stream.
- If a persisted screen/window source cannot be matched, keep the visual in the pool with `ready: false` and show "Reselect source".
- Do not mark missing live sources as file-missing warnings; use live-specific warnings.

## Readiness, Loop, And Timeline Behavior

Live visuals should not define timeline duration. They should not be included in `assignedVideoIds` or any other media-length calculation. Treat them effectively as image-like indefinite sources.

Loop behavior:

- Loop range calculation must ignore live visuals entirely.
- Loop activation/deactivation must not seek, restart, pause, or otherwise mutate a display currently showing a live visual.
- Display drift correction should skip live visual elements because there is no meaningful target media time.
- A mixed layout with one finite file video and one live stream should loop only the finite file video rail; the live stream rail remains independent.

Readiness rules:

- A mapped live visual is blocking if permission is denied or no active stream track exists.
- A live visual in the pool but not assigned to an active display should be a warning or standby state, not a show-blocking error.
- If a live stream track ends while mapped, mark the relevant display degraded or the visual blocked until reacquired.

## Implementation Phases

### Phase 1: UX Menu And Data Shape

- Add the add-media dropdown in `control.ts` and style it with existing `.context-menu` classes.
- Keep `Local static files` wired to the existing `visual:add`.
- Add shared live capture types and v5 persistence shape.
- Add `Director.addLiveVisual()` and tests for creation, persistence, restore, remove, and timeline exclusion.
- Add loop/timeline tests proving live visuals are ignored by duration and loop calculations.

### Phase 2: Webcam

- Add permission handlers for `media`.
- Add a webcam picker using `enumerateDevices`.
- Implement renderer live runtime for `getUserMedia`.
- Render webcam streams in asset preview and display windows.
- Create a linked live audio source for webcam audio, muted/unrouted by default.
- Warn before routing live microphone audio to outputs.
- Report metadata and stream-ended errors.

### Phase 3: Screen Capture

- Add `desktopCapturer` source listing IPC.
- Add `setDisplayMediaRequestHandler` and pending grant handshake.
- Implement screen source picker with thumbnails.
- Render screen streams in previews and display windows.
- Add macOS Screen Recording guidance and diagnostics.

### Phase 4: Window Capture

- Extend source picker to `window` sources with icons.
- Add stale/missing source reselect behavior.
- Add tests around persisted window-source hints.

### Phase 5: Region Capture

- Add crop editor UI over a source thumbnail or preview.
- Store normalized crop rectangles.
- Apply CSS crop in display output.
- Profile canvas-based cropping only if CSS cropping cannot satisfy mapping requirements.

## Testing Plan

Unit tests:

- `Director.addLiveVisual()` creates indefinite ready-false visuals.
- Live visuals are excluded from finite timeline duration.
- Loop controls do not seek or mutate live displays.
- Mixed finite/live layouts loop finite media only.
- v4 show configs migrate to file visuals.
- v5 live configs restore without file URLs.
- Removing a live visual clears display mappings like file visuals.

Manual tests:

- Windows: webcam add, screen add, window add, unplug/replug camera, monitor hotplug, app restart.
- macOS: first-run camera permission, denied camera permission, Screen Recording not granted, Screen Recording granted after restart, fullscreen display output while capturing another screen.
- Multi-display: same live visual assigned to two display windows.
- Preview lifecycle: media-pool live preview stops on selection change; display-card live preview keeps running while paused/stopped; display output updates only when transport policy allows it.
- Audio safety: webcam audio source appears in audio pool, warns before routing, and mutes on simulated feedback once detection exists.
- Failure: selected window closes, screen source disappears, stream track ends, permission revoked.

Diagnostics:

- Include live source type, last known source label, permission status, active track state, and last renderer error in exported diagnostics.

## Open Decisions

- Confirm paused/stopped display-output behavior for live visuals: hold last committed frame, keep updating while playing only, blackout on stop, or another explicit policy.
- Confirm whether webcam audio should be mandatory when available or user-selectable during live visual creation.
- Confirm whether the first implementation should warn on every live microphone routing action or remember user acknowledgement per source/output route.
- Confirm whether Linux support is a hard MVP requirement for screen/window source picking, or only a design constraint.
- Confirm whether independent streams are acceptable for MVP, with shared capture reserved for performance/consistency work.
