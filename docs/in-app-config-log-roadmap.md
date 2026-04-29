# In-App Config Log Enrichment — Roadmap

## Purpose

The Config surface includes a bottom pane that today shows the **Show open profile log**: structured checkpoints while a show is opening (and related readiness timing). The product goal is to **grow this into a broader in-app activity log** that records meaningful user operations and backend effects across Patch, Stream, and shared show infrastructure—without dumping noise into the pane.

Work proceeds **in stages**. This document is the **canonical checklist**: what we want to log, what is already implemented, and what remains. Implementation details (naming refactors, unified log types, IPC shape) can follow later; this file tracks **intent and coverage**.

## Current Implementation (Baseline)

### Where it lives

| Piece | Role |
| --- | --- |
| `src/shared/showOpenProfile.ts` | Shared types, `logShowOpenProfile` (renderer), checkpoint naming notes in file header |
| `src/renderer/control/config/showOpenProfileUi.ts` | In-memory ring buffer (400 rows), clear + subscribe for UI refresh |
| `src/renderer/control/config/configSurface.ts` | Renders the log card, formats lines, includes buffer in diagnostics export |
| `src/main/main.ts` | Forwards main-process checkpoints via IPC (`forwardShowOpenProfileFromMain`) during open path |
| `src/preload/preload.ts` | `showOpenProfile.onLog` bridge |

### Row format today

Each entry carries `loggedAt` (wall time, ms), `source` (`renderer` \| `main`), `runId`, `checkpoint`, `sinceRunStartMs`, optional `segmentMs`, optional `extra`. The UI prints ISO-derived time-of-day, source, truncated `runId`, checkpoint, offsets, and JSON `extra`.

### Checkpoints already implemented (show open / readiness pipeline)

These are **done** for the open-show flow. They assume a per-open `runId`; renderer uses `performance.now()`-based `sinceRunStartMs` from `flowStartMs`, main uses `Date.now() - t0` from the same run (see `openShowConfigPath` in main).

**Main process** (`main_*`):

| Checkpoint | Meaning (short) |
| --- | --- |
| `main_open_path_enter` | open path started |
| `main_read_config_done` | JSON/config read from disk |
| `main_restore_enter` … `main_restore_exit` | inner restore sequence (validate media, build URLs, close displays, director restore, register displays, stream engine load) |
| `main_validate_media_done` | media validation finished |
| `main_build_media_urls_done` | media URL build finished |
| `main_display_close_all_done` | all display windows closed |
| `main_director_restore_done` | director state restored |
| `main_displays_register_done` | displays recreated and registered |
| `main_stream_engine_load_done` | stream engine loaded from show |
| `main_restore_call_done` | `restoreShowConfigFromDiskConfig` returned |
| `main_add_recent_done` | recent list updated |
| `main_open_path_exit` | open path finished |

**Renderer** (`renderer_*`):

| Checkpoint | Meaning (short) |
| --- | --- |
| `renderer_open_flow_start` | renderer open flow started; `extra.route`: `menu_open` \| `launch_dashboard` \| (create path: *not yet first-class*) |
| `renderer_after_first_render_state` | first `renderState` after open |
| `renderer_hydrate_*` | control UI snapshot hydrate (`enter`, `after_control_ui_get`, `skip_no_snapshot`, `after_patch_apply`, `after_stream_get_state`, `exit`) |
| `renderer_before_wait_ready` | about to wait for presentation readiness |
| `renderer_wait_ready_enter` | entered readiness wait |
| `renderer_wait_ready_blocked` | still blocked; `extra.reason` rotates when it changes |
| `renderer_wait_ready_done` | readiness satisfied (or continued after timeout path) |
| `renderer_open_flow_done` | open flow complete |

**Not logged today (gaps relative to “first meaningful user action”):**

- Explicit **“user chose to open / create / save”** at the instant of UI interaction (before dialogs or IPC), including chosen path or project identity where safe to record.
- **Save** and **Save as** operations (no profile rows).
- **Create new project** flow end-to-end (only partially overlaps open flow once a path exists).

---

## Design Principles (for all future stages)

1. **Two beats per important operation where it matters**  
   - **UI intent**: user clicked / confirmed / selected (local, fast).  
   - **Backend effect**: main or engine confirmed work started or finished (authoritative for “when it actually happened”).

2. **Correlation**  
   - Reuse or extend `runId` (or introduce `operationId`) so one user gesture chains to many checkpoints without guessing.

3. **Timestamps**  
   - Keep **wall clock** (`loggedAt` or explicit ISO in `extra` when needed).  
   - For Stream timeline-related events, also record **timeline-relative timecode** (see Stage 4)—the calculated timeline position, not only “seconds since boot.”

4. **Workspace attribution**  
   - Log lines should be attributable to **Patch**, **Stream**, **Config**, **global**, or **main** so operators can filter mentally and we can extend filtering in the UI later.

5. **Stage discipline**  
   - Land one stage at a time; extend buffer/format/export when the schema stabilizes.

---

## Stage 1 — Project & show lifecycle (priority)

**Goal:** Extend logging so the **first** checkpoint in a session is not “inside restore” but **the operator’s decision**, then chain into existing open/hydrate/wait-ready rows.

### Desired events

| Event | UI checkpoint (proposed) | Backend / effect checkpoint (proposed) | Status |
| --- | --- | --- | --- |
| User initiates **Open** (menu / keyboard) | e.g. `ui_open_show_invoked` | — | Not implemented |
| User picks file / confirms open dialog | e.g. `ui_open_show_path_selected` (`extra.path` or hash) | *(already)* `main_open_path_enter` … | Partially (backend only after path known) |
| User initiates **Create** | e.g. `ui_create_show_invoked` | main/create path start | Not implemented |
| New project path chosen & project created | e.g. `ui_create_show_committed` | e.g. `main_create_project_done` | Not implemented |
| User **Save** | e.g. `ui_save_show_clicked` | e.g. `main_save_done` / `main_save_failed` | Not implemented |
| User **Save as** | e.g. `ui_save_as_invoked` → `ui_save_as_path_selected` | same as save with path | Not implemented |

**Notes:**

- Tie Stage 1 rows into the **same log buffer** (or a backward-compatible superset type) so Config keeps one timeline.
- Preserve existing `runId` behavior for open: first row after user confirms could mint `runId` before calling `openShowConfigPath` so main and renderer share it from the true start.

---

## Stage 2 — Transport (Patch vs Stream workspace headers)

**Goal:** Log **transport controls** in both workspaces distinctly: human interaction **and** engine truth.

### Dimensions

- **Workspace:** `patch` vs `stream` (distinct checkpoint prefixes or `extra.workspace`).
- **Command:** play, pause, stop, reset, seek (where applicable), and any future header actions.
- **Layers:**  
  - **UI:** button / shortcut fired.  
  - **Engine:** video and audio actually **started**, **paused**, **stopped**, **reset**, seek applied (split if video/audio diverge).

### Desired events (illustrative checkpoints)

| Layer | Patch (example) | Stream (example) |
| --- | --- | --- |
| UI | `ui_patch_transport_play` | `ui_stream_transport_play` |
| Engine ack | `engine_patch_play_started` | `engine_stream_play_started` |
| … | pause / stop / reset variants | pause / stop / reset variants |

**Status:** Not implemented (transport today does not emit in-app log rows).

---

## Stage 3 — Patch workspace: seek attribution

**Goal:** Whenever the playhead **seeks**, log **why**:

- **Manual seek** (scrubber, keyboard, explicit operator gesture).
- **Automatic seek** (e.g. **drift correction** or other sync logic).

### Desired fields (conceptual)

- `seek_kind`: `manual` \| `drift_correction` \| *(extensible)*  
- Optional: from/to positions, and correlation to transport state.

**Status:** Not implemented.

---

## Stage 4 — Stream workspace: scene state machine

**Goal:** Log **every scene state transition** relevant to operators and debugging, not only “play” and “end.”

### States to cover

Align with product/runtime vocabulary (including): **disabled**, **ready**, **preloading**, **running**, **paused**, **complete**, **failed**, **skipped**, and any intermediate transitions the runtime emits.

### Timestamps on each row

- **Local machine time** (wall; same family as `loggedAt`).
- **Stream timeline timecode** at the event: position on the **calculated / playback** timeline (exact field TBD per implementation, but the log line must carry both “when locally” and “where on the show clock”).

### Illustrative checkpoints

- `stream_scene_state` with `extra.sceneId`, `extra.from`, `extra.to`, `extra.timelineTc`, `extra.localIso` (or rely on top-level `loggedAt` + `extra.timelineTc` only).

**Status:** Not implemented.

---

## Roadmap Summary

| Stage | Scope | Implementation status |
| --- | --- | --- |
| **0** | Show open + hydrate + presentation readiness; main open path | **Implemented** (see tables above) |
| **1** | Open / create / save / save as — UI first beat + backend completion | **Not started** |
| **2** | Patch & Stream transport — UI + engine checkpoints | **Not started** |
| **3** | Patch seek — manual vs drift correction | **Not started** |
| **4** | Stream scene — all state changes; wall + timeline timecode | **Not started** |

---

## Follow-ups (non-blocking)

- **UI copy:** The pane title “Show open profile log” will eventually mislead; rename when Stage 1 lands (e.g. “Activity log” or “Session log”) and adjust empty-state hint text.
- **Schema:** `ShowOpenProfile*` names may be generalized to an **app activity log** module while keeping JSON/export compatibility for diagnostics.
- **Volume:** Interval-based logs (e.g. repeated `wait_ready_blocked`) should not be the pattern for high-frequency events; prefer state transitions or throttling for transport/scene logs.

---

## Related Documents

- `docs/stream-workspace-and-runtime-plan.md` — Stream timeline, scene states, transport semantics.
- `src/shared/showOpenProfile.ts` — Current checkpoint documentation in source.
