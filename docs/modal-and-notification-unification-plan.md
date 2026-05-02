# Modal and in-app notification unification plan

This document proposes a **phased** approach to replace **OS-native message UI** (Electron `dialog.showMessageBox`, `window.confirm`, `window.alert`) with **consistent in-renderer** modals—without changing file/folder picker behavior in early phases, and **without breaking** existing product flows.

## Implementation status (2026-05-02)


| Phase                                | Status                          | Notes                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundations**                  | **Done**                        | `src/shared/modalSpec.ts`, `#shellModalHost` in `src/renderer/index.html`, `src/renderer/styles/control/shell-modal.css`, `buildEmbeddedAudioImportPrompt` + `src/shared/embeddedAudioImportPrompt.test.ts`, HTML smoke in `src/main/controlShell.test.ts`.                |
| **1 — Renderer `confirm` / `alert`** | **Done**                        | `shellShowConfirm` / `shellShowAlert` / `shellShowChoiceModal` in `src/renderer/control/shell/shellModalPresenter.ts`; call sites updated. Grep: no `confirm(` / `alert(` under `src/renderer` outside the shell modal presenter.                                          |
| **2 — Embedded audio choice**        | **Done**                        | `show:choose-embedded-audio-import` uses `buildEmbeddedAudioImportPrompt` + `promptShellChoiceModal` (no `dialog.showMessageBox` in that handler when the control window can present the shell modal).                                                                     |
| **3 — Unsaved changes**              | **Done (bridge + opt-in skip)** | Renderer calls `show:prompt-unsaved-if-needed` before open/create UX, then `show:*` IPC with `{ skipUnsavedPrompt: true }` so main runs `promptUnsavedChangesIfNeeded` **at most once**. Call sites that omit the flag still get a main-side guard.                        |
| **4 — Quit / close**                 | **Done**                        | `runCloseOrQuitConfirmation` uses `promptShellChoiceModal` with the same triad; `cancelAllPendingShellModals` runs when control `webContents` is destroyed.                                                                                                                |
| **5 — Consolidation**                | **Partial**                     | `src/main/shellModalBridge.ts` retains `**dialog.showMessageBox` fallback** when the control window is missing or destroyed. While `webContents` is loading, the bridge **awaits `did-finish-load`** then uses the shell modal (no native box solely for “still loading”). |


**Architecture in code (Option B):** main sends `control-ui:shell-modal-open` with a `correlationId` and choice spec; renderer completes with `ipcRenderer.invoke('control-ui:shell-modal-response', correlationId, buttonIndex)`. Preload exposes `window.xtream.shellModal.onOpen` / `.respond`. `**ShowDiskActionIpcOpts.skipUnsavedPrompt`** (see `src/shared/types.ts`) threads optional dedupe for show-disk handlers. Local renderer-only prompts reuse the same DOM host without IPC.

**Outstanding test gaps (from plan §6):** Full **Electron** integration (dirty + open without disk write on Cancel) and **Playwright** cross-browser smoke still optional; shell modal **happy-dom** coverage and **bridge load-wait** unit tests are in repo (`shellModalPresenter.dom.test.ts`, `shellModalBridge.wait.test.ts`).

---

## 1. Goals


| Goal                     | Detail                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Single mental model**  | Notifications (informational, errors) and option prompts (OK/Cancel, multi-button) use one **API** and one **visual system**.     |
| **OS independence**      | Critical user decisions and messages do not use Chrome’s `alert`/`confirm` or Electron message boxes that vary by platform theme. |
| **Non-regression**       | Each migration step keeps semantics (default button, cancel/escape, blocking vs non-blocking) aligned with today’s behavior.      |
| **Incremental delivery** | Ship behind small, reviewable changes; prefer feature flags or short-lived dual paths only where needed.                          |


## 2. Non-goals (initial phases)

- **Native file/save/folder dialogs** (`dialog.showOpenDialog`, `dialog.showSaveDialog`) remain Electron native. They are pickers, not “notification/option” modals; replacing them is a separate UX project.
- **System permission / screen-share pickers** (Chromium) are out of scope.
- **Deep merge** of every legacy custom overlay (launch dashboard, live-capture, media import) into one component library is **deferred**—see [Appendix B](#appendix-b-catalog-of-existing-custom-modals--overlays-for-future-integration).

---

## 3. Baseline: system-dependent UI (pre-unification catalog)

The tables below describe the **original** surface area. After implementation, most choice prompts use the shell modal; **native `dialog.showMessageBox` remains only as a fallback** in `promptShellChoiceModal` when the control surface cannot render (see §5 Phase 5 / Implementation status).

### 3.1 Electron `dialog.showMessageBox` (main process)

**File:** `src/main/main.ts`


| Location (approx.) | Trigger                                 | Purpose                                                                                                       |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ~900–924           | `promptUnsavedChangesIfNeeded`          | Save / Don’t Save / Cancel before `show:open`, `show:create-project`, `show:open-default`, `show:open-recent` |
| ~937–974           | `runCloseOrQuitConfirmation`            | Same triad on app quit / window close                                                                         |
| ~1404–1437         | IPC `show:choose-embedded-audio-import` | Dynamic buttons: skip vs extract (representation/file) depending on video length                              |


All of these block the **IPC handler** in the main process until the user acts.

### 3.2 `window.confirm` (renderer)


| File                                             | Usage                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `src/renderer/control/patch/displayWorkspace.ts` | Remove display confirmation                                |
| `src/renderer/control/patch/detailsPane.ts`      | Remove display / virtual output                            |
| `src/renderer/control/patch/mediaPool.ts`        | Remove media pool record                                   |
| `src/renderer/control/patch/patchSurface.ts`     | `confirmPoolRecordRemoval`                                 |
| `src/renderer/control/stream/streamSurface.ts`   | Same pool removal helper; scene reorder dependency warning |


### 3.3 `window.alert` (renderer)


| File                                                    | Usage                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/renderer/control/patch/missingMediaRelinkModal.ts` | Errors / validation (“Choose a folder first”, batch failure messages) |


---

## 4. Target architecture

### 4.1 Layering

1. `**shared/` types** — serializable modal specs and result unions (implemented: `ShellModalOpenPayload` and related types in `src/shared/modalSpec.ts`).
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

Main process code should use `**await promptShellChoiceModal(spec, parentWindowGetter)`** (`src/main/shellModalBridge.ts`), which resolves with the chosen button index; reserve native `dialog.showMessageBox` for fallback when the control window cannot host the modal.

### 4.3 Main ↔ renderer bridge (required for parity)

Electron main cannot render HTML; the modal must paint in the **control** `BrowserWindow`.

**Implemented pattern (Option B):**

1. Main: `webContents.send('control-ui:shell-modal-open', payload)` where `payload` includes `correlationId`, copy, `buttons`, `defaultId`, `cancelId`.
2. Renderer: `installShellModalPresenter()` subscribes via preload, mounts the dialog in `#shellModalHost`, then `invoke('control-ui:shell-modal-response', correlationId, index)`.
3. Main: `ipcMain.handle('control-ui:shell-modal-response', …)` resolves the pending promise; correlation entries are cleared on timeout (120s → cancel index) or when control webContents is destroyed.

**Optional later (Option A):** Renderer-led flows could call a single unsaved path and pass `{ discardUnsaved?: boolean }` into `show:`* handlers to avoid duplicate prompts—see Implementation status for Phase 3.

**Historical note:** Phase 1 shipped renderer-only confirms first; the bridge was added for main-originated choice dialogs.

### 4.4 Semantics parity checklist


| Today                                              | Replacement behavior                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `showMessageBox` `cancelId: 2`                     | Escape / backdrop dismiss returns that button index or explicit `cancel`                   |
| Default focused button (`defaultId`)               | Focus ring + Enter key                                                                     |
| `type: 'question'`                                 | Neutral or `info` styling; destructive actions use `variant: 'danger'` on the button       |
| Tri-modal unsaved (`Save`, `Don't Save`, `Cancel`) | Three explicit buttons; `Cancel` aborts downstream IPC                                     |
| Embedded audio dynamic buttons                     | Build button list from same rules as today (`LONG_VIDEO_EMBEDDED_AUDIO_THRESHOLD_SECONDS`) |


---

## 5. Phased implementation plan

### Phase 0 — Foundations (no behavior change to users optional) — **Done**

1. Add `**shared/modalSpec.ts`** (names flexible) defining specs + results + zod/manual validation if the project prefers.
2. Add **modal host markup** placeholder in `src/renderer/index.html` (e.g. `#shellModalHost`) with **nothing visible** until first use—or mount purely from TS.
3. Add **CSS module** under `src/renderer/styles/control/` (`shell-modal.css` or similar): overlay scrim, panel, title, body, footer button row, focus styles—aligned with existing tokens (`--bg-base`, `--accent-teal`, etc.).
4. Unit-test **pure functions**: map legacy `EmbeddedAudioImport` rules → button specs (mirror `main.ts` logic in shared or duplicate with tests to prevent drift).

**Exit criteria:** Types compile; CSS loads; zero call-site changes behind a dev-only harness if desired.

### Phase 1 — Replace renderer `confirm` / `alert` (high value, low coupling) — **Done**

1. Implement `**shellShowConfirm` / `shellShowAlert`** (and `shellShowChoiceModal`) in the renderer backed by the new host (blocking `Promise` API).
2. Replace each `**window.confirm`** call site with `**await shellShowConfirm`** (callers may need `async` propagation—keep UI handlers `void` wrappers where needed).
3. Replace `**window.alert`** in `missingMediaRelinkModal.ts` with `**shellShowAlert`** (or inline error state inside the modal for batch errors—preferred UX: no second modal stacking).

**Exit criteria:** Grep finds no `confirm(` / `alert(` in `src/renderer` except inside the modal subsystem itself.

**Risk:** Making click handlers async; ensure no double-submit (disable buttons while pending).

### Phase 2 — Embedded audio choice (`show:choose-embedded-audio-import`) — **Done**

Previously: renderer → `ipcRenderer.invoke` → **main** `dialog.showMessageBox` → returns choice.

Target:

- Either **pure renderer**: main IPC returns minimal data; renderer asks user locally, then invokes `audioSources.addEmbedded` / `extractEmbedded` based on choice (larger refactor).
- Or **modal bridge**: main sends spec to renderer and awaits result (**smaller footprint**, keeps director logic in main).

**Exit criteria:** No `dialog` in handler `show:choose-embedded-audio-import` when the shell modal path is used; identical button sets and mappings to `'skip' | 'representation' | 'file'` (covered by `embeddedAudioImportPrompt.test.ts`).

### Phase 3 — Unsaved changes (`promptUnsavedChangesIfNeeded`) — **Done**

Requires either:

- **3a. Renderer-led open/create flows:** Header/menu triggers show modal first when `showExplicitDirty` (expose read via existing autosave dirty signaling or new `show:get-dirty-query` IPC), then invoke open/create only after confirmation.

**Or**

- **3b. Modal bridge** from existing main guards.

**Recommendation:** Prefer **3a** long-term—main stays free of UX blocking. Short term **3b** may be faster if dirty state is fragile to duplicate.

**Exit criteria:** Opening/creating/recents/default show does not rely on native `dialog.showMessageBox` for dirty checks when the control window is active; semantics match Save / Discard / Cancel. `**show:prompt-unsaved-if-needed`** is for renderer preflight; disk actions pass `**skipUnsavedPrompt: true`** on the subsequent `show:`* invoke so the main handler does not prompt twice.

### Phase 4 — Quit / close confirmation (`runCloseOrQuitConfirmation`) — **Done**

Same bridge or renderer-led as Phase 3. Ensure **window destroy** paths still behave if modal host is unavailable (fatal fallback to native dialog only when `controlWindow` missing—currently similar guard exists).

**Exit criteria:** Quit path uses in-app modal when control window is active.

### Phase 5 — Consolidation / cleanup — **In progress**

1. `**dialog.showMessageBox` fallback (decision, see below):** keep as supported fail-safe, narrow scope, or remove—trade-offs are product/architecture, not purely technical.
2. Document public API for future features (toast queue, stacked modals policy).
3. Optional: unify copy with `runtime-changelog` / user-facing messaging guidelines.

#### Phase 5 — Native fallback: context and options

**Plain language — two Electron pieces**

- `**webContents`:** Each `BrowserWindow` has a `**webContents`** object representing the **Chromium page** inside that window (HTML, CSS, your control UI JavaScript). The shell modal is **drawn in that page**. Main uses `**webContents.send(...)`** to tell the renderer “show this dialog,” and the renderer answers back over IPC. No live `webContents` ⇒ the in-app modal cannot run.
- `**dialog.showMessageBox`:** An Electron **main-process** API that pops the **operating system’s own** dialog (Windows/macOS/Linux styled alert), with buttons like Save / Cancel. It does **not** use your HTML/CSS; it’s the same family of UI as native file pickers. It blocks until the user clicks something, then returns which button index was pressed.

**Your product model:** While Xtream is running for normal use, the **control** window is expected to be open, so **almost all** prompts use the **in-app shell modal**. The fallback is for **edge moments** where main still runs but the in-app path is unsafe or impossible, for example: **startup** (page still loading), **destroy/quit ordering** (window/teardown racing a prompt), **stuck load** (our 15s wait times out), or **future** code paths that call the bridge without a window. It is **not** “two equal UX paths in daily use.”

**What the three options mean (implications)**


| Option                  | In practice                                                                                                                  | Implication                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Keep fallback**   | If the in-app path can’t be used, show `**showMessageBox`** once so the user can still answer and main doesn’t wait forever. | **Safest:** something always completes. **Cost:** in those rare cases the dialog looks like the OS, not Xtream.                                                                                                |
| **B — Remove fallback** | Never call `**showMessageBox`** for these flows.                                                                             | You **must** pick what happens instead when there’s no `webContents`: pretend “Cancel”? skip the action? crash? queue until later? Wrong choice can **block quit**, **lose data**, or **hang** an IPC handler. |
| **C — Narrow fallback** | Native only for e.g. **quit**, in-app only for everything else (and **assert** control exists there).                        | Fewer native dialogs in theory; **more branches** and you still need a rule when control is missing on “non-quit” code paths.                                                                                  |


Implementation today is **option A** in that table, with a **15s** wait for `webContents` to finish loading before treating the in-app path as failed.

---

## 6. Testing strategy


| Area          | Tests                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Spec builders | `embeddedAudioImportPrompt.test.ts` — button layouts vs duration threshold                                 |
| Modal bridge  | `shellModalBridge.wait.test.ts` — load wait vs `did-finish-load` / timeout / listener cleanup              |
| Modal host    | `shellModalPresenter.dom.test.ts` (happy-dom) — Escape → cancelId, Tab wrap, focus restore, focusout guard |
| HTML fixture  | `controlShell.test.ts` — `#shellModalHost` present in control `index.html`                                 |
| Integration   | Full Electron: dirty + open → Cancel does not mutate disk (optional / manual)                              |
| Regression    | Manual matrix: OS theming parity for native **fallback** paths only                                        |


---

## 7. Risks and mitigations


| Risk                                                 | Mitigation                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Async refactors introduce race conditions            | Disable primary actions until modal settles; modal singleton (one blocking dialog at a time) |
| Main/renderer deadlock                               | Timeouts + correlation IDs; teardown on window close                                         |
| Accessibility regression                             | Preserve `aria-modal`, `aria-labelledby`, focus return on close                              |
| Stacking with existing overlays (extraction, import) | Document z-index layering; optionally queue modal requests                                   |


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


| Element / section               | Purpose                                                                  | Driven by                                                                            |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `#launchDashboard`              | Startup: open/create/default + recents                                   | `src/renderer/control/shell/launchDashboard.ts`, `src/renderer/control.ts`           |
| `#launchLoadingOverlay`         | Loading spinner overlay on launch card                                   | `setLaunchDashboardLoadingUi` in `launchDashboard.ts`                                |
| `#workspacePresentationOverlay` | Full-frame “loading show…” over workspace during menu-driven open/create | `src/renderer/control/shell/presentationLoadingUi.ts`                                |
| `#extractionOverlay`            | Embedded-audio extraction progress + error + retry/dismiss               | `src/renderer/control/patch/embeddedAudioImport.ts`; elements in `shell/elements.ts` |
| `#shellModalHost`               | Unified blocking choice / alert surface (scrim + panel)                  | `src/renderer/control/shell/shellModalPresenter.ts`; `shell/elements.ts`             |
| `#loopPopover`                  | Loop range controls                                                      | `patchHeader.ts`, `transportControls.ts`                                             |


### B.2 Programmatic DOM (`document.body` append / overlay pattern)


| Module                                                  | Responsibility                                 | Pattern summary                                                                    |
| ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/renderer/control/patch/mediaImportModal.ts`        | Link vs copy, busy/error states during import  | `section` overlay, `.live-capture-overlay`, `.live-capture-panel`, `role="dialog"` |
| `src/renderer/control/patch/missingMediaRelinkModal.ts` | Missing media relink workflow                  | Same overlay families; `#missingMediaRelinkHeading`; Escape + backdrop dismiss     |
| `src/renderer/control/patch/mediaPool.ts`               | Live capture source picker (“Add Live Stream”) | `openLiveCaptureModal`, `.live-capture-`* grid and lists                           |


### B.3 Shared styling references

- `src/renderer/styles/control/shell-modal.css` — `#shellModalHost`, scrim, panel, button variants
- `src/renderer/styles/control/patch-mixer-display.css` — `.live-capture-overlay`, `.live-capture-panel`, `.live-capture-modal`, etc.
- `src/renderer/styles/control/patch-media-pool.css` — `.media-import-modal-`*, `.missing-media-relink-`*
- `src/renderer/styles/control/shell.css` — launch dashboard, extraction overlay, workspace presentation overlay

### B.4 Display window (separate process/window)

- `src/renderer/display.ts` — `#displayIdentifyOverlay` flash (transient label), not a full modal system.

### B.5 Future integration notes

- **Live-capture** and **media-import** modals duplicate structure (overlay + panel + header + footer). Candidate to refactor to **shared layout components** once `shellModal` primitives exist.
- **Extraction overlay** is already in HTML; could become a **variant** of the unified host (non-dismissible while pending).
- **Launch dashboard** is a **wizard shell**; keep separate from small alert/confirm host but **share tokens and button components** where possible.

---

## Appendix C — Traceability table (system → replacement)


| Mechanism (historical)                                               | Phase | Replacement (current)                                                            |
| -------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `window.confirm` (patch/stream)                                      | 1     | `shellShowConfirm` + `#shellModalHost`                                           |
| `window.alert` (`missingMediaRelinkModal.ts`)                        | 1     | `shellShowAlert`                                                                 |
| `show:choose-embedded-audio-import` message box                      | 2     | `buildEmbeddedAudioImportPrompt` + `promptShellChoiceModal`                      |
| `promptUnsavedChangesIfNeeded`                                       | 3     | `promptShellChoiceModal`; optional `show:prompt-unsaved-if-needed` from renderer |
| `runCloseOrQuitConfirmation`                                         | 4     | `promptShellChoiceModal`                                                         |
| Native open/save directory dialogs                                   | —     | Appendix A — unchanged                                                           |
| Shell modal unreachable (no window / destroyed / load wait exceeded) | 5     | `dialog.showMessageBox` fallback in `shellModalBridge.ts`                        |


---

*Document version: 3 (2026-05-02). Owner: engineering. Dirty/quit flows use the **modal bridge** (Option B); renderer-led deduping uses `skipUnsavedPrompt`.*