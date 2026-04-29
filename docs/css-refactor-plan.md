# Control UI CSS refactor plan

This document describes how to split `src/renderer/control.css` into multiple maintainable files and unify the design token story between Tailwind’s `@theme` block and legacy `:root` custom properties—without changing how the control window looks or behaves.

## Goals

- **Modularity:** Replace one ~4k-line file with ordered, domain-scoped stylesheets that map to UI areas (shell, patch, stream, shared components).
- **Single token source:** Eliminate duplicated or divergent color/spacing/font definitions between `@theme { … }` and `:root { … }`.
- **Stability:** No intentional visual or layout behavior change; same import entry from `control.ts` (`import './control.css'`).
- **Build:** Continue to work with Vite + `@tailwindcss/vite` and existing `scrollbar.css`.

## Non-goals (for this refactor)

- Rewriting layouts in Tailwind utility classes across the whole app.
- Renaming hundreds of HTML/TS class strings.
- Changing `display.css`, `audio.css`, or non-control bundles (unless shared token files are explicitly reused later).

## Historical baseline (before refactor)

| Item | Notes |
|------|--------|
| Entry | `control.ts` imports `./control.css`. |
| Layout | A single multi-thousand-line `control.css` mixed Tailwind, tokens, shell, patch, stream, and shared primitives. |
| Tokens | `@theme` and `:root` overlapped naming (`--color-bg-base` vs `--bg-base`); handwritten rules relied on `:root` aliases staying in sync. |

**Resolved in this refactor:** Token story is unified in `tokens.css` (`@theme` canonical names + `:root` aliases). `--text-muted` is aliased; `--slider-fill` / `--slider-rail` remain **scoped on** `input[type="range"].mini-slider` (see `base.css`), not global `:root`.

---

## Target folder layout

Keep a **single public entry** so `control.ts` does not change:

```
src/renderer/
  control.css                 ← thin orchestrator (imports only)
  scrollbar.css               ← unchanged location (or moved under styles/ if desired)
  styles/
    control/
      README.md               ← import order + ownership (see file)
      00-tailwind-entry.css   ← @import "tailwindcss"; @import scrollbar
      tokens.css              ← @theme + unified :root token layer
      base.css                ← global resets, body, buttons, inputs, mini-slider
      shell.css               ← app shell, rail, frame, launch/extraction overlays, loading scrims
      patch-layout.css           ← patch surface, transport/top bar, workspace grid, surface-* config shells (ends before pool columns)
      patch-media-pool.css       ← `.panel`, media pool columns, splitter, visual pool grid, tabs, mapping grids
      patch-mixer-display.css    ← Mixer strips, pans, meters, displays/cards/previews/modals/details/routing (monolith order preserved)
      stream.css                   ← `.stream-*` (incl. `@media (max-width: 980px)` for stream layout)
      shared-components.css        ← `.db-control`, `.badge`, `.status-footer`, `.sr-only`, `.icon-button`, `.control-icon`, panel-header icon sizing
```

**Naming:** Numeric prefix `00-*` optional; what matters is a **fixed import order** documented in `control.css` (see below).

The exact split above is a **starting point**. When extracting, prefer **natural boundaries** (blank lines / feature areas) over arbitrary line counts. If `patch-mixer-display.css` or `stream.css` remains very large, split again (e.g. `stream-header.css`, `stream-scene-list.css`).

---

## Import order (required)

Cascade order must be preserved. Recommended order:

1. Tailwind + scrollbar  
2. **Tokens** (`@theme` + unified `:root`)  
3. **Base** (global elements)  
4. **Shell** (layout chrome and modals not tied to one surface)  
5. **Patch** (patch surface + shared patch workspace pieces)  
6. **Stream**  
7. **Shared components** last so narrow utilities (e.g. `.sr-only`, `.badge`) remain predictable—or place shared **before** surfaces if those classes are meant to be overridden by surface-specific rules today (audit when moving).

Document the chosen order at the top of `control.css` in a short comment block.

---

## Token unification strategy

### Principle

Use **one authoritative layer** for **semantic** colors, fonts, radii (if any), and spacing scale, and have both **Tailwind’s theme** and **legacy `--bg-base`-style props** derive from it—so utilities and handwritten CSS never drift apart.

Tailwind CSS v4 supports defining design tokens in `@theme`. The project already uses `@theme { … }` at the top of `control.css`.

### Recommended approach

1. **Define canonical tokens in `@theme`** for everything that should generate utilities (colors, font families, optional spacing keys). Use **one naming convention** Tailwind expects, e.g. `--color-*`, `--font-*`.
2. **In the same `tokens.css` file, add a `:root` block that only:**
   - **Aliases** semantic names used across existing rules:  
     `--bg-base: var(--color-bg-base);`  
     `--surface: var(--color-surface);`  
     …and so on for every legacy name still referenced in split files.
   - Holds **non-Tailwind layout tokens** that are not part of the default theme (`--media-pool-width`, `--mixer-strip-w`, `--header-height`, scrollbar math, etc.).
3. **Remove duplicate raw hex values** from `:root` where they mirror `@theme`; keep a short comment if a value is intentional (e.g. meter gradient stops).
4. **Body / typography:** Prefer `font-family: var(--font-body)` (from `@theme`) or a single `:root` `--font-body-stack` alias to avoid repeating the Inter stack in two places.

### What not to do

- Do not maintain **two parallel lists** of hex colors in `@theme` and `:root` without `var()` linkage.
- Do not rename every `--surface` occurrence in TS/HTML in the first pass; **alias** is enough for maintainability.

### Optional: `@layer`

If specificity issues appear when mixing utilities with custom CSS, introduce `@layer theme, base, components, utilities` and assign new rules incrementally. This is optional and can wait until after the file split works.

---

## Phased rollout (suggested PRs)

### Phase 1 — Entry + tokens (low risk)

- Add `src/renderer/styles/control/tokens.css` with merged `@theme` + reconciled `:root` (aliases + layout-only vars).
- Replace the top of `control.css` with imports: tailwind + scrollbar → `tokens.css` → rest still inline **or** copy-paste unchanged body below until Phase 2.
- Run `npm run build:renderer` and smoke-test Control (open show, patch surface, stream rail, config).

**Status (done):** `tokens.css` holds `@theme` plus `:root` aliases (`--surface` → `var(--color-surface)`, etc.) including `--color-on-surface`, `--color-outline-variant`, and `--text-muted` → `--color-text-secondary`. Subsequent imports are split under `styles/control/` (`base`, `shell`, patch partials; then `stream.css` and `shared-components.css` after Phase 4).

### Phase 2 — Base + shell

- Move global reset / `body` / `button` / `input` / `.mini-slider` to `base.css`.
- Move `.app-shell` through launch/extraction/scrim rules into `shell.css`.
- **Snapshot:** Grep for rules that reference only shell classes to avoid stragglers.

**Status (done):** `base.css` and `shell.css` live under `src/renderer/styles/control/`. `@keyframes extraction-spin` is defined once at the top of `shell.css`.

### Phase 3 — Patch

- Move `.patch-surface`, `.top-bar`, `.workspace`, `.operator-footer`, `.surface-panel`, media pool, mixer, display cards in the patch context to the patch\* files.
- Keep **selector order** identical within each moved block to avoid cascade differences.

**Status (done):** `patch-layout.css` (.patch-surface … timeline/loop chrome … surface-cards/log … ends before `.panel`/pool columns). `patch-media-pool.css` (`.panel` through `.audio-panel`). `patch-mixer-display.css` carries **mixer + displays + previews + routing + detail panes** in **one file** because the legacy sheet interleaves those rules (splitting further would reorder selectors). Duplicate launch/extraction block that had landed in `control-surfaces.css` **removed** at split time so shell styles stay single-sourced.

### Phase 4 — Stream + shared

- Move `.stream-*` and trailing shared utilities (`.status-footer`, `.badge`, `.icon-button`, media queries that only touch stream) into `stream.css` / `shared-components.css`.
- Resolve any **cross-file ordering** issue (e.g. `.display-card` used in both patch and stream): if today one block wins by source order, preserve that order via file import order or a single shared partial.

**Status (done):** `control-surfaces.css` was split into `stream.css` (all `.stream-*` rules plus the stream-only `@media (max-width: 980px)` block) and `shared-components.css` (global `.db-control`, `.badge`, `.status-footer`, `.sr-only`, `.control-icon`, `.icon-button`). Import order is `patch-mixer-display.css` → `stream.css` → `shared-components.css`, so stream-specific rules precede shared primitives as before. **`@media (max-width: 1180px)` for `.output-source-row` / `.output-source-mid` / `.output-source-actions`** lives in `patch-mixer-display.css` next to the patch mixer output-source rules (it is not stream-specific); that closes the gap where it had sat at the end of the old combined surfaces file.

### Phase 5 — Cleanup

- Delete dead comments; ensure `tokens.css` has no unused `@theme` keys.
- Optional: add `styles/control/README.md` with “who owns what” and import order.

**Status (done):** `styles/control/README.md` documents import order, file ownership, and editing notes (`--slider-fill` / `--slider-rail` locality). Noise-only comments trimmed where applicable; Mixer file banner updated. **`@theme` keys** remain defined for Tailwind and are all consumed via `:root` aliases in the same file (no orphaned theme entries).

---

## Verification checklist

Roadmap phases 1–5 are complete for **implementation**. Automated checks (`npm run typecheck`, `npm run build:renderer`) succeed; keep the remaining rows as **manual QA** before release.

- [x] `npm run typecheck` passes.  
- [x] `npm run build:renderer` passes.  
- [ ] **Visual:** Patch surface—transport, loop popover, timeline scrubber, media pool, mixer, display assignment area.  
- [ ] **Visual:** Stream surface—header, scene list, scene edit, bottom pane.  
- [ ] **Visual:** Config/performance surfaces, launch dashboard, extraction overlay, workspace loading overlay.  
- [ ] **States:** `launch-blocked`, `extraction-blocked`, `data-workspace-loading="active"`.  
- [ ] Scrollbar appearance unchanged (depends on `--scrollbar-*`).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Cascade order changes and subtle UI shifts | Move contiguous blocks verbatim; use import order table; compare before/after screenshots on key screens. |
| Undefined `var(--…)` after token merge | Grep for `var(--` in split files; list every name in `tokens.css` or local scope. |
| Merge conflicts on a monolithic file | Split reduces future conflict size; do token file first so later PRs touch smaller files. |
| Over-eager Tailwind migration | Keep this refactor to **structure + tokens**; utilities can grow incrementally later. |

---

## References

- Entry: `src/renderer/control.ts` → `import './control.css'`.
- **Ownership / import order:** `src/renderer/styles/control/README.md`.
- Vite root: `src/renderer` (`vite.config.ts`).  
- Tailwind v4 + Vite: `@import "tailwindcss";` and `@theme` in CSS (current project pattern).

---

## Summary

**Split** `control.css` into a small entry plus `styles/control/*.css` ordered by shell → patch → stream → shared. **Unify** tokens by making `@theme` the canonical definition for themeable values and **aliasing** legacy `:root` names used throughout the app, plus layout-only variables in one `tokens.css`. Execute in **phases** with build + visual checks after each phase so the control UI remains stable while maintainability improves.

**Refactor roadmap:** Phases 1–5 are **implemented** (`README.md`, cleanup, documented token/slider conventions). Outstanding verification is **manual** UX QA (checkboxes above for visual/state/scrollbar parity).
