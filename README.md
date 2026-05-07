# Xtream

<p align="center">
  <strong>Desktop show control for multi-display visuals, audio routing, and scene-based playback.</strong>
</p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-41-47848f?logo=electron&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-lightgrey">
</p>

Xtream is an Electron app for building and running media-rich shows on a workstation. It brings visual media, live capture, display windows, virtual audio outputs, and scene-based cueing into one operator console.

It is designed for installations, exhibitions, performances, demos, and other rooms where you need to route content to screens and audio outputs with confidence.

## Highlights

- **Patch workspace** for importing media, previewing assets, mapping visuals to display windows, and mixing virtual audio outputs.
- **Stream workspace** for programming scenes with manual, follow, delay, and timecode triggers.
- **Audio, visual, and control sub-cues** for routing audio, targeting displays, adjusting fades and loops, and automating transport or global safety actions.
- **Thread-based playback** so manual scenes, side timelines, loops, and parallel branches can run without flattening everything into one brittle timeline.
- **Flow and Gantt views** for arranging scenes visually and reviewing timing across complex streams.
- **Waveform audio editing** for trimming source ranges, auditioning cues, changing pitch, editing fades, and drawing level or pan automation.
- **Live visual sources** for webcams, screens, screen regions, and application windows.
- **Operator diagnostics** with a global problems strip, session log, readiness checks, missing-media relink, and diagnostics export.

## Workspaces

| Workspace | Use it for |
| --- | --- |
| **Patch** | Media pool, display windows, visual mapping, virtual outputs, meters, transport, and asset details. |
| **Stream** | Scene lists, Flow layout, Gantt timing, scene editing, sub-cues, thread playback, and Stream transport. |
| **Config** | Runtime overview, show settings, Stream playback preferences, display composition, diagnostics, and session log. |
| **Performance** | Planned surface for live execution and monitoring. |

## Show Projects

Xtream saves shows as `show.xtream-show.json` files inside a project folder. Copied and extracted media is stored under project-local `assets/audio` and `assets/visuals` folders, while linked media keeps its original disk path.

Current show files use schema v9. Older supported schemas are migrated automatically when opened.

## Getting Started

### Requirements

- Node.js LTS
- npm
- Git

### Run Locally

```bash
git clone https://github.com/XiaoTianFan/Xtream.git
cd Xtream
npm install
npm start
```

`npm start` builds the app, runs type checks and tests, then opens Xtream in Electron.

## Development

```bash
npm run typecheck   # TypeScript checks for main and renderer
npm test            # Vitest test suite
npm run build       # Clean, typecheck, test, and build
npm run pack        # Build unpacked Electron app
npm run dist        # Build distributable app packages
npm run dist:win    # Build Windows NSIS and portable packages
```

The main process lives in `src/main`, shared show/runtime models live in `src/shared`, and the control/display/audio renderers live in `src/renderer`.

## License

Xtream is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Personal, educational, research, hobby, and other noncommercial use is allowed. Commercial use requires separate written permission from the project owner.

## Working in Progress

- [Runtime changelog](docs/runtime-changelog.md)

## Current Status

For the latest product-level changes, see the [runtime changelog](docs/runtime-changelog.md).
