# In-App Session Log & Problem Surfacing — Roadmap

## Purpose

The Config surface includes a bottom pane that today shows the **Show open profile log**: structured checkpoints while a show is opening (and related readiness timing). The product goal is to **evolve this into a single global session log** for the control runtime: one mechanism, one buffer, one export story—recording meaningful operations, validation transitions, and backend effects across Patch, Stream, Config, and main—**without dumping high-frequency noise** into the pane.

Work proceeds **in stages**. This document is the **canonical checklist**: what we want to log, what is already implemented, what must change first, and what remains. Implementation details (exact TypeScript names, IPC shape) can follow the intent here.

---

## Current Implementation (Baseline)

### Where the log lives today


| Piece                                          | Role                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/shared/showOpenProfile.ts`                | Session log types, `logShowOpenProfile`, `logSessionEvent`, `normalizeSessionLogEntry`, domain/kind |
| `src/renderer/control/shell/sessionLogUi.ts`   | Session log ring buffer (400 rows), clear + subscribe; `installSessionLogBridge`                    |
| `src/renderer/control/config/configSurface.ts` | Session log pane, line format, diagnostics export attach                                            |
| `src/main/main.ts`                             | Forwards main rows via IPC (`session-log:entry`, `forwardSessionLogFromMain`) during open path      |
| `src/preload/preload.ts`                       | `sessionLog.onEntry`; `showOpenProfile.onLog` alias (same IPC)                                      |


### Row format today

Each entry carries `loggedAt` (wall time, ms), `source` (`renderer`  `main`), `runId`, `checkpoint`, `sinceRunStartMs`, optional `segmentMs`, optional `extra`. The UI prints ISO-derived time-of-day, source, truncated `runId`, checkpoint, offsets, and JSON `extra`.

### Checkpoints already implemented (show open / readiness pipeline)

These are **done** for the open-show flow. They assume a per-open `runId`; renderer uses `performance.now()`-based `sinceRunStartMs` from `flowStartMs`, main uses `Date.now() - t0` from the same run (see `openShowConfigPath` in main).

**Main process** (`main_*`):


| Checkpoint                                 | Meaning (short)                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `main_open_path_enter`                     | open path started                                                                                                            |
| `main_read_config_done`                    | JSON/config read from disk                                                                                                   |
| `main_restore_enter` … `main_restore_exit` | inner restore sequence (validate media, build URLs, close displays, director restore, register displays, stream engine load) |
| `main_validate_media_done`                 | media validation finished                                                                                                    |
| `main_build_media_urls_done`               | media URL build finished                                                                                                     |
| `main_display_close_all_done`              | all display windows closed                                                                                                   |
| `main_director_restore_done`               | director state restored                                                                                                      |
| `main_displays_register_done`              | displays recreated and registered                                                                                            |
| `main_stream_engine_load_done`             | stream engine loaded from show                                                                                               |
| `main_restore_call_done`                   | `restoreShowConfigFromDiskConfig` returned                                                                                   |
| `main_add_recent_done`                     | recent list updated                                                                                                          |
| `main_open_path_exit`                      | open path finished                                                                                                           |


**Renderer** (`renderer_*`):


| Checkpoint                          | Meaning (short)                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer_open_flow_start`          | renderer open flow started; `extra.route`: `menu_open`                                                                                   |
| `renderer_after_first_render_state` | first `renderState` after open                                                                                                           |
| `renderer_hydrate_*`                | control UI snapshot hydrate (`enter`, `after_control_ui_get`, `skip_no_snapshot`, `after_patch_apply`, `after_stream_get_state`, `exit`) |
| `renderer_before_wait_ready`        | about to wait for presentation readiness                                                                                                 |
| `renderer_wait_ready_enter`         | entered readiness wait                                                                                                                   |
| `renderer_wait_ready_blocked`       | still blocked; `extra.reason` rotates when it changes                                                                                    |
| `renderer_wait_ready_done`          | readiness satisfied (or continued after timeout path)                                                                                    |
| `renderer_open_flow_done`           | open flow complete                                                                                                                       |


**Not logged today (gaps relative to “first meaningful user action”):**

- Explicit **“user chose to open / create / save”** at the instant of UI interaction (before dialogs or IPC), including chosen path or project identity where safe to record.
- **Save** and **Save as** operations (no profile rows).
- **Create new project** flow end-to-end (only partially overlaps open flow once a path exists).

### Baseline problem surfacing (pre–Stage 1)

Today, **two different validation channels** are merged in the Patch **Patch Summary** detail column:

- `**state.readiness.issues`** from the **Director** (live graph: displays, mapped media readiness, routing, loop, previews, etc.).
- `**show:media-validation-issues`** → `**validateShowConfigMedia`**, which includes **missing files on disk** and **stream graph checks on the persisted snapshot** (`target: stream:…`).

Separately, **Stream** surfaces `**StreamEngine.validationMessages`** (human-readable strings, derived from structured schedule validation in `src/shared/streamSchedule.ts`) via the **global session problems strip** (Stage 1). The stream workspace also reflects authoring health in the **scene list** (State column, including runtime status `**error`** for misconfigured non-disabled scenes), **flow cards**, and **scene edit / sub-cue rail** (red-tinted rows for scenes and sub-cues with severity-`error` authoring issues). Legacy: the stream header static problem line and scene-edit validation banner were removed per Stage 1.

**Why “Show readiness: ready” can disagree with an `ERROR stream:…` line in the issue list**

- The short line in the Patch header / Patch Summary (`#showStatus`) is driven by `**transportControls.syncTransportInputs`**: it reflects `**state.readiness.ready`**, i.e. **whether `Director` readiness contains any `severity: 'error'` issue**.
- Stream-on-disk validation errors from `**getMediaValidationIssues`** are `**MediaValidationIssue`** rows rendered in `**#issueList`**, but they are **not** part of `readiness.issues` unless the same condition is also expressed there.
- So the UI can show **ready** in the one-line summary while the list below still shows **stream configuration errors** from the persisted validation path—**inconsistent copy and confusing mental model**. Stage 1 removes that split presentation and fixes domain separation.

---

## Design Principles (for all stages)

1. **Single log mechanism**
  All session events (checkpoints today; validation transitions, saves, transport, etc. tomorrow) should **append through one pipeline** (shared type, one buffer, one IPC pattern for main → renderer, one export hook). Generalize naming from “Show open profile” to **session / activity log** while keeping diagnostics JSON compatibility (versioned or aliased fields).
2. **Two beats per important operation where it matters**
  - **UI intent**: user clicked / confirmed / selected (local, fast).  
  - **Backend effect**: main or engine confirmed work started or finished (authoritative).
3. **Correlation**
  Reuse or extend `runId` (or introduce `operationId`) so one user gesture chains to many rows without guessing.
4. **Timestamps**
  Keep **wall clock** (`loggedAt` or explicit ISO in `extra` when needed). For Stream timeline-related events, also record **timeline-relative timecode** (see Stage 5).
5. **Workspace attribution**
  Every log row and every **problem** shown to the operator should carry `**domain`**: `**patch`  `stream`  `config`  `global`  `main`** (exact enum TBD) so filtering and copy stay honest.
6. **Unify persistence vs engine stream checks (data model)**
  - **Persisted / disk validation** (`validateShowConfigMedia`): stream section folded into `MediaValidationIssue` with `target: stream:…`.  
  - **Live stream engine** (`StreamEngine.revalidate` → `validationMessages`): plain strings + timeline issues.  
   Stage 1 **does not** require a single internal function for both, but it **does** require a **unified operator-facing model**: one place in the shell, consistent severity/labels, and **no stream-only problems rendered inside Patch-only chrome** (and vice versa).
7. **Stage discipline**
  Land one stage at a time; extend buffer/schema when stable; throttle noisy events.

---

## Stage 1 — **Priority: unified session log foundation + global problem shell + domain separation**

**Goal:** (1) Treat the existing profile log as the **first slice** of a **global session log**—same ring buffer, subscription, Config pane, and diagnostics attach path, extended with `**domain`** (and later richer entry kinds). (2) **Stop mixing Stream validation into Patch-only UI** and **stop scattering** stream problems across header/scene/banner. (3) Present **all operator-visible problems in one global strip** in the **bottom shell immediately after the runtime version label** (`#runtimeVersionLabel` in `src/renderer/index.html` → `footer.status-footer`), with **clear Patch vs Stream (vs shared) attribution**.

### 1A — Global problem strip (UI)


| Requirement                                                                           | Notes                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Remove** Patch Summary **issue list** and **problem-oriented use of `#showStatus`** | Today: `#issueList` + `#showStatus` in `details-body` / header sync. Detail pane should return to **patch-specific summary / selection detail only**—not a cross-workspace issue dump.                                                                                     |
| **Remove** Stream **transport status problem line**                                   | The `stream-transport-status` block under transport in `streamHeader.ts` that surfaces `validationMessages` / play-disabled detail for **static “problem copy”** moves to the global strip; transport controls may still disable buttons with **tooltips** only if needed. |
| **Remove** Stream **scene edit validation banner**                                    | `stream-validation-banner` in `sceneEditPane.ts` goes away; same information appears in the **global strip** (or session log) with stream domain.                                                                                                                          |
| **Add** global strip after `**#runtimeVersionLabel`**                                 | New region in `status-footer`: e.g. **session problems** line or scrollable chip row, `**aria-live="polite"`**, shared styles for Patch vs Stream. **Unify** visual language (severity, typography) across domains.                                                        |


**Domain rules for what appears in the strip**


| Domain              | Source (conceptual)                                                                                                                                                                                                                                                                                      | Operator expectation                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Patch**           | Director `readiness` errors/warnings that concern **patch timeline / displays / pool / routing**; optional **patch-relevant** media-on-disk warnings if they block patch operation (semantics TBD in implementation).                                                                                    | Never show **stream engine graph string** messages here.                                            |
| **Stream**          | `StreamEnginePublicState.validationMessages` (messages use **scene titles** / **cue numbers** and **sub-cue kind + ordinal**, e.g. `audio sub-cue no.1`, not raw ids), timeline `notice` / invalid timeline state, and **stream-class** persisted validation if not already represented in engine state. | Never show **patch-only readiness** copy here unless it is a **shared** global blocker (see below). |
| **Shared / global** | Conditions that block **both** worlds (e.g. project load failure, catastrophic missing show file)—tag `**global`**.                                                                                                                                                                                      | Shown with clear label.                                                                             |


When the **Patch** rail is active, the strip may **prioritize** Patch + Shared rows; when **Stream** is active, prioritize Stream + Shared—**or** show all domains in one list with badges; pick one behavior in implementation and document it in the PR. The hard requirement is **no stream validity rows inside Patch Summary** and **no duplicate competing headers** in Stream.

### 1B — Unified session log (same mechanism, broader scope)


| Requirement                 | Notes                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One append path**         | Generalize `logShowOpenProfile` / `forwardShowOpenProfileFromMain` into a **session log API** (name TBD: e.g. `logSessionEvent`) with `**domain`** + `**kind`** (`checkpoint`                             |
| **Same buffer + Config UI** | Keep ring buffer + clear + subscribe; **rename** pane from “Show open profile log” to **“Session log”** (or “Activity log”) and empty-state copy.                                                         |
| **Emit high-value events**  | At minimum in Stage 1, log **transitions** (not per-frame): e.g. stream validation set changed, readiness blocked/unblocked, save/open completed. Exact checklist in implementation; throttle duplicates. |
| **Diagnostics export**      | Attach full session buffer (alias `showOpenProfile` in JSON for backward compatibility or bump export `schemaVersion` field if present).                                                                  |


### 1C — Readiness vs “problems” copy

- `**state.readiness.ready`** remains the **Director** gate for Patch transport LIVE/BLOCKED chip; Stage 1 should **not** imply “overall show valid” unless we redefine copy (e.g. rename line to **“Patch LIVE gate: …”** if it stays in Patch chrome).
- The **global strip** owns **truth in one place** for “what is wrong right now” across Patch + Stream; avoid a second contradictory one-liner tied only to readiness.

### Stage 1 deliverables checklist

- Global footer region after runtime version label; unified styling; `aria-live` for changes.
- Remove `#issueList` from Patch Summary (and related CSS); relocate logic from `renderIssues(patchElements.issueList, …)` to global shell controller.
- Split `**combineVisibleIssues(readiness, getMediaValidationIssues)`** into **patch-attributed vs stream-attributed** sets; stop pushing stream-validity issues into Patch-only mounts.
- Remove stream header **static** problem line and scene-edit **validation banner**; feed stream problems into global strip (+ optional session log rows).
- Unify persistence-backed stream validation with engine `**validationMessages`** in the **operator model** consumed by the strip (implementation may normalize to a shared `SessionProblem` type with `domain: 'stream'`).
- Rename and extend profile log → **session log** (buffer, Config pane title, preload/API naming where user-facing).
- Update diagnostics export and `docs/stream-workspace-and-runtime-plan.md` cross-links if they reference old locations.

**Status:** **Implemented** (Stage 1 deliverables above). Lifecycle UI/backend beats are **Stage 2** below.

### Post–Stage 1 stream validation (implemented)

These items tighten **operator-facing copy and affordances** while keeping one global strip for problems; they do **not** replace Stage 5 (session **logging** of scene transitions).


| Item                             | Notes                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Readable validation strings**  | `validateStreamContentIssues` / engine `revalidate` produce messages via `scenePrimaryLabel` and per-kind sub-cue ordinals (`audio` / `visual` / `control` sub-cue no.*).                                 |
| **Highlight map for Stream UI**  | `getStreamAuthoringErrorHighlights` + `getAuthoringIssuesForStreamUi` drive red styling for errored **scene rows**, **sub-cue lines** (expanded list), **flow cards**, and **scene edit / sub-cue rail**. |
| **Runtime scene status `error`** | `SceneRuntimeState.status` includes `error`; stream engine overlays authoring errors on otherwise `ready` rows so the list **State** column matches misconfiguration.                                     |


---

## Stage 2 — Project & show lifecycle (logging)

**Goal:** Extend logging so the **first** checkpoint in a session is not “inside restore” but **the operator’s decision**, then chain into existing open/hydrate/wait-ready rows.

### Desired events


| Event                                     | UI checkpoint (proposed)                               | Backend / effect checkpoint (proposed)     | Status          |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------ | --------------- |
| User initiates **Open**                   | e.g. `ui_open_show_invoked`                            | —                                          | Not implemented |
| User picks file / confirms open dialog    | e.g. `ui_open_show_path_selected`                      | *(already)* `main_open_path_enter` …       | Partially       |
| User initiates **Create**                 | e.g. `ui_create_show_invoked`                          | main/create path start                     | Not implemented |
| New project path chosen & project created | e.g. `ui_create_show_committed`                        | e.g. `main_create_project_done`            | Not implemented |
| User **Save**                             | e.g. `ui_save_show_clicked`                            | e.g. `main_save_done` / `main_save_failed` | Not implemented |
| User **Save as**                          | e.g. `ui_save_as_invoked` → `ui_save_as_path_selected` | same as save with path                     | Not implemented |


**Notes:**

- Rows use the **same session log buffer** as Stage 1.
- Preserve `runId` behavior for open; mint early so main and renderer share it.

---

## Stage 3 — Transport (Patch vs Stream workspace headers)

**Goal:** Log **transport controls** in both workspaces distinctly: human interaction **and** engine truth.

### Dimensions

- **Workspace:** `patch` vs `stream` (`extra.workspace` or checkpoint prefix).
- **Command:** play, pause, stop, reset, seek, etc.
- **Layers:** UI intent vs engine ack.

### Illustrative checkpoints


| Layer  | Patch (example)             | Stream (example)             |
| ------ | --------------------------- | ---------------------------- |
| UI     | `ui_patch_transport_play`   | `ui_stream_transport_play`   |
| Engine | `engine_patch_play_started` | `engine_stream_play_started` |


**Status:** Not implemented.

---

## Stage 4 — Patch workspace: seek attribution

**Goal:** Whenever the playhead **seeks**, log **why** (`seek_kind`: `manual`  `drift_correction`  …).

**Status:** Not implemented.

---

## Stage 5 — Stream workspace: scene state machine

**Goal:** Log **every scene state transition** relevant to operators (disabled, ready, **error**, preloading, running, paused, complete, failed, skipped, …).

### Product / UI (ahead of logging)

- The **scene state set** in the app already includes `**error`** (authoring / misconfiguration overlay). Operators see it in the stream **list** State column; **session log rows** for transitions are still **Stage 5** scope.

### Timestamps

- Wall clock + **stream timeline timecode** at the event where applicable.

**Status:** **Not implemented** (logging only; UI/runtime state machine extended as above).

---

## Roadmap Summary


| Stage | Scope                                                                                                                                                                                                                           | Implementation status                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **0** | Show open + hydrate + presentation readiness; main open path; legacy problem UI in Patch header/detail and Stream header/scene                                                                                                  | **Implemented** (session log); legacy problem UI **replaced by Stage 1** |
| **1** | **Session log foundation + domain separation + global problem strip** (footer after runtime label); unify stream validation surfacing; stream messages readable; list/flow/edit authoring highlights; scene runtime `**error`** | **Implemented**                                                          |
| **2** | Open / create / save / save as — UI first beat + backend completion                                                                                                                                                             | Not started                                                              |
| **3** | Patch & Stream transport — UI + engine checkpoints                                                                                                                                                                              | Not started                                                              |
| **4** | Patch seek — manual vs drift correction                                                                                                                                                                                         | Not started                                                              |
| **5** | Stream scene — **log** all state changes (wall + timeline timecode); UI/runtime already includes `**error`** status                                                                                                             | **Not started** (logging only)                                           |


---

## Follow-ups (non-blocking)

- **Throttle:** Repeated `renderer_wait_ready_blocked` should remain interval-based; same for high-frequency validation churn—emit on **edges** only.
- **Performance surface:** When built, optionally mirror **subset** of global strip problems for context.
- **Strip vs structured issues:** Today the strip consumes **string** `validationMessages`; structured `StreamScheduleIssue` exists for authoring—optional future: dedupe or enrich strip items from the same model.

---

## Related Documents

- `docs/stream-workspace-and-runtime-plan.md` — Stream timeline, scene states, transport semantics; footer strip / session log cross-link under “Current implementation context”.
- `src/shared/streamSchedule.ts` — `StreamScheduleIssue`, `getAuthoringIssuesForStreamUi`, `getStreamAuthoringErrorHighlights`, human-readable validation messages for stream authoring.