# Control Renderer Refactor Plan

This plan tracks the incremental split of `src/renderer/control.ts` into smaller renderer modules. The goal is to reduce file size and coupling without changing runtime behavior, especially around transport, display previews, audio metering, and show-state IPC.

## Goals

- Keep `src/renderer/control.ts` as the composition root: CSS import, state subscription, module controller setup, global event wiring, and startup/cleanup.
- Move cohesive behavior into `src/renderer/control/*` modules with clear ownership.
- Avoid circular imports by passing callbacks/controllers into modules that need to refresh state or report status.
- Preserve the existing vanilla TypeScript renderer stack.
- Verify each extraction with `npm run typecheck` and targeted tests where available.

## Refactor Checklist

- [x] Extract DOM element registry to `src/renderer/control/elements.ts`.
- [x] Extract renderer-local shared UI types to `src/renderer/control/types.ts`.
- [x] Extract pure formatting helpers to `src/renderer/control/formatters.ts`.
- [x] Extract persisted layout sizing and splitter behavior to `src/renderer/control/layoutPrefs.ts`.
- [x] Extract launch dashboard behavior to `src/renderer/control/launchDashboard.ts`.
- [x] Extract shell icon decoration to `src/renderer/control/shellIcons.ts`.
- [x] Extract display preview runtime to `src/renderer/control/displayPreview.ts`.
- [x] Extract transport, timecode, rate, loop, and timeline controls to `src/renderer/control/transportControls.ts`.
- [x] Extract media pool rendering, filtering, context menus, and drag/drop import to `src/renderer/control/mediaPool.ts`.
- [ ] Extract selected asset preview and local preview controls to `src/renderer/control/assetPreview.ts`.
- [ ] Extract visual/audio metadata probing and embedded-audio import prompts to `src/renderer/control/embeddedAudioImport.ts`.
- [ ] Extract display card rendering, telemetry text, and mapping controls to `src/renderer/control/displayWorkspace.ts`.
- [ ] Extract mixer strips, faders, meters, solo/mute controls, and output-source routing controls to `src/renderer/control/mixerPanel.ts`.
- [ ] Extract details pane rendering to `src/renderer/control/detailsPane.ts`.
- [ ] Extract non-patch surfaces (`cue`, `performance`, `config`, `logs`) to `src/renderer/control/surfaceViews.ts`.
- [ ] Extract render-signature helpers or introduce a small render coordinator once feature modules have stable boundaries.
- [ ] Reduce `src/renderer/control.ts` to bootstrap and orchestration only.

## Current Module Map

```text
src/renderer/control.ts                  # composition root, render orchestration, remaining feature renderers
src/renderer/control/audioRuntime.ts      # existing Web Audio graph/runtime
src/renderer/control/busFaderLaw.ts       # existing fader law helpers
src/renderer/control/displayPreview.ts    # display preview canvas/video/progress sync
src/renderer/control/dom.ts               # existing DOM factory helpers
src/renderer/control/elements.ts          # DOM element registry
src/renderer/control/formatters.ts        # pure display formatting helpers
src/renderer/control/graticuleLayout.ts   # existing meter/fader scale layout
src/renderer/control/icons.ts             # existing icon decoration primitive
src/renderer/control/issues.ts            # existing issue list renderer
src/renderer/control/launchDashboard.ts   # launch dashboard controller
src/renderer/control/layoutPrefs.ts       # layout prefs and splitter behavior
src/renderer/control/mediaPool.ts         # media pool rendering, filtering, context menus, import controls
src/renderer/control/mediaSync.ts         # existing timed media sync helper
src/renderer/control/shellIcons.ts        # shell icon installation
src/renderer/control/transportControls.ts # transport/timecode/rate/loop/timeline controller
src/renderer/control/types.ts             # renderer-local shared UI types
```

## Safe Extraction Order

1. Media pool and asset preview.
   These are visible UI areas with moderate coupling to selection and embedded-audio prompts. Keep them separate so local preview playback does not get tied to list rendering.

2. Embedded-audio import and metadata probing.
   This flow touches file operations through preload IPC and should be isolated before future live-capture work expands media import behavior.

3. Display workspace.
   Keep display card DOM separate from `displayPreview.ts`, which already owns preview media synchronization.

4. Mixer panel.
   Move meter caches, fader rendering, solo state sync, and output source controls as a unit. Do not split meters away from the caches that update them.

5. Details pane and surface views.
   These depend on many helpers and should move after the feature modules expose stable rendering/control functions.

6. Render coordinator cleanup.
   Once feature modules are separated, move render signatures and render gating into a small coordinator or keep them in `control.ts` if that remains clearer.

## Guardrails

- Do not export mutable globals from feature modules.
- Prefer controller factories that receive `renderState`, `getState`, `setShowStatus`, and selection callbacks.
- Preserve existing IPC calls and state refresh behavior before attempting UX or performance changes.
- Keep meter element caches and display preview `WeakMap` ownership local to their feature modules.
- Run `npm run typecheck` after each extraction.
- Run `npm run test` after behavior-sensitive extractions.

## Verification Status

- [x] `npm run typecheck` passed after the first extraction pass.
- [x] `npm run test` passed after the first extraction pass.
- [x] `npm run typecheck` passed after media pool extraction.
- [x] `npm run test` passed after media pool extraction.
