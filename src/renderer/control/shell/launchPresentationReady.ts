import type { DirectorState, PreviewStatus, VisualState } from '../../../shared/types';
import { getActiveDisplays, getLayoutVisualIds } from '../../../shared/layouts';
import { logShowOpenProfile } from '../../../shared/showOpenProfile';
import type { ControlSurface } from '../shared/types';

export function previewSettled(p: PreviewStatus | undefined): boolean {
  return Boolean(p && (p.ready || p.error !== undefined));
}

function previewDescribe(p: PreviewStatus | undefined): string {
  if (!p) {
    return 'missing';
  }
  if (p.ready) {
    return 'ready';
  }
  if (p.error !== undefined) {
    return `error:${p.error}`;
  }
  return 'pending';
}

function visualsNeedingPoolPreview(state: DirectorState): VisualState[] {
  return Object.values(state.visuals).filter((v) => {
    if (v.kind === 'live') {
      return true;
    }
    if (v.kind !== 'file') {
      return false;
    }
    return (v.type === 'image' || v.type === 'video') && Boolean(v.url);
  });
}

/** Human-readable first blocking condition for launch presentation readiness (null if ready). */
export function getLaunchPresentationBlockReason(state: DirectorState, activeSurface: ControlSurface): string | null {
  if (!state.readiness.ready) {
    return `readiness:not_ready:issues=${state.readiness.issues.length}`;
  }

  if (!state.audioRendererReady) {
    return 'audio_renderer:not_ready';
  }

  const displays = getActiveDisplays(state.displays);
  for (const display of displays) {
    if (display.health !== 'ready') {
      return `display_health:${display.id}:${display.health}`;
    }
    for (const visualId of getLayoutVisualIds(display.layout)) {
      const visual = state.visuals[visualId];
      if (state.performanceMode && visual?.kind === 'file' && visual.type === 'video') {
        continue;
      }
      const key = `display:${display.id}:${visualId}`;
      if (!previewSettled(state.previews[key])) {
        return `preview_not_settled:${key}:${previewDescribe(state.previews[key])}`;
      }
    }
  }

  for (const output of Object.values(state.outputs)) {
    if (output.sources.length > 0 && !output.ready) {
      return `output_not_ready:${output.id}`;
    }
  }

  if (activeSurface === 'patch' || activeSurface === 'stream') {
    for (const visual of visualsNeedingPoolPreview(state)) {
      const key = `pool:${visual.id}`;
      if (!previewSettled(state.previews[key])) {
        return `pool_preview_not_settled:${key}:${previewDescribe(state.previews[key])}`;
      }
    }
  }

  return null;
}

export function isLaunchPresentationReady(state: DirectorState, activeSurface: ControlSurface): boolean {
  return getLaunchPresentationBlockReason(state, activeSurface) === null;
}

export async function waitForLaunchPresentationReady(options: {
  getActiveSurface: () => ControlSurface;
  setShowStatus?: (message: string) => void;
  timeoutMs?: number;
  showOpenProfile?: { runId: string; flowStartMs: number };
}): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const timeoutMs = options.timeoutMs ?? 45_000;
  const waitSectionStart = performance.now();

  return new Promise<void>((resolve) => {
    let done = false;
    let timeoutId: number | undefined;
    let pollId: number | undefined;
    let unsub: (() => void) | undefined;
    let lastLoggedReason = '';

    const cleanup = (): void => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (pollId !== undefined) {
        window.clearInterval(pollId);
        pollId = undefined;
      }
      unsub?.();
      unsub = undefined;
    };

    const finish = (extra?: Record<string, unknown>): void => {
      if (done) {
        return;
      }
      done = true;
      if (options.showOpenProfile) {
        const { runId, flowStartMs } = options.showOpenProfile;
        logShowOpenProfile({
          runId,
          checkpoint: 'renderer_wait_ready_done',
          sinceRunStartMs: performance.now() - flowStartMs,
          extra: { waitSectionMs: performance.now() - waitSectionStart, ...extra },
        });
      }
      cleanup();
      resolve();
    };

    const tryState = (state: DirectorState): void => {
      if (isLaunchPresentationReady(state, options.getActiveSurface())) {
        finish();
      }
    };

    if (options.showOpenProfile) {
      const { runId, flowStartMs } = options.showOpenProfile;
      logShowOpenProfile({
        runId,
        checkpoint: 'renderer_wait_ready_enter',
        sinceRunStartMs: performance.now() - flowStartMs,
        extra: { afterRafMs: performance.now() - waitSectionStart },
      });
      pollId = window.setInterval(() => {
        void window.xtream.director.getState().then((state) => {
          const reason = getLaunchPresentationBlockReason(state, options.getActiveSurface());
          if (reason === null) {
            return;
          }
          if (reason !== lastLoggedReason) {
            lastLoggedReason = reason;
            logShowOpenProfile({
              runId,
              checkpoint: 'renderer_wait_ready_blocked',
              sinceRunStartMs: performance.now() - flowStartMs,
              extra: { reason },
            });
          }
        });
      }, 400);
    }

    unsub = window.xtream.director.onState((next) => tryState(next));

    void window.xtream.director.getState().then((state) => tryState(state));

    timeoutId = window.setTimeout(() => {
      if (done) {
        return;
      }
      options.setShowStatus?.('Some previews took longer than expected; continuing.');
      void window.xtream.director.getState().then((state) => {
        if (done) {
          return;
        }
        const reason = getLaunchPresentationBlockReason(state, options.getActiveSurface());
        finish({ timedOut: true, lastBlockReason: reason });
      });
    }, timeoutMs);
  });
}
