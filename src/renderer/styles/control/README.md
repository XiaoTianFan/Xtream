# Control UI styles

The control window loads a single bundle from `src/renderer/control.css` (`control.ts` imports it). That file is a thin orchestrator; cascade-sensitive rules live here in a **fixed order**.

## Import order (`control.css`)

| # | File | Role |
|---|------|------|
| 1 | `tailwindcss` + `scrollbar.css` | Framework + scrollbars (scrollbar colors from `:root` in `tokens.css`) |
| 2 | `tokens.css` | `@theme` (Tailwind-facing names) + `:root` semantic aliases and layout tokens |
| 3 | `base.css` | Global reset, `body`, buttons, inputs, `input[type="range"].mini-slider` |
| 4 | `shell.css` | App shell, rail, frame, launch / extraction overlays, loading scrims |
| 5 | `patch-layout.css` | Patch grid, top bar, workspace, operator footer, surface cards (through pre-pool chrome) |
| 6 | `patch-media-pool.css` | Panels, media pool columns, splitter, pool tabs, mappings |
| 7 | `patch-mixer-display.css` | Mixer strips, meters, displays, previews, routing modals, patch output-source rows |
| 8 | `stream.css` | Stream surface (header, transport, scene list, scene edit, subcues, stream-only media queries) |
| 9 | `config-layout.css` | Config surface: tab strip host, resizable bottom log pane (`--config-log-height`) |
| 10 | `shared-components.css` | Cross-surface primitives: `.db-control`, `.badge`, `.status-footer`, `.sr-only`, `.icon-button`, `.control-icon` |

Keep **stream** before **config-layout** before **shared** so surface-scoped rules that reference `.icon-button` / `.pool-tab` / `.db-control` stay ahead of the generic component rules (same specificity discipline as the legacy monolith).

## Editing

- Prefer **contiguous blocks** and stable selector order when moving rules between files.
- **`@theme` keys** live only in `tokens.css`; legacy names (`--surface`, `--text-primary`, …) are `:root` aliases so existing rules do not need renaming.
- **`--slider-fill` / `--slider-rail`** for range inputs are set on `input[type="range"].mini-slider` in `base.css` (component-local), not as global tokens.
