import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ControlProjectUiStateV1 } from '../shared/types';

const CONTROL_PROJECT_UI_STATE_FILENAME = 'control-project-ui-state.json';

function normalizeShowProjectKey(configPath: string): string {
  return path.resolve(configPath).toLowerCase();
}

function getControlUiStateFilePath(userDataPath: string): string {
  return path.join(userDataPath, CONTROL_PROJECT_UI_STATE_FILENAME);
}

function readControlUiStateStore(userDataPath: string): Record<string, ControlProjectUiStateV1> {
  try {
    const raw = fs.readFileSync(getControlUiStateFilePath(userDataPath), 'utf8');
    return JSON.parse(raw) as Record<string, ControlProjectUiStateV1>;
  } catch {
    return {};
  }
}

function writeControlUiStateStore(userDataPath: string, store: Record<string, ControlProjectUiStateV1>): void {
  const filePath = getControlUiStateFilePath(userDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function getControlUiStateForPath(userDataPath: string, showFilePath: string): ControlProjectUiStateV1 | undefined {
  return readControlUiStateStore(userDataPath)[normalizeShowProjectKey(showFilePath)];
}

export function saveControlUiStateForPath(userDataPath: string, showFilePath: string, snapshot: ControlProjectUiStateV1): void {
  const key = normalizeShowProjectKey(showFilePath);
  const store = readControlUiStateStore(userDataPath);
  store[key] = snapshot;
  writeControlUiStateStore(userDataPath, store);
}

export async function persistControlUiSnapshotFromRenderer(
  userDataPath: string,
  controlWindow: BrowserWindow | undefined,
  showFilePath: string | undefined,
): Promise<void> {
  if (!controlWindow || controlWindow.isDestroyed() || controlWindow.webContents.isDestroyed() || !showFilePath) {
    return;
  }
  try {
    const raw = await controlWindow.webContents.executeJavaScript('window.__xtreamGetControlUiSnapshot?.() ?? null', true);
    if (!raw || typeof raw !== 'object') {
      return;
    }
    saveControlUiStateForPath(userDataPath, showFilePath, raw as ControlProjectUiStateV1);
  } catch (error: unknown) {
    console.warn('Could not persist control UI snapshot.', error);
  }
}
