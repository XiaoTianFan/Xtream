# Modal and in-app notification unification plan

This document proposes a **phased** approach to replace **OS-native message UI** (Electron `dialog.showMessageBox`, `window.confirm`, `window.alert`) with **consistent in-renderer** modals—without changing file/folder picker behavior in early phases, and **without breaking** existing product flows.

---

## 1. Goals

| Goal | Detail |
|------|--------|
| **Single mental model** | Notifications (informational, errors) and option prompts (OK/Cancel, multi-button) use one **API** and one **visual system**. |
| **OS independence** | Critical user decisions and messages do not use Chrome’s `alert`/`confirm` or Electron message boxes that vary by platform theme. |
| **Non-regression** | Each migration step keeps semantics (default button, cancel/escape, blocking vs non-blocking) aligned with today’s behavior. |
| **Incremental delivery** | Ship behind small, reviewable changes; prefer feature flags or short-lived dual paths only where needed. |

## 2. Non-goals (initial phases)

- **Native file/save/folder dialogs** (`dialog.showOpenDialog`, `dialog.showSaveDialog`) remain Electron native. They are pickers, not “notification/option” modals; replacing them is a separate UX project.
- **System permission / screen-share pickers** (Chromium) are out of scope.
- **Deep merge** of every legacy custom overlay (launch dashboard, live-capture, media import) into one component library is **deferred**—see [Appendix B](#appendix-b-catalog-of-existing-custom-modals--overlays-for-future-integration).

---

## 3. Current system-dependent UI (scope for unification)

### 3.1 Electron `dialog.showMessageBox` (main process)

**File:** `src/main/main.ts`

| Location (approx.) | Trigger | Purpose |
|--------------------|---------|---------|
| ~900–924 | `promptUnsavedChangesIfNeeded` | Save / Don’t Save / Cancel before `show:open`, `show:create-project`, `show:open-default`, `show:open-recent` |
| ~937–974 | `runCloseOrQuitConfirmation` | Same triad on app quit / window close |
| ~1404–1437 | IPC `show:choose-embedded-audio-import` | Dynamic buttons: skip vs extract (representation/file) depending on video length |

All of these block the **IPC handler** in the main process until the user acts.

### 3.2 `window.confirm` (renderer)

| File | Usage |
|------|--------|
| `src/renderer/control/patch/displayWorkspace.ts` | Remove display confirmation |
| `src/renderer/control/patch/detailsPane.ts` | Remove display / virtual output |
| `src/renderer/control/patch/mediaPool.ts` | Remove media pool record |
| `src/renderer/control/patch/patchSurface.ts` | `confirmPoolRecordRemoval` |
| `src/renderer/control/stream/streamSurface.ts` | Same pool removal helper; scene reorder dependency warning |

### 3.3 `window.alert` (renderer)

| File | Usage |
|------|--------|
| `src/renderer/control/patch/missingMediaRelinkModal.ts` | Errors / validation (“Choose a folder first”, batch failure messages) |

---

## 4. Target architecture

### 4.1 Layering

1. **`shared/` types** — serializable modal specs and result unions (e.g. `AlertSpec`, `ConfirmSpec`, `ChoiceSpec`, `ModalResult`).
2. **Renderer: modal host + registry** — one (or few) DOM mount points under `.app-frame`, z-index above workspace, focus trap, Escape handling, optional `aria-modal` / `role="dialog"`.
3. **Bridge IPC** — for prompts that today run inside **main** handlers: main must **delegate** rendering to the control window and **await** the user’s choice (see §4.3).
4. **Styling** — single CSS surface (tokens + variants: `destructive`, `info`, `warning`) so new modals do not diverge from the app shell.

### 4.2 Public API shape (conceptual)

Expose a single entry for renderer code:

- `showAlert(spec)` → `Promise<void>`
- `showConfirm(spec)` → `Promise<boolean>`
- `showChoice(spec)` → `Promise<number | string>` (button id or semantic tag)

Specifications should include:

- `title`, `message`, optional `detail` (body / monospace block for technical errors if needed).
- Buttons: `{ id, label, variant?, isDefault?, dismisses?: boolean }[]`.
- Optional `cancelId` semantics (Escape / backdrop = cancel).
- Optional **non-blocking** “toast” variant later (queued, auto-dismiss)—**not required for parity with `confirm`;** can follow after blocking path is stable.

Main process code must not call `dialog.showMessageBox` for these flows once migrated; instead it calls **`await modalBridge.request(spec)`** that resolves with the user choice.

### 4.3 Main ↔ renderer bridge (required for parity)

Electron main cannot render HTML; the modal must paint in the **control** `BrowserWindow`.

**Recommended pattern:**

1. Add IPC such as **`control-ui:modal-request`** handled in main—or, cleaner, handle in preload-only flow:
   - Renderer exposes **`ipcRenderer.invoke('internal:modal', spec)`** that is implemented by **opening the host and returning a Promise** resolved when the user completes the dialog.

2. For **calls originating in main** (unsaved prompt, quit, embedded-audio choice):
   - **Option A (preferred):** Refactor flow so **renderer initiates** the sequence (e.g. “open show” clicked → renderer checks dirty via existing state or lightweight IPC → shows in-app modal → then invokes `show:open` with `{ discardUnsaved?: boolean }`). This reduces main-side blocking glue but touches more call sites.
   - **Option B:** Main retains orchestration but **suspends** the handler via a Promise wired to **`webContents.send('modal-present', correlationId, spec)`** and **`ipcMain.handle('modal-resolve', (_, id, result)`**—must use strict correlation IDs and teardown on window close.

**Mitigation:** Start with **renderer-only** `confirm`/`alert` replacement (no main bridge). Add the bridge once the host components and types stabilize.

### 4.4 Semantics parity checklist

| Today | Replacement behavior |
|-------|---------------------|
| `showMessageBox` `cancelId: 2` | Escape / backdrop dismiss returns that button index or explicit `cancel` |
| Default focused button (`defaultId`) | Focus ring + Enter key |
| `type: 'question'` | Neutral or `info` styling; destructive actions use `variant: 'danger'` on the button |
| Tri-modal unsaved (`Save`, `Don't Save`, `Cancel`) | Three explicit buttons; `Cancel` aborts downstream IPC |
| Embedded audio dynamic buttons | Build button list from same rules as today (`LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS`) |

---

## 5. Phased implementation plan

### Phase 0 — Foundations (no behavior change to users optional)

1. Add **`shared/modalSpec.ts`** (names flexible) defining specs + results + zod/manual validation if the project prefers.
2. Add **modal host markup** placeholder in `src/renderer/index.html` (e.g. `#shellModalHost`) with **nothing visible** until first use—or mount purely from TS.
3. Add **CSS module** under `src/renderer/styles/control/` (`shell-modal.css` or similar): overlay scrim, panel, title, body, footer button row, focus styles—aligned with existing tokens (`--bg-base`, `--accent-teal`, etc.).
4. Unit-test **pure functions**: map legacy `EmbeddedAudioImport` rules → button specs (mirror `main.ts` logic in shared or duplicate with tests to prevent drift).

**Exit criteria:** Types compile; CSS loads; zero call-site changes behind a dev-only harness if desired.

### Phase 1 — Replace renderer `confirm` / `alert` (high value, low coupling)

1. Implement **`showConfirm` / `showAlert`** in the renderer backed by the new host (blocking `Promise` API).
2. Replace each **`window.confirm`** call site with **`await showConfirm`** (callers may need `async` propagation—keep UI handlers `void` wrappers where needed).
3. Replace **`window.alert`** in `missingMediaRelinkModal.ts` with **`showAlert`** (or inline error state inside the modal for batch errors—preferred UX: no second modal stacking).

**Exit criteria:** Grep finds no `confirm(` / `alert(` in `src/renderer` except inside the modal subsystem itself.

**Risk:** Making click handlers async; ensure no double-submit (disable buttons while pending).

### Phase 2 — Embedded audio choice (`show:choose-embedded-audio-import`)

Today: renderer → `ipcRenderer.invoke` → **main** `dialog.showMessageBox` → returns choice.

Target:

- Either **pure renderer**: main IPC returns minimal data; renderer asks user locally, then invokes `audioSources.addEmbedded` / `extractEmbedded` based on choice (larger refactor).
- Or **modal bridge**: main sends spec to renderer and awaits result (**smaller footprint**, keeps director logic in main).

**Exit criteria:** No `dialog` in handler `show:choose-embedded-audio-import`; identical button sets and mappings to `'skip' | 'representation' | 'file'`.

### Phase 3 — Unsaved changes (`promptUnsavedChangesIfNeeded`)

Requires either:

- **3a. Renderer-led open/create flows:** Header/menu triggers show modal first when `showExplicitDirty` (expose read via existing autosave dirty signaling or new `show:get-dirty-query` IPC), then invoke open/create only after confirmation.

**Or**

- **3b. Modal bridge** from existing main guards.

**Recommendation:** Prefer **3a** long-term—main stays free of UX blocking. Short term **3b** may be faster if dirty state is fragile to duplicate.

**Exit criteria:** Opening/creating/recents/default show never calls `dialog.showMessageBox` for dirty checks; semantics match Save / Discard / Cancel.

### Phase 4 — Quit / close confirmation (`runCloseOrQuitConfirmation`)

Same bridge or renderer-led as Phase 3. Ensure **window destroy** paths still behave if modal host is unavailable (fatal fallback to native dialog only when `controlWindow` missing—currently similar guard exists).

**Exit criteria:** Quit path uses in-app modal when control window is active.

### Phase 5 — Consolidation / cleanup

1. Delete dead `dialog.showMessageBox` code paths used only for superseded prompts.
2. Document public API for future features (toast queue, stacked modals policy).
3. Optional: unify copy with `runtime-changelog` / user-facing messaging guidelines.

---

## 6. Testing strategy

| Area | Tests |
|------|--------|
| Spec builders | Pure unit tests for embedded-audio button layout vs duration threshold |
| Modal host | DOM tests or Playwright smoke: Escape, backdrop, default button, tab cycle |
| Integration | Fake main dirty flag → open workflow does not mutate disk on Cancel |
| Regression | Manual matrix: Win/macOS/Linux theming parity **removed** visually; logical parity preserved |

---

## 7. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Async refactors introduce race conditions | Disable primary actions until modal settles; modal singleton (one blocking dialog at a time) |
| Main/renderer deadlock | Timeouts + correlation IDs; teardown on window close |
| Accessibility regression | Preserve `aria-modal`, `aria-labelledby`, focus return on close |
| Stacking with existing overlays (extraction, import) | Document z-index layering; optionally queue modal requests |

---

## Appendix A — File picker dialogs (explicitly unchanged for now)

These **remain native** Electron dialogs per current plan:

- `pickVisualFiles` / `visual:choose-files`, replace, drag-import paths invoking open dialog
- `audio-source:choose-file`, `audio-source:replace-file`
- `show:save-as`, `show:open`, `show:create-project`, batch relink directory, diagnostics export save

Re-evaluate only if product asks for embedded file browsers.

---

## Appendix B — Catalog of existing custom modals / overlays (future integration)

Use this list when merging styles or sharing the modal host—not part of Phase 1–4 scope except where call sites overlap.

### B.1 Declared in `src/renderer/index.html`

| Element / section | Purpose | Driven by |
|-------------------|---------|-----------|
| `#launchDashboard` | Startup: open/create/default + recents | `src/renderer/control/shell/launchDashboard.ts`, `src/renderer/control.ts` |
| `#launchLoadingOverlay` | Loading spinner overlay on launch card | `setLaunchDashboardLoadingUi` in `launchDashboard.ts` |
| `#workspacePresentationOverlay` | Full-frame “loading show…” over workspace during menu-driven open/create | `src/renderer/control/shell/presentationLoadingUi.ts` |
| `#extractionOverlay` | Embedded-audio extraction progress + error + retry/dismiss | `src/renderer/control/patch/embeddedAudioImport.ts`; elements in `shell/elements.ts` |
| `#loopPopover` | Loop range controls | `patchHeader.ts`, `transportControls.ts` |

### B.2 Programmatic DOM (`document.body` append / overlay pattern)

| Module | Responsibility | Pattern summary |
|--------|----------------|-----------------|
| `src/renderer/control/patch/mediaImportModal.ts` | Link vs copy, busy/error states during import | `section` overlay, `.live-capture-overlay`, `.live-capture-panel`, `role="dialog"` |
| `src/renderer/control/patch/missingMediaRelinkModal.ts` | Missing media relink workflow | Same overlay families; `#missingMediaRelinkHeading`; Escape + backdrop dismiss |
| `src/renderer/control/patch/mediaPool.ts` | Live capture source picker (“Add Live Stream”) | `openLiveCaptureModal`, `.live-capture-*` grid and lists |

### B.3 Shared styling references

- `src/renderer/styles/control/patch-mixer-display.css` — `.live-capture-overlay`, `.live-capture-panel`, `.live-capture-modal`, etc.
- `src/renderer/styles/control/patch-media-pool.css` — `.media-import-modal-*`, `.missing-media-relink-*`
- `src/renderer/styles/control/shell.css` — launch dashboard, extraction overlay, workspace presentation overlay

### B.4 Display window (separate process/window)

- `src/renderer/display.ts` — `#displayIdentifyOverlay` flash (transient label), not a full modal system.

### B.5 Future integration notes

- **Live-capture** and **media-import** modals duplicate structure (overlay + panel + header + footer). Candidate to refactor to **shared layout components** once `shellModal` primitives exist.
- **Extraction overlay** is already in HTML; could become a **variant** of the unified host (non-dismissible while pending).
- **Launch dashboard** is a **wizard shell**; keep separate from small alert/confirm host but **share tokens and button components** where possible.

---

## Appendix C — Traceability table (system → planned replacement)

| Current mechanism | Planned phase |
|-------------------|---------------|
| `window.confirm` (all patch/stream sites) | Phase 1 |
| `window.alert` (`missingMediaRelinkModal.ts`) | Phase 1 |
| `show:choose-embedded-audio-import` message box | Phase 2 |
| `promptUnsavedChangesIfNeeded` message box | Phase 3 |
| `runCloseOrQuitConfirmation` message box | Phase 4 |
| Native open/save directory dialogs | Appendix A — unchanged |

---

*Document version: initial. Owner: engineering. Update when a phase completes or architecture choice (renderer-led vs modal bridge) is locked for dirty/quit flows.*
