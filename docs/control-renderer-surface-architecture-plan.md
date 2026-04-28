# Control Renderer Surface Architecture Plan

This plan describes the next refactor phase for the control renderer after the first split of `src/renderer/control.ts`.
The current renderer is moving in the right direction, but the architecture should not permanently treat Patch as the
main workspace and Cue, Performance, Config, and Logs as small side panels. Cue and Performance are expected to become
large, first-class workspaces, so the renderer should be organized around peer surfaces.

## Goals

- Make Patch, Cue, Performance, Config, and Logs parallel surface modules.
- Move the current Patch-specific modules into a `patch/` subtree.
- Move the current global top bar/header behavior into surface-owned headers, starting with `patchHeader`.
- Keep the app shell responsible only for navigation, launch gating, active-surface mounting, global status, and startup.
- Introduce a light surface router before introducing any heavier render coordinator.
- Keep shared UI helpers and media/audio primitives outside individual surfaces.
- Preserve runtime behavior throughout the migration.

## Current Problem

The current DOM and renderer structure implies this shape:

```text
control.ts
  shell rail
  global top bar
  patch workspace
  placeholder non-patch surface panel
  patch footer/details
```

That works while Patch is the only complex surface, but it will not scale well if:

- Cue needs a dedicated cue-list and cue-playback header.
- Performance needs live-show controls, monitoring summaries, and a different operator layout.
- Config and Logs grow beyond placeholder cards.

The top bar is the clearest architectural mismatch. It currently contains transport, loop, rate, show file actions,
live-state, mute, blackout, and performance-mode controls. Some of those are Patch-oriented, some are global, and some
may need different treatment in Cue or Performance. A permanent global header would force future surfaces to either
share Patch's header or add awkward exceptions.

## Target Shape

The target is:

```text
src/renderer/control.ts                 # app bootstrap and controller composition only

src/renderer/control/app/
  surfaceRouter.ts                      # active surface switching and mounting
  renderCoordinator.ts                  # optional later, only after repeated patterns settle
  showActions.ts                        # open/save/create project actions
  appStatus.ts                          # show status and issue merging
  interactionLocks.ts                   # panel interaction guard helpers

src/renderer/control/shell/
  elements.ts                           # shell/global DOM registry, split further over time
  rail.ts                               # Patch/Cue/Performance/Config/Logs navigation
  launchDashboard.ts                    # launch overlay behavior
  shellIcons.ts                         # shell/global icon install
  topBar.ts                             # temporary adapter during header migration

src/renderer/control/shared/
  dom.ts                                # generic DOM factories
  formatters.ts                         # generic formatting helpers
  icons.ts                              # icon decoration primitive
  issues.ts                             # issue list renderer
  types.ts                              # shared renderer-local UI types

src/renderer/control/media/
  audioRuntime.ts                       # Web Audio graph/runtime
  mediaSync.ts                          # timed media sync helper
  mediaMetadata.ts                      # embedded-audio metadata helper

src/renderer/control/meters/
  busFaderLaw.ts                        # fader law helpers
  graticuleLayout.ts                    # fader/meter scale layout

src/renderer/control/patch/
  patchSurface.ts                       # Patch surface composition
  patchHeader.ts                        # Patch-owned header controls
  patchLayoutPrefs.ts                   # Patch splitters/layout prefs if not shared
  mediaPool.ts
  assetPreview.ts
  embeddedAudioImport.ts
  displayWorkspace.ts
  mixerPanel.ts
  detailsPane.ts
  displayPreview.ts

src/renderer/control/cue/
  cueSurface.ts
  cueHeader.ts

src/renderer/control/performance/
  performanceSurface.ts
  performanceHeader.ts

src/renderer/control/config/
  configSurface.ts
  configHeader.ts                       # optional if config needs custom controls

src/renderer/control/logs/
  logsSurface.ts
  logsHeader.ts                         # optional if logs needs custom controls
```

This structure is a target, not a requirement to move every file in one pass.

## Ownership Rules

### `control.ts`

`control.ts` should become the app composition root. It should:

- Import CSS.
- Create shared controllers.
- Create the surface router.
- Subscribe to director state.
- Forward state to the router/coordinator.
- Install global lifecycle hooks.
- Start audio/display monitor loading.

It should not:

- Render Patch cards directly.
- Render non-patch surfaces directly.
- Own Patch header controls.
- Own meter caches.
- Own selected entity details rendering.

### App Layer

The `app/` layer owns cross-surface orchestration:

- Active surface state.
- Surface routing.
- Global show actions when they truly apply to all surfaces.
- Global status and visible issue merging.
- Shared render invalidation primitives if needed.

It should not know how to build Patch, Cue, or Performance DOM internals.

### Shell Layer

The `shell/` layer owns stable application chrome:

- Rail navigation.
- Launch dashboard.
- Global app frame visibility.
- Any truly global status region.

The shell should not permanently own the current Patch top bar. During migration, `topBar.ts` can temporarily adapt
existing DOM until each surface owns its header.

### Surface Layer

Each surface owns its own:

- Header.
- Body/workspace.
- Footer or secondary panels.
- Render signatures.
- Interaction locks specific to its panels.
- Surface-specific controls and command wiring.

Patch is one surface among peers, not the parent of the others.

## Header Refactor

The current `index.html` has one global header:

```html
<header class="top-bar">...</header>
```

The long-term structure should become:

```html
<main class="app-main">
  <aside class="rail">...</aside>
  <section id="surfaceMount" class="surface-mount"></section>
</main>
```

Each surface then renders or owns:

```text
surface
  surface header
  surface body
  optional surface footer
```

For Patch, the initial `patchHeader.ts` should own the current controls:

- Timecode display and edit behavior.
- Play, pause, stop.
- Loop popover.
- Timeline scrubber.
- Rate display and drag/edit behavior.
- Global audio mute and display blackout buttons if they remain Patch-visible.
- Performance mode toggle if it remains Patch-visible.
- Show save/open/create actions if these remain visible in Patch.
- Live-state chip if Patch-specific presentation remains useful.

Some header controls may later move to shared widgets:

- Transport/timecode controls can become `shared/transportWidget.ts` if Cue or Performance reuses them.
- Show save/open/create can become `app/showActions.ts` plus small per-surface buttons.
- Live status can become `app/appStatus.ts` if it is global.

Do not decide all of this in one move. First make Patch own the current header. Then extract reusable widgets only when
another surface needs them.

## File Movement Recommendations

### Move To `patch/`

These modules are Patch-specific today:

- `assetPreview.ts`
- `detailsPane.ts`
- `displayPreview.ts`
- `displayWorkspace.ts`
- `embeddedAudioImport.ts`
- `mediaPool.ts`
- `mixerPanel.ts`

Likely Patch-specific:

- `layoutPrefs.ts`, unless future surfaces use the same splitters.
- `transportControls.ts`, initially as part of `patchHeader.ts` or beside it.

### Move To `shared/`

These are generic UI utilities:

- `dom.ts`
- `formatters.ts`
- `icons.ts`
- `issues.ts`
- `types.ts`

If `types.ts` grows surface-specific unions, split it into shared and surface-local types.

### Move To `shell/`

These are app chrome or launch behavior:

- `elements.ts`, temporarily. Later split into shell and surface element registries.
- `launchDashboard.ts`
- `shellIcons.ts`

Potential additions:

- `rail.ts`
- `topBar.ts`, as a temporary bridge during header migration.

### Move To `media/`

These are media/audio runtime primitives:

- `audioRuntime.ts`
- `mediaSync.ts`
- `mediaMetadata.ts`, currently located at `src/renderer/mediaMetadata.ts`.

### Move To `meters/`

These are meter/fader primitives:

- `busFaderLaw.ts`
- `graticuleLayout.ts`

Tests should move with their corresponding modules.

## Surface Router

Introduce `app/surfaceRouter.ts` before a full render coordinator.

The router should own:

- The active `ControlSurface`.
- Rail state updates, or delegate those to `shell/rail.ts`.
- Showing/hiding the active surface mount.
- Calling the active surface controller.

Conceptual API:

```ts
type SurfaceController = {
  id: ControlSurface;
  mount: () => void;
  unmount?: () => void;
  render: (state: DirectorState) => void;
};

createSurfaceRouter({
  surfaces: [patchSurface, cueSurface, performanceSurface, configSurface, logsSurface],
  getActiveSurface,
  setActiveSurface,
});
```

Initially, surfaces can still use existing static DOM nodes. Later they can mount into a dedicated `surfaceMount`.

## Render Signatures

A render signature is a compact representation of the part of state a renderer cares about. It is used to avoid
unnecessary DOM replacement and to protect focused inputs, select menus, drag state, preview DOM, and meter elements.

Example:

```ts
const nextSignature = patchSurface.createRenderSignature(state, context);
if (nextSignature !== previousSignature) {
  patchSurface.render(state);
}
```

Surface-local signature helpers should remain close to the surface until duplication appears.

Good signature helpers are:

- Pure functions.
- Specific to the renderer they guard.
- Conservative enough to update when visible behavior changes.
- Stable enough not to rerender on irrelevant telemetry or meter changes.

Avoid one giant app-wide signature. It will either be too broad and cause unnecessary rerenders or too subtle to maintain.

## Render Coordinator

A render coordinator is optional and should come after surface separation.

It would centralize repeated mechanics like:

- Previous signature storage.
- Forced invalidation.
- Interaction lock checks.
- Skip rendering inactive surfaces.
- Optional timing/debug logs.

Conceptual API:

```ts
coordinator.render('patch.mediaPool', mediaPoolSignature, {
  blocked: isPanelInteractionActive(mediaPanel),
  render: () => mediaPool.render(state),
});
```

The coordinator should not know domain details such as “visuals”, “outputs”, or “cue rows”. It should only know keys,
signatures, blocking conditions, and render callbacks.

Recommended sequence:

1. Keep signatures inside current controllers.
2. Introduce `surfaceRouter`.
3. Move Patch to `patch/patchSurface.ts`.
4. Add Cue and Performance placeholder surface controllers.
5. Only then extract a coordinator if the render gating pattern is repeated enough to justify it.

## Migration Plan

### Phase 1: Prepare Surface Boundaries

- Create `control/patch/`.
- Move Patch-specific modules into `patch/`.
- Update imports without changing behavior.
- Create `patch/patchSurface.ts` that composes:
  - `mediaPool`
  - `displayWorkspace`
  - `assetPreview`
  - `embeddedAudioImport`
  - `mixerPanel`
  - `detailsPane`
- Keep existing DOM structure for this phase.

Verification:

- `npm run typecheck`
- `npm run test`

### Phase 2: Introduce Surface Router

- Create `app/surfaceRouter.ts`.
- Move `activeSurface`, rail state, and surface switching out of `control.ts`.
- Keep current non-patch surfaces as lightweight controllers.
- Route Patch through `patchSurface.render(state)`.

Verification:

- `npm run typecheck`
- `npm run test`
- Manual smoke test: switch Patch/Cue/Performance/Config/Logs.

### Phase 3: Header Ownership

- Create `patch/patchHeader.ts`.
- Move current top-bar transport/timecode/rate/loop wiring into Patch header.
- Decide which controls are truly global versus Patch-owned.
- If necessary, create temporary `shell/topBar.ts` to bridge static DOM while moving ownership.

Do not redesign the header yet. This phase is about ownership.

Verification:

- `npm run typecheck`
- `npm run test`
- Manual smoke test: transport, timecode edit, rate drag/edit, loop popover, save/open/create, mute, blackout.

### Phase 4: Split Static DOM

- Update `index.html` from one global Patch-shaped layout toward:
  - shell rail
  - launch overlay
  - active surface mount
- Let Patch render or own its header/body/footer structure.
- Keep CSS class names stable where possible to reduce risk.

Verification:

- `npm run typecheck`
- `npm run test`
- Browser smoke test for Patch layout and launch dashboard.

### Phase 5: Promote Shared Primitives

- Move `dom.ts`, `formatters.ts`, `icons.ts`, `issues.ts`, and shared `types.ts` under `shared/`.
- Move media runtime helpers under `media/`.
- Move fader/meter primitives under `meters/`.
- Move tests with their modules.

Verification:

- `npm run typecheck`
- `npm run test`

### Phase 6: First-Class Cue And Performance Surfaces

- Replace placeholders with `cue/cueSurface.ts` and `performance/performanceSurface.ts`.
- Give each surface its own header module.
- Extract shared widgets only when two or more surfaces need them.

Verification:

- Surface-specific smoke tests as behavior is added.
- Existing full test suite.

### Phase 7: Optional Render Coordinator

- Review repeated render gating logic.
- Introduce `app/renderCoordinator.ts` only if it removes real duplication.
- Keep signature generation surface-local unless a helper is genuinely shared.

Verification:

- Add focused tests for coordinator behavior if it contains meaningful logic.
- Full typecheck and test suite.

## Guardrails

- Do not move files and change behavior in the same commit/pass unless required.
- Prefer import-only moves before ownership refactors.
- Do not create a large generic framework before Cue and Performance expose real needs.
- Keep surface modules responsible for their own DOM and signatures.
- Keep shell modules free of Patch-specific rendering.
- Keep media/audio primitives independent from surface modules.
- Preserve IPC calls and preload contracts.
- Preserve interaction-lock behavior around focused form controls.
- Run `npm run typecheck` after every phase.
- Run `npm run test` after every phase that touches behavior or shared utilities.

## Open Decisions

- Which current top-bar controls are global versus Patch-owned?
- Should show save/open/create always be visible in shell, or repeated per surface?
- Should global mute/blackout be shell-level emergency controls, or Patch/Performance header controls?
- Should Performance reuse Patch transport controls or get a stricter live-only transport widget?
- Should `layoutPrefs.ts` become Patch-only or a generic splitter preference utility?
- Should `elements.ts` remain a single registry until DOM is split, or be split early by surface?

## Immediate Next Recommendation

Do not extract `surfaceViews.ts` as a single flat module.

Instead, the next implementation step should be:

1. Create `src/renderer/control/patch/`.
2. Move the current Patch modules into that folder.
3. Create `patch/patchSurface.ts` as the Patch composition point.
4. Create `app/surfaceRouter.ts` with the existing non-patch placeholders as separate surface controllers.

This makes the future Cue and Performance workspaces peers of Patch rather than extensions of it.
