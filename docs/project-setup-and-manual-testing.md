# Xtream Electron Player Setup and Manual Testing Guide

## Project Shape

Electron apps have more than one JavaScript runtime:

- **Main process**: Node/Electron runtime that owns app lifecycle, windows, filesystem access, IPC, display registry, persistence, and the playback director. In this repo, this is `src/main/`.
- **Preload process**: a small bridge that safely exposes selected main-process APIs to browser renderers through `contextBridge`. In this repo, this is `src/preload/preload.ts`.
- **Renderer processes**: browser windows. The control window and display windows are separate renderer pages. In this repo, these are `src/renderer/index.html`, `src/renderer/control.ts`, `src/renderer/display.html`, and `src/renderer/display.ts`.
- **Shared code**: types and pure helpers used by both main and renderers. In this repo, this is `src/shared/`.

The most important mental model: Electron has “browser windows plus a privileged desktop app process.” Keep privileged APIs in main/preload, not directly in renderer code.

## Prerequisites

- Node.js and npm installed.
- Windows or macOS for normal app validation. Current development is on Windows.
- Optional for exhibition validation: multiple displays and multiple audio output devices.

Install dependencies:

```powershell
npm install
```

## Common Commands

Run type checks:

```powershell
npm run typecheck
```

Run unit tests:

```powershell
npm test
```

Build main and renderer output:

```powershell
npm run build
```

Launch the Electron app:

```powershell
npm start
```

`npm start` currently runs a full build first, then launches Electron from `dist/main/main/main.js`.

## Is There a Test Server?

The current repo does not define a hot dev-server command. `vite build` compiles the renderer pages, and `electron .` launches the desktop app. That means the normal local loop is:

```powershell
npm run build
npm start
```

The main process already checks `VITE_DEV_SERVER_URL`, so a future hot-reload setup can run a Vite dev server for renderer pages and then launch Electron with that environment variable. Until a script is added, use `npm start` as the supported way to run the app.

## First Launch Walkthrough

1. Run `npm install`.
2. Run `npm run build`.
3. Run `npm start`.
4. Confirm one control window opens by default.
5. Confirm no public display windows open until you click a display creation or mode preset button.
6. Use the control window to choose video slots, choose audio, create displays, apply mode presets, and run transport.

## Manual Test Matrix

Run `npm run build` before each manual test pass unless you are intentionally testing an unbuilt local change.

### App Startup and Window Lifecycle

1. Start the app with `npm start`.
2. Verify exactly one control window opens.
3. Verify no display windows open by default.
4. Close the control window.
5. On Windows, verify the app exits.
6. On macOS, verify dock activation can recreate the control window.

Expected result: the control window is the only interactive window, and app lifecycle follows platform conventions.

### Mode 1: One Split Display

1. Start the app.
2. Select video file A and video file B.
3. Select a stereo audio file.
4. Click `Apply Mode 1: Split Display`.
5. Verify one display window opens or is assigned.
6. Verify the display layout is split left/right with slot A and slot B.
7. Click Play.
8. Verify both videos move together and audio is controlled from the control window.
9. Pause, stop, and seek.

Expected result: one display window shows two muted video rails side by side, with one control-owned stereo audio rail.

### Mode 2: Two Display Windows

1. Select video file A and video file B.
2. Select a stereo audio file.
3. Click `Apply Mode 2: Two Displays`.
4. Verify two display windows exist.
5. Verify display 1 maps to slot A and display 2 maps to slot B.
6. Move or fullscreen each display from the control window.
7. Play, pause, seek, stop, and change rate.

Expected result: each display window shows one muted video slot while the control window owns shared audio playback and transport.

### Mode 3: L/R Audio Routing

1. Select video file A, video file B, and a stereo audio file.
2. Click `Apply Mode 3: Split Audio`.
3. Refresh audio outputs.
4. Select different left and right output devices if available.
5. Click `Test Left` and confirm the lower tone routes to the left sink.
6. Click `Test Right` and confirm the higher tone routes to the right sink.
7. If physical split routing is unavailable, verify the UI shows the fallback reason.
8. Accept fallback only for rehearsal-style validation.
9. Play and verify video mapping matches Mode 2.

Expected result: when two independent sinks are available, logical left and right paths are physically split. When not available, the app clearly routes stereo fallback through the main/default path and blocks readiness until fallback is accepted.

### Readiness Gate

1. Start with no media selected.
2. Try to press Play.
3. Verify Play is disabled or playback remains paused.
4. Add only one video file.
5. Verify readiness still reports missing audio or missing required slots/displays.
6. Add all required media and displays.
7. Verify readiness changes to ready.

Expected result: playback does not enter running state until required rails, displays, and fallback acknowledgements are ready.

### Looping

1. Load valid media.
2. Set loop enabled.
3. Set loop start and end, for example start `2`, end `8`.
4. Play from before the loop end.
5. Observe playback crossing the loop end.
6. Verify audio and all active videos return to the loop start together.
7. Stop playback.

Expected result: loop state is director-level and applies to audio and video rails together.

### Drift and Correction

1. Load valid media and start playback.
2. Watch drift values in the control window.
3. Seek while playing.
4. Verify display/audio rails correct back toward director time.
5. If a rail repeatedly fails to correct, verify degraded state is surfaced.

Expected result: drift is reported to main, correction state is visible, and repeated failures become degraded instead of silently continuing.

### Display Window Mapping and Monitor Placement

1. Open at least three display windows.
2. Assign different layouts and slots.
3. Change a display window to fullscreen.
4. Move/resize a display window manually.
5. Verify bounds/fullscreen state updates in the control window state.
6. Use monitor selection to place a display window on a target monitor.
7. Close a display window and verify its state becomes closed.
8. Reopen with previous mapping.

Expected result: displays are tracked by registry id, not hardcoded names, and mappings survive close/reopen flows.

### Persistence

1. Configure mode, slots, audio, display mappings, fullscreen, audio sinks, and loop settings.
2. Click Save or Save As.
3. Quit the app.
4. Relaunch the app.
5. Open the saved config if it was not the default.
6. Verify mode, media paths, routing selections, displays, and loop settings restore.
7. Move or rename a media file.
8. Reopen the show config.

Expected result: configuration restores without restoring transient playback state, and missing files are surfaced as recoverable warnings.

### Diagnostics Export

1. Configure a show.
2. Create at least one warning state, such as Mode 3 fallback or a missing file.
3. Click `Export Diagnostics`.
4. Open the exported JSON.
5. Verify it includes app version, platform, process versions, director state, readiness, issues, display state, audio routing, and correction state.

Expected result: diagnostics contain enough state for installation troubleshooting.

### Display-Only Surface

1. Open a display window with a valid video slot.
2. Verify there are no menus, file dialogs, transport controls, or routing controls in the display window.
3. Verify audience-facing slot overlays are hidden in normal display windows.

Expected result: public display windows are video-only surfaces.

## Electron App Lifecycle Standards

Typical Electron lifecycle management includes:

- Create windows only after `app.whenReady()`.
- Use `BrowserWindow` in the main process, not from renderer code.
- Use `preload` plus `contextBridge` for renderer access to privileged features.
- Keep `nodeIntegration` disabled and `contextIsolation` enabled.
- Quit on `window-all-closed` except on macOS, where apps commonly stay active until explicit quit.
- Recreate or refocus windows on macOS `activate`.
- Consider `app.requestSingleInstanceLock()` for production apps to prevent multiple app instances from fighting over files, devices, or display windows.
- Treat renderer crashes and unresponsive windows as recoverable states in main process state.

This project follows the core shape: main owns windows and director state, preload exposes a narrow API, renderers receive state and report readiness/drift.

## Build, Packaging, and Release Standards

Current repo status:

- `npm run build` compiles and validates the app.
- `npm start` launches Electron from built output.
- There is not yet a configured installer/package pipeline.

Typical Electron release pipeline:

1. **Unit validation**: `npm run typecheck`, `npm test`.
2. **Production build**: compile main, preload, shared, and renderer assets.
3. **Package**: create platform-specific app bundles.
4. **Make installers**: generate `.exe`/Squirrel/MSI-style artifacts on Windows and `.dmg`/`.zip`/signed `.app` artifacts on macOS.
5. **Code sign**: sign Windows and macOS artifacts with the correct certificates.
6. **Notarize macOS**: submit signed macOS builds for Apple notarization.
7. **Smoke test packaged builds**: launch packaged artifacts, validate media decoding, fullscreen placement, file dialogs, config paths, audio device enumeration, and sink routing.
8. **Publish**: upload release artifacts to the chosen channel, such as GitHub Releases, S3, or an internal installer distribution.

Electron Forge and electron-builder are common choices for packaging. Electron Forge uses commands such as `electron-forge package`, `electron-forge make`, and `electron-forge publish`; it can configure makers, signing, notarization, and publishers in a Forge config file.

For this project, a future packaging pass should define:

- Supported Windows and macOS versions.
- App id, product name, icons, and installer names.
- Whether packaged app contents use `asar`.
- Windows signing certificate and timestamping.
- macOS Developer ID signing identity, hardened runtime, entitlements, and notarization credentials.
- Release channel and artifact storage.
- A packaged smoke-test checklist for show hardware.

## Recommended Validation Before Exhibition

Run this sequence before any show build is considered ready:

```powershell
npm run typecheck
npm test
npm run build
npm start
```

Then complete the manual test matrix above on the actual target hardware, especially:

- monitor placement and fullscreen behavior,
- media decoding for final codecs and resolutions,
- audio output enumeration,
- `setSinkId` behavior,
- split display left/right visual independence,
- drift behavior after play, seek, and loop boundaries,
- save/restore and diagnostics export.

## Phase 8/9 Operator Console Validation

Complete this pass after `npm run build` and before moving beyond the `v0.0.6` runtime line:

1. Launch with `npm start` and confirm the Patch rail is active by default with Media Pool, Display Windows, Audio Mixer, Details, and Status Footer visible.
2. Import a video with an embedded audio track and confirm a linked embedded audio source appears in the Audio tab after metadata loads.
3. Open Config and confirm it shows runtime version, readiness, global audio state, display blackout state, patch topology, system actions, and raw Director State.
4. Open Logs and confirm readiness issues, display telemetry, and audio routing status are visible without changing show state.
5. Open Cue and Performance and confirm they are clear placeholders only, with no fake triggering or state-changing controls.
6. Toggle Audio Mute while playing routed audio and confirm meters may continue to report signal while live output is muted, then restore audio.
7. Toggle Display Blackout and confirm public display windows and control previews go black, then restore display output.
8. Click Reset Meters and confirm visible mixer meters reset before live signal updates resume.
9. Export diagnostics and confirm the JSON includes both package `appVersion` and `runtimeVersion`.
10. Save, reopen, and confirm session controls such as Audio Mute and Display Blackout are not restored from the show file.

Phase 9 hardware validation remains mandatory because Electron, Chromium, operating systems, HDMI devices, Bluetooth devices, and audio interfaces can expose different routing capabilities depending on the packaged build and machine.
