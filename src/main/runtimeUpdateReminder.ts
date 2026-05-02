import type { BrowserWindow } from 'electron';

import { isRemoteRuntimeNewer, parseRuntimeVersionFromVersionTsSource } from '../shared/runtimeVersionRemote';
import { XTREAM_RUNTIME_VERSION } from '../shared/version';
import { promptShellChoiceModal } from './shellModalBridge';

/** Raw `version.ts` on the default Git branch (same path as the local file). */
export const RUNTIME_VERSION_TS_RAW_URL =
  'https://raw.githubusercontent.com/XiaoTianFan/Xtream/master/src/shared/version.ts';

const FETCH_TIMEOUT_MS = 10_000;

function controlWindowAvailable(getControlWindow: () => BrowserWindow | undefined): boolean {
  const win = getControlWindow();
  return Boolean(win && !win.isDestroyed() && !win.webContents.isDestroyed());
}

/**
 * On launch, fetches `version.ts` from GitHub and, if the published runtime is newer than this build,
 * shows a shell modal (falls back to native dialog if needed). Network or parse failures are ignored.
 */
export async function checkAndPromptRuntimeUpdateReminder(
  getControlWindow: () => BrowserWindow | undefined,
): Promise<void> {
  let text: string;
  try {
    const res = await fetch(RUNTIME_VERSION_TS_RAW_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/plain' },
    });
    if (!res.ok) {
      return;
    }
    text = await res.text();
  } catch {
    return;
  }

  const remote = parseRuntimeVersionFromVersionTsSource(text);
  if (!remote || !isRemoteRuntimeNewer(remote, XTREAM_RUNTIME_VERSION)) {
    return;
  }

  if (!controlWindowAvailable(getControlWindow)) {
    return;
  }

  try {
    await promptShellChoiceModal(
      {
        title: 'Update available',
        message: `A newer Xtream runtime is available (${remote}).`,
        detail: `This copy is ${XTREAM_RUNTIME_VERSION}. Install the latest build when you can — automatic updates are not available yet.`,
        buttons: [{ label: 'OK', variant: 'primary' }],
        defaultId: 0,
        cancelId: 0,
      },
      getControlWindow,
    );
  } catch {
    // Presenting the modal should not affect startup.
  }
}
