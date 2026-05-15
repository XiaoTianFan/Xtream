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
- Remote display URLs do not include tokens. The first production release uses a viewer PIN login page before WebRTC signaling is allowed.
- Remote display rendering uses dedicated offscreen-enabled `BrowserWindow` remote render targets, not capture of visible local display windows.
- Remote display availability must not depend on a local display window being open, visible, unminimized, or sized like the remote client.
- Each remote display target has an explicit output canvas size/aspect ratio, independent from the local display window size.
- The first production release supports multiple simultaneously published remote displays.
- Each published display has one canonical server-side output profile at a time. Per-client sizing is handled in the remote browser by fitting the received stream to the client viewport.
- The server should default to an automatically selected robust LAN IP, preferring the active default-route private IPv4 address on Wi-Fi or Ethernet. Users can override which LAN interface/IP the server exposes to. Development builds may also allow localhost. `GET /health` is localhost-only.
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
  - PIN generation/validation.
  - Viewer login session issuance/validation.
  - Optional stronger pairing flow later.
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
  - Main-side management of offscreen-enabled `BrowserWindow` remote render and WebRTC stream-host renderers.
  - Maps published display IDs to remote render targets and output profiles.
  - Creates/tears down per-display streaming sources without depending on visible display windows.
- `src/preload/streamHostPreload.ts`
  - Dedicated minimal bridge for the internal stream-host renderer.
- `src/renderer/remote-display-viewer/`
  - Vite-built remote browser viewer page source.
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
  - `GET /health` for localhost-only liveness status.
  - 404/403 handling.
- WebSocket routing:
  - Upgrade handling.
  - Protocol namespacing.
  - Session creation.
  - Heartbeat/ping timeout.
- Auth:
  - PIN verification for viewer login.
  - Viewer session validation for signaling.
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
  hostMode: 'auto-lan' | 'interface' | 'address' | 'localhost';
  interfaceId?: string;
  host?: string;
  port: number;
  authMode: 'pin';
  /** Hash of the LAN viewer PIN. */
  pinHash?: string;
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
  outputProfileId?: string;
  outputWidth?: number;
  outputHeight?: number;
  defaultViewerFitMode?: 'contain' | 'cover';
};
```

Settled decision:

- Store remote display publication settings app-locally.
- Do not persist remote display publication in the show file for the first production release.
- If a display ID from app-local publication settings does not exist in the current show/session, mark it unavailable. Never auto-prune stale publication records silently; cleanup must be an explicit user action.
- When a display is explicitly removed, run the removal pipeline in this order: unpublish, remove the app-local publication record, then close affected clients and remote render targets.
- Because slugs dynamically follow display labels, the app-local record should track whether the current slug is auto-generated. Manual slug editing can be deferred; if added later, manual slugs should stop automatic label syncing.
- Output size/aspect-ratio settings are app-local remote-output settings. They do not modify the local display window geometry or the show file.
- Viewer fit mode is a remote-client presentation preference. It controls how the browser fits the received video into its own viewport and does not create a server-side per-client render target.

## Security model

Local-network server features are risky because they turn a desktop app into a LAN service.

Minimum security for the first production release:

- Server is disabled by default.
- User must enable it from Config.
- Default to automatic LAN binding.
- Prefer the active default-route private IPv4 address on a Wi-Fi or Ethernet interface.
- Avoid loopback, link-local, VPN, Docker, virtual machine, and other virtual adapters by default.
- Allow the user to choose the exact LAN interface/IP from Config, including advanced/manual entries when needed.
- Allow localhost in development.
- Generate a random LAN viewer PIN.
- Remote display URLs do not include credentials.
- The remote viewer page includes a PIN login screen.
- Successful PIN verification grants a short-lived viewer session scoped to the requested capability.
- The viewer session credential is not placed in the URL. The viewer uses it for the WebSocket handshake, for example through `Sec-WebSocket-Protocol`, so invalid sessions can be rejected during upgrade.
- No unauthenticated WebSocket upgrades.
- Do not expose filesystem paths, show config JSON, raw media files, or control APIs.
- Log active remote clients in the app.
- Provide a "Disconnect all clients" action.
- Stop the server on app quit.

URL form:

```txt
http://192.168.1.20:37680/display/main-stage
```

Recommended first production release:

- Use credential-free copyable display URLs.
- Require the viewer to enter the LAN PIN before signaling starts.
- Treat the PIN as a lightweight LAN access code, not a strong internet-facing credential.
- Avoid cookies for now.
- Keep the verified viewer session in memory or browser session storage.
- Add a stronger pairing flow later if remote control surfaces need a better UX.

Future security additions:

- Per-display PINs or capability grants.
- Expiring invite links.
- QR-code share UI.
- HTTPS with self-signed/local cert if browser APIs require secure context for future features.
- Allowlist by subnet or client address.

## Discovery

Discovery is useful later, but it should not block the first production release.

Options:

- Manual URL copy: first production release.
- QR code in Config or display detail: deferred.
- mDNS/Bonjour service advertisement: later.
- SSDP/UPnP: out of scope.

Recommendation:

- First production release uses manual URL copy only.
- Add mDNS only after the server protocol and security model stabilize.

## Network binding policy

Default behavior:

- Use `auto-lan` as the default host mode.
- Choose an active, non-internal, private IPv4 address that has a default route.
- Prefer physical Wi-Fi or Ethernet interfaces over VPN, Docker, virtual machine, tunnel, link-local, and loopback interfaces.
- Prefer stable RFC1918 LAN addresses (`192.168.x.x`, `10.x.x.x`, `172.16.x.x` through `172.31.x.x`) over public, link-local, or IPv6 addresses for the first production release.
- If multiple good physical LAN candidates exist, prefer the interface currently used for the OS default route. If still tied, prefer Ethernet, then Wi-Fi, then the lowest interface metric when available.

Config behavior:

- Show the automatically selected LAN IP and interface label.
- Allow the user to override the binding by choosing a specific interface/IP.
- Keep manual override available for advanced setups such as production VLANs, dedicated show networks, or machines with multiple NICs.
- Hide or de-emphasize VPN/virtual/link-local adapters by default, but allow showing them through an advanced list.
- If the selected manual interface disappears, stop accepting new LAN connections, show `no_lan_interface` or `bind_failed`, and let the operator choose another interface. Do not silently expose the server on a different LAN after a manual override.
- If `auto-lan` loses its selected address, re-evaluate candidates and restart on the best available LAN IP with a visible diagnostics event.

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
- Show a useful waiting/error state if the display is unpublished, missing from the current show/session, the remote render target is offline, or PIN verification fails.
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

Use dedicated offscreen-enabled remote render targets as the production architecture from the beginning.

The remote display protocol should not capture a visible local display `BrowserWindow` or a physical monitor. Instead, each published display gets an offscreen-enabled Electron `BrowserWindow` renderer that subscribes to the same trusted display state as local display windows and renders the final visual composition at a configured remote output size. The stream-host mirrors those rendered frames into an internal canvas, uses `canvas.captureStream()` to produce a `MediaStream`, and sends that track to remote viewers over WebRTC.

Required behavior:

- Remote display can run even when the matching local display window is closed.
- Remote output size/aspect ratio is independent from the local display window.
- Multiple published displays can stream at the same time, each with its own offscreen-enabled render target and source stream.
- Per-client sizing is delegated to the remote browser viewer. The server sends the canonical display stream; the viewer uses `object-fit: contain` by default, optional `cover`, fullscreen, and CSS sizing to adapt to each device viewport.
- Live visual sources must either render correctly in the remote render target or report a stable source-specific error. Silent partial rendering is not acceptable.
- The remote renderer remains the source for WebRTC streaming; the remote browser does not receive show state or raw media paths.
- The local display window, when open, remains a separate local presentation target.
- Physical screen capture and visible-window capture are not fallback paths for production.

Recommended implementation:

- Create one offscreen-enabled Electron `BrowserWindow` for each published display when it is published.
- Size the remote render `BrowserWindow` to the display's current remote output profile.
- Reuse the existing display renderer code path as much as possible so DOM/video/image/live-capture behavior stays consistent with local display output.
- Subscribe to render frames with Electron frame subscription/offscreen rendering APIs.
- Draw subscribed frames into a stream-host canvas at the output profile size.
- Produce the WebRTC source with `canvas.captureStream(30)` and feed that `MediaStream` into `RTCPeerConnection`.
- Do not send raw frames over WebSocket.
- Keep a purpose-built canvas compositor as future optimization/reliability work only if the offscreen `BrowserWindow` path cannot satisfy production QA.

Rejected strategies:

- Visible display window capture: rejected because it depends on local window existence, size, minimization, occlusion, fullscreen behavior, and platform capture quirks.
- Physical monitor capture: rejected because it can expose unrelated desktop content and cannot guarantee an Xtream-only remote output.
- Remote browser reimplementation of `display.html`: rejected because it would expose too much app state/media surface and duplicate trusted Electron rendering behavior.
- Server-side per-client render sizing: rejected for the first production release because it multiplies renderer/encoder load and makes stream synchronization harder. Client-specific viewport fitting belongs in the remote viewer.

Risks:

- More engineering work than visible-window capture.
- The remote renderer must receive trusted state without exposing broad IPC to remote clients.
- Live capture visuals may need careful routing so the remote renderer can consume the same intended visual source safely.
- Multiple published displays require multiple render targets, increasing CPU/GPU cost.
- Frame subscription plus canvas blitting adds work on the operator machine and needs careful frame pacing.
- True per-client aspect-ratio rendering would require multiple render targets or encodes per display, increasing synchronization and performance risk.

Mitigation:

- Use one canonical remote render target and source stream per published display.
- Support multiple published displays immediately, but avoid multiple server-side output profiles per display in the first production release.
- Delegate per-client sizing to the viewer by scaling, letterboxing, cropping, and fullscreening the received video locally.
- Keep the remote renderer visually equivalent to local displays through shared display-rendering modules and focused parity tests.

### Recommended remote display production architecture

```txt
Remote browser
  GET /display/<slug>
    receives viewer HTML/JS
  PIN login
    verifies the viewer PIN and creates a capability-scoped viewer session credential
  WebSocket /ws/remote-display/<slug>
    authenticates the viewer session during upgrade without URL credentials
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

Electron offscreen remote render/stream-host renderer
  renders display output at configured remote size/aspect ratio
  mirrors render frames into a canvas-backed MediaStream
  owns peer connections or receives peer instructions
```

Key decision:

- WebRTC runs in the stream-host renderer process, not pure Node.

Recommendation:

- Use an offscreen-enabled trusted Electron `BrowserWindow` renderer as the remote render target and WebRTC stream host.
- Keep the HTTP/WebSocket server in main.
- Main forwards signaling messages between remote WebSocket clients and the stream-host renderer through IPC.

This fits the current Electron architecture:

- Main remains the network authority.
- Renderer remains the browser API authority for rendering, `RTCPeerConnection`, `MediaStream`, and browser codecs.
- Existing display renderer behavior can be reused without exposing Electron preload APIs to remote browsers.

### Stream-host renderer

The offscreen remote render/stream-host renderer should be internal and minimal.

Responsibilities:

- Receive `ensure-source` from main with display ID, output profile, and resolution/fps/bitrate hints.
- Create or reuse the offscreen-enabled `BrowserWindow` render target for that display/output profile.
- Subscribe to the same trusted display state and stream state needed to render the final visual output.
- Mirror subscribed render frames into an internal canvas and produce a source `MediaStream` with `canvas.captureStream(30)`.
- Maintain one source stream per published display.
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

Files:

- `src/renderer/streamHost.html`
- `src/renderer/streamHost.ts`
- `src/preload/streamHostPreload.ts`
- Shared display-rendering modules factored from `src/renderer/display.ts` as needed.

Vite config would need a new input for `streamHost.html`.

### WebRTC signaling

Use WebSocket for signaling.

Before opening the signaling WebSocket, the viewer submits the PIN to a small verification route. A successful response returns a short-lived viewer session credential scoped to `display:view` for the requested display slug. The viewer must present that session credential during the WebSocket upgrade without putting it in the URL, such as by using the `Sec-WebSocket-Protocol` header value supported by browser WebSocket clients.

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
  | { type: 'hello'; protocolVersion: 1; displayId: string; displayLabel?: string; outputProfile: RemoteDisplayOutputProfile; defaultViewerFitMode: RemoteDisplayViewerFitMode }
  | { type: 'status'; status: 'waiting' | 'starting' | 'live' | 'ended' | 'error'; message?: string }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'display-update'; displayId: string; displayLabel?: string; slug: string; outputProfile: RemoteDisplayOutputProfile; defaultViewerFitMode: RemoteDisplayViewerFitMode }
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
};

type RemoteDisplayViewerFitMode = 'contain' | 'cover';
```

### Viewer page

The remote viewer page should be deliberately small.

Responsibilities:

- Parse display slug.
- Show a PIN login state until the viewer session is verified.
- Open WebSocket signaling connection.
- Create an `RTCPeerConnection`.
- Send offer and ICE candidates.
- Attach remote stream to a video element.
- Fit the received video to the client viewport with `object-fit: contain` by default.
- Allow local viewer-side `cover`/fullscreen behavior without requesting a different server-side render size.
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

Quality presets:

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
  - 1080p cap
  - 30 fps
  - higher bitrate

Start conservative:

- Default to `balanced`.
- Default max clients per display: `2`.
- Expose max clients per display in Config.
- Defer 60 fps and 1440p+ profiles until baseline 1080p/30 streaming is stable on both Windows and macOS.

### Remote display output profiles and client-side sizing

Remote rendering needs explicit output profiles so the stream is not tied to a visible local display window.

Built-in profiles:

```ts
type RemoteDisplayOutputProfilePreset = '720p-landscape' | '1080p-landscape' | '1080p-portrait' | 'custom';
```

First production release behavior:

- Default to `1080p-landscape`.
- Allow width/height configuration in Config or display detail.
- Support multiple published remote displays at the same time.
- Use one active server-side output profile and one source stream per published display.
- Apply output profile changes through in-place source reconfiguration wherever possible:
  - Do not resize, close, or reopen local display windows.
  - Do not require the remote browser window to reload.
  - Keep existing viewer peer connections and video elements attached.
  - Switch the stream-host canvas/render source to the new output profile and let the remote client continue receiving the updated video track.
  - If the browser/WebRTC stack requires renegotiation for the changed stream dimensions, perform it automatically without user action and keep the viewer in a live/reconfiguring state rather than an ended state.
- Let every remote viewer fit the received stream locally with `contain` by default.
- Allow viewer-side `cover`/fullscreen behavior without creating a new server render target.
- Do not support arbitrary server-side per-client aspect-ratio rendering in the first production release.
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
- PIN login or stronger pairing.
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
- PIN regeneration.
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
- Client count.
- Stream status.
- Remote output profile selector.
- Remote output width/height fields for custom profiles.
- Default viewer fit mode selector: contain or cover, applied client-side.
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
   - Missing display IDs: mark unavailable and preserve the app-local publication record.
   - New display IDs: publish only if default says so.
3. Active clients for removed displays receive `ended`.
4. Published displays create remote render targets even if no visible display window is open and even before remote WebRTC clients connect.

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

- Unpublish the display.
- Remove its app-local publication record.
- Close affected client sessions and the remote render target.

### Server setting change

- Validate new config.
- Restart server when host/port/auth mode changes.
- Keep protocol module state where safe, but use clean teardown when auth or bind settings require it.
- Apply remote display output profile changes through in-place stream source reconfiguration where possible, preserving local display windows, remote browser windows, peer connections, and video element attachment.

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
- PIN generation, verification, and viewer session validation.
- Capability checks.
- Route matching.
- Display slug generation and deduplication.
- Publication reconciliation when displays are created, closed, reopened, removed, and relabeled.
- Remote output profile normalization and validation.
- Viewer-side fit mode behavior.
- Message schema parsing.

### Main-process integration tests

Add tests for:

- Starting and stopping server core.
- Port conflict handling.
- HTTP route returns expected viewer shell.
- Unauthorized requests get 401/403.
- Unknown slugs get 404.
- WebSocket upgrade dispatch rejects invalid protocol routes.
- `GET /health` only responds to localhost requests.

### Renderer tests

Add tests for:

- Viewer connection states.
- WebRTC signaling state reducer if factored into pure helpers.
- Viewer error states.
- PIN login and slug parsing.

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
- Open the same display from different viewport sizes and confirm client-side `contain`/`cover` behavior without server-side render target changes.
- Regenerate the PIN and confirm existing viewer sessions are closed or reverified.
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
- Stream multiple published displays at the same time.
- Stream the same display to clients with different viewport sizes while sharing one source stream.
- Observe CPU/GPU/network usage.

Platform QA:

- Windows and macOS are both first-target platforms.
- Verify offscreen-enabled `BrowserWindow` remote render target behavior on both.
- Verify packaged renderer asset loading and WebRTC stream creation on both.
- Linux only if packaging/support targets it.

## Implementation phases

### Phase 1: Server foundation

Scope:

- Add app-local local-network settings and persistence.
- Add `LocalNetworkServiceManager`.
- Add `ServerCore` with HTTP route registration, lifecycle, status, and shutdown handling.
- Add PIN generation/verification, viewer session validation, and capability checks.
- Add basic Config UI for enable/disable, host, port, status, and PIN regeneration.

Deliverables:

- Server can start, stop, restart, and auto-start after `app.whenReady` when enabled.
- `GET /health` returns minimal localhost-only status.
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
- Add remote output profile settings, including width, height, quality preset, default viewer fit mode, and max clients.
- Factor the current display renderer enough that local display windows and remote render targets can share the same visual rendering path.
- Define the trusted IPC contract needed by offscreen-enabled `BrowserWindow` remote renderers.

Deliverables:

- Publications can be created, updated, removed, and reconciled against the current display IDs.
- Output profiles validate and normalize independently from local display window geometry, and viewer fit mode remains client-side.
- Shared display-rendering code can be loaded by both `display.html` and the future remote render/stream-host entry.

Acceptance:

- Slugs deduplicate and auto-update when display labels change.
- Removing a display unpublishes it, removes its app-local publication record, then closes affected clients and the remote render target.
- Output profile changes do not resize or reopen local display windows.
- Renderer factoring preserves existing local display behavior in tests/manual smoke checks.

### Phase 3: Viewer routes, publication UI, and signaling skeleton

Scope:

- Add credential-free `GET /display/<slug>` viewer route that serves a PIN login state before playback.
- Add WebSocket support in server core using `ws` and `/ws/remote-display/<slug>` signaling route.
- Add client/session registry with heartbeat, timeout, and cleanup callbacks.
- Add Config/Display UI controls for publish, slug, output profile, copy URL, status, and client count.
- Add the Vite-built viewer shell with PIN login, connection, unauthorized, unavailable, waiting, and ended states.

Deliverables:

- A published display has a copyable URL and optional local display-window title annotation when the local window is open.
- Viewer verifies the PIN, connects to the authenticated signaling route, and receives display metadata/status.
- Unknown, unpublished, unauthorized, and removed displays produce stable viewer states.
- Viewer URLs do not contain credentials.

Acceptance:

- Unauthorized protected HTTP/API requests and WebSocket upgrades are rejected.
- Stale clients time out and disappear from diagnostics.
- Display removal sends an ended/error state.
- No show config, raw media paths, or control APIs are exposed.

### Phase 4: Offscreen BrowserWindow remote render targets

Scope:

- Add the offscreen-enabled `BrowserWindow` remote render/stream-host renderer entry and dedicated preload.
- Add main-to-host IPC for `ensure-source`, output profile changes, source status, and release.
- Render a published display ID at the selected remote output profile without opening a visible local display window.
- Subscribe to render target frames, mirror them into a stream-host canvas, and produce a local `MediaStream` with `canvas.captureStream(30)`.
- Add render-target status reporting and parity checks against local display rendering.

Deliverables:

- Remote render targets can render the visual output for multiple published displays with no remote WebRTC clients attached.
- Remote rendering continues when the visible local display window is closed.
- Render target dimensions match the selected output profile.

Acceptance:

- Works in development on Windows and macOS.
- Closing/reopening a local display window does not stop the remote render target.
- Remote render targets never use visible-window capture or physical-screen capture.
- Live visual sources either render correctly or report a stable `remote_render_target_unavailable`/source-specific error.

### Phase 5: WebRTC streaming from remote render targets

Scope:

- Create one `RTCPeerConnection` per remote viewer.
- Relay SDP/ICE over the WebSocket signaling path.
- Attach the remote render target video track to each peer connection.
- Apply quality presets and enforce max clients per display.
- Share one source stream per published display across that display's remote clients.
- Keep per-client sizing in the remote viewer through `contain`, `cover`, fullscreen, and CSS viewport fitting.

Deliverables:

- Remote browser sees the visual-only stream for a published display.
- Multiple published displays can stream at the same time.
- Multiple clients can view the same published display within the configured limit.
- Manual URL sharing and PIN login work over LAN.

Acceptance:

- Viewer handles live, reconnecting, ended, unauthorized, unpublished, and unavailable states.
- Client disconnect cleans up peer connections, tracks, and session state.
- Remote output profile controls the canonical stream dimensions/aspect ratio.
- Different client viewport sizes do not create server-side render targets.
- No raw media files are served.

### Phase 6: Production lifecycle, diagnostics, and output behavior

Scope:

- Add render target recovery when the renderer, media stream, or WebRTC source fails.
- Add output profile change handling through in-place source reconfiguration, with automatic renegotiation only when required by the browser/WebRTC stack.
- Add detailed Config diagnostics for server, publications, render targets, clients, and last errors.
- Add disconnect-all, PIN regeneration cleanup, and app shutdown cleanup.
- Add focused parity/performance tests for offscreen `BrowserWindow` rendering.

Deliverables:

- Remote display survives common lifecycle changes.
- Operator can inspect remote render target status, stream status, and client status.
- PIN regeneration and settings changes intentionally close or restart affected sessions.

Acceptance:

- Closing/reopening local display windows does not interrupt remote output.
- Unpublishing/removing displays ends affected clients cleanly.
- Render target recovery is visible in status and does not leak old peer connections or tracks.
- Output profile changes update the active remote stream without resizing local display windows, reloading remote browser windows, or requiring user action from connected viewers.

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

4. Should viewer authentication use a token in the URL or a PIN login page?

   Use a PIN login page immediately. Remote display URLs must not include credentials.

5. Should the remote output capture a visible display window, a physical screen, or render independently?

   Render independently through an offscreen-enabled `BrowserWindow` remote render target. Do not use visible display-window capture or physical screen capture.

6. What default bind address should the UI choose?

   Default to `auto-lan`: choose the active default-route private IPv4 address on a physical Wi-Fi or Ethernet interface. Avoid loopback, link-local, VPN, Docker, virtual machine, and tunnel adapters by default. Let the user override the exact LAN interface/IP in Config.

7. What is the expected first target platform?

   Both Windows and macOS. Infrastructure must be platform agnostic.

8. How many remote viewers per display should be allowed by default?

   2 per display by default. Expose this setting in the Config surface.

9. Should per-client remote viewport sizing create server-side render targets?

   No. The first production release supports multiple published remote displays, but each display has one canonical server-side output profile. Individual clients fit that stream locally with contain/cover/fullscreen behavior.

10. What should happen when a published display's remote output profile changes?

   The local display window and remote browser window should not be interrupted. Reconfigure the remote render target/source in place, keep existing peer connections and video elements attached where possible, and let the remote client continue receiving the updated stream. If the browser/WebRTC stack requires renegotiation for dimension changes, handle it automatically without user action.

## Remaining implementation decisions

These are not product blockers for the server foundation, but they should be resolved before or during the streaming phases.

1. Exact quality preset numbers.

   The quality presets are named and bounded, but the initial bitrate targets, encoder preference hints, and fallback behavior should be finalized during performance QA on Windows and macOS.

## Risks and mitigations

### Remote render reliability

Risk:

- Offscreen `BrowserWindow` remote rendering may diverge from the local display renderer or fail to acquire equivalent visual inputs.

Mitigation:

- Share display-rendering modules between local and remote renderers where practical.
- Show clear remote render target and stream-host status in Config.
- Test both Windows and macOS early because offscreen `BrowserWindow` renderer behavior is part of the core requirement.
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
- PIN verification required before signaling.
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
- Credential-free HTTP viewer route with PIN login.
- PIN/session-secured WebSocket signaling route.
- Display publication with label-derived dynamic slug.
- Copyable remote display URL.
- Current remote display URL in the local display window title while published.
- Offscreen-enabled `BrowserWindow` remote render/stream-host renderer with a dedicated preload.
- Remote output profiles with configured size/aspect ratio.
- Multiple simultaneously published remote displays.
- Viewer-side per-client sizing through contain/cover/fullscreen fitting.
- WebRTC visual-only stream from the remote render target.
- Remote rendering that does not require a visible local display window.
- Basic status/errors in Config.
- Client cleanup on display removal and app shutdown.
- Windows and macOS manual QA.

It should defer:

- Audio.
- Remote control.
- mDNS discovery.
- QR-code share UI.
- Stronger pairing flow beyond the first PIN login.
- Raw media serving.
- MIDI/OSC implementations.
- Server-side per-client render targets or arbitrary per-client source aspect ratios.
- Physical screen capture fallback.
- Visible display-window capture fallback.

## Notes for future implementation

- Prefer Node built-ins for HTTP at first. Avoid adding Express unless routing complexity justifies it.
- Use the `ws` package for the main-process WebSocket server instead of implementing the WebSocket protocol manually.
- Keep WebRTC in the Chromium stream-host renderer; do not add a native Node WebRTC dependency for the first production release.
- Keep all remote network message schemas in shared types with runtime validation helpers.
- Avoid passing full `DirectorState` or show config to remote clients for display viewing. The viewer needs stream status and WebRTC negotiation only.
- When adding future OSC/MIDI, keep command/action mapping explicit and auditable.
