import { randomBytes } from 'node:crypto';
import type { BrowserWindow, WebContents } from 'electron';
import { dialog, ipcMain } from 'electron';
import type { ShellModalOpenPayload } from '../shared/modalSpec';

export type PromptShellChoiceInput = Omit<ShellModalOpenPayload, 'correlationId'>;

type PendingModal = {
  resolve: (index: number) => void;
  cancelId: number;
  timer: NodeJS.Timeout;
};

const RESPONSE_CHANNEL = 'control-ui:shell-modal-response';
/** Renderer tears down any visible shell modal when the user closes the window mid-dialog. */
export const SHELL_MODAL_DISMISS_ALL_CHANNEL = 'control-ui:shell-modal-dismiss-all';
/** Wait before assuming the renderer will never answer — resolves with cancelId. */
const SHELL_MODAL_TIMEOUT_MS = 120_000;
/** If `webContents` stays in `isLoading()` longer than this, fall back to a native dialog. */
export const SHELL_WEBCONTENTS_LOAD_WAIT_MS = 15_000;

const pendingModalByCorrelationId = new Map<string, PendingModal>();

export function attachShellModalIpcHandlers(): void {
  ipcMain.removeHandler(RESPONSE_CHANNEL);
  ipcMain.handle(RESPONSE_CHANNEL, (_event, correlationId: unknown, responseIndex: unknown) => {
    if (typeof correlationId !== 'string' || typeof responseIndex !== 'number' || responseIndex < 0) {
      return;
    }
    settleShellModal(correlationId, responseIndex);
  });
}

function settleShellModal(correlationId: string, responseIndex: number): void {
  const entry = pendingModalByCorrelationId.get(correlationId);
  if (!entry) {
    return;
  }
  pendingModalByCorrelationId.delete(correlationId);
  clearTimeout(entry.timer);
  entry.resolve(responseIndex);
}

/**
 * Releases every in-flight modal with its cancel button index — call when WebContents dies.
 */
export function cancelAllPendingShellModals(reason: string): void {
  for (const [correlationId, entry] of pendingModalByCorrelationId) {
    pendingModalByCorrelationId.delete(correlationId);
    clearTimeout(entry.timer);
    console.warn(`${reason}: dismissing pending shell modal`, correlationId);
    entry.resolve(entry.cancelId);
  }
}

/**
 * User closed the control window while a shell modal may still be on screen.
 * Resolve every main-side pending `promptShellChoiceModal` with cancel semantics, then
 * ask the renderer to remove any visible modal (including locally opened ones) so the
 * quit confirmation (or close) can present cleanly.
 */
export function clearShellModalsBeforeWindowClosePrompt(parentWindowGetter: () => BrowserWindow | undefined): void {
  cancelAllPendingShellModals('Window close: superseding open shell modal');
  const win = parentWindowGetter();
  const wc = win?.webContents;
  if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) {
    return;
  }
  wc.send(SHELL_MODAL_DISMISS_ALL_CHANNEL);
}

async function fallbackNativeMessageBox(parent: BrowserWindow | undefined, spec: PromptShellChoiceInput): Promise<number> {
  const buttons = spec.buttons.map((b) => b.label);
  const result = parent
    ? await dialog.showMessageBox(parent, {
        type: 'question',
        buttons,
        defaultId: spec.defaultId,
        cancelId: spec.cancelId,
        title: spec.title,
        message: spec.message,
        detail: spec.detail,
      })
    : await dialog.showMessageBox({
        type: 'question',
        buttons,
        defaultId: spec.defaultId,
        cancelId: spec.cancelId,
        title: spec.title,
        message: spec.message,
        detail: spec.detail,
      });
  return result.response;
}

async function waitForWebContentsLoad(wc: WebContents): Promise<'ready' | 'timeout'> {
  return waitForWebContentsInteractive(wc, SHELL_WEBCONTENTS_LOAD_WAIT_MS);
}

/** Exposed for unit tests (`maxWaitMs`, fake timers, mock `WebContents`). */
export async function waitForWebContentsInteractive(
  wc: WebContents,
  maxWaitMs: number,
): Promise<'ready' | 'timeout'> {
  if (wc.isDestroyed() || typeof wc.isLoading !== 'function' || !wc.isLoading()) {
    return 'ready';
  }
  return await new Promise<'ready' | 'timeout'>((resolve) => {
    let settled = false;
    const finish = (outcome: 'ready' | 'timeout') => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      wc.removeListener('did-finish-load', onLoad);
      resolve(outcome);
    };
    const onLoad = () => finish('ready');
    const timer = setTimeout(() => finish('timeout'), maxWaitMs);
    wc.once('did-finish-load', onLoad);
  });
}

function validateChoiceSpec(spec: PromptShellChoiceInput): void {
  if (spec.buttons.length === 0) {
    throw new Error('Shell modal requires at least one button.');
  }
  if (spec.defaultId < 0 || spec.defaultId >= spec.buttons.length) {
    throw new Error('Shell modal defaultId is out of range.');
  }
  if (spec.cancelId < 0 || spec.cancelId >= spec.buttons.length) {
    throw new Error('Shell modal cancelId is out of range.');
  }
}

/**
 * Opens the in-app shell modal when the control window is ready; otherwise native message box fallback.
 */
export async function promptShellChoiceModal(spec: PromptShellChoiceInput, parentWindowGetter: () => BrowserWindow | undefined): Promise<number> {
  validateChoiceSpec(spec);
  const win = parentWindowGetter();
  const wc = win?.webContents;

  if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) {
    return fallbackNativeMessageBox(win, spec);
  }

  const loadOutcome = await waitForWebContentsLoad(wc);
  if (loadOutcome === 'timeout') {
    console.warn(
      'Shell modal: timed out waiting for control webContents to finish loading; using native message box.',
    );
    return fallbackNativeMessageBox(win, spec);
  }

  if (win.isDestroyed() || wc.isDestroyed()) {
    return fallbackNativeMessageBox(undefined, spec);
  }

  const correlationId = randomBytes(16).toString('hex');
  const payload: ShellModalOpenPayload = { correlationId, ...spec };

  return await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      if (!pendingModalByCorrelationId.has(correlationId)) {
        return;
      }
      settleShellModal(correlationId, spec.cancelId);
    }, SHELL_MODAL_TIMEOUT_MS);
    pendingModalByCorrelationId.set(correlationId, { resolve, cancelId: spec.cancelId, timer });
    wc.send('control-ui:shell-modal-open', payload);
  });
}


