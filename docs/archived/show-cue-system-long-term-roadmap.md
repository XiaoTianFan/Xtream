# Show Cue System Long-Term Development Roadmap

## 1. Purpose

This roadmap describes future development options for evolving Xtream from the initial Electron multi-display exhibition player MVP into a broader show cue system. It is intentionally long-term: the MVP should stay focused on reliable operator-controlled playback, while this document records the upgrade paths that can be layered on after the current playback, routing, persistence, and diagnostics foundations are stable.

The roadmap assumes the existing product direction from `docs/electron-cross-platform-player-prd.md` remains the near-term anchor:

- One control window owns all operator interaction.
- Display windows are output-only surfaces.
- A main-process director owns authoritative transport state.
- Media rails remain decoupled and synchronized by director time.
- Show configuration is stored as versioned data.
- Hardware capability detection and explicit degraded states are part of the product, not afterthoughts.

## 2. Roadmap Principles

- Preserve show reliability over feature breadth. A smaller cue set that starts every time is more valuable than a broad system with uncertain behavior under show pressure.
- Keep one authoritative show clock. Audio, video, cue sequencing, lighting, MIDI, OSC, serial, and future integrations should subscribe to the same director timeline or a clearly named external timecode source.
- Treat every output as a rail. Video, audio, lighting, MIDI, OSC, serial, and network commands should share lifecycle concepts: prepare, start, stop, fade, loop, recover, report status.
- Use adapters at hardware boundaries. Protocol integrations should live behind narrow interfaces so DMX, Art-Net, MIDI, OSC, serial, and future backends can be added without reshaping the cue engine.
- Prefer data-driven show files. Cue lists, assets, routes, outputs, timing, and fallback policy should be stored in versioned JSON first, with later migration to a richer project bundle or database if needed.
- Separate authoring from operation. The live control surface should stay simple and resilient. Advanced editing, timeline views, templates, and batch operations can grow into an authoring mode.

## 3. Target System Layers

The long-term show system can be organized around these layers:

1. Director and timing core: authoritative clock, transport, loop policy, drift correction, timecode sync, readiness barriers.
2. Cue engine: cue list execution, cue states, sequencing rules, preloading, conditional actions, follow-on cues.
3. Rail adapters: media, audio routing, lighting, MIDI, OSC, serial, and future external protocols.
4. Output registry: display windows, audio sinks, lighting universes, MIDI ports, OSC endpoints, serial ports, and remote clients.
5. Show document: cue lists, media references, routing, hardware profiles, presets, warnings, and schema migrations.
6. Operator UI: GO workflow, cue list status, diagnostics, health checks, live overrides, and recovery controls.
7. Authoring UI: editing tools, templates, timeline visualization, media management, and validation reports.

## 4. Phase 0: MVP Stabilization

This phase is the foundation and should remain focused on the current exhibition player requirement.

### Functional Scope

- Keep modes 1, 2, and 3 working over the shared director and display registry.
- Finish reliable show save/open flows for versioned JSON configuration.
- Validate display placement, fullscreen behavior, audio sink enumeration, and split audio fallback on target Windows and macOS hardware.
- Keep diagnostics export useful enough for installation support.
- Prove that playback start, stop, seek, and loop behavior are predictable across all active rails.

### Technical Priorities

- Harden the current `DirectorState` before adding cue-list complexity.
- Keep display windows video-only.
- Make runtime validation visible in the control UI as a show-readiness checklist.
- Record hardware capabilities at startup and during diagnostics export.
- Build tests around show config persistence, director transport, mode presets, and layout mapping.

### Exit Criteria

- A packaged build can run the current exhibition setup on supported hardware.
- Operators can recover from missing media, unavailable outputs, and display-window issues without editing files by hand.
- The code does not contain fixed two-window assumptions that would block later cue or display expansion.

## 5. Phase 1: Cue List Foundation

This phase introduces show-cue semantics without adding complex external hardware control yet.

### Product Goals

- Add a cue list that operators can step through with a clear `GO` workflow.
- Support media cues that wrap the existing video/audio playback engine.
- Preserve the existing mode-based playback setup as a cue type or cue preset.
- Show current cue, next cue, cue status, elapsed time, and warnings.

### Core Cue Concepts

- Cue identity: stable `id`, human label, optional cue number, color/status markers.
- Cue state: idle, preparing, ready, running, complete, failed, skipped, stopped.
- Cue trigger policy: manual, after previous cue completes, after delay, at director time, at external timecode.
- Cue action model: one cue can contain one or more actions across rails.
- Cue lifecycle: validate, prepare, execute, monitor, stop, recover.

### Candidate Data Model

```ts
type CueId = string;

type CueTrigger =
  | { type: 'manual' }
  | { type: 'after-previous'; delaySeconds?: number }
  | { type: 'at-time'; seconds: number }
  | { type: 'timecode'; value: string };

type CueAction =
  | { type: 'media-playback'; mode: 1 | 2 | 3; startSeconds?: number; loop?: boolean }
  | { type: 'audio-fade'; targetDb: number; durationSeconds: number }
  | { type: 'display-layout'; displayId: string; layout: unknown };

type CueDefinition = {
  id: CueId;
  number?: string;
  label: string;
  trigger: CueTrigger;
  actions: CueAction[];
  notes?: string;
  disabled?: boolean;
};
```

### Implementation Notes

- Add a `CueEngine` beside the existing director rather than embedding cue-list logic directly into media playback code.
- Let the cue engine request director transport changes through explicit commands.
- Store cue lists in the show configuration after a schema migration.
- Keep manual cue triggering as the first production workflow.
- Treat automatic follow cues and timecode cues as optional until the manual model is stable.

### Exit Criteria

- A show file can contain a cue list.
- The operator can select a cue and press `GO`.
- Cue execution updates state and errors visibly.
- Existing single-show playback still works as a default cue or simplified mode.

## 6. Phase 2: Media Cue Expansion

This phase deepens audio/video functionality before introducing high-risk hardware protocols.

### Audio Playback

- Add explicit audio cues: start, stop, pause, seek, loop, fade in, fade out, set volume, route to sink.
- Support layered audio playback where multiple cues can overlap intentionally.
- Add fade curves such as linear, equal-power, and logarithmic.
- Add per-cue gain and mute states independent of global output routing.
- Add preflight validation for codec, sample rate, channel count, duration, and missing files.

### Video Playback

- Add explicit video cues: start, stop, pause, seek, loop, fade in, fade out, blackout, freeze frame.
- Add display-target selection per cue action.
- Add media preloading and preroll states so video cues can start cleanly.
- Add layout changes as cueable actions: single, split, grid, picture-in-picture, confidence monitor.
- Add optional transition types such as cut, dissolve, fade to black, and fade from black.

### Media Management

- Introduce a project asset index that can validate referenced files before show time.
- Consider a portable project bundle format with relative media paths.
- Add an asset health panel showing file presence, duration, codec, resolution, frame rate, and audio channel count.

### Technical Options

- Continue using Electron HTML media elements and Web Audio while timing needs remain moderate.
- Keep a media adapter boundary open for future VLC/libVLC, mpv, WebCodecs, or native helper processes if HTML media limits become blocking.
- Avoid introducing Python media playback into the default stack unless a specific hardware need outweighs packaging and operations cost.

### Exit Criteria

- Operators can run multiple media cues in a cue list.
- Media fades and loops are controlled by cue data and director time.
- Show readiness blocks or warns on media issues before playback.

## 7. Phase 3: Protocol Adapter Framework

This phase creates the common integration surface for lighting, MIDI, OSC, serial, and future systems.

### Goals

- Add a rail-agnostic adapter interface for external control.
- Allow cue actions to target protocol endpoints without coupling the cue engine to each library.
- Give every adapter a capability report, validation step, execution result, and health state.

### Adapter Contract

```ts
type RailAdapterKind = 'lighting' | 'midi' | 'osc' | 'serial' | 'timecode' | 'media';

type AdapterHealth = {
  kind: RailAdapterKind;
  id: string;
  status: 'unconfigured' | 'ready' | 'degraded' | 'failed';
  message?: string;
};

type CueActionResult = {
  ok: boolean;
  message?: string;
  recoverable?: boolean;
};
```

### Common Requirements

- Each adapter must support dry-run validation for show readiness.
- Each adapter must report missing hardware or unreachable endpoints clearly.
- Cue failures must include the cue id, action id, adapter id, and suggested recovery.
- External adapters should not block the main UI thread.
- Long-running or streaming adapters should use explicit start/stop lifecycle methods.

### Exit Criteria

- The cue engine can execute at least one non-media adapter action through the shared adapter contract.
- Adapter health appears in diagnostics and show readiness.
- Failed external actions do not crash the app or silently pass.

## 8. Phase 4: OSC Control

OSC is a strong first network protocol because it is widely used by TouchDesigner, Max/MSP, Pure Data, QLab, Resolume, lighting tools, and custom controllers.

### Features

- Send OSC messages from cues to configured hosts and ports.
- Receive OSC commands for transport, cue selection, and `GO`.
- Map incoming OSC paths to app commands through a show-level routing table.
- Display recent inbound and outbound OSC messages in diagnostics.
- Support rehearsal mode with local loopback testing.

### Node/Electron Options

- Use a maintained Node OSC package such as `osc` or `node-osc`.
- Keep OSC networking in the main process or a worker process, not in display renderers.
- Store endpoints and path mappings in the show configuration.

### Exit Criteria

- A cue can send a parameterized OSC message.
- An external OSC controller can trigger `GO` or select a cue.
- OSC endpoint health is visible in the readiness checklist.

## 9. Phase 5: MIDI Control

MIDI is useful for instruments, effects processors, show controllers, and MIDI Show Control workflows.

### Features

- Send note, control change, program change, and sysex messages from cues.
- Receive note/control messages as cue triggers or operator shortcuts.
- Add port discovery and reconnect handling.
- Add a MIDI learn workflow for mapping incoming messages to commands.
- Consider MIDI Show Control support after basic MIDI is reliable.

### Node/Electron Options

- Evaluate `easymidi`, `midi`, or a Web MIDI approach depending on Electron support and packaged-build reliability.
- Keep native module packaging risk visible before committing to a MIDI stack.
- Use adapter-level tests or a virtual MIDI device in CI where practical.

### Exit Criteria

- A cue can send a MIDI command to a selected port.
- Incoming MIDI can trigger a safe, explicitly mapped command.
- Missing or renamed MIDI ports produce clear readiness warnings.

## 10. Phase 6: Lighting Control

Lighting control has high show value but should arrive after the adapter framework is stable.

### Art-Net First

Art-Net is likely the best first lighting target because it is network-based and avoids USB driver differences.

- Configure one or more Art-Net nodes.
- Define universes, channels, fixture aliases, and named looks.
- Send cueable DMX values over Art-Net.
- Support fades between looks over director time.
- Add blackout and restore actions.
- Add diagnostics for node reachability and packet output.

### USB DMX Later

USB DMX can follow once the app has a hardware abstraction and a clear supported-device list.

- Evaluate supported interfaces such as Enttec-compatible devices.
- Treat driver installation and permission requirements as deployment risks.
- Keep USB DMX optional if Art-Net covers the target installations.

### Cue Features

- Lighting look cues: recall named scene.
- Lighting fade cues: transition over duration.
- Channel cues: set raw channel values for testing.
- Safety cues: blackout, hold, restore previous look.

### Exit Criteria

- A cue can recall and fade a named Art-Net lighting look.
- Lighting output can be disabled globally for rehearsal.
- Readiness detects unavailable Art-Net endpoints or invalid universe mappings.

## 11. Phase 7: Serial and Device Control

Serial control supports projectors, media servers, switchers, relay devices, and other installation hardware.

### Features

- Configure serial ports with baud rate, data bits, stop bits, parity, and line endings.
- Send ASCII, hex, or templated command payloads.
- Optionally wait for expected responses before marking a cue action complete.
- Add command retries and timeout policy per cue action.
- Add safe manual test controls in diagnostics.

### Node/Electron Options

- Use `serialport`, with packaging and driver validation on Windows and macOS.
- Keep serial operations out of renderer windows.
- Store command templates in show configuration with clear labels.

### Exit Criteria

- A cue can send a serial command and optionally validate a response.
- Serial port availability appears in show readiness.
- Timeouts and failed responses are visible and recoverable.

## 12. Phase 8: Timecode Sync

Timecode should be introduced only after the internal director and cue engine are reliable, because it changes the app from operator-driven playback to externally synchronized playback.

### Supported Modes

- Internal director clock: default mode for MVP and cue-list operation.
- MIDI Timecode input: external clock source through MIDI.
- LTC input: audio-input-based timecode decoding, likely requiring a specialized library or native helper.
- Timecode chase mode: cue engine follows external timecode positions.
- Timecode trigger mode: external timecode triggers specific cues, while local director handles execution.

### Requirements

- External timecode must be explicitly selected as the active clock source.
- Loss of timecode must trigger a clear degraded state and configured fallback policy.
- Operators need visible current timecode, drift, lock state, and source health.
- Timecode-triggered cues need deterministic behavior when the playhead jumps backward or forward.

### Technical Options

- For MTC, evaluate MIDI libraries used in Phase 5.
- For LTC, consider whether a Node library, native helper, or external timecode decoder is more reliable.
- Keep timecode parsing separate from cue execution so internal timing remains usable without external hardware.

### Exit Criteria

- The app can follow MTC or another chosen external source in a controlled test environment.
- Cue triggers tied to timecode fire predictably.
- Timecode dropout behavior is documented and surfaced in the UI.

## 13. Phase 9: Advanced Cue Sequencing

This phase turns the cue list into a fuller show-programming environment.

### Features

- Follow cues: automatically trigger after cue completion or after delay.
- Timed cues: trigger at specific director time or wall-clock time.
- Conditional cues: trigger based on adapter state, input message, or operator confirmation.
- Cue groups: start, stop, arm, or disable groups of cues.
- Preload cues: prepare media or hardware states before a visible cue.
- Stop cues: explicitly stop or fade currently running rails.
- Panic and recovery cues: blackout, mute, stop all, restore previous state.

### Editing Features

- Duplicate, reorder, disable, and annotate cues.
- Cue templates for common media, lighting, MIDI, OSC, and serial actions.
- Validation panel for unresolved references, missing outputs, conflicting triggers, and unreachable hardware.
- Import/export cue lists as part of show configuration.

### Exit Criteria

- A show can be programmed as a sequence of manual and automatic cues.
- Operators can clearly tell why a cue is waiting, running, complete, or failed.
- Cue validation catches common show-breaking mistakes before performance.

## 14. Phase 10: Remote and Networked Operation

Remote operation should be added after local operation is dependable.

### Features

- Browser-based remote control surface for tablets or phones on the local network.
- Read-only monitor view for technicians.
- Optional remote `GO`, cue select, stop, and panic controls with authentication.
- WebSocket status updates from the main app.
- OSC/MIDI mappings remain available for hardware controllers.

### Safety Requirements

- Remote control must be opt-in per show or per session.
- Dangerous commands such as stop all, blackout, or panic should require explicit permission.
- The local operator UI remains authoritative.
- Network disconnects must not stop local playback.

### Exit Criteria

- A remote device can monitor show status.
- Authorized remote control can trigger safe commands.
- Remote clients appear in diagnostics and can be disconnected by the operator.

## 15. Phase 11: Authoring, Project Bundles, and Asset Workflow

As shows become larger, the system will need better content management.

### Project Bundles

- Store show configuration, assets, thumbnails, diagnostics, and hardware profiles in one portable directory.
- Use relative media paths inside bundles.
- Add bundle validation and repair tools.
- Preserve support for simple standalone JSON show files where possible.

### Authoring Tools

- Timeline view for media and timed cues.
- Cue dependency graph or filtered list by rail.
- Bulk asset relinking.
- Template library for common show structures.
- Notes, operator prompts, and installation instructions per cue.

### Versioning

- Add schema migrations with tests for every shipped show-file version.
- Add a compatibility policy for opening older shows.
- Record app version and adapter versions in show files and diagnostics.

### Exit Criteria

- A show can be moved between machines without manually relinking every asset.
- Older shipped show files migrate safely.
- Authoring features do not compromise the simplicity of live operation.

## 16. Phase 12: Production Hardening and Operations

This phase improves confidence for repeated live use.

### Reliability

- Watchdog renderer health and recover display windows where practical.
- Add autosave and recovery snapshots for authoring changes.
- Add structured logs for cue execution, adapter actions, errors, drift, and hardware changes.
- Add a pre-show validation report that can be exported or printed.
- Add optional rehearsal logs for comparing expected and actual cue timings.

### Testing

- Unit tests for cue engine state transitions.
- Integration tests for show config migrations.
- Contract tests for each adapter.
- Hardware-in-the-loop test scripts for target devices where practical.
- Packaged-build smoke tests on supported OS versions.

### Deployment

- Decide installer, signing, notarization, and update strategy.
- Document supported operating systems, codecs, display configurations, and hardware interfaces.
- Build a reproducible support bundle export with logs, show config, hardware capability reports, and app version data.

### Exit Criteria

- A show technician can diagnose common failures from app-generated reports.
- Packaged builds are repeatably produced and smoke-tested.
- Supported hardware and fallback behavior are documented.

## 17. Recommended Library Direction

Xtream is currently an Electron/Node application. The long-term roadmap should favor Node/Electron libraries unless a specific protocol requires a native helper. This keeps packaging, UI integration, and IPC simpler than adding a default Python sidecar.

### Preferred First Choices


| Capability           | Preferred Direction                                     | Notes                                                    |
| -------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| Cue scheduling       | Internal cue engine over director time                  | Avoid cron-style schedulers for live cue sequencing.     |
| Audio/video playback | Electron media elements and Web Audio first             | Keep adapter boundary open for VLC/mpv/native fallback.  |
| OSC                  | Node OSC package                                        | Good early external-control candidate.                   |
| MIDI                 | Node MIDI or Web MIDI after packaged-build spike        | Native module packaging is the main risk.                |
| Art-Net              | Node Art-Net implementation or small custom UDP adapter | Favor network DMX before USB DMX.                        |
| Serial               | `serialport`                                            | Validate driver and packaging behavior early.            |
| Timecode             | MTC via MIDI first; LTC later                           | LTC may require native or audio-input-specific handling. |
| Cue storage          | Versioned JSON, later project bundle                    | SQLite can wait until JSON becomes limiting.             |
| Remote UI            | WebSocket from Electron main process                    | Keep local control authoritative.                        |


### Python Sidecar Option

Python remains useful for experimentation, hardware-specific integrations, or advanced media tooling, but it should not become part of the default runtime unless the app needs a capability that is substantially more reliable in Python. If introduced, a Python sidecar should be treated as a managed adapter process with clear startup, health, logging, and shutdown behavior.

Potential Python sidecar cases:

- Specialty timecode decoding.
- Hardware integrations with mature Python-only libraries.
- Offline media analysis or preprocessing.
- Installation-specific automation scripts.

## 18. Suggested Priority Order

1. Stabilize the MVP and hardware validation workflow.
2. Add cue list foundation and manual `GO` operation.
3. Expand media cues with fades, preload, and loop control.
4. Add the generic adapter framework.
5. Add OSC as the first external protocol.
6. Add MIDI after package reliability is proven.
7. Add Art-Net lighting looks and fades.
8. Add serial device control.
9. Add timecode sync.
10. Add advanced sequencing and authoring tools.
11. Add remote operation and multi-client monitoring.
12. Add project bundles, migrations, and production operations hardening.

## 19. Major Risks

- Feature creep before the MVP is show-stable could weaken reliability.
- Native Node modules for MIDI or serial may complicate packaging.
- Multi-output audio behavior may vary by Electron version, OS, permissions, and hardware.
- Lighting and device-control mistakes can affect real equipment, so dry-run validation and global output disable switches are required.
- Timecode chase behavior can be surprising around jumps, loops, and dropouts unless policies are explicit.
- Remote operation introduces safety and authentication concerns.
- Show-file schema changes require careful migration once any show has shipped.

## 20. Near-Term Next Steps After MVP

- Define the cue-list schema and cue engine state machine.
- Add tests for cue lifecycle transitions before adding UI complexity.
- Add a minimal operator cue list UI with current cue, next cue, and `GO`.
- Wrap the current playback mode application as the first media cue action.
- Add a readiness checklist that can include cue-list validation.
- Add a diagnostics section for cue execution history.
- Choose OSC as the first adapter implementation unless a real show requirement demands MIDI, lighting, or serial first.

