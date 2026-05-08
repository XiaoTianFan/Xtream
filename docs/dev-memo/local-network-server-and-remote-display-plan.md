# Local network server and remote display plan

Date: 2026-05-08

## Goal

Design a durable local-network server layer for Xtream, then use remote display streaming as the first implementation.

The server should not be a one-off "remote display server." It should become the common local infrastructure for future LAN-facing features such as:

- Remote display viewing.
- Remote operator/control surfaces.
- MIDI over LAN bridges.
- OSC over UDP/TCP/WebSocket bridges.
- Local status, diagnostics, and discovery.
- Future protocol adapters that need a stable lifecycle, security model, and message routing layer.

Remote display is the first use case because it exercises the hardest parts early:

- Serving a browser page to another device.
- Identifying a published app resource by URL slug.
- Streaming real-time media.
- Coordinating per-client sessions.
- Keeping the Electron display renderer and main-process show state as the source of truth.
- Handling security, server lifecycle, and display-window lifecycle.

## Current architecture summary

Xtream is currently a local Electron application with no HTTP, WebSocket, or socket server layer.

Important current files:

- `src/main/main.ts`
  - Owns app lifecycle.
  - Creates `Director`, `StreamEngine`, `DisplayRegistry`, the control window, and the audio window.
  - Broadcasts director state and stream state to trusted Electron windows through IPC.
- `src/main/displayRegistry.ts`
  - Owns display `BrowserWindow` creation, reopening, closing, monitor assignment, fullscreen behavior, always-on-top behavior, and display window state.
  - Loads display windows with `display.html?id=<displayId>`.
  - Sends visual sub-cue preview commands to display windows.
- `src/main/ipc/registerIpcHandlers.ts`
  - Registers all renderer-facing IPC handlers.
  - Handles display create/update/reopen/remove.
  - Handles renderer readiness and drift reports.
  - Handles live-capture permission preparation.
- `src/renderer/display.ts`
  - The display renderer.
  - Subscribes to `window.xtream.director.onState` and `window.xtream.stream.onState`.
  - Renders display output as DOM, `video`, `img`, live capture streams, and layered elements.
  - Reports drift and preview status back to main.
- `src/renderer/control/media/liveCaptureRuntime.ts`
  - Acquires webcam, screen, screen-region, and application-window live visual sources inside trusted Electron renderers.
- `src/main/capturePermissions.ts`
  - Grants trusted Electron display-capture requests.
  - Enumerates `desktopCapturer` sources.

Relevant constraints:

- Remote browsers cannot use the Electron preload API exposed as `window.xtream`.
- Existing file visuals and audio use `file://` URLs that are not valid on another device.
- Live capture currently depends on Electron trust and permission hooks.
- The final display composition happens inside local Electron display renderers.
- Therefore, remote display should begin as a pixel/media stream of the local display result, not as a remote copy of `display.html`.

## Design principles

1. Keep Electron main as the authority.

   The main process already owns app lifecycle, display windows, trusted IPC, show state, and runtime engines. The local-network server should be created, stopped, and supervised from main.

2. Separate server infrastructure from feature protocols.

   A reusable server core should own HTTP binding, security, client sessions, routes, WebSocket upgrades, logging, lifecycle, and discovery hooks. Remote display should be one protocol module plugged into that core.

3. Use explicit publication.

   LAN resources should not become reachable just because they exist locally. A display output should become remotely reachable only when remote display serving is enabled and that display is published.

4. Prefer capability-scoped URLs.

   A URL should reveal only the capability it grants. A remote display URL should not automatically grant control, file browsing, diagnostics, or future MIDI/OSC access.

5. Avoid exposing raw project media.

   The first remote display implementation should stream rendered pixels. It should not serve local media files over HTTP unless a later feature explicitly requires an authenticated asset endpoint.

6. Plan for protocol diversity.

   MIDI, OSC, remote displays, and remote control surfaces will not share the same wire format. They can still share server lifecycle, auth, session tracking, routing, metrics, and configuration.

7. Make shutdown boring.

   When the app quits, the server stops. When a display is unpublished, removed, or missing from the current show/session, its clients receive an end/error state. Closing a visible local display window does not end remote rendering by itself. When settings change, old listeners are closed intentionally before new ones bind.

## Settled product decisions

- Remote display publication is app-local.
- The remote display URL should be rendered in the corresponding local display window title when that display is published.
- Display slugs are label-derived for readability.
- Display slugs dynamically update when display labels change.
- Remote display is visual-only. This includes any visual display output, not only video files. Audio remains intentionally separate.
- Token-in-URL links are acceptable for the first production release, using a 4-character token.
- Remote display rendering uses dedicated hidden/offscreen remote render targets, not capture of visible local display windows.
- Remote display availability must not depend on a local display window being open, visible, unminimized, or sized like the remote client.
- Each remote display target has an explicit output canvas size/aspect ratio, independent from the local display window size.
- The server should bind to the local machine IP selected for LAN use. Development builds may also allow localhost.
- The infrastructure must be platform agnostic and target both Windows and macOS.
- The default remote viewer limit is 2 clients per display, exposed in Config.

## Proposed high-level architecture

```txt
Electron main process
  Director
  StreamEngine
  DisplayRegistry
  LocalNetworkServiceManager
    LocalServerCore
      HTTP routes
      WebSocket routes
      Static viewer assets
      Auth/session registry
      Route registry
      Protocol registry
      Diagnostics/events
    Protocol modules
      RemoteDisplayProtocol
      FutureOscProtocol
      FutureMidiProtocol
      FutureRemoteControlProtocol
  Trusted Electron renderers
    Control renderer
    Audio renderer
    Display renderers
    Remote render/stream-host renderer(s)

Remote browser/device
  GET /display/<slug>
  WebSocket/WebRTC signaling
  Video playback element
```

### Main-process modules

Recommended new files:

- `src/main/localNetwork/localNetworkService.ts`
  - Top-level coordinator.
  - Starts and stops the shared local server.
  - Wires protocol modules to app services such as `Director`, `StreamEngine`, and `DisplayRegistry`.
  - Exposes a small imperative API for control/config UI.
- `src/main/localNetwork/serverCore.ts`
  - HTTP server creation and binding.
  - Route registration.
  - WebSocket upgrade dispatch.
  - Client/session registry.
  - Common request logging and error handling.
- `src/main/localNetwork/serverConfig.ts`
  - Normalized persisted server settings.
  - Port, host/interface, enabled state, auth mode, display publication defaults, discovery settings.
- `src/main/localNetwork/auth.ts`
  - Access token generation/validation.
  - Optional pairing/PIN flow later.
  - Capability checks per request/session.
- `src/main/localNetwork/routes.ts`
  - Small route matcher.
  - Slug normalization helpers.
  - Shared response helpers.
- `src/main/localNetwork/protocols/remoteDisplay.ts`
  - Remote display publication registry.
  - Display slug mapping.
  - Viewer routes.
  - WebRTC signaling.
  - Display stream session lifecycle.
- `src/main/localNetwork/protocols/remoteDisplayStreamHost.ts`
  - Main-side management of hidden/offscreen remote render and WebRTC stream-host renderers.
  - Maps published display IDs to remote render targets and output profiles.
  - Creates/tears down per-display streaming sources without depending on visible display windows.
- `src/preload/streamHostPreload.ts` or an extension to current preload
  - Minimal bridge for the internal stream-host renderer if a separate trusted renderer is used.
- `src/renderer/remote-display-viewer/`
  - Remote browser viewer page source if built by Vite, or a simple static file emitted with the renderer bundle.
- `src/shared/localNetworkTypes.ts`
  - Shared server status, protocol status, publication, client session, and remote display types.

### Server core responsibilities

The shared server core should provide these primitives:

- Lifecycle:
  - `start(config)`
  - `stop(reason)`
  - `restart(config, reason)`
  - `getStatus()`
- Network binding:
  - Host/interface selection.
  - Port selection.
  - Port conflict reporting.
  - LAN URL generation.
- HTTP routing:
  - Static viewer pages.
  - JSON endpoints for health/status where appropriate.
  - 404/403 handling.
- WebSocket routing:
  - Upgrade handling.
  - Protocol namespacing.
  - Session creation.
  - Heartbeat/ping timeout.
- Auth:
  - Token parsing.
  - Capability checks.
  - Optional local-only bypass for development.
- Session registry:
  - Client ID.
  - Remote address.
  - User agent.
  - Connected protocol.
  - Capability.
  - Created/last-seen timestamps.
  - Cleanup callbacks.
- Diagnostics:
  - Server status.
  - Bound addresses.
  - Active clients.
  - Protocol module status.
  - Last error.

The server core should not know what a display window, MIDI device, or OSC address means. It should only know how to bind, route, authenticate, and track sessions.

### Protocol module interface

Each protocol module should plug into the server core through a narrow interface.

Example shape:

```ts
export type LocalNetworkProtocolModule = {
  id: string;
  label: string;
  start(ctx: LocalNetworkProtocolContext): Promise<void> | void;
  stop(reason: string): Promise<void> | void;
  getStatus(): LocalNetworkProtocolStatus;
};

export type LocalNetworkProtocolContext = {
  registerHttpRoute: (route: HttpRouteDefinition) => void;
  registerWebSocketRoute: (route: WebSocketRouteDefinition) => void;
  auth: LocalNetworkAuthService;
  sessions: LocalNetworkSessionRegistry;
  log: LocalNetworkLogSink;
  appServices: {
    director: Director;
    streamEngine: StreamEngine;
    displayRegistry: DisplayRegistry;
  };
};
```

Remote display, OSC, MIDI, and remote control can then evolve independently while sharing the same operational foundation.

## Server configuration model

Add app-local server settings, not show-file settings.

Rationale:

- The server is a machine/network capability.
- The same show file may be opened on another machine with different interfaces, firewall rules, or security posture.
- Display publication is also app-local for the first production release. It can reference current show display IDs, but opening a show should not automatically expose its display outputs on a different machine.

Recommended app-local config fields:

```ts
export type LocalNetworkServerSettingsV1 = {
  enabled: boolean;
  host: '127.0.0.1' | 'local-ip' | string;
  port: number;
  authMode: 'token';
  /** Hash of the 4-character LAN access token. */
  accessTokenHash?: string;
  allowDiscovery: boolean;
  remoteDisplay: {
    enabled: boolean;
    defaultPublishNewDisplays: boolean;
    quality: RemoteDisplayQualityPreset;
    maxClientsPerDisplay: number;
    publications: Record<DisplayWindowId, RemoteDisplayPublicationSettings>;
  };
};

export type RemoteDisplayPublicationSettings = {
  published: boolean;
  slug?: string;
  tokenScope?: 'server' | 'display';
  outputProfileId?: string;
  outputWidth?: number;
  outputHeight?: number;
  fitMode?: 'contain' | 'cover';
};
```

Settled decision:

- Store remote display publication settings app-locally.
- Do not persist remote display publication in the show file for the first production release.
- If a display ID from app-local publication settings does not exist in the current show/session, mark it unavailable or prune it through an explicit cleanup path.
- Because slugs dynamically follow display labels, the app-local record should track whether the current slug is auto-generated. Manual slug editing can be deferred; if added later, manual slugs should stop automatic label syncing.
- Output size/aspect-ratio settings are app-local remote-output settings. They do not modify the local display window geometry or the show file.

## Security model

Local-network server features are risky because they turn a desktop app into a LAN service.

Minimum security for the first production release:

- Server is disabled by default.
- User must enable it from Config.
- Bind to a selected local machine IP for LAN use.
- Allow localhost in development.
- Generate a random 4-character server access token.
- Remote display URLs include a token or lead to a token gate.
- Tokens are capability-scoped.
- No unauthenticated WebSocket upgrades.
- Do not expose filesystem paths, show config JSON, raw media files, or control APIs.
- Log active remote clients in the app.
- Provide a "Disconnect all clients" action.
- Stop the server on app quit.

Potential URL forms:

```txt
http://192.168.1.20:37680/display/main-stage?t=<token>
http://192.168.1.20:37680/display/main-stage
```

The first is easiest. The second is cleaner if the viewer page prompts for a token and stores it in memory/local storage.

Recommended first production release:

- Use token query params for copyable display URLs.
- The token is exactly 4 characters. Treat this as a lightweight LAN access code, not a strong internet-facing credential.
- Avoid cookies for now.
- Add a later pairing flow if remote control surfaces need a better UX.

Future security additions:

- Pairing PIN.
- Per-display tokens.
- Expiring invite links.
- QR-code share UI.
- HTTPS with self-signed/local cert if browser APIs require secure context for future features.
- Allowlist by subnet or client address.

## Discovery

Discovery is useful later, but it should not block the first production release.

Options:

- Manual URL copy: first production release.
- QR code in Config or display detail: easy and useful.
- mDNS/Bonjour service advertisement: later.
- SSDP/UPnP: probably unnecessary.

Recommendation:

- Phase 1 uses manual URLs and optional QR display.
- Add mDNS only after the server protocol and security model stabilize.

## Remote display as first use case

### User story

An operator enables the local network server, publishes one or more display outputs, and opens a URL on another device:

```txt
http://<operator-machine-ip>:<port>/display/<display-slug>
```

The remote page shows the current visual output of the corresponding Xtream display, rendered by a dedicated remote render target.

### Product expectations

Remote display should:

- Show the final composed output of one display output.
- Use a readable label-derived slug that dynamically follows the display label.
- Work from phones, tablets, laptops, and other browser-capable devices on the same LAN.
- Continue rendering when no visible local display window is open.
- Render at a configured remote output size/aspect ratio independent from local display window geometry.
- Show a useful waiting/error state if the display is unpublished, missing from the current show/session, the remote render target is offline, or the token is invalid.
- Reconnect if the app restarts the stream host.
- Avoid exposing controls in the first version.

Remote display should not:

- Let remote devices control the show.
- Serve or download raw project media.
- Replace local physical display windows.
- Guarantee frame-perfect show-critical output on weak Wi-Fi.
- Include audio unless explicitly added as a later feature.

### Slug strategy

Each display publication needs a URL-safe slug.

Recommended slug rules:

- Default slug from display label when present, otherwise display ID.
- Lowercase.
- Trim.
- Replace whitespace with `-`.
- Remove unsupported URL characters.
- Deduplicate with `-2`, `-3`, etc.
- Dynamically update auto-generated slugs when display labels change.
- Never use an empty slug.

Examples:

```txt
Display label: "Main Stage" -> /display/main-stage
Display ID: "display-0" -> /display/display-0
Duplicate label: "Main Stage" -> /display/main-stage-2
```

Slug lookup should resolve to a display ID through the remote display protocol module, not through the display label directly.

Because slugs dynamically update with labels, old label-derived URLs are not guaranteed to remain valid after a label change. The Config and display detail surfaces should always show the current URL.

The corresponding local display window title should include the current remote display URL while that display is published. This makes the URL visible on the local virtual display window when it is open and can also help identify the matching remote render target during development and diagnostics.

### Remote display render strategy

Use dedicated hidden/offscreen remote render targets as the production architecture from the beginning.

The remote display protocol should not capture a visible local display `BrowserWindow` or a physical monitor. Instead, each published display gets an internal renderer that subscribes to the same trusted display state as local display windows and renders the final visual composition at a configured remote output size. The stream-host then converts that remote render target into a WebRTC video track for remote viewers.

Required behavior:

- Remote display can run even when the matching local display window is closed.
- Remote output size/aspect ratio is independent from the local display window.
- The remote renderer remains the source for WebRTC streaming; the remote browser does not receive show state or raw media paths.
- The local display window, when open, remains a separate local presentation target.
- Physical screen capture and visible-window capture are not fallback paths for production.

Recommended implementation:

- Create a hidden Electron `BrowserWindow` or offscreen renderer for remote display rendering.
- Reuse the existing display renderer code path as much as possible so DOM/video/image/live-capture behavior stays consistent with local display output.
- Add a stream-host layer that owns `RTCPeerConnection` instances and uses a rendered source stream from the remote render target.
- Prefer `canvas.captureStream()` or a hidden renderer capture path that does not depend on OS-level desktop capture permissions.
- Use offscreen `paint` frames only if the chosen renderer-capture path needs explicit frame transport into a canvas or media encoder.

Rejected strategies:

- Visible display window capture: rejected because it depends on local window existence, size, minimization, occlusion, fullscreen behavior, and platform capture quirks.
- Physical monitor capture: rejected because it can expose unrelated desktop content and cannot guarantee an Xtream-only remote output.
- Remote browser reimplementation of `display.html`: rejected because it would expose too much app state/media surface and duplicate trusted Electron rendering behavior.

Risks:

- More engineering work than visible-window capture.
- The remote renderer must receive trusted state without exposing broad IPC to remote clients.
- Live capture visuals may need careful routing so the hidden renderer can consume the same intended visual source safely.
- Multiple output sizes may require multiple render targets, increasing CPU/GPU cost.

Mitigation:

- Start with one remote render target per published display using a configured output profile.
- Group clients by output profile so viewers with the same profile share one encoded source where practical.
- Keep per-client adaptive aspect ratios as a later enhancement unless a client explicitly selects a supported output profile.
- Keep the remote renderer visually equivalent to local displays through shared display-rendering modules and focused parity tests.

### Recommended remote display production architecture

```txt
Remote browser
  GET /display/<slug>?t=<token>
    receives viewer HTML/JS
  WebSocket /ws/remote-display/<slug>?t=<token>
    sends WebRTC offer/candidates
    receives answer/candidates/status
  RTCPeerConnection
    receives display video track

Electron main
  LocalNetworkServiceManager
    ServerCore
      HTTP + WebSocket
    RemoteDisplayProtocol
      slug -> displayId
      session registry
      signaling dispatch
      remote render target management
      stream host management

Electron remote render/stream-host renderer
  renders display output at configured remote size/aspect ratio
  exposes a source MediaStream from the remote render target
  owns peer connections or receives peer instructions
```

Key decision:

- WebRTC must run in a renderer process, not pure Node, unless we add a native/WebRTC Node dependency.

Recommendation:

- Use a hidden trusted Electron renderer as the remote render and WebRTC stream host.
- Keep the HTTP/WebSocket server in main.
- Main forwards signaling messages between remote WebSocket clients and the stream-host renderer through IPC.

This fits the current Electron architecture:

- Main remains the network authority.
- Renderer remains the browser API authority for rendering, `RTCPeerConnection`, `MediaStream`, and browser codecs.
- Existing display renderer behavior can be reused without exposing Electron preload APIs to remote browsers.

### Stream-host renderer

The remote render/stream-host renderer should be internal and minimal.

Responsibilities:

- Receive `ensure-source` from main with display ID, output profile, resolution/fps/bitrate hints, and fit mode.
- Create or reuse the hidden/offscreen render target for that display/output profile.
- Subscribe to the same trusted display state and stream state needed to render the final visual output.
- Produce a source `MediaStream` from the remote render target.
- Maintain one source stream per published display/output profile where possible.
- Create one `RTCPeerConnection` per remote client.
- Add the display video track to each peer connection.
- Apply encoding preferences if available.
- Relay SDP answers and ICE candidates to main.
- Report source status and peer status to main.
- Stop tracks when no clients remain or the display is unpublished.

It should not:

- Access show/project files.
- Render control UI.
- Modify director or stream state.
- Accept arbitrary remote messages.
- Depend on a visible local display window.

Potential files:

- `src/renderer/streamHost.html`
- `src/renderer/streamHost.ts`
- `src/preload/streamHostPreload.ts`
- Shared display-rendering modules factored from `src/renderer/display.ts` as needed.

Vite config would need a new input for `streamHost.html`.

### WebRTC signaling

Use WebSocket for signaling.

Viewer-to-server messages:

```ts
type RemoteDisplayViewerMessage =
  | { type: 'hello'; protocolVersion: 1; displaySlug: string }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'request-keyframe' }
  | { type: 'disconnect' };
```

Server-to-viewer messages:

```ts
type RemoteDisplayServerMessage =
  | { type: 'hello'; protocolVersion: 1; displayId: string; displayLabel?: string }
  | { type: 'status'; status: 'waiting' | 'starting' | 'live' | 'ended' | 'error'; message?: string }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'display-update'; displayId: string; displayLabel?: string; slug: string }
  | { type: 'error'; code: string; message: string };
```

Main-to-stream-host IPC:

```ts
type RemoteDisplayHostCommand =
  | { type: 'ensure-source'; displayId: string; outputProfile: RemoteDisplayOutputProfile; quality: RemoteDisplayQuality }
  | { type: 'create-peer'; displayId: string; clientId: string; offer: RTCSessionDescriptionInit }
  | { type: 'add-ice-candidate'; clientId: string; candidate: RTCIceCandidateInit }
  | { type: 'close-peer'; clientId: string; reason: string }
  | { type: 'release-source'; displayId: string; reason: string };
```

Stream-host-to-main IPC:

```ts
type RemoteDisplayHostEvent =
  | { type: 'source-status'; displayId: string; status: 'starting' | 'live' | 'ended' | 'error'; message?: string }
  | { type: 'peer-answer'; clientId: string; answer: RTCSessionDescriptionInit }
  | { type: 'peer-ice-candidate'; clientId: string; candidate: RTCIceCandidateInit }
  | { type: 'peer-status'; clientId: string; status: RTCPeerConnectionState }
  | { type: 'peer-error'; clientId: string; message: string };
```

Remote display output profile:

```ts
type RemoteDisplayOutputProfile = {
  id: string;
  label: string;
  width: number;
  height: number;
  fitMode: 'contain' | 'cover';
};
```

### Viewer page

The remote viewer page should be deliberately small.

Responsibilities:

- Parse display slug and token.
- Open WebSocket signaling connection.
- Create an `RTCPeerConnection`.
- Send offer and ICE candidates.
- Attach remote stream to a video element.
- Show states:
  - Connecting
  - Waiting for display
  - Live
  - Reconnecting
  - Ended
  - Unauthorized
  - Display unavailable
- Keep screen awake where browser allows.
- Fullscreen button.
- Mute/audio controls only if audio is added later.

The viewer should not load the existing app CSS or control shell. It should be stable, dark, and minimal.

### Remote display quality settings

Start with presets instead of exposing every WebRTC knob.

Suggested presets:

```ts
type RemoteDisplayQualityPreset = 'low-latency' | 'balanced' | 'quality';
```

Initial mapping:

- `low-latency`
  - 720p cap
  - 30 fps
  - lower bitrate
- `balanced`
  - 1080p cap
  - 30 fps
  - medium bitrate
- `quality`
  - source resolution or 1080p/1440p cap
  - 30 or 60 fps if stable
  - higher bitrate

Start conservative:

- Default to `balanced`.
- Default max clients per display: `2`.
- Expose max clients per display in Config.

### Remote display output profiles

Remote rendering needs explicit output profiles so the stream is not tied to a visible local display window.

Suggested built-in profiles:

```ts
type RemoteDisplayOutputProfilePreset = '720p-landscape' | '1080p-landscape' | '1080p-portrait' | 'custom';
```

Initial behavior:

- Default to `1080p-landscape` unless the current display configuration clearly indicates another shape.
- Allow width/height configuration in Config or display detail.
- Keep all clients on the same display/output profile sharing one source stream where possible.
- Let the remote viewer fit the received stream with `contain` by default and optional `cover` if exposed later.
- Do not resize local display windows when remote output profile changes.

### Audio

Remote display should be visual-only for the first production release.

Reason:

- Display windows intentionally mute visual media.
- Audio is rendered/mixed in the dedicated audio renderer and virtual output system.
- Capturing "system audio" is platform-specific and may capture too much.
- Sending a specific virtual output mix to remote viewers requires a dedicated audio graph/export path.
- "Visual-only" here means the remote stream contains only the visual output track. The visual output may be a video, image, live capture, layered stream composition, blackout state, or any other visual display content.

Future audio options:

1. Capture app/system audio with display capture where supported.
2. Add a dedicated "remote monitor output" from the audio renderer and send it as a WebRTC audio track.
3. Let users choose a virtual output bus to include in a remote display stream.

Recommendation:

- Document remote display as visual-only in the first production release.
- Design message types so audio tracks can be added later without changing the URL shape.

## Future MIDI and OSC use cases

The shared server should support future protocol modules without needing architectural changes.

### OSC

OSC likely needs UDP support in addition to HTTP/WebSocket.

Possible architecture:

- `OscProtocol` registers with `LocalNetworkServiceManager`.
- It creates a UDP socket through Node's `dgram`.
- It maps incoming OSC addresses to explicit app actions.
- It optionally mirrors OSC events to WebSocket clients for browser-based diagnostics.

Important separation:

- UDP socket lifecycle can be managed by the protocol module.
- Server core still owns status, auth metadata for WebSocket diagnostics, and central logging.
- OSC actions must go through an explicit command mapping layer, not direct arbitrary IPC.

### MIDI

MIDI over LAN could take several forms:

- Browser Web MIDI control page through the local HTTP server.
- RTP-MIDI/network MIDI integration.
- WebSocket bridge for MIDI-like events.
- Native MIDI device routing from the main process or a trusted renderer.

The shared server should not assume which one we choose. It should provide:

- Protocol module lifecycle.
- Session/client registry.
- Auth.
- Diagnostics.
- Optional WebSocket message routing.

### Remote control surfaces

A later remote control surface can reuse:

- HTTP static serving.
- Token/pairing.
- WebSocket sessions.
- Capability-scoped routing.
- App state subscriptions.

But remote control should require stronger authorization than remote display.

Suggested capability separation:

- `display:view`
- `control:read`
- `control:transport`
- `control:edit`
- `protocol:osc`
- `protocol:midi`
- `diagnostics:read`

## Config and UI integration

Add Config surface controls after the server core exists.

Recommended UI areas:

### Config > Local Network

Show:

- Server enabled toggle.
- Bound address and port.
- LAN URLs.
- Token regeneration.
- Active clients.
- Last error.
- Restart server button.
- Disconnect all clients button.

Controls:

- Host/interface selector.
- Port input.
- Enable discovery toggle, initially disabled or hidden.

### Display detail / Displays tab

For each display:

- Publish remote display toggle.
- Slug field.
- Copy URL button.
- Current remote URL rendered in the local display window title while published.
- QR code button later.
- Client count.
- Stream status.
- Remote output profile selector.
- Remote output width/height fields for custom profiles.
- Fit mode: contain by default; cover can be exposed when useful.
- Quality preset.

### Readiness/diagnostics

Add diagnostics for:

- Server disabled/enabled.
- Bind failure.
- Port conflict.
- No LAN interface.
- Unauthorized connection attempts.
- Remote render target unavailable.
- Stream-host renderer not ready.
- Remote render target unavailable.
- Display published but missing from the current show/session.
- Client count over limit.

## Lifecycle and state handling

### App startup

1. Read app-local server settings.
2. Initialize `LocalNetworkServiceManager`.
3. Register protocol modules.
4. If enabled, start server after `app.whenReady`.
5. If remote display enabled, rebuild publication registry from settings/current displays.

### Show open/create

1. Display windows are closed/reopened by existing show restore flow.
2. Remote display module reconciles publications:
   - Existing display IDs still present: keep slug/settings.
   - Missing display IDs: mark unavailable or prune stale app-local publication records through a clear cleanup path.
   - New display IDs: publish only if default says so.
3. Active clients for removed displays receive `ended`.
4. Published displays with active clients create remote render targets even if no visible display window is open.

### Display create/update/remove

Create:

- Allocate slug if publication defaults to enabled.
- Otherwise no remote route beyond a disabled status.

Update label:

- Do not auto-change an existing slug unless the slug was never manually edited.

Close:

- Keep publication and keep remote rendering available if the display ID still exists in the current show/session.
- Do not end remote clients only because the visible local display window closes.

Reopen:

- Reopen the local window independently from remote render targets.
- Notify clients only if display metadata or output profile changed.

Remove:

- Unpublish or mark stale.
- Close client sessions.

### Server setting change

- Validate new config.
- Restart server when host/port/auth mode changes.
- Keep protocol module state where safe, but use clean teardown when output profile, auth, or bind settings require it.

### App shutdown

- Stop accepting new connections.
- Send `ended` to active viewers.
- Close WebSockets.
- Close peer connections.
- Stop remote render target media tracks.
- Destroy remote render/stream-host renderer.
- Close HTTP server.

## Error model

Use stable error codes so the viewer, UI, and diagnostics can agree.

Examples:

```ts
type LocalNetworkErrorCode =
  | 'server_disabled'
  | 'bind_failed'
  | 'unauthorized'
  | 'not_found'
  | 'display_unpublished'
  | 'display_not_found'
  | 'remote_render_target_unavailable'
  | 'stream_host_unavailable'
  | 'client_limit_reached'
  | 'webrtc_negotiation_failed'
  | 'internal_error';
```

The remote viewer should show user-facing messages. The app diagnostics should include technical details.

## Testing strategy

### Unit tests

Add tests for:

- Server config normalization.
- Host/port validation.
- Token generation and validation.
- Capability checks.
- Route matching.
- Display slug generation and deduplication.
- Publication reconciliation when displays are created, closed, reopened, removed, and relabeled.
- Remote output profile normalization and validation.
- Message schema parsing.

### Main-process integration tests

Add tests where practical for:

- Starting and stopping server core.
- Port conflict handling.
- HTTP route returns expected viewer shell.
- Unauthorized requests get 401/403.
- Unknown slugs get 404.
- WebSocket upgrade dispatch rejects invalid protocol routes.

### Renderer tests

Add tests for:

- Viewer connection states.
- WebRTC signaling state reducer if factored into pure helpers.
- Viewer error states.
- Token/slug parsing.

### Manual QA

Minimum manual QA:

- Start server on localhost.
- Start server on LAN interface.
- Open viewer from same machine.
- Open viewer from phone/tablet on same Wi-Fi.
- Publish/unpublish a display while viewer is open.
- Close/reopen local display window while viewer is open and confirm remote output continues.
- Change display label and confirm the URL/title update.
- Change remote output profile and confirm stream dimensions/aspect ratio update without resizing the local display window.
- Regenerate token and confirm old URL fails.
- Verify app shutdown closes viewer cleanly.
- Verify no raw file paths appear in viewer HTML/messages.

Performance QA:

- One display, one client.
- One display, two clients.
- Two displays, one client each.
- Stream video file playback.
- Stream image.
- Stream layered/crossfade display.
- Stream live capture visual if available.
- Stream the same display to clients with the same output profile.
- Exercise two different output profiles if multi-profile support ships.
- Observe CPU/GPU/network usage.

Platform QA:

- Windows and macOS are both first-target platforms.
- Verify hidden/offscreen remote render target behavior on both.
- Verify packaged renderer asset loading and WebRTC stream creation on both.
- Linux only if packaging/support targets it.

## Implementation phases

### Phase 1: Server foundation

Scope:

- Add app-local local-network settings and persistence.
- Add `LocalNetworkServiceManager`.
- Add `ServerCore` with HTTP route registration, lifecycle, status, and shutdown handling.
- Add auth token generation/validation and capability checks.
- Add basic Config UI for enable/disable, host, port, status, and token regeneration.

Deliverables:

- Server can start, stop, restart, and auto-start after `app.whenReady` when enabled.
- `GET /health` or equivalent internal route returns minimal authenticated or local-only status.
- No remote display route or renderer yet.

Acceptance:

- Server is disabled by default.
- Host/port validation and port conflict reporting are clear.
- App shutdown closes the HTTP server cleanly.
- Typecheck and focused server/auth tests pass.

### Phase 2: Remote display model and render-runtime groundwork

Scope:

- Add the remote display protocol module shell.
- Add display publication settings, label-derived slug generation, and slug reconciliation.
- Add remote output profile settings, including width, height, quality preset, fit mode, and max clients.
- Factor the current display renderer enough that local display windows and remote render targets can share the same visual rendering path.
- Define the trusted IPC contract needed by hidden/offscreen remote renderers.

Deliverables:

- Publications can be created, updated, removed, and reconciled against the current display IDs.
- Output profiles validate and normalize independently from local display window geometry.
- Shared display-rendering code can be loaded by both `display.html` and the future remote render/stream-host entry.

Acceptance:

- Slugs deduplicate and auto-update when display labels change.
- Removing a display closes or invalidates its app-local publication.
- Output profile changes do not resize or reopen local display windows.
- Renderer factoring preserves existing local display behavior in tests/manual smoke checks.

### Phase 3: Viewer routes, publication UI, and signaling skeleton

Scope:

- Add token-secured `GET /display/<slug>` viewer route.
- Add WebSocket support in server core and `/ws/remote-display/<slug>` signaling route.
- Add client/session registry with heartbeat, timeout, and cleanup callbacks.
- Add Config/Display UI controls for publish, slug, output profile, copy URL, status, and client count.
- Add viewer shell with connection, unauthorized, unavailable, waiting, and ended states.

Deliverables:

- A published display has a copyable URL and optional local display-window title annotation when the local window is open.
- Viewer connects to the authenticated signaling route and receives display metadata/status.
- Unknown, unpublished, unauthorized, and removed displays produce stable viewer states.

Acceptance:

- Unauthorized HTTP and WebSocket requests are rejected.
- Stale clients time out and disappear from diagnostics.
- Display removal sends an ended/error state.
- No show config, raw media paths, or control APIs are exposed.

### Phase 4: Hidden/offscreen remote render targets

Scope:

- Add the hidden/offscreen remote render/stream-host renderer entry and preload.
- Add main-to-host IPC for `ensure-source`, output profile changes, source status, and release.
- Render a published display ID at the selected remote output profile without opening a visible local display window.
- Produce a local `MediaStream` or equivalent video source from the remote render target.
- Add render-target status reporting and parity checks against local display rendering.

Deliverables:

- Remote render target can render the visual output for a published display with no remote WebRTC client attached.
- Remote rendering continues when the visible local display window is closed.
- Render target dimensions match the selected output profile.

Acceptance:

- Works in development on Windows and macOS.
- Closing/reopening a local display window does not stop the remote render target.
- The remote render target never uses visible-window capture or physical-screen capture.
- Live visual sources either render correctly or report a stable `remote_render_target_unavailable`/source-specific error.

### Phase 5: WebRTC streaming from remote render targets

Scope:

- Create one `RTCPeerConnection` per remote viewer.
- Relay SDP/ICE over the WebSocket signaling path.
- Attach the remote render target video track to each peer connection.
- Apply quality presets and enforce max clients per display.
- Share one source stream for clients on the same display/output profile where practical.

Deliverables:

- Remote browser sees the visual-only stream for a published display.
- Multiple clients can view the same published display within the configured limit.
- Manual URL/token sharing works over LAN.

Acceptance:

- Viewer handles live, reconnecting, ended, unauthorized, unpublished, and unavailable states.
- Client disconnect cleans up peer connections, tracks, and session state.
- Remote output profile controls stream dimensions/aspect ratio.
- No raw media files are served.

### Phase 6: Production lifecycle, diagnostics, and output behavior

Scope:

- Add render target recovery when the renderer, media stream, or WebRTC source fails.
- Add output profile change handling, including source restart or renegotiation.
- Add detailed Config diagnostics for server, publications, render targets, clients, and last errors.
- Add disconnect-all, token regeneration cleanup, and app shutdown cleanup.
- Add focused parity/performance tests for hidden/offscreen rendering.

Deliverables:

- Remote display survives common lifecycle changes.
- Operator can inspect remote render target status, stream status, and client status.
- Token regeneration and settings changes intentionally close or restart affected sessions.

Acceptance:

- Closing/reopening local display windows does not interrupt remote output.
- Unpublishing/removing displays ends affected clients cleanly.
- Render target recovery is visible in status and does not leak old peer connections or tracks.
- Output profile changes are reflected in new or renegotiated streams.

### Phase 7: Packaging and platform polish

Scope:

- Ensure renderer build includes viewer and remote render/stream-host assets.
- Ensure packaged app loads viewer/host resources correctly from packaged paths.
- Verify server auto-start when enabled in packaged builds.
- Add QR code or clearer share UI.
- Add firewall/user guidance if needed.
- Add diagnostics export fields for local network server status.

Deliverables:

- Packaged app can run the remote display server.
- Diagnostics include server/protocol/render-target/client state.

Acceptance:

- `npm run build` passes.
- Packaged Windows and macOS apps can serve a remote display over LAN.
- Remote rendering works in packaged builds without a visible local display window.

### Phase 8: Future protocol readiness

Scope:

- Extract any remote-display-specific server code that leaked into core.
- Add protocol module docs.
- Add a stub/sample internal protocol module for future OSC/MIDI work.

Deliverables:

- Server core is demonstrably reusable.
- MIDI/OSC planning can proceed without reworking lifecycle/auth/session code.

Acceptance:

- Remote display is one module, not the server architecture.
- New protocol modules can register HTTP/WebSocket routes or own sockets while reporting status through the same manager.

## Settled answers from product review

1. Should remote display publication be stored app-locally, in the show file, or split between the two?

   App-local.

2. Should display URLs use display labels by default or stable display IDs by default?

   Label-derived slugs for readability, dynamically updated according to display labels.

3. Is video-only acceptable for the first remote display release?

   Yes. Remote display is for visuals only, which may include videos, images, live captures, and composed visual output. Audio remains separate by architecture.

4. Is a token in the URL acceptable for the first production release?

   Yes. Use a 4-character token.

5. Should the remote output capture a visible display window, a physical screen, or render independently?

   Render independently through a hidden/offscreen remote render target. Do not use visible display-window capture or physical screen capture.

6. What default bind address should the UI choose?

   Use the local machine IP only. For development, allow localhost.

7. What is the expected first target platform?

   Both Windows and macOS. Infrastructure must be platform agnostic.

8. How many remote viewers per display should be allowed by default?

   2 per display by default. Expose this setting in the Config surface.

## Risks and mitigations

### Capture reliability

Risk:

- Hidden/offscreen remote rendering may diverge from the local display renderer or fail to acquire equivalent visual inputs.

Mitigation:

- Share display-rendering modules between local and remote renderers where practical.
- Show clear remote render target and stream-host status in Config.
- Test both Windows and macOS early because hidden/offscreen renderer behavior is part of the core requirement.
- Include parity tests for local display output versus remote render target output.

### Performance

Risk:

- Multiple displays and clients can increase GPU/CPU/network load.

Mitigation:

- Default to conservative quality.
- Enforce client limits.
- Add status metrics.
- Avoid raw frame transport over WebSocket.

### Security

Risk:

- A LAN server can expose show output or future controls to unintended clients.

Mitigation:

- Disabled by default.
- Token required.
- Capability-scoped auth.
- No raw project media.
- Visible client list.
- Disconnect/regenerate controls.

### Architecture drift

Risk:

- Remote display code could hard-code one-off server behavior and make OSC/MIDI harder later.

Mitigation:

- Build server core and protocol module boundaries before WebRTC.
- Keep remote display as the first protocol module.
- Add a module interface test or stub.

### Browser compatibility

Risk:

- WebRTC support and autoplay/fullscreen behavior vary on mobile browsers.

Mitigation:

- Use a simple user-gesture "Start" fallback if autoplay fails.
- Keep viewer UI minimal.
- Test iOS Safari, Android Chrome, desktop Chrome/Edge.

## Recommended first production release definition

The first shippable version should include:

- App-local local-network server settings.
- Server disabled by default.
- Token-secured HTTP viewer route.
- Token-secured WebSocket signaling route.
- Display publication with label-derived dynamic slug.
- Copyable remote display URL.
- Current remote display URL in the local display window title while published.
- Hidden/offscreen remote render/stream-host renderer.
- Remote output profiles with configured size/aspect ratio.
- WebRTC visual-only stream from the remote render target.
- Remote rendering that does not require a visible local display window.
- Basic status/errors in Config.
- Client cleanup on display removal and app shutdown.
- Windows and macOS manual QA.

It should defer:

- Audio.
- Remote control.
- mDNS discovery.
- Pairing/PIN.
- Raw media serving.
- MIDI/OSC implementations.
- Per-client arbitrary aspect-ratio rendering beyond supported output profiles.
- Physical screen capture fallback.
- Visible display-window capture fallback.

## Notes for future implementation

- Prefer Node built-ins for HTTP at first. Avoid adding Express unless routing complexity justifies it.
- A WebSocket dependency will probably be needed unless we implement the protocol manually. Choose a small, maintained package when implementation begins.
- WebRTC should stay in a Chromium renderer unless a strong reason appears to add a native Node WebRTC dependency.
- Keep all remote network message schemas in shared types with runtime validation helpers.
- Avoid passing full `DirectorState` or show config to remote clients for display viewing. The viewer needs stream status and WebRTC negotiation only.
- When adding future OSC/MIDI, keep command/action mapping explicit and auditable.
