import type { ShowOpenProfileLogEntry } from '../../../shared/showOpenProfile';
import { subscribeShowOpenProfileUi } from '../../../shared/showOpenProfile';

const MAX_ENTRIES = 400;
const buffer: ShowOpenProfileLogEntry[] = [];
let revision = 0;
const surfaceListeners = new Set<() => void>();

export function getShowOpenProfileLogRevision(): number {
  return revision;
}

export function getShowOpenProfileLogBuffer(): readonly ShowOpenProfileLogEntry[] {
  return buffer;
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

export function pushShowOpenProfileEntry(entry: ShowOpenProfileLogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
  bump();
}

export function clearShowOpenProfileLogBuffer(): void {
  buffer.length = 0;
  bump();
}

/** When the log buffer changes, re-render if the config surface is active (see control.ts). */
export function subscribeShowOpenProfileLogBuffer(callback: () => void): () => void {
  surfaceListeners.add(callback);
  return () => surfaceListeners.delete(callback);
}

/** Wire renderer-originated rows + main process IPC into the buffer. Call once from control bootstrap. */
export function installShowOpenProfileLogBridge(): void {
  subscribeShowOpenProfileUi((entry) => pushShowOpenProfileEntry(entry));
  window.xtream.showOpenProfile.onLog((entry) => pushShowOpenProfileEntry(entry));
}
