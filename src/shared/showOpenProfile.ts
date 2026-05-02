/** Correlates main + renderer timing for opening a show (observability). */
export type ShowOpenProfileFlowContext = {
  runId: string;
  /** `performance.now()` when the renderer open flow started (after IPC returned). */
  flowStartMs: number;
};

/** Attribution for unified session log rows (Config pane + diagnostics). */
export type SessionLogDomain = 'patch' | 'stream' | 'config' | 'global' | 'main';

export type SessionLogKind = 'checkpoint' | 'validation' | 'operation' | 'info';

/**
 * Control session event log — Config → Session log pane.
 *
 * Open-show checkpoints retain `checkpoint` naming (main_* / renderer_*). Other kinds use descriptive `checkpoint`
 * strings (e.g. `patch_readiness_blocked`, `stream_validation_changed`).
 */
export type SessionLogPayload = {
  checkpoint: string;
  runId?: string;
  sinceRunStartMs?: number;
  segmentMs?: number;
  domain?: SessionLogDomain;
  kind?: SessionLogKind;
  extra?: Record<string, unknown>;
};

/** @deprecated Prefer {@link SessionLogPayload} — kept for call sites passing classic open-flow payloads. */
export type ShowOpenProfilePayload = {
  runId: string;
  checkpoint: string;
  sinceRunStartMs: number;
  segmentMs?: number;
  extra?: Record<string, unknown>;
};

export type ShowOpenProfileLogEntry = Omit<SessionLogPayload, 'domain' | 'kind' | 'runId' | 'sinceRunStartMs'> & {
  loggedAt: number;
  source: 'renderer' | 'main';
  runId: string;
  sinceRunStartMs: number;
  domain: SessionLogDomain;
  kind: SessionLogKind;
};

type SessionLogUiListener = (entry: ShowOpenProfileLogEntry) => void;
const sessionLogUiListeners = new Set<SessionLogUiListener>();

export function subscribeSessionLogUi(listener: SessionLogUiListener): () => void {
  sessionLogUiListeners.add(listener);
  return () => sessionLogUiListeners.delete(listener);
}

/** @deprecated Use {@link subscribeSessionLogUi}. */
export function subscribeShowOpenProfileUi(listener: SessionLogUiListener): () => void {
  return subscribeSessionLogUi(listener);
}

function notifySessionLogUi(entry: ShowOpenProfileLogEntry): void {
  for (const listener of sessionLogUiListeners) {
    try {
      listener(entry);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function defaultDomainForPayload(payload: SessionLogPayload, source: 'renderer' | 'main'): SessionLogDomain {
  if (source === 'main') {
    return 'main';
  }
  return payload.checkpoint.startsWith('main_') || payload.checkpoint.startsWith('renderer_') ? 'config' : 'global';
}

function defaultKindForCheckpoint(checkpoint: string): SessionLogKind {
  return checkpoint.startsWith('main_') || checkpoint.startsWith('renderer_') ? 'checkpoint' : 'info';
}

export function normalizeSessionLogEntry(payload: SessionLogPayload, source: 'renderer' | 'main'): ShowOpenProfileLogEntry {
  return {
    ...payload,
    loggedAt: Date.now(),
    source,
    runId: payload.runId ?? 'session',
    sinceRunStartMs: payload.sinceRunStartMs ?? 0,
    domain: payload.domain ?? defaultDomainForPayload(payload, source),
    kind: payload.kind ?? defaultKindForCheckpoint(payload.checkpoint),
  };
}

/** Append a unified session log row from the renderer. */
export function logSessionEvent(payload: SessionLogPayload): void {
  if (typeof window !== 'undefined') {
    notifySessionLogUi(normalizeSessionLogEntry(payload, 'renderer'));
  }
}

/** Classic open-show checkpoints (`domain`: `config`). Main IPC rows use `domain`: `main`. */
export function logShowOpenProfile(payload: ShowOpenProfilePayload): void {
  logSessionEvent({
    checkpoint: payload.checkpoint,
    runId: payload.runId,
    sinceRunStartMs: payload.sinceRunStartMs,
    segmentMs: payload.segmentMs,
    extra: payload.extra,
    domain: 'config',
    kind: 'checkpoint',
  });
}
