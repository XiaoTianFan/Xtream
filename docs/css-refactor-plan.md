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

## Current state (baseline)

| Item | Notes |
|------|--------|
| Entry | `control.ts` imports `./control.css`. |
| Tailwind | `control.css` begins with `@import "tailwindcss";` and `@import "./scrollbar.css";`. |
| Tokens | **`@theme { … }`** defines a subset of colors and fonts (`--color-*`, `--font-*`). **` :root`** duplicates overlapping concepts with different names (`--surface`, `--text-primary`, …) and adds layout tokens (`--gutter`, `--media-pool-width`, …). |
| Scrollbars | `scrollbar.css` uses `--scrollbar-*` variables assumed to exist (today set under `:root` in `control.css`). |

### Token duplication today

- **Colors:** `@theme` uses `--color-bg-base`, while `:root` uses `--bg-base` for the same role. Tailwind utilities would see the former; hand-written rules use the latter.
- **Fonts:** `@theme` sets `--font-timecode` / `--font-data` / `--font-body`; `:root` repeats long `font-family` stacks on `body` and references `var(--font-timecode)` in places—consistency depends on both blocks staying in sync.

### Gaps to fix during unification

- Audit **undefined or one-off variables** (e.g. `var(--text-muted)` appears in stream styles; confirm definition or alias to an existing token).
- **`--slider-fill` / `--slider-rail`:** Scoped under `input[type="range"].mini-slider` in places; document whether these belong in global tokens or stay component-scoped.

---

## Target folder layout

Keep a **single public entry** so `control.ts` does not change:

```
src/renderer/
  control.css                 ← thin orchestrator (imports only)
  scrollbar.css               ← unchanged location (or moved under styles/ if desired)
  styles/
    control/
      README.md               ← optional: import order + ownership (one screen)
      00-tailwind-entry.css   ← @import "tailwindcss"; @import scrollbar
      tokens.css              ← @theme + unified :root token layer
      base.css                ← global resets, body, buttons, inputs, mini-slider
      shell.css               ← app shell, rail, frame, launch/extraction overlays, loading scrims
      patch-layout.css        ← patch surface grid, top-bar, workspace, operator footer, surface-panel
      patch-media-pool.css    ← media pool, pool tabs, toolbars, list rows in patch context
      patch-mixer.css         ← mixer panel, strips, pan knob, mixer meters/toggles as grouped here today
      patch-displays.css      ← display cards, display workspace, monitor/preview styles before stream block
      stream.css              ← .stream-* from .stream-surface through stream scene edit, media queries at end of stream block
      shared-components.css   ← cross-surface primitives: icon-button, control-icon, badges, db-control, status-footer, sr-only, warning/issue (or split further if still large)
```

**Naming:** Numeric prefix `00-*` optional; what matters is a **fixed import order** documented in `control.css` (see below).

The exact split above is a **starting point**. When extracting, prefer **natural boundaries** (blank lines / feature areas) over arbitrary line counts. If `patch-mixer.css` or `stream.css` remains very large, split again (e.g. `stream-header.css`, `stream-scene-list.css`).

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

### Phase 2 — Base + shell

- Move global reset / `body` / `button` / `input` / `.mini-slider` to `base.css`.
- Move `.app-shell` through launch/extraction/scrim rules into `shell.css`.
- **Snapshot:** Grep for rules that reference only shell classes to avoid stragglers.

### Phase 3 — Patch

- Move `.patch-surface`, `.top-bar`, `.workspace`, `.operator-footer`, `.surface-panel`, media pool, mixer, display cards in the patch context to the patch\* files.
- Keep **selector order** identical within each moved block to avoid cascade differences.

### Phase 4 — Stream + shared

- Move `.stream-*` and trailing shared utilities (`.status-footer`, `.badge`, `.icon-button`, media queries that only touch stream) into `stream.css` / `shared-components.css`.
- Resolve any **cross-file ordering** issue (e.g. `.display-card` used in both patch and stream): if today one block wins by source order, preserve that order via file import order or a single shared partial.

### Phase 5 — Cleanup

- Delete dead comments; ensure `tokens.css` has no unused `@theme` keys.
- Optional: add `styles/control/README.md` with “who owns what” and import order.

---

## Verification checklist

- [ ] `npm run typecheck` passes.  
- [ ] `npm run build:renderer` passes.  
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
- Vite root: `src/renderer` (`vite.config.ts`).  
- Tailwind v4 + Vite: `@import "tailwindcss";` and `@theme` in CSS (current project pattern).

---

## Summary

**Split** `control.css` into a small entry plus `styles/control/*.css` ordered by shell → patch → stream → shared. **Unify** tokens by making `@theme` the canonical definition for themeable values and **aliasing** legacy `:root` names used throughout the app, plus layout-only variables in one `tokens.css`. Execute in **phases** with build + visual checks after each phase so the control UI remains stable while maintainability improves.
