import type { DirectorState } from '../../../shared/types';
import { elements } from '../shell/elements';
import type { ControlSurface } from '../shared/types';

export type SurfaceController = {
  id: ControlSurface;
  mount?: () => void;
  unmount?: () => void;
  createRenderSignature?: (state: DirectorState) => string;
  render: (state: DirectorState) => void;
};

type SurfaceRouterOptions = {
  surfaces: SurfaceController[];
  initialSurface?: ControlSurface;
  getCurrentState: () => DirectorState | undefined;
};

export type SurfaceRouter = {
  getActiveSurface: () => ControlSurface;
  setActiveSurface: (surface: ControlSurface) => void;
  render: (state: DirectorState) => void;
};

export function createSurfaceRouter({ surfaces, initialSurface = 'patch', getCurrentState }: SurfaceRouterOptions): SurfaceRouter {
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  let activeSurface = initialSurface;
  let mountedSurface: ControlSurface | undefined;
  let surfaceRenderSignature = '';

  function getActiveSurface(): ControlSurface {
    return activeSurface;
  }

  function setActiveSurface(surface: ControlSurface): void {
    if (!surfaceById.has(surface)) {
      return;
    }
    activeSurface = surface;
    surfaceRenderSignature = '';
    const state = getCurrentState();
    if (state) {
      render(state);
    } else {
      syncShellState();
    }
  }

  function render(state: DirectorState): void {
    syncShellState();
    const controller = surfaceById.get(activeSurface);
    if (!controller) {
      return;
    }
    if (mountedSurface !== activeSurface) {
      surfaceById.get(mountedSurface as ControlSurface)?.unmount?.();
      mountedSurface = activeSurface;
      controller.mount?.();
    }
    const signature = controller.createRenderSignature?.(state);
    if (signature !== undefined && surfaceRenderSignature === signature) {
      return;
    }
    surfaceRenderSignature = signature ?? '';
    controller.render(state);
  }

  function syncShellState(): void {
    const isPatch = activeSurface === 'patch';
    syncRailState();
    elements.appFrame.classList.toggle('surface-mode', !isPatch);
    elements.patchSurface.hidden = !isPatch;
    elements.surfacePanel.hidden = isPatch;
  }

  function syncRailState(): void {
    const railButtons: Record<ControlSurface, HTMLButtonElement> = {
      patch: elements.patchRailButton,
      cue: elements.cueRailButton,
      performance: elements.performanceRailButton,
      config: elements.configRailButton,
      logs: elements.logsRailButton,
    };
    for (const [surface, button] of Object.entries(railButtons) as Array<[ControlSurface, HTMLButtonElement]>) {
      const active = activeSurface === surface;
      button.classList.toggle('active', active);
      if (active) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }
  }

  syncShellState();

  return {
    getActiveSurface,
    setActiveSurface,
    render,
  };
}
