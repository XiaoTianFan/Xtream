import type { DirectorState, PreviewStatus, VisualState } from '../../../shared/types';
import { getActiveDisplays, getLayoutVisualIds } from '../../../shared/layouts';
import type { ControlSurface } from '../shared/types';

export function previewSettled(p: PreviewStatus | undefined): boolean {
  return Boolean(p && (p.ready || p.error !== undefined));
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

export function isLaunchPresentationReady(state: DirectorState, activeSurface: ControlSurface): boolean {
  if (!state.readiness.ready) {
    return false;
  }

  if (!state.audioRendererReady) {
    return false;
  }

  const displays = getActiveDisplays(state.displays);
  for (const display of displays) {
    if (display.health !== 'ready') {
      return false;
    }
    for (const visualId of getLayoutVisualIds(display.layout)) {
      const visual = state.visuals[visualId];
      if (state.performanceMode && visual?.kind === 'file' && visual.type === 'video') {
        continue;
      }
      const key = `display:${display.id}:${visualId}`;
      if (!previewSettled(state.previews[key])) {
        return false;
      }
    }
  }

  for (const output of Object.values(state.outputs)) {
    if (output.sources.length > 0 && !output.ready) {
      return false;
    }
  }

  if (activeSurface === 'patch' || activeSurface === 'stream') {
    for (const visual of visualsNeedingPoolPreview(state)) {
      const key = `pool:${visual.id}`;
      if (!previewSettled(state.previews[key])) {
        return false;
      }
    }
  }

  return true;
}

export async function waitForLaunchPresentationReady(options: {
  getActiveSurface: () => ControlSurface;
  setShowStatus?: (message: string) => void;
  timeoutMs?: number;
}): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const timeoutMs = options.timeoutMs ?? 45_000;

  return new Promise<void>((resolve) => {
    let done = false;
    let timeoutId: number | undefined;
    let unsub: (() => void) | undefined;

    const cleanup = (): void => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      unsub?.();
      unsub = undefined;
    };

    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      resolve();
    };

    const tryState = (state: DirectorState): void => {
      if (isLaunchPresentationReady(state, options.getActiveSurface())) {
        finish();
      }
    };

    unsub = window.xtream.director.onState((next) => tryState(next));

    void window.xtream.director.getState().then((state) => tryState(state));

    timeoutId = window.setTimeout(() => {
      options.setShowStatus?.('Some previews took longer than expected; continuing.');
      finish();
    }, timeoutMs);
  });
}
