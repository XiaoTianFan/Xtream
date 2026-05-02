import type { ShowOpenProfileLogEntry } from '../../../shared/showOpenProfile';
import { subscribeSessionLogUi } from '../../../shared/showOpenProfile';

const MAX_ENTRIES = 400;
const buffer: ShowOpenProfileLogEntry[] = [];
let revision = 0;
const surfaceListeners = new Set<() => void>();
let afterClearHooks = new Set<() => void>();
let sessionLogBridgeInstalled = false;

export function onSessionLogBufferClear(hook: () => void): () => void {
  afterClearHooks.add(hook);
  return () => afterClearHooks.delete(hook);
}

export function getSessionLogRevision(): number {
  return revision;
}

/** @deprecated Use {@link getSessionLogRevision}. */
export function getShowOpenProfileLogRevision(): number {
  return getSessionLogRevision();
}

export function getSessionLogBuffer(): readonly ShowOpenProfileLogEntry[] {
  return buffer;
}

/** @deprecated Use {@link getSessionLogBuffer}. */
export function getShowOpenProfileLogBuffer(): readonly ShowOpenProfileLogEntry[] {
  return getSessionLogBuffer();
}

function bump(): void {
  revision += 1;
  for (const listener of surfaceListeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function pushSessionLogEntry(entry: ShowOpenProfileLogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
  bump();
}

/** @deprecated Use {@link pushSessionLogEntry}. */
export function pushShowOpenProfileEntry(entry: ShowOpenProfileLogEntry): void {
  pushSessionLogEntry(entry);
}

export function clearSessionLogBuffer(): void {
  buffer.length = 0;
  bump();
  for (const hook of afterClearHooks) {
    try {
      hook();
    } catch {
      /* ignore */
    }
  }
}

/** @deprecated Use {@link clearSessionLogBuffer}. */
export function clearShowOpenProfileLogBuffer(): void {
  clearSessionLogBuffer();
}

export function subscribeSessionLogBuffer(callback: () => void): () => void {
  surfaceListeners.add(callback);
  return () => surfaceListeners.delete(callback);
}

/** @deprecated Use {@link subscribeSessionLogBuffer}. */
export function subscribeShowOpenProfileLogBuffer(callback: () => void): () => void {
  return subscribeSessionLogBuffer(callback);
}

export function installSessionLogBridge(): void {
  if (sessionLogBridgeInstalled) {
    return;
  }
  sessionLogBridgeInstalled = true;
  subscribeSessionLogUi((entry) => pushSessionLogEntry(entry));
  window.xtream.sessionLog.onEntry((entry) => pushSessionLogEntry(entry));
}

/** @deprecated Use {@link installSessionLogBridge}. */
export function installShowOpenProfileLogBridge(): void {
  installSessionLogBridge();
}
